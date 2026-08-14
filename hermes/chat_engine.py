"""The conversational chat turn: MCP tool dispatch, start_task auto-routing,
the pending write-action gate, and fact learning.

Transport-agnostic on purpose. This used to live only inside
`hermes/web_ui.py`'s FastAPI closures; the Telegram bot's free-text messages
answered with a canned greeting instead of reaching any of it. Splitting the
same behavior into two copies for two transports is exactly the drift
`docs/TODO.md`'s "what went wrong three times" section warns about, except
for logic instead of prose — so there is one engine, and both `web_ui.py` and
`hermes/main.py`'s Telegram wiring call the same instance.
"""
from __future__ import annotations
import asyncio
import inspect
import json
import re
from pathlib import Path

from . import brain, config, ics, imagegen, launcher, mcp_hub, mcp_risk, paths, postmortem, uploads, ytclip
from .pending_actions import PendingAction, PendingStore
from .project_resolve import parse_project_ref
from .telegram_bridge import new_task_id

CHAT_HISTORY_LIMIT = 20   # turns fed back to the model — caps prompt cost
IMAGE_MARKER = "\n\n[gambar dilampirkan]"

# How long the start_task tool waits for handle_task to settle its gate before
# answering the model. The slow part is one `git status` subprocess, so this is
# generous; the task itself keeps running in the background either way.
START_TASK_DECISION_TIMEOUT_S = 5.0

# Code work aimed at a registered @project is routed into start_task by THIS
# code, not by the model's judgement. See wants_code_task below for the full
# rationale (moved verbatim from web_ui.py).
_QUESTION = re.compile(
    r"^\s*(apa\w*|kenapa|mengapa|gimana|bagaimana|berapa|kapan|siapa|mana|"
    r"why|what|how|when|where|which|who|is|are|does|do|can|should)\b", re.I)
_DISCUSSION = re.compile(
    r"^\s*(jelas\w*|terangkan|uraikan|ringkas\w*|rangkum\w*|analis\w*|"
    r"bandingkan|review|telaah|periksa|cek|baca|lihat|"
    r"explain|describe|summar\w*|compare|analyz\w*|analys\w*|show me)\b", re.I)


def wants_code_task(text: str, settings, session_project: str | None = None) -> bool:
    """True when this chat turn is code work on a registered project.

    Unregistered names are left alone on purpose: start_task would only reject
    them, and the model's own answer (which lists the registered names) is the
    more useful reply.
    """
    name, rest = parse_project_ref(text)
    if name is None and session_project:
        name = session_project
    if name is None or name not in settings.projects:
        return False
    if not rest.strip():
        return False               # the sigil alone asks for nothing
    if rest.rstrip().endswith("?") or _QUESTION.match(rest):
        return False
    return not _DISCUSSION.match(rest)


AUTO_TASK_NOTE = (
    "[SISTEM] Permintaan ini menyebut proyek terdaftar dan menyangkut kode, "
    "jadi `start_task` SUDAH dijalankan otomatis untuk teks itu apa adanya. "
    "Hasil alat: {result}\n"
    "Laporkan `status`, `reasons`, dan Task ID di atas apa adanya — `running` "
    "berarti task baru mulai, bukan selesai. JANGAN memanggil `start_task` "
    "lagi untuk permintaan ini dan JANGAN menulis patch/diff di chat: yang "
    "mengerjakan kodenya adalah task itu."
)

# Sent as the last user turn of a resume request, never stored. The retry
# policy lives here rather than in a server-side loop on purpose: re-calling
# a write tool blind can repeat its side effect, so the model — which can
# read the error and fix the arguments — decides whether a second attempt is
# safe, and it is told plainly that stopping quietly is not an option.
RESUME_NUDGE = (
    "Aksi yang tadi tertahan sudah dieksekusi dan hasilnya ada di pesan terakhir. "
    "Periksa hasil itu dulu: kalau berhasil, lanjutkan rencanamu ke langkah "
    "berikutnya tanpa menunggu perintah baru. Kalau hasilnya error atau kosong, "
    "JANGAN mengaku berhasil dan jangan berhenti — perbaiki argumennya lalu "
    "panggil tool-nya lagi, atau tempuh cara lain untuk tujuan yang sama. "
    "Kalau sudah dicoba ulang dan tetap gagal, sebutkan jelas apa yang gagal "
    "dan apa yang kamu butuhkan dari operator."
)

# Tools the conversational agent may call. A curated, safe set — read-only
# system queries plus start_task, which only ever QUEUES a task held for the
# operator's one-tap confirm (bridge.handle_task force_confirm). Deliberately
# not the MCP hub: that exposes ask_user, which would deadlock a chat turn.
CHAT_TOOLS = [
    {"type": "function", "function": {
        "name": "list_projects",
        "description": "Daftar proyek terdaftar beserta path dan apakah foldernya ada di disk.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "recent_tasks",
        "description": "Beberapa task orkestrasi terakhir beserta status dan teksnya.",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "description": "jumlah maksimal, default 5"}}}}},
    {"type": "function", "function": {
        "name": "get_task_detail",
        "description": "Status dan potongan log terakhir sebuah task, berdasarkan task_id.",
        "parameters": {"type": "object", "properties": {
            "task_id": {"type": "string"}}, "required": ["task_id"]}}},
    {"type": "function", "function": {
        "name": "failure_report",
        "description": ("Ringkasan kegagalan task terakhir, dikelompokkan menurut jenisnya "
                        "(lingkungan / struktural / sesaat / kode) beserta yang berulang. "
                        "Pakai ini bila ditanya kenapa task sering gagal atau apa yang "
                        "perlu diperbaiki — jangan menebak dari ingatan."),
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "description": "berapa task terakhir diperiksa, default 50"}}}}},
    {"type": "function", "function": {
        "name": "start_task",
        "description": ("Antre lalu jalankan task orkestrasi. Bila permintaan menyebut "
                        "@nama-proyek, repositorinya bersih, dan pekerjaannya tidak "
                        "berisiko (push/deploy/hapus), task LANGSUNG berjalan; selain "
                        "itu task ditahan sampai operator menekan Run. Hasil pemanggilan "
                        "berisi status sebenarnya beserta alasannya — pakai itu, jangan "
                        "menebak."),
        "parameters": {"type": "object", "properties": {
            "description": {"type": "string",
                            "description": "instruksi task, mis. '@myprofit jalankan pengujian'"}},
            "required": ["description"]}}},
    {"type": "function", "function": {
        "name": "calendar_events",
        "description": ("Acara Google Calendar yang akan datang, dibaca dari alamat "
                        "iCal rahasia di setelan. Read-only — tidak bisa membuat, "
                        "mengubah, atau menghapus acara. Pakai ini bila ditanya "
                        "jadwal, rapat, atau agenda; jangan menebak dari ingatan."),
        "parameters": {"type": "object", "properties": {
            "days": {"type": "integer",
                     "description": "rentang hari ke depan, default 7, maksimal 60"}}}}},
    {"type": "function", "function": {
        "name": "open_app",
        "description": ("Buka aplikasi desktop yang dikenal (mis. paint, notepad, calculator, "
                        "explorer, wordpad) ATAU sebuah URL http/https, langsung di komputer "
                        "pengguna. Langsung DIBUKA tanpa konfirmasi operator — bukan aksi "
                        "tertahan. Setelah status 'opened', katakan sudah dibuka. Hanya app "
                        "dalam daftar aman yang bisa; lainnya balas 'unknown_app'."),
        "parameters": {"type": "object", "properties": {
            "target": {"type": "string",
                       "description": "nama app (mis. 'paint') atau URL (mis. 'https://calendar.google.com')"}},
            "required": ["target"]}}},
    {"type": "function", "function": {
        "name": "generate_image",
        "description": ("Buat/generate gambar dari deskripsi teks dan tampilkan ke "
                        "pengguna. Pakai ini bila pengguna minta dibuatkan gambar, "
                        "ilustrasi, logo, ikon, atau foto. Hasilnya berisi field "
                        "`markdown` — sertakan APA ADANYA di jawabanmu agar gambarnya "
                        "muncul. Jangan mengarang bahwa gambar sudah dibuat tanpa "
                        "memanggil alat ini."),
        "parameters": {"type": "object", "properties": {
            "prompt": {"type": "string",
                       "description": "deskripsi gambar dalam bahasa apa pun, sedetail mungkin"}},
            "required": ["prompt"]}}},
    {"type": "function", "function": {
        "name": "youtube_clip",
        "description": ("Potong sebuah klip dari video YouTube (atau URL video lain) "
                        "pada rentang waktu tertentu, lalu tampilkan ke pengguna. "
                        "Pakai bila pengguna minta dibuatkan klip/potongan/cuplikan "
                        "video dari sebuah tautan. Hasilnya berisi field `markdown` — "
                        "sertakan APA ADANYA di jawabanmu agar videonya muncul."),
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "URL video, mis. https://youtube.com/watch?v=..."},
            "start": {"type": "string", "description": "waktu mulai, detik atau MM:SS / HH:MM:SS"},
            "end": {"type": "string", "description": "waktu selesai, detik atau MM:SS / HH:MM:SS"},
            "vertical": {"type": "string", "enum": ["blur", "crop", "none"],
                         "description": "format 9:16 untuk Shorts/TikTok: 'blur' (utuh+background blur, DEFAULT), 'crop' (potong tengah), 'none' (rasio asli)."}},
            "required": ["url", "start", "end"]}}},
    {"type": "function", "function": {
        "name": "viral_clip",
        "description": ("Analisa sebuah video YouTube dan otomatis potong bagian yang "
                        "PALING BERPOTENSI VIRAL — memakai data 'most replayed' "
                        "(bagian yang paling banyak diputar ulang penonton) dari "
                        "YouTube. Pakai bila pengguna minta 'carikan bagian viral', "
                        "'potong yang menarik', atau memberi URL tanpa waktu mulai/"
                        "selesai. Durasi maksimal default 60 detik (1 menit). Hasilnya "
                        "berisi `markdown` (sertakan APA ADANYA agar video tampil), "
                        "serta `start`/`end`/`reason`."),
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "URL video YouTube"},
            "max_seconds": {"type": "integer",
                            "description": "durasi maks klip dalam detik, default 60 (maks 60)"},
            "vertical": {"type": "string", "enum": ["blur", "crop", "none"],
                         "description": "format 9:16 Shorts/TikTok, default 'blur' (utuh+background blur). 'crop' potong tengah, 'none' rasio asli."}},
            "required": ["url"]}}},
    {"type": "function", "function": {
        "name": "viral_clips",
        "description": ("Hasilkan BEBERAPA (default 3) kandidat klip viral dari satu "
                        "video YouTube sekaligus: tiap kandidat adalah bagian yang "
                        "paling banyak diputar ulang, LENGKAP dengan judul viral yang "
                        "dibuatkan otomatis. Pakai bila pengguna minta 'beberapa "
                        "kandidat', 'top 3', atau pilihan klip. Hasil berisi daftar "
                        "`candidates`, tiap item punya `title`, `start`, `end`, dan "
                        "`markdown` — tampilkan SETIAP `markdown` apa adanya agar "
                        "semua videonya muncul."),
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "URL video YouTube"},
            "count": {"type": "integer", "description": "jumlah kandidat, default 3 (maks 3)"},
            "max_seconds": {"type": "integer",
                            "description": "durasi maks tiap klip, default 60 (maks 60)"},
            "vertical": {"type": "string", "enum": ["blur", "crop", "none"],
                         "description": "format 9:16 Shorts/TikTok, default 'blur'. 'crop' potong tengah, 'none' rasio asli."}},
            "required": ["url"]}}},
]


class ChatEngine:
    """One conversational agent, shared by every transport that talks to it.

    `bridge` is mutable and may start as None: `hermes/main.py` builds the
    engine before the Bridge exists (the Bridge needs a sender the bot
    constructs later), and fills it in once ready. `pending` may be handed in
    so two transports (web + Telegram) share one write-action queue.
    """

    def __init__(self, store, bridge=None, hub=None, facts=None,
                 pending: PendingStore | None = None):
        self.store = store
        self.bridge = bridge
        self.hub = hub
        self.facts = facts
        self.pending = pending if pending is not None else PendingStore()
        self._mcp_tools_cache = None

    def brain_context(self) -> dict:
        s = config.load_settings()
        return {"role": "system",
                "content": brain.context_block(self.store.list_facts(),
                                               self.store.list_tasks(limit=20),
                                               list(s.projects))}

    def history_with_context(self, sid: str, images: list[Path] | None = None) -> list[dict]:
        history = [self.brain_context(), *self.store.get_messages(sid, limit=CHAT_HISTORY_LIMIT)]
        if images and history[-1]["role"] == "user":
            said = history[-1]["content"].replace(IMAGE_MARKER, "")
            history[-1] = {"role": "user",
                           "content": uploads.as_content_parts(said, images)}
        return history

    async def history_for_turn(self, sid: str, text: str, images: list[Path] | None,
                               dispatch) -> tuple[list[dict], str | None]:
        history = self.history_with_context(sid, images)
        sess = self.store.get_session(sid)
        sproj = sess.get("project") if sess else None
        if not (text and wants_code_task(text, config.load_settings(), session_project=sproj)):
            return history, None
        result = await dispatch("start_task", {"description": text})
        try:
            task_id = json.loads(result).get("task_id")
        except ValueError:
            task_id = None
        return ([*history, {"role": "user",
                            "content": AUTO_TASK_NOTE.format(result=result)}],
                task_id)

    def task_card_suffix(self, reply: str, task_id: str | None,
                         template: str = "\n\nTask `{tid}`") -> str:
        if not task_id or task_id in reply:
            return ""
        return template.format(tid=task_id)

    def take_images(self, sid: str, names: list[str]) -> list[Path]:
        found = [uploads.resolve(paths.uploads_dir(), sid, n) for n in names or []]
        return [p for p in found if p is not None]

    def attach_images_to_task(self, desc: str, images: list[Path]) -> str:
        if not images:
            return desc
        name, _ = parse_project_ref(desc)
        proj = name and config.load_settings().projects.get(name)
        if not proj or not Path(proj).is_dir():
            return desc
        import shutil
        dest_dir = Path(proj) / ".hermes-uploads"
        dest_dir.mkdir(exist_ok=True)
        saved = []
        for img in images:
            dest = dest_dir / img.name
            try:
                shutil.copy2(img, dest)
            except OSError:
                continue
            saved.append(f".hermes-uploads/{img.name}")
        if not saved:
            return desc
        return desc + "\n\n[Gambar terlampir di: " + ", ".join(saved) + "]"

    async def learn_from_turn(self, user_text: str, reply: str) -> None:
        if self.facts is None or not reply.strip():
            return
        if not brain.worth_extracting(user_text):
            return
        try:
            for f in await self.facts(user_text, reply):
                self.store.set_fact(f["key"], f["value"])
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            print(f"Could not learn from turn: {safe}")

    def make_dispatch(self, session_id: str, images: list[Path] | None = None,
                      chat_id: int = 0, user_id: int = 0):
        started: dict = {}
        pending_created: list[PendingAction] = []

        async def chat_dispatch(name: str, args: dict) -> str:
            try:
                if name == "list_projects":
                    s = config.load_settings()
                    return json.dumps(
                        [{"name": n, "path": p, "exists": Path(p).exists()}
                         for n, p in s.projects.items()], ensure_ascii=False)
                if name == "recent_tasks":
                    limit = int(args.get("limit") or 5)
                    rows = [t for t in self.store.list_tasks() if t.get("chat_id", 0) >= 0][:limit]
                    return json.dumps(
                        [{"task_id": t["task_id"], "status": t["status"], "text": t["text"]}
                         for t in rows], ensure_ascii=False)
                if name == "get_task_detail":
                    tid = str(args.get("task_id") or "")
                    t = self.store.get_task(tid)
                    if not t:
                        return json.dumps({"error": "task tidak ditemukan"}, ensure_ascii=False)
                    return json.dumps(
                        {"task_id": tid, "status": t["status"], "text": t["text"],
                         "logs": self.store.get_logs(tid)[-8:]}, ensure_ascii=False)
                if name == "failure_report":
                    limit = int(args.get("limit") or 50)
                    rows = [t for t in self.store.list_tasks(limit=limit)
                            if t.get("chat_id", 0) >= 0]
                    summary = postmortem.summarize(rows, self.store.get_logs)
                    return json.dumps({**summary,
                                       "report": postmortem.render(summary)},
                                      ensure_ascii=False)
                if name == "generate_image":
                    s = config.load_settings()
                    if not s.image_model:
                        return json.dumps({"error": "image model tidak dikonfigurasi"},
                                          ensure_ascii=False)
                    prompt = str(args.get("prompt") or "").strip()
                    if not prompt:
                        return json.dumps({"error": "prompt kosong"}, ensure_ascii=False)
                    sec = config.load_secrets()
                    res = await asyncio.to_thread(
                        imagegen.generate, prompt,
                        base_url=s.nvidia_base_url, key=sec.nvidia_api_key,
                        model=s.image_model,
                        out_dir=paths.artifacts_dir() / "generated")
                    if res.get("status") == "generated":
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['path'])}"
                        if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                            try:
                                await self.bridge.send_file(chat_id, "screenshot", res["path"])
                            except Exception as e:
                                print(f"Could not send generated image to Telegram: {e}")
                        return json.dumps(
                            {"status": "generated", "url": url,
                             "markdown": f"![gambar]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)
                if name == "youtube_clip":
                    res = await asyncio.to_thread(
                        ytclip.clip, str(args.get("url") or ""),
                        start=args.get("start"), end=args.get("end"),
                        vertical=str(args.get("vertical") or "blur"),
                        out_dir=paths.artifacts_dir() / "clips")
                    if res.get("status") == "clipped":
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['path'])}"
                        if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                            try:
                                await self.bridge.send_file(chat_id, "document", res["path"])
                            except Exception as e:
                                print(f"Could not send clip to Telegram: {e}")
                        return json.dumps(
                            {"status": "clipped", "url": url, "seconds": res.get("seconds"),
                             "markdown": f"![clip]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)
                if name == "viral_clip":
                    try:
                        mx = min(float(args.get("max_seconds") or 60), 60.0)
                    except (TypeError, ValueError):
                        mx = 60.0
                    res = await asyncio.to_thread(
                        ytclip.viral_clip, str(args.get("url") or ""),
                        max_seconds=mx, vertical=str(args.get("vertical") or "blur"),
                        out_dir=paths.artifacts_dir() / "clips")
                    if res.get("status") == "clipped":
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['path'])}"
                        if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                            try:
                                await self.bridge.send_file(chat_id, "document", res["path"])
                            except Exception as e:
                                print(f"Could not send clip to Telegram: {e}")
                        return json.dumps(
                            {"status": "clipped", "url": url,
                             "start": res.get("start"), "end": res.get("end"),
                             "reason": res.get("reason"), "title": res.get("title"),
                             "markdown": f"![clip]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)
                if name == "viral_clips":
                    s = config.load_settings()
                    sec = config.load_secrets()
                    try:
                        mx = min(float(args.get("max_seconds") or 60), 60.0)
                    except (TypeError, ValueError):
                        mx = 60.0
                    try:
                        n = min(int(args.get("count") or 3), 3)
                    except (TypeError, ValueError):
                        n = 3
                    res = await asyncio.to_thread(
                        ytclip.viral_candidates, str(args.get("url") or ""),
                        n=n, max_seconds=mx, out_dir=paths.artifacts_dir() / "clips",
                        vertical=str(args.get("vertical") or "blur"),
                        base_url=s.nvidia_base_url, key=sec.nvidia_api_key,
                        model=(s.chat_model or s.model))
                    if res.get("status") == "ok":
                        from urllib.parse import quote
                        cands = []
                        for c in res["candidates"]:
                            u = f"/api/artifacts/view?path={quote(c['path'])}"
                            if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                                try:
                                    await self.bridge.send_file(chat_id, "document", c["path"])
                                except Exception as e:
                                    print(f"Could not send candidate clip to Telegram: {e}")
                            cands.append({"title": c["title"], "start": c["start"],
                                          "end": c["end"],
                                          "markdown": f"### {c['title']}\n![clip]({u})"})
                        return json.dumps({"status": "ok",
                                           "video_title": res["video_title"],
                                           "candidates": cands}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)

                if name == "start_task":
                    if started:
                        return json.dumps(
                            {**started,
                             "note": ("task untuk giliran ini sudah diantre — "
                                      "ini hasil yang sama, bukan task baru")},
                            ensure_ascii=False)
                    bridge = self.bridge
                    if not bridge:
                        return json.dumps({"error": "bridge tidak tersedia — tidak bisa antre task"},
                                          ensure_ascii=False)
                    desc = str(args.get("description") or "").strip()
                    if not desc:
                        return json.dumps({"error": "deskripsi task kosong"}, ensure_ascii=False)
                    desc = self.attach_images_to_task(desc, images or [])
                    new_id = new_task_id()
                    sig = inspect.signature(bridge.handle_task)
                    def accepts(param: str) -> bool:
                        return param in sig.parameters or any(
                            p.kind == p.VAR_KEYWORD for p in sig.parameters.values())
                    settled = asyncio.get_running_loop().create_future()
                    def on_decision(status: str, reasons: list):
                        if not settled.done():
                            settled.set_result({"status": status, "reasons": reasons})
                    kwargs = {}
                    if accepts("session_id"):
                        kwargs["session_id"] = session_id
                    if accepts("on_decision"):
                        kwargs["on_decision"] = on_decision
                    t = asyncio.create_task(bridge.handle_task(
                        user_id=user_id, chat_id=chat_id, text=desc, task_id=new_id,
                        trusted=True, force_confirm=True, **kwargs))
                    t.add_done_callback(_bg_crash_cb(self.store, new_id))
                    try:
                        outcome = await asyncio.wait_for(
                            settled, START_TASK_DECISION_TIMEOUT_S)
                    except asyncio.TimeoutError:
                        outcome = {"status": "queued", "reasons": [],
                                   "note": "gate belum memutuskan; lihat kartu task"}
                    started.update({"task_id": new_id, **outcome})
                    return json.dumps({"task_id": new_id, **outcome},
                                      ensure_ascii=False)
                if name == "calendar_events":
                    url = config.load_settings().calendar_ics_url
                    if not url:
                        return json.dumps(
                            {"error": ("alamat iCal kalender belum diisi — set "
                                       "calendar_ics_url di setelan (Google Calendar "
                                       "-> Setelan kalender -> Integrasikan kalender "
                                       "-> Alamat rahasia dalam format iCal)")},
                            ensure_ascii=False)
                    days = max(1, min(60, int(args.get("days") or 7)))
                    events = await ics.upcoming(url, days)
                    return json.dumps({"days": days, "events": events},
                                      ensure_ascii=False)
                if name == "open_app":
                    return json.dumps(launcher.open_app(str(args.get("target") or "")),
                                      ensure_ascii=False)
                # integrate_mcp/integrate_status/integrate_secret are NOT here —
                # see Global Constraints: that wizard stays web-only, layered on
                # top of this dispatch by web_ui.py (Task 3), not inside it.
                hub = self.hub
                if hub is not None and mcp_risk.is_mcp_name(name):
                    if config.load_settings().confirm_risky and mcp_risk.is_risky_tool(name):
                        pa = self.pending.add(name, args, session_id,
                                              chat_id=chat_id or None)
                        pending_created.append(pa)
                        return json.dumps({
                            "status": "pending_confirmation",
                            "pending_id": pa.id,
                            "tool": name, "args": args,
                            "note": ("Aksi menulis/mengirim/mengubah data ini TERTAHAN, "
                                     "menunggu persetujuan operator (tombol atau ucapkan "
                                     "'konfirmasi' / 'batal'). BELUM dijalankan — jangan "
                                     "mengaku sudah melakukannya."),
                        }, ensure_ascii=False)
                    result = await hub.call(name, args)
                    return result if isinstance(result, str) \
                        else json.dumps(result, ensure_ascii=False)
                return json.dumps({"error": f"tool tak dikenal: {name}"}, ensure_ascii=False)
            except Exception as e:
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                return json.dumps({"error": f"tool gagal: {safe}"}, ensure_ascii=False)

        chat_dispatch.pending_created = pending_created
        return chat_dispatch

    def wrap_dispatch(self, dispatch, extra: dict):
        """Layer transport-specific tool handlers on top of the shared dispatch,
        without teaching the engine about them. `extra` maps tool name ->
        async (args) -> str. Used by web_ui.py (Task 3) for integrate_mcp/
        integrate_status/integrate_secret, which stay web-only (Global
        Constraints). Preserves `dispatch.pending_created` on the wrapper so
        callers reading it after the fact (run_turn) still see it."""
        async def wrapped(name: str, args: dict) -> str:
            fn = extra.get(name)
            if fn is not None:
                return await fn(args)
            return await dispatch(name, args)
        wrapped.pending_created = dispatch.pending_created
        return wrapped

    async def chat_tools(self) -> list[dict]:
        base = list(CHAT_TOOLS)
        if not config.load_settings().image_model:
            base = [t for t in base if t["function"]["name"] != "generate_image"]
        import importlib.util
        if importlib.util.find_spec("yt_dlp") is None:
            base = [t for t in base
                    if t["function"]["name"] not in
                    ("youtube_clip", "viral_clip", "viral_clips")]
        hub = self.hub
        if hub is None:
            return base
        cache = self._mcp_tools_cache
        if not cache:
            try:
                cache = await hub.list_tools()
            except Exception as e:
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                print(f"MCP tool discovery failed, retrying next turn: {safe}")
                cache = []
            if cache:
                self._mcp_tools_cache = cache
        from .mcp_hub import to_openai_tools
        return base + to_openai_tools(cache)

    async def resolve_pending(self, pa: PendingAction, approved: bool) -> dict:
        self.pending.pop(pa.id)
        if not approved:
            msg = f"\u274c Aksi dibatalkan: {pa.summary()}."
            self.store.add_message(pa.conv_id, "assistant", msg)
            return {"id": pa.id, "approved": False, "tool": pa.tool, "message": msg}
        hub = self.hub
        if hub is None:
            msg = f"\u26a0\ufe0f Tidak bisa menjalankan {pa.summary()}: MCP tidak tersedia."
            self.store.add_message(pa.conv_id, "assistant", msg)
            return {"id": pa.id, "approved": True, "resume": True,
                    "error": "hub tidak tersedia", "message": msg}
        try:
            result = await hub.call(pa.tool, pa.args)
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            msg = f"\u26a0\ufe0f Gagal menjalankan {pa.summary()}: {safe}"
            self.store.add_message(pa.conv_id, "assistant", msg)
            return {"id": pa.id, "approved": True, "resume": True, "error": safe, "message": msg}
        text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        reason = mcp_hub.failure_reason(text)
        if reason:
            msg = f"\u26a0\ufe0f {pa.summary()} tidak berhasil: {reason}"
            self.store.add_message(pa.conv_id, "assistant", msg)
            return {"id": pa.id, "approved": True, "resume": True, "error": reason, "message": msg}
        msg = f"\u2705 {pa.summary()} selesai.\n\n{text[:800]}"
        self.store.add_message(pa.conv_id, "assistant", msg)
        return {"id": pa.id, "approved": True, "resume": True, "result": text, "message": msg}

    async def run_turn(self, session_id: str, text: str,
                       images: list[Path] | None = None, chat=None,
                       chat_id: int = 0, user_id: int = 0) -> dict:
        """One non-streaming conversational turn: record it, run the model
        (with auto-task routing and tool dispatch), persist the answer, learn
        from it. Used by both the web UI's non-streaming endpoint and every
        Telegram message."""
        text = (text or "").strip()
        self.store.add_message(session_id, "user", text + (IMAGE_MARKER if images else ""))
        dispatch = self.make_dispatch(session_id, images, chat_id=chat_id, user_id=user_id)
        if chat is None:
            s = config.load_settings()
            agent_name = s.agent_name or "Lail Agent"
            reply = (f"Halo! Saya {agent_name}, asisten orkestrasi Anda.\n\n"
                    "Untuk menjalankan tugas, gunakan `/task <deskripsi>`.")
            auto_id = None
        else:
            try:
                turn, auto_id = await self.history_for_turn(session_id, text, images, dispatch)
                reply = await chat(turn, tools=await self.chat_tools(), dispatch=dispatch)
            except Exception as e:
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                reply = f"(Maaf, chat gagal: {safe})"
                auto_id = None
        from . import voice
        clean, _ = voice.strip_voice_tag(reply)
        clean += self.task_card_suffix(clean, auto_id)
        self.store.add_message(session_id, "assistant", clean)
        if images:
            uploads.discard(images)
        await self.learn_from_turn(text, clean)
        return {"reply": clean, "task_id": auto_id,
                "pending": [{"id": pa.id, "tool": pa.tool, "args": pa.args,
                             "summary": pa.summary()}
                            for pa in dispatch.pending_created]}

    async def run_resume_turn(self, session_id: str, chat, chat_id: int = 0,
                              user_id: int = 0) -> dict:
        """The turn after an approved write action ran: no new operator
        message, just the model picking its plan back up. Mirrors the web
        SSE endpoint's `resume` branch."""
        dispatch = self.make_dispatch(session_id, None, chat_id=chat_id, user_id=user_id)
        history = [*self.history_with_context(session_id),
                  {"role": "user", "content": RESUME_NUDGE}]
        try:
            reply = await chat(history, tools=await self.chat_tools(), dispatch=dispatch)
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            reply = f"(Maaf, chat gagal: {safe})"
        from . import voice
        clean, _ = voice.strip_voice_tag(reply)
        self.store.add_message(session_id, "assistant", clean)
        return {"reply": clean,
                "pending": [{"id": pa.id, "tool": pa.tool, "args": pa.args,
                             "summary": pa.summary()}
                            for pa in dispatch.pending_created]}


def _bg_crash_cb(store, task_id: str):
    def _cb(t: asyncio.Task):
        if t.cancelled():
            return
        exc = t.exception()
        if exc is None:
            return
        safe = repr(exc).encode("ascii", "backslashreplace").decode("ascii")
        print(f"Background task crashed: {safe}")
        try:
            store.append_log(task_id, f"error: background task crashed: {exc}")
            store.set_task_status(task_id, "failed")
        except Exception:
            pass
    return _cb
