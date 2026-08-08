from __future__ import annotations
import asyncio, json, re, subprocess, time
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel, ValidationError, field_validator
from . import brain, cleanup, config, ics, paths, postmortem, stt, uploads, voice, desktop_api, mcp_hub, mcp_risk, launcher, mcp_integrate, mcp_oauth, imagegen, ytclip
from .pending_actions import PendingStore
from .project_resolve import parse_project_ref
from .session_store import Store
from .telegram_bridge import new_task_id

class TaskSubmit(BaseModel):
    text: str
    session_id: str | None = None
    # Names returned by POST /api/uploads, attached to THIS turn only. The
    # files are deleted once the answer is produced, so they are never replayed
    # into a later prompt — one look, one answer, gone.
    images: list[str] = []
    # Continuation turn after an approved action ran: there is no operator
    # message behind it, so `text` is empty and nothing is written to the
    # thread as a user turn. See RESUME_NUDGE.
    resume: bool = False

class TaskConfirm(BaseModel):
    approved: bool

class TaskAnswer(BaseModel):
    ask_id: str
    text: str | None = None
    options: list[int] | None = None

class IntegrateBody(BaseModel):
    link: str

class SecretBody(BaseModel):
    value: str

# Request models must live at module scope: `from __future__ import annotations`
# turns every annotation into a string, and FastAPI resolves those against the
# endpoint's module globals only. A model declared inside create_app() is
# invisible there, so the parameter degrades to a required query param and every
# POST comes back 422.
class SessionRename(BaseModel):
    title: str

class ResolveBody(BaseModel):
    """Approve or decline one parked write action.

    Module scope is load-bearing, for the reason spelled out above: declared
    inside create_app it was invisible to FastAPI, which silently demoted it to
    a query parameter — so every confirm, by button or by voice, came back 422
    and no gated MCP action could ever be approved.
    """
    id: str | None = None
    approved: bool



# The web operator holds one continuous conversation. Localhost, single user,
# so a fixed id is enough; a per-browser session id is only needed once the
# dashboard is multi-user.
CONV_WEB = "web"
CHAT_HISTORY_LIMIT = 20   # turns fed back to the model — caps prompt cost

# Code work aimed at a registered @project is routed into start_task by THIS
# code, not by the model's judgement. The system prompt has told the model to
# call the tool since the chat-auto-run change, and it still answered plenty of
# "@proj perbaiki X" turns with a patch pasted in the chat pane — a patch that
# never reaches the repository. An explicit sigil plus a code verb is explicit
# intent, so the queueing is not left to a sampling outcome.
#
# The verb list is deliberately a plain heuristic in Indonesian and English:
# the decision it makes is "queue a task", and a task still faces the bridge's
# own risk gate before anything runs, so a false positive costs a card the
# operator can cancel, never an unreviewed write.
_CODE_INTENT = re.compile(
    r"\b(tambah\w*|buat\w*|bikin\w*|ubah\w*|ganti\w*|perbaik\w*|betulkan|benerin|"
    r"fix|refactor\w*|hapus\w*|implement\w*|terapkan|pasang|update|upgrade|"
    r"optimas\w*|optimi\w*|migras\w*|integras\w*|rename|bug|error|debug\w*|"
    r"test\w*|uji\w*|add|change|remove|delete|write|create|build|deploy)\b", re.I)
# A question about a project is discussion, not work. Both anchors matter: the
# trailing "?" catches "@proj kenapa build-nya error?" and the leading question
# word catches the same sentence typed without punctuation.
_QUESTION = re.compile(
    r"^\s*(apa\w*|kenapa|mengapa|gimana|bagaimana|berapa|kapan|siapa|mana|"
    r"why|what|how|when|where|which|who|is|are|does|do|can|should)\b", re.I)


def wants_code_task(text: str, settings) -> bool:
    """True when this chat turn is code work on a registered project.

    Unregistered names are left alone on purpose: start_task would only reject
    them, and the model's own answer (which lists the registered names) is the
    more useful reply.
    """
    name, rest = parse_project_ref(text)
    if name is None or name not in settings.projects:
        return False
    if rest.rstrip().endswith("?") or _QUESTION.match(rest):
        return False
    return bool(_CODE_INTENT.search(rest))


# What the model is told after the task was queued for it. It is a user turn,
# not a system one, because it has to be the last message in the prompt.
AUTO_TASK_NOTE = (
    "[SISTEM] Permintaan ini menyebut proyek terdaftar dan menyangkut kode, "
    "jadi `start_task` SUDAH dijalankan otomatis untuk teks itu apa adanya. "
    "Hasil alat: {result}\n"
    "Laporkan `status`, `reasons`, dan Task ID di atas apa adanya — `running` "
    "berarti task baru mulai, bukan selesai. JANGAN memanggil `start_task` "
    "lagi untuk permintaan ini dan JANGAN menulis patch/diff di chat: yang "
    "mengerjakan kodenya adalah task itu."
)

# How long the start_task tool waits for handle_task to settle its gate before
# answering the model. The slow part is one `git status` subprocess, so this is
# generous; the task itself keeps running in the background either way.
START_TASK_DECISION_TIMEOUT_S = 5.0

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
        "name": "integrate_mcp",
        "description": ("Pasang server MCP baru dari satu link (URL server remote, "
                        "link GitHub/npm, atau nama paket npm). Berjalan di latar: "
                        "kembalikan run_id lalu pantau dengan integrate_status. "
                        "Bila prosesnya minta kredensial, jawab dengan integrate_secret."),
        "parameters": {"type": "object", "properties": {
            "link": {"type": "string", "description": "link atau nama paket"}},
            "required": ["link"]}}},
    {"type": "function", "function": {
        "name": "integrate_status",
        "description": "Keadaan dan riwayat sebuah integrasi MCP yang sedang berjalan.",
        "parameters": {"type": "object", "properties": {
            "run_id": {"type": "string"}}, "required": ["run_id"]}}},
    {"type": "function", "function": {
        "name": "integrate_secret",
        "description": ("Isi kredensial yang diminta sebuah integrasi yang sedang "
                        "menunggu (lihat pending_secret dari integrate_status)."),
        "parameters": {"type": "object", "properties": {
            "run_id": {"type": "string"}, "value": {"type": "string"}},
            "required": ["run_id", "value"]}}},
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
            "vertical": {"type": "string", "enum": ["none", "blur", "crop"],
                         "description": "format 9:16 untuk Shorts/TikTok: 'blur' (utuh+background blur), 'crop' (potong tengah), 'none' (rasio asli). Default 'none'."}},
            "required": ["url", "start", "end"]}}},
    {"type": "function", "function": {
        "name": "viral_clip",
        "description": ("Analisa sebuah video YouTube dan otomatis potong bagian yang "
                        "PALING BERPOTENSI VIRAL — memakai data 'most replayed' "
                        "(bagian yang paling banyak diputar ulang penonton) dari "
                        "YouTube. Pakai bila pengguna minta 'carikan bagian viral', "
                        "'potong yang menarik', atau memberi URL tanpa waktu mulai/"
                        "selesai. Durasi maksimal default 90 detik (1:30). Hasilnya "
                        "berisi `markdown` (sertakan APA ADANYA agar video tampil), "
                        "serta `start`/`end`/`reason`."),
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "URL video YouTube"},
            "max_seconds": {"type": "integer",
                            "description": "durasi maks klip dalam detik, default 90 (maks 90)"},
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
                            "description": "durasi maks tiap klip, default 90 (maks 90)"},
            "vertical": {"type": "string", "enum": ["blur", "crop", "none"],
                         "description": "format 9:16 Shorts/TikTok, default 'blur'. 'crop' potong tengah, 'none' rasio asli."}},
            "required": ["url"]}}},
]

def _bg_crash_cb(store: Store, task_id: str):
    """Done-callback for the web UI's fire-and-forget bridge tasks.

    main.py wires crash_reporter onto every Telegram create_task; these two
    endpoints spawn the same coroutines with no chat to report into, so a raise
    outside run_task's try/except is otherwise swallowed at GC with no trace.
    Mark the task failed and record why. backslashreplace, not repr() raw: on a
    redirected legacy-codepage stdout a bare non-ASCII repr raises inside the
    callback, and asyncio drops that into the loop handler -- losing the report.
    """
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

# Claude CLI model choices (aliases + full ids, per Anthropic docs 2026-07).
# Static on purpose: `claude` has no list-models subcommand, and the select
# keeps a Custom option so a newer id is never blocked by this list.
CLAUDE_MODELS = [
    "fable", "opus", "sonnet", "haiku",
    "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7",
    "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5",
]

# Shown when `agy models` is unavailable (agy not installed, not logged in,
# or slow). Known-good display name observed in agy's own settings.json.
AGY_FALLBACK_MODELS = ["Gemini 3.5 Flash (High)"]

_AGY_CACHE_TTL_S = 3600       # refresh a good list hourly
_AGY_NEG_TTL_S = 300          # after a failure, don't re-block requests for 5 min
_agy_cache: dict = {"at": 0.0, "models": None}

def list_agy_models(timeout_s: float = 10.0) -> list[str] | None:
    """Ask the agy CLI for its model list. None means \"could not ask\" —
    the caller falls back rather than caching an empty answer."""
    import shutil
    exe = shutil.which("agy") or shutil.which("agy.exe")
    if exe is None:
        return None
    try:
        res = subprocess.run([exe, "models"], capture_output=True, text=True,
                             timeout=timeout_s)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if res.returncode != 0:
        return None
    models = []
    for line in res.stdout.splitlines():
        line = line.strip().lstrip("*-• ").strip()
        # skip blanks and header-ish lines ("Available models:", "Usage: ...")
        if not line or line.endswith(":") or line.lower().startswith("usage"):
            continue
        models.append(line)
    return models or None

class SecretsUpdate(BaseModel):
    nvidia_api_key: str | None = None
    telegram_bot_token: str | None = None

    @field_validator("telegram_bot_token")
    @classmethod
    def _token_shape(cls, v):
        # "" and "***" mean keep-current; a real BotFather token is <digits>:<secret>
        if v in ("", "***", None):
            return v
        if not re.fullmatch(r"\d{8,12}:[A-Za-z0-9_-]{30,}", v):
            raise ValueError(
                "not a Telegram bot token — expected '<digits>:<secret>' from @BotFather")
        return v

    @field_validator("nvidia_api_key")
    @classmethod
    def _key_shape(cls, v):
        # API keys travel in an HTTP header: ASCII only, no whitespace/smart quotes
        if v in ("", "***", None):
            return v
        if not v.isascii() or any(c.isspace() for c in v):
            raise ValueError(
                "not a valid API key — contains whitespace or non-ASCII characters "
                "(check for smart quotes from copy-paste); NVIDIA keys look like 'nvapi-...'")
        return v

STATIC_DIR = Path(__file__).parent / "static"
INDEX_HTML_CACHE: str | None = None

def load_index_html() -> str:
    global INDEX_HTML_CACHE
    import os
    if os.environ.get("HERMES_DEV"):
        path = STATIC_DIR / "index.html"
        if path.exists():
            return path.read_text(encoding="utf-8")

    if INDEX_HTML_CACHE is not None:
        return INDEX_HTML_CACHE
    path = STATIC_DIR / "index.html"
    if path.exists():
        INDEX_HTML_CACHE = path.read_text(encoding="utf-8")
        return INDEX_HTML_CACHE
    return (
        "<html><head><title>Hermes: Bundle Missing</title></head>"
        "<body style='font-family: sans-serif; padding: 2rem; background: #0b0c10; color: #fff;'>"
        "<h1>Hermes UI Bundle Missing</h1>"
        "<p>The frontend React bundle is not built yet.</p>"
        "<p>Please build it by running:</p>"
        "<pre style='background: #1f2833; padding: 1rem; border-radius: 4px; color: #66fcf1;'>"
        "npm --prefix web run build</pre>"
        "<p>Or start Hermes using <code>start.bat</code> which builds it automatically.</p>"
        "</body></html>"
    )

def create_app(store: Store, bridge=None, ask_registry=None, chat=None, lifespan=None, hub=None, facts=None) -> FastAPI:
    # lifespan carries the ask MCP server's session manager when main.py mounts
    # it here: a mounted sub-app's own lifespan is ignored by Starlette, so the
    # manager has to be started by the parent or the /ask-mcp endpoint is dead.
    app = FastAPI(lifespan=lifespan)
    app.state.bridge = bridge
    app.state.ask_registry = ask_registry
    # The MCP hub gives the chat agent the same file/browser/gmail/calendar tools
    # the planner has. None disables the feature (the chat then runs on CHAT_TOOLS
    # alone). Discovery is cached: list_tools opens transports, too costly per turn.
    app.state.hub = hub
    app.state._mcp_tools_cache = None
    # Write actions the chat agent proposed, awaiting operator approval (button
    # or voice). Executed only from the resolve endpoint, never in the tool loop.
    app.state.pending = PendingStore()

    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR), check_dir=False), name="static")

    # Voice output has no dependency on store/bridge/ask_registry, so it lives
    # in its own module instead of this factory's closure.
    app.include_router(voice.router)

    # Tray-helper <-> browser bridge (wake word + voice-state heartbeat). One
    # DesktopState per app, kept on app.state so tests can read it back.
    app.state.desktop = desktop_api.DesktopState()
    app.include_router(desktop_api.build_router(app.state.desktop))

    # async (history, tools=, dispatch=) -> str; None when no NIM chat is wired
    # (the conversational branch then falls back to a canned reply).
    app.state.chat = chat
    # async (user_text, reply) -> [{"key","value"}]; None disables learning.
    # Injected like chat so a test can wire a fake — or nothing, and the chat
    # still works, it just stops remembering.
    app.state.facts = facts
    app.state.integrate_runs = {}
    app.state.pending_auth = mcp_oauth.PendingAuth()

    def brain_context() -> dict:
        """The situational preamble as a system message.

        Prepended to the history for every chat turn, which is why it is built
        per turn rather than cached: the clock moves, tasks finish, and a stale
        "sedang berjalan" is worse than no context at all.
        """
        s = config.load_settings()
        return {"role": "system",
                "content": brain.context_block(store.list_facts(),
                                               store.list_tasks(limit=20),
                                               list(s.projects))}

    def history_with_context(sid: str, images: list[Path] | None = None) -> list[dict]:
        """The turn as the model sees it, newest message last.

        With images, the final user message becomes a multimodal content list.
        Only that message: earlier turns keep the `[gambar dilampirkan]` marker
        stored in their text, so a conversation about one photo does not pay
        for that photo on every subsequent turn.
        """
        history = [brain_context(), *store.get_messages(sid, limit=CHAT_HISTORY_LIMIT)]
        if images and history[-1]["role"] == "user":
            # The marker is for the turns that come after, which will see it in
            # place of the picture. On this turn the picture is right there, so
            # telling the model an image is attached is noise.
            said = history[-1]["content"].replace(IMAGE_MARKER, "")
            history[-1] = {"role": "user",
                           "content": uploads.as_content_parts(said, images)}
        return history

    async def history_for_turn(sid: str, text: str, images: list[Path] | None,
                               dispatch) -> tuple[list[dict], str | None]:
        """The prompt for one chat turn, plus the id of any task queued for it.

        See wants_code_task: when the turn is code work on a registered project
        the task is started here, before the model speaks, and the model is left
        to report it. `dispatch` must be the same callable handed to the model,
        so its start_task memo covers both callers.
        """
        history = history_with_context(sid, images)
        if not (text and wants_code_task(text, config.load_settings())):
            return history, None
        result = await dispatch("start_task", {"description": text})
        try:
            task_id = json.loads(result).get("task_id")
        except ValueError:
            task_id = None
        return ([*history, {"role": "user",
                            "content": AUTO_TASK_NOTE.format(result=result)}],
                task_id)

    def task_card_suffix(reply: str, task_id: str | None) -> str:
        """The line that makes the queued task's Run/Cancel card appear, or "".

        The card is drawn by the client for every task id it finds in the
        assistant's text (findTaskIds in Dashboard.tsx). Leaving that to the
        model's prose is how a held task ends up with no way to run it: the
        model wrote "Task @v3 ditahan", no id, so the operator got a paragraph
        about pressing Run and no button to press. The id is ours, not the
        model's, so it is appended when the model left it out.

        A suffix rather than a rewritten reply, so the streaming path can send
        exactly these bytes as one more delta.
        """
        if not task_id or task_id in reply:
            return ""
        return f"\n\nTask `{task_id}`"

    def take_images(sid: str, names: list[str]) -> list[Path]:
        """Resolve upload names to files. Unknown names are dropped, not an
        error: a re-sent or already-discarded image should cost the operator a
        plain text answer, not a failed turn."""
        found = [uploads.resolve(paths.uploads_dir(), sid, n) for n in names or []]
        return [p for p in found if p is not None]

    IMAGE_MARKER = "\n\n[gambar dilampirkan]"

    async def learn_from_turn(user_text: str, reply: str) -> None:
        """Store whatever durable facts this turn revealed.

        Fire-and-forget: the operator's reply is already on screen by the time
        this runs, and a failed extraction must not delay or break a turn that
        otherwise succeeded.
        """
        extract = getattr(app.state, "facts", None)
        if extract is None or not reply.strip():
            return
        # Skip the model call on turns that plainly carry nothing durable
        # (greetings, one-word acks): extraction runs every turn, so this is a
        # free token/latency saving with no risk of dropping a real fact.
        if not brain.worth_extracting(user_text):
            return
        try:
            for f in await extract(user_text, reply):
                store.set_fact(f["key"], f["value"])
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            print(f"Could not learn from turn: {safe}")

    def make_chat_dispatch(session_id: str):
        # One dispatch per turn, so this holds the turn's start_task outcome. The
        # auto-route below queues the task before the model speaks; without a
        # memo the model would obey its instructions, call start_task itself, and
        # the same work would run twice against the same repository.
        started: dict = {}

        async def chat_dispatch(name: str, args: dict) -> str:
            """Execute one chat tool call and return a JSON string for the model.

            Every tool is read-only except start_task, which only queues a task
            held for the operator's one-tap confirm — the LLM never runs work or
            mutates a repo directly. Errors are returned as data, never raised, so
            one bad call cannot abort the whole chat turn.
            """
            try:
                if name == "list_projects":
                    s = config.load_settings()
                    return json.dumps(
                        [{"name": n, "path": p, "exists": Path(p).exists()}
                         for n, p in s.projects.items()], ensure_ascii=False)
                if name == "recent_tasks":
                    limit = int(args.get("limit") or 5)
                    rows = [t for t in store.list_tasks() if t.get("chat_id", 0) >= 0][:limit]
                    return json.dumps(
                        [{"task_id": t["task_id"], "status": t["status"], "text": t["text"]}
                         for t in rows], ensure_ascii=False)
                if name == "get_task_detail":
                    tid = str(args.get("task_id") or "")
                    t = store.get_task(tid)
                    if not t:
                        return json.dumps({"error": "task tidak ditemukan"}, ensure_ascii=False)
                    return json.dumps(
                        {"task_id": tid, "status": t["status"], "text": t["text"],
                         "logs": store.get_logs(tid)[-8:]}, ensure_ascii=False)
                if name == "failure_report":
                    limit = int(args.get("limit") or 50)
                    rows = [t for t in store.list_tasks(limit=limit)
                            if t.get("chat_id", 0) >= 0]
                    summary = postmortem.summarize(rows, store.get_logs)
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
                    # Blocking HTTP + file write -> off the event loop.
                    res = await asyncio.to_thread(
                        imagegen.generate, prompt,
                        base_url=s.nvidia_base_url, key=sec.nvidia_api_key,
                        model=s.image_model,
                        out_dir=paths.artifacts_dir() / "generated")
                    if res.get("status") == "generated":
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['path'])}"
                        return json.dumps(
                            {"status": "generated", "url": url,
                             "markdown": f"![gambar]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)
                if name == "youtube_clip":
                    res = await asyncio.to_thread(
                        ytclip.clip, str(args.get("url") or ""),
                        start=args.get("start"), end=args.get("end"),
                        vertical=str(args.get("vertical") or "none"),
                        out_dir=paths.artifacts_dir() / "clips")
                    if res.get("status") == "clipped":
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['path'])}"
                        return json.dumps(
                            {"status": "clipped", "url": url, "seconds": res.get("seconds"),
                             "markdown": f"![clip]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)
                if name == "viral_clip":
                    try:
                        mx = min(float(args.get("max_seconds") or 90), 90.0)
                    except (TypeError, ValueError):
                        mx = 90.0
                    res = await asyncio.to_thread(
                        ytclip.viral_clip, str(args.get("url") or ""),
                        max_seconds=mx, vertical=str(args.get("vertical") or "blur"),
                        out_dir=paths.artifacts_dir() / "clips")
                    if res.get("status") == "clipped":
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['path'])}"
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
                        mx = min(float(args.get("max_seconds") or 90), 90.0)
                    except (TypeError, ValueError):
                        mx = 90.0
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
                    bridge = getattr(app.state, "bridge", None)
                    if not bridge:
                        return json.dumps({"error": "bridge tidak tersedia — tidak bisa antre task"},
                                          ensure_ascii=False)
                    desc = str(args.get("description") or "").strip()
                    if not desc:
                        return json.dumps({"error": "deskripsi task kosong"}, ensure_ascii=False)
                    new_id = new_task_id()
                    import inspect
                    sig = inspect.signature(bridge.handle_task)
                    def accepts(param: str) -> bool:
                        return param in sig.parameters or any(
                            p.kind == p.VAR_KEYWORD for p in sig.parameters.values())
                    # The gate settles long before the task does, but handle_task
                    # only returns when the whole task is over. A future filled by
                    # its callback is the only way to answer the model with what
                    # actually happened instead of a guess.
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
                        user_id=0, chat_id=0, text=desc, task_id=new_id,
                        trusted=True, force_confirm=True, **kwargs))
                    t.add_done_callback(_bg_crash_cb(store, new_id))
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
                    # Clamped, not validated: a model that asks for a year of
                    # events gets a month, rather than an error it must retry.
                    days = max(1, min(60, int(args.get("days") or 7)))
                    events = await ics.upcoming(url, days)
                    return json.dumps({"days": days, "events": events},
                                      ensure_ascii=False)
                if name == "open_app":
                    # Ungated on purpose: a known app / URL the user just asked
                    # for opens straight away, no operator confirm. Safety is the
                    # fixed allow-list in launcher.KNOWN_APPS, not this gate.
                    return json.dumps(launcher.open_app(str(args.get("target") or "")),
                                      ensure_ascii=False)
                if name == "integrate_mcp":
                    link = str(args.get("link") or "").strip()
                    if not link:
                        return json.dumps({"error": "link kosong"}, ensure_ascii=False)
                    run_id = _start_integrate(link)
                    return json.dumps(
                        {"run_id": run_id, "state": "running",
                         "note": ("Integrasi berjalan di latar. Pantau dengan "
                                  "integrate_status; jangan mengaku sudah selesai "
                                  "sebelum state-nya 'done'.")},
                        ensure_ascii=False)
                if name == "integrate_status":
                    run = app.state.integrate_runs.get(str(args.get("run_id") or ""))
                    if run is None:
                        return json.dumps({"error": "run tidak ditemukan"},
                                          ensure_ascii=False)
                    return json.dumps(
                        {"state": run.state, "pending_secret": run.pending_secret,
                         "login_url": run.login_url, "server": run.server,
                         "events": run.events[-12:]}, ensure_ascii=False)
                if name == "integrate_secret":
                    run = app.state.integrate_runs.get(str(args.get("run_id") or ""))
                    if run is None:
                        return json.dumps({"error": "run tidak ditemukan"},
                                          ensure_ascii=False)
                    ok = run.answer_secret(str(args.get("value") or ""))
                    return json.dumps({"ok": ok}, ensure_ascii=False)
                # MCP integration tools (file / browser / gmail / calendar). Reads
                # run straight through; a write/send/delete is gated — returned to
                # the model as "needs confirmation" and NOT executed, so the chat
                # agent can never silently mutate data. The operator runs a gated
                # action deliberately (Telegram /task, or a later confirm card).
                hub = getattr(app.state, "hub", None)
                if hub is not None and mcp_risk.is_mcp_name(name):
                    # confirm_risky=False means the operator waived the gate for
                    # every surface, chat included — run straight through. When
                    # True, a write/send/delete is parked for approval.
                    if config.load_settings().confirm_risky and mcp_risk.is_risky_tool(name):
                        # Park it for the operator to approve (button or voice),
                        # do NOT execute here. The model is told it is pending so
                        # it never claims the action was done.
                        pa = app.state.pending.add(name, args, session_id)
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
            except Exception as e:  # a tool failure is data for the model, not a 500
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                return json.dumps({"error": f"tool gagal: {safe}"}, ensure_ascii=False)
        return chat_dispatch

    from .mcp_hub import to_openai_tools

    async def _chat_tools():
        """CHAT_TOOLS plus whatever the MCP hub exposes, discovered once and
        cached. On any discovery failure the chat still works on CHAT_TOOLS.

        Only a NON-EMPTY discovery is cached. A stdio server is a subprocess
        that has to be spawned (`npx` fetching a package on a cold cache is
        seconds, sometimes past the timeout), and hub.list_tools swallows the
        per-server failure and returns []. Caching that made one slow first
        turn disable every integration for the life of the process — the agent
        then answers "akses disk tidak ada di sesi ini" forever, with the
        servers sitting right there in the settings.
        """
        base = list(CHAT_TOOLS)
        # No image model configured -> don't offer a tool that can only fail.
        if not config.load_settings().image_model:
            base = [t for t in base if t["function"]["name"] != "generate_image"]
        # yt-dlp not installed (the optional `media` extra) -> hide the clip tools.
        import importlib.util
        if importlib.util.find_spec("yt_dlp") is None:
            base = [t for t in base
                    if t["function"]["name"] not in
                    ("youtube_clip", "viral_clip", "viral_clips")]
        hub = getattr(app.state, "hub", None)
        if hub is None:
            return base
        cache = app.state._mcp_tools_cache
        if not cache:
            try:
                cache = await hub.list_tools()
            except Exception as e:
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                print(f"MCP tool discovery failed, retrying next turn: {safe}")
                cache = []
            if cache:
                app.state._mcp_tools_cache = cache
        return base + to_openai_tools(cache)

    async def _resolve_pending(pa, approved: bool) -> dict:
        """Run or drop one parked write action, and record the outcome in the
        conversation so the thread (and the next model turn) stays truthful.

        Approving is the middle of a plan, not the end of one: the model's turn
        ended when the action was parked, so every approved outcome — worked,
        errored, or came back empty — carries `resume: True` and the caller
        drives one more model turn. Without that the tool ran, its result sat in
        the thread as dead text, and the agent simply stopped.
        """
        app.state.pending.pop(pa.id)
        if not approved:
            store.add_message(pa.conv_id, "assistant",
                              f"❌ Aksi dibatalkan: {pa.summary()}.")
            return {"id": pa.id, "approved": False, "tool": pa.tool}
        hub = getattr(app.state, "hub", None)
        if hub is None:
            store.add_message(pa.conv_id, "assistant",
                              f"⚠️ Tidak bisa menjalankan {pa.summary()}: MCP tidak tersedia.")
            return {"id": pa.id, "approved": True, "resume": True,
                    "error": "hub tidak tersedia"}
        try:
            result = await hub.call(pa.tool, pa.args)
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            store.add_message(pa.conv_id, "assistant",
                              f"⚠️ Gagal menjalankan {pa.summary()}: {safe}")
            return {"id": pa.id, "approved": True, "resume": True, "error": safe}
        text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        # A call that returned without raising still may not have done anything.
        # Saying "selesai" over an error payload or an empty result is the lie
        # that made a dead confirm look like a completed one.
        reason = mcp_hub.failure_reason(text)
        if reason:
            store.add_message(pa.conv_id, "assistant",
                              f"⚠️ {pa.summary()} tidak berhasil: {reason}")
            return {"id": pa.id, "approved": True, "resume": True, "error": reason}
        store.add_message(pa.conv_id, "assistant",
                          f"✅ {pa.summary()} selesai.\n\n{text[:800]}")
        return {"id": pa.id, "approved": True, "resume": True, "result": text}

    @app.get("/api/chat/pending")
    def get_chat_pending():
        """Write actions awaiting approval — rendered as cards and polled by the
        voice loop so 'konfirmasi' knows whether anything is pending."""
        return [{"id": a.id, "tool": a.tool, "summary": a.summary(), "args": a.args}
                for a in app.state.pending.list()]

    @app.post("/api/chat/pending/resolve")
    async def resolve_chat_pending(body: ResolveBody):
        """Approve/decline a parked action. No `id` resolves the oldest — the
        shape a voice 'konfirmasi' / 'batal' uses, since speech carries no id."""
        pending = app.state.pending
        items = pending.list()
        pa = pending.get(body.id) if body.id else (items[0] if items else None)
        if pa is None:
            return {"ok": False, "error": "tidak ada aksi tertunda"}
        out = await _resolve_pending(pa, body.approved)
        return {"ok": True, **out}

    @app.get("/", response_class=HTMLResponse)
    def dashboard():
        return HTMLResponse(content=load_index_html())

    @app.get("/settings", response_class=HTMLResponse)
    def settings_page():
        return HTMLResponse(content=load_index_html())

    @app.get("/api/artifacts/download")
    def download_artifact(path: str):
        resolved = Path(path).resolve()
        if not resolved.exists() or not resolved.is_file():
            raise HTTPException(status_code=404, detail="Artifact file not found")
        try:
            resolved.relative_to(paths.home().resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied")
        return FileResponse(str(resolved), filename=resolved.name)

    @app.get("/api/artifacts/view")
    def view_artifact(path: str):
        resolved = Path(path).resolve()
        if not resolved.exists() or not resolved.is_file():
            raise HTTPException(status_code=404, detail="Artifact file not found")
        try:
            resolved.relative_to(paths.home().resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied")
        media_type = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp",
            ".mp4": "video/mp4", ".webm": "video/webm",
        }.get(resolved.suffix.lower(), "application/octet-stream")
        return FileResponse(str(resolved), media_type=media_type)

    @app.get("/api/tasks")
    def tasks():
        # chat_id is a display sentinel here, not a real Telegram chat:
        #   >0  a real Telegram chat        (shown)
        #    0  a web-submitted /task       (shown)
        #   -1  a web conversational stub    (/help, /projects, small talk -- hidden)
        # The list is the orchestration queue, so the -1 stubs are filtered out;
        # they are still fetchable by id for the chat pane that created them.
        all_tasks = store.list_tasks()
        return [t for t in all_tasks if t.get("chat_id", 0) >= 0]

    @app.get("/api/tasks/events")
    async def tasks_events(request: Request):
        print("API: tasks_events called")
        queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def listener(event):
            print("API: listener called with event:", event)
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
                print("API: event queued in loop")
            except Exception as e:
                print("API: listener exception:", e)

        store.subscribe(listener)

        async def event_generator():
            print("API: event_generator started")
            try:
                while True:
                    if await request.is_disconnected():
                        print("API: client disconnected")
                        break
                    try:
                        print("API: waiting for queue...")
                        event = await asyncio.wait_for(queue.get(), timeout=15.0)
                        print("API: got event from queue:", event)
                        yield brain.sse(event)
                        # Speech is decided here, not in the browser: the old
                        # notify effect lived in the Dashboard component, so a
                        # task that finished while the operator was on any
                        # other page was never announced. Every connected
                        # client gets the same utterance, on every page.
                        utterance = brain.speech_for(
                            event, config.load_settings(),
                            task_text=lambda tid: (store.get_task(tid) or {}).get("text", ""))
                        if utterance:
                            yield brain.sse(utterance)
                    except asyncio.TimeoutError:
                        print("API: timeout, yielding keep-alive")
                        yield "data: {\"type\": \"keep-alive\"}\n\n"
            finally:
                print("API: event_generator finally, unsubscribing")
                store.unsubscribe(listener)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive"
            }
        )

    @app.get("/api/tasks/{task_id}")
    def task(task_id: str):
        t = store.get_task(task_id) or {}

        pending_confirm = None
        bridge = getattr(app.state, "bridge", None)
        if bridge and task_id in bridge.confirm_reasons:
            pending_confirm = bridge.confirm_reasons[task_id]

        pending_ask = None
        ask_registry = getattr(app.state, "ask_registry", None)
        if ask_registry:
            active_ask = ask_registry.active_for_task(task_id)
            if active_ask:
                pending_ask = {
                    "ask_id": active_ask.ask_id,
                    "question": active_ask.question,
                    "options": active_ask.options,
                    "multi": active_ask.multi
                }

        return {
            "task": t,
            "logs": store.get_logs(task_id),
            "artifacts": store.get_artifacts(task_id),
            "pending_confirm": pending_confirm,
            "pending_ask": pending_ask
        }

    @app.post("/api/tasks")
    async def post_task(body: TaskSubmit):
        bridge = getattr(app.state, "bridge", None)
        text = body.text.strip()
        task_id = new_task_id()
        sid = body.session_id or CONV_WEB

        # chat_id sentinels below: /task -> 0 (a real queued task, listed);
        # every other branch is a synchronous stub answered inline and stored
        # with chat_id=-1 so it stays out of the task list. See /api/tasks.
        # Only /task needs the bridge (it queues real work); /help, /projects
        # and conversation answer inline, so they must still work bridge-less.
        if text.lower().startswith("/task"):
            if not bridge:
                raise HTTPException(status_code=503, detail="Bridge not configured")
            prompt = text[5:].strip()
            import inspect
            sig = inspect.signature(bridge.handle_task)
            kwargs = {}
            if "session_id" in sig.parameters or any(p.kind == p.VAR_KEYWORD for p in sig.parameters.values()):
                kwargs["session_id"] = sid
            t = asyncio.create_task(bridge.handle_task(
                user_id=0, chat_id=0, text=prompt, task_id=task_id,
                trusted=True, **kwargs))
            t.add_done_callback(_bg_crash_cb(store, task_id))
            return {"task_id": task_id, "status": "queued"}
        elif text.lower().startswith("/help"):
            from .telegram_bridge import help_text
            answer = help_text()
            store.create_task(task_id, -1, text, session_id=sid)
            store.set_task_status(task_id, "done")
            store.append_log(task_id, "ask: Bantuan Penggunaan")
            store.append_log(task_id, f"answer: {answer}")
            # Record in the thread too: /help and /projects are conversational
            # Q&A, so they belong in the chat log the pane renders, unlike /task
            # which is real work tracked in the task list.
            store.add_message(sid, "user", text)
            store.add_message(sid, "assistant", answer)
            return {"task_id": task_id, "status": "done"}
        elif text.lower().startswith("/projects"):
            from .telegram_bridge import projects_overview
            answer = projects_overview(config.load_settings())
            store.create_task(task_id, -1, text, session_id=sid)
            store.set_task_status(task_id, "done")
            store.append_log(task_id, "ask: Proyek Terdaftar")
            store.append_log(task_id, f"answer: {answer}")
            store.add_message(sid, "user", text)
            store.add_message(sid, "assistant", answer)
            return {"task_id": task_id, "status": "done"}
        else:
            store.create_task(task_id, -1, text, session_id=sid)
            store.append_log(task_id, "ask: Chat Conversation")
            # Record the user's turn first, so the history handed to the model
            # includes the message it is replying to. The marker is what later
            # turns will see in place of the picture.
            images = take_images(sid, body.images)
            store.add_message(sid, "user", text + (IMAGE_MARKER if images else ""))
            chat = getattr(app.state, "chat", None)
            auto_id = None
            if chat is None:
                s = config.load_settings()
                agent_name = s.agent_name or "Lail Agent"
                reply = (
                    f"Halo! Saya {agent_name}, asisten orkestrasi Anda.\n\n"
                    "Untuk menjalankan tugas, gunakan `/task <deskripsi>` — "
                    "mis. `/task @myproject jalankan pengujian`.\n"
                    "Gunakan `/projects` untuk daftar proyek atau `/help` untuk bantuan."
                )
            else:
                try:
                    dispatch = make_chat_dispatch(sid)
                    turn, auto_id = await history_for_turn(sid, text, images, dispatch)
                    reply = await chat(turn, tools=await _chat_tools(),
                                       dispatch=dispatch)
                except Exception as e:
                    # A NIM outage or missing key must not 500 the chat pane;
                    # surface it as the assistant's turn so the thread stays
                    # coherent and the operator sees the cause.
                    safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                    reply = f"(Maaf, chat gagal: {safe})"
            # The tag is a transport detail between the model and the speech
            # path. Storing it would feed it back as context next turn.
            clean, _ = voice.strip_voice_tag(reply)
            clean += task_card_suffix(clean, auto_id)
            store.add_message(sid, "assistant", clean)
            store.set_task_status(task_id, "done")
            store.append_log(task_id, f"answer: {clean}")
            uploads.discard(images)      # looked at, answered, gone
            await learn_from_turn(text, clean)
            return {"task_id": task_id, "status": "done"}

    @app.post("/api/tasks/{task_id}/confirm")
    async def confirm_task(task_id: str, body: TaskConfirm):
        bridge = getattr(app.state, "bridge", None)
        if not bridge:
            raise HTTPException(status_code=503, detail="Bridge not configured")
        t = asyncio.create_task(bridge.resolve_confirm(user_id=0, task_id=task_id, approved=body.approved, trusted=True))
        t.add_done_callback(_bg_crash_cb(store, task_id))
        return {"ok": True}

    @app.post("/api/tasks/{task_id}/answer")
    async def answer_task(task_id: str, body: TaskAnswer):
        ask_registry = getattr(app.state, "ask_registry", None)
        if not ask_registry:
            raise HTTPException(status_code=503, detail="Ask Registry not configured")

        ask = ask_registry.get(body.ask_id)
        if not ask or ask.task_id != task_id:
            raise HTTPException(status_code=404, detail="Ask not found or does not belong to this task")

        if body.options is not None:
            ok = ask_registry.answer_options(body.ask_id, body.options)
        else:
            ok = ask_registry.answer(body.ask_id, body.text or "")

        return {"ok": ok}

    @app.get("/api/sessions")
    def list_sessions():
        return store.list_sessions()

    @app.post("/api/sessions")
    def create_session():
        session_id = new_task_id()
        store.create_session(session_id, "Percakapan Baru")
        return {"session_id": session_id, "title": "Percakapan Baru", "created": time.time()}

    @app.post("/api/sessions/{session_id}/rename")
    def rename_session(session_id: str, body: SessionRename):
        store.rename_session(session_id, body.title)
        return {"ok": True}

    @app.delete("/api/sessions/{session_id}")
    def delete_session(session_id: str):
        task_ids = store.delete_session(session_id)
        # The rows are gone; now the bytes. Deliberately after the DB delete
        # and never able to undo it: a directory the OS refuses to remove
        # (a file open in Explorer, an antivirus lock) must not leave the
        # operator with a conversation they cannot delete.
        cleanup.purge(paths.uploads_dir(), session_id)
        for tid in task_ids:
            cleanup.purge(paths.artifacts_dir(), tid)
        return {"ok": True}

    @app.get("/api/chat")
    def chat_history(session_id: str | None = None):
        # The whole conversational thread, oldest-first, for the chat pane to
        # render on load. Slash-command tasks live in /api/tasks, not here.
        sid = session_id or CONV_WEB
        return {"messages": store.get_messages(sid, limit=CHAT_HISTORY_LIMIT)}

    @app.post("/api/chat/reset")
    def chat_reset(session_id: str | None = None):
        sid = session_id or CONV_WEB
        store.clear_messages(sid)
        # With the thread gone, nothing references the files it was handed.
        cleanup.purge(paths.uploads_dir(), sid)
        return {"ok": True}

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

    @app.post("/api/chat/stream")
    async def chat_stream(body: TaskSubmit):
        # Server-Sent Events: the assistant's reply streams token-by-token so the
        # pane fills live instead of waiting for the whole completion. The user
        # turn is recorded before streaming (history must include it); the
        # assistant turn is persisted once, after the stream ends, from the text
        # actually delivered — a client that disconnects mid-stream still leaves
        # a coherent thread on the next load.
        text = body.text.strip()
        sid = body.session_id or CONV_WEB
        images = take_images(sid, body.images)
        # A resume turn has no operator message behind it — the trigger was the
        # confirm button — so nothing is recorded as a user turn and the thread
        # shows only the outcome plus the agent picking the work back up.
        if not body.resume:
            store.add_message(sid, "user", text + (IMAGE_MARKER if images else ""))
        chat = getattr(app.state, "chat", None)

        # Auto rename session if it was default name
        if sid != CONV_WEB and not body.resume:
            sessions = store.list_sessions()
            curr = next((s for s in sessions if s["session_id"] == sid), None)
            if curr and curr["title"] == "Percakapan Baru":
                new_title = text[:30] + "..." if len(text) > 30 else text
                store.rename_session(sid, new_title)

        sse = brain.sse

        async def gen():
            acc = ""
            usage = None
            auto_id = None
            if chat is None or not hasattr(chat, "stream"):
                s = config.load_settings()
                agent_name = s.agent_name or "Lail Agent"
                acc = (f"Halo! Saya {agent_name}. Untuk menjalankan tugas gunakan "
                       "`/task <deskripsi>`; `/projects` untuk daftar proyek, "
                       "`/help` untuk bantuan.")
                yield sse({"delta": acc})
            else:
                dispatch = make_chat_dispatch(sid)
                history, auto_id = await history_for_turn(sid, text, images, dispatch)
                if body.resume:
                    # Ephemeral, not stored: it steers this one turn and would be
                    # noise in the thread. Also guarantees the prompt ends on a
                    # user turn — the outcome line before it is an assistant
                    # message, which some providers will not complete after.
                    history = [*history, {"role": "user", "content": RESUME_NUDGE}]
                try:
                    async for kind, payload in chat.stream(
                            history,
                            tools=await _chat_tools(),
                            dispatch=dispatch):
                        if kind == "token":
                            acc += payload
                            yield sse({"delta": payload})
                        elif kind == "usage":
                            usage = payload
                            yield sse({"usage": payload})
                except Exception as e:
                    safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                    note = f"\n\n(Maaf, chat gagal: {safe})"
                    acc += note
                    yield sse({"delta": note})
            # Persist whatever was actually produced (empty stays empty, not a
            # lie), minus the <voice> line the client already consumed.
            clean, _ = voice.strip_voice_tag(acc)
            # The id has to reach the live stream too, not just the stored
            # message: the pane renders the card off the streaming text and only
            # re-reads the thread on the next load.
            suffix = task_card_suffix(clean, auto_id)
            if suffix:
                yield sse({"delta": suffix})
                clean += suffix
            store.add_message(sid, "assistant", clean)
            uploads.discard(images)      # looked at, answered, gone
            yield sse({"done": True, "usage": usage})
            # After the client has its answer: learning is a background chore,
            # and holding the stream open for a second model call would show up
            # as a pause with the reply already fully written. A resume turn has
            # no operator utterance to learn from, so it is skipped.
            if not body.resume:
                await learn_from_turn(text, clean)

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache",
                                          "X-Accel-Buffering": "no"})

    @app.post("/api/uploads")
    async def post_upload(request: Request, session_id: str | None = None):
        """Accept one image for a conversation.

        Raw body rather than multipart, like /api/stt: it needs no
        python-multipart dependency and the browser has the bytes anyway. The
        response carries the stored name, which the client sends back on the
        chat turn that should see the picture.
        """
        data = await request.body()
        if not data:
            raise HTTPException(status_code=400, detail="Body kosong")
        try:
            name, mime = uploads.save(paths.uploads_dir(),
                                      session_id or CONV_WEB, data)
        except uploads.UnsupportedImage as e:
            raise HTTPException(status_code=415, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=413, detail=str(e))
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Gagal menyimpan: {e}")
        return {"id": name, "mime": mime, "bytes": len(data)}

    @app.get("/api/postmortem")
    def get_postmortem(limit: int = 50):
        """Why tasks have been failing lately, grouped by what would fix them.

        The same reading of the same data the agent gets from its
        `failure_report` tool — one implementation, so the dashboard and the
        chat can never disagree about what went wrong.
        """
        rows = [t for t in store.list_tasks(limit=limit) if t.get("chat_id", 0) >= 0]
        summary = postmortem.summarize(rows, store.get_logs)
        return {**summary, "report": postmortem.render(summary)}

    @app.get("/api/facts")
    def get_facts():
        """What Hermes has learned about the operator. Readable — and
        deletable below — because these are extracted automatically: a fact the
        model got wrong would otherwise ride in every prompt forever."""
        return store.list_facts()

    @app.delete("/api/facts/{key}")
    def delete_fact(key: str):
        store.delete_fact(key)
        return {"ok": True}

    @app.get("/api/settings")
    def get_settings(): return config.load_settings().model_dump()

    @app.post("/api/settings")
    def post_settings(body: config.Settings):
        config.save_settings(body)
        return {"ok": True}

    @app.get("/api/secrets/status")
    def secrets_status():
        s = config.load_secrets()
        return {"nvidia_api_key_set": bool(s.nvidia_api_key),
                "telegram_bot_token_set": bool(s.telegram_bot_token)}

    @app.post("/api/secrets")
    def post_secrets(body: SecretsUpdate):
        cur = config.load_secrets()
        def keep(new, old): return old if new in ("", "***", None) else new
        config.save_secrets(config.Secrets(
            nvidia_api_key=keep(body.nvidia_api_key, cur.nvidia_api_key),
            telegram_bot_token=keep(body.telegram_bot_token, cur.telegram_bot_token)))
        return {"ok": True}

    @app.get("/api/engine-models")
    def engine_models():
        # agy's list comes from its CLI (needs its own auth/network), so it
        # is cached and degrades to a static fallback instead of erroring.
        now = time.time()
        ttl = _AGY_CACHE_TTL_S if _agy_cache["models"] is not None else _AGY_NEG_TTL_S
        if now - _agy_cache["at"] > ttl:
            live = list_agy_models()
            _agy_cache["at"] = now          # negative result also backs off
            if live is not None:
                _agy_cache["models"] = live # a failure never clobbers a good list
        agy = _agy_cache["models"]
        return {"claude": CLAUDE_MODELS,
                "agy": agy if agy is not None else AGY_FALLBACK_MODELS,
                "agy_live": agy is not None}

    @app.get("/api/projects")
    def get_projects():
        # `exists` is a UI hint only. The Settings validator deliberately
        # never stats paths (a dead folder must not crash startup), and
        # resolve_project() re-checks at task time — this is display state.
        s = config.load_settings()
        return [{"name": n, "path": p, "exists": Path(p).is_dir()}
                for n, p in s.projects.items()]

    @app.post("/api/projects")
    def post_projects(body: dict[str, str]):
        s = config.load_settings()
        try:
            updated = config.Settings.model_validate(
                {**s.model_dump(), "projects": body})
        except ValidationError as e:
            # Surface the validator's own message ("bad project name ...",
            # "path must be absolute ...") instead of a generic 500.
            raise HTTPException(status_code=422, detail=e.errors()[0]["msg"])
        config.save_settings(updated)
        return {"ok": True}

    @app.get("/api/mcp")
    def get_mcp(): return [m.model_dump() for m in config.load_settings().mcp_servers]

    @app.post("/api/mcp")
    async def post_mcp(body: list[config.McpServer]):
        s = config.load_settings()
        s.mcp_servers = body
        config.save_settings(s)
        # Reconnect the live hub too. The hub was built once at startup from
        # the settings file, so saving alone left the running agent on the old
        # server list — the settings page appeared to do nothing until Hermes
        # was restarted. The discovery cache is dropped with it, otherwise the
        # next chat turn would still be offered the previous set of tools.
        hub = getattr(app.state, "hub", None)
        if hub is not None:
            try:
                await hub.close()
                hub.servers = body
                await hub.connect()
                app.state._mcp_tools_cache = None
            except Exception as e:
                # The settings are saved either way; a restart picks them up.
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                return {"ok": True, "reconnect_error": safe}
        return {"ok": True}

    @app.get("/api/mcp/tools")
    async def mcp_tools():
        """What the chat agent can actually call right now.

        The registered-servers list says what was configured; this says what
        connected. Without it, "the agent says it has no disk access" is
        indistinguishable from a server that failed to start, and the only
        way to tell was reading the console.
        """
        tools = await _chat_tools()
        names = [t["function"]["name"] for t in tools]
        mcp_names = [n for n in names if mcp_risk.is_mcp_name(n)]
        gate_on = config.load_settings().confirm_risky
        return {
            "builtin": [n for n in names if not mcp_risk.is_mcp_name(n)],
            "mcp": mcp_names,
            "gated": [n for n in mcp_names if gate_on and mcp_risk.is_risky_tool(n)],
            "servers": sorted({n.split("__", 1)[0] for n in mcp_names}),
        }

    @app.post("/api/mcp/test")
    async def mcp_test(srv: config.McpServer):
        from .mcp_hub import McpHub
        factory = getattr(app.state, "mcp_factory", None)
        if factory is None:
            return {"ok": False, "error": "no mcp factory configured"}
        hub = McpHub([srv], session_factory=factory)
        try:
            await hub.connect()
            tools = await hub.list_tools()
            await hub.close()
            return {"ok": True, "tools": [t["name"] for t in tools]}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    INTEGRATE_RUN_TTL_S = 1800     # a finished run stays readable for a while
    INTEGRATE_RUNS_MAX = 20

    class IntegrateRun:
        """One integration attempt, readable while it runs.

        The ladder is a coroutine that outlives a request, so its progress has
        to live somewhere both the SSE stream and a plain GET can read.
        """

        def __init__(self, run_id: str, link: str):
            self.id = run_id
            self.link = link
            self.state = "running"       # running | done
            self.events: list[dict] = []
            self.queue: asyncio.Queue = asyncio.Queue()
            self.pending_secret = ""
            self.login_url = ""
            self.server = None
            self.result = None
            self.finished_at = 0.0
            self._secret: asyncio.Future | None = None

        async def emit(self, ev: dict):
            self.events.append(ev)
            if ev.get("kind") == "login":
                self.login_url = ev.get("url", "")
            if ev.get("kind") == "done":
                self.state = "done"
                self.server = ev.get("server")
                self.finished_at = time.time()
            await self.queue.put(ev)

        async def ask_secret(self, name: str, hint: str) -> str:
            self.pending_secret = name
            self._secret = asyncio.get_running_loop().create_future()
            try:
                # Bounded like the OAuth wait: an unanswered prompt must not
                # hold a run open forever.
                return await asyncio.wait_for(self._secret, 300.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                return ""
            finally:
                self.pending_secret = ""

        def answer_secret(self, value: str) -> bool:
            if self._secret is None or self._secret.done():
                return False
            self._secret.set_result(value)
            return True

    def _evict_old_runs():
        runs = app.state.integrate_runs
        cutoff = time.time() - INTEGRATE_RUN_TTL_S
        for rid, run in list(runs.items()):
            if run.state == "done" and run.finished_at < cutoff:
                runs.pop(rid, None)
        while len(runs) > INTEGRATE_RUNS_MAX:
            runs.pop(next(iter(runs)))

    async def _open_login(url: str):
        # From the panel the front-end opens its own popup on the `login`
        # event; opening here as well covers a run started from chat, where no
        # panel is listening.
        launcher.open_app(url)

    def _start_integrate(link: str) -> str:
        _evict_old_runs()
        run_id = f"i{int(time.time() * 1000)}"
        run = IntegrateRun(run_id, link)
        app.state.integrate_runs[run_id] = run
        settings = config.load_settings()
        port = getattr(app.state, "port", 8799)

        async def go():
            try:
                res = await mcp_integrate.integrate(
                    link,
                    emit=run.emit,
                    ask_secret=run.ask_secret,
                    open_url=_open_login,
                    session_factory=getattr(app.state, "mcp_factory", None)
                    or (lambda s, auth=None: None),
                    propose_config=getattr(app.state, "propose_mcp_config", None),
                    read_readme=getattr(app.state, "read_readme", None),
                    pending=app.state.pending_auth,
                    # Derived from the running port, not hardcoded: a provider
                    # rejects a redirect_uri that does not match exactly.
                    redirect_uri=f"http://127.0.0.1:{port}/api/mcp/oauth/callback",
                    taken={s.name for s in settings.mcp_servers})
                run.result = res
                if res.ok and res.server is not None:
                    await _save_integrated(res.server)
            except Exception as e:
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                await run.emit({"kind": "done", "ok": False,
                                "reason": "error", "error": safe})
        asyncio.create_task(go())
        return run_id

    async def _save_integrated(srv: config.McpServer):
        """Append the server and reconnect the hub, reusing the same path the
        MCP panel's save uses so there is only one way a server is registered."""
        s = config.load_settings()
        s.mcp_servers = [m for m in s.mcp_servers if m.name != srv.name] + [srv]
        config.save_settings(s)
        hub = getattr(app.state, "hub", None)
        if hub is not None:
            try:
                await hub.close()
                hub.servers = s.mcp_servers
                await hub.connect()
                app.state._mcp_tools_cache = None
            except Exception:
                pass

    @app.post("/api/mcp/integrate")
    async def mcp_integrate_start(body: IntegrateBody):
        return {"run_id": _start_integrate(body.link)}

    @app.get("/api/mcp/integrate/{run_id}")
    async def mcp_integrate_state(run_id: str):
        run = app.state.integrate_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run tidak ditemukan")
        return {"state": run.state, "events": run.events,
                "pending_secret": run.pending_secret,
                "login_url": run.login_url, "server": run.server}

    @app.get("/api/mcp/integrate/{run_id}/events")
    async def mcp_integrate_events(run_id: str, request: Request):
        run = app.state.integrate_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run tidak ditemukan")

        async def gen():
            for ev in list(run.events):        # whatever already happened
                yield brain.sse(ev)
            while run.state != "done":
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(run.queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield brain.sse(ev)
        return StreamingResponse(gen(), media_type="text/event-stream")

    @app.post("/api/mcp/integrate/{run_id}/secret")
    async def mcp_integrate_secret(run_id: str, body: SecretBody):
        run = app.state.integrate_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run tidak ditemukan")
        return {"ok": run.answer_secret(body.value)}

    @app.post("/api/mcp/integrate/{run_id}/cancel")
    async def mcp_integrate_cancel(run_id: str):
        run = app.state.integrate_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run tidak ditemukan")
        run.answer_secret("")
        await run.emit({"kind": "done", "ok": False, "reason": "cancelled"})
        return {"ok": True}

    @app.get("/api/mcp/oauth/callback")
    async def mcp_oauth_callback(code: str = "", state: str = ""):
        """Where the identity provider sends the browser back.

        Only a state this process is currently waiting on is accepted; anything
        else is refused without side effect, which is what stops another
        program on this machine from injecting an authorization code.
        """
        if not app.state.pending_auth.resolve(state, code):
            raise HTTPException(status_code=400, detail="state tidak dikenal")
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'>"
            "<p>Login selesai. Jendela ini bisa ditutup.</p>"
            "<script>window.close()</script>")

    @app.get("/api/stt/status")
    def get_stt_status():
        s = config.load_settings()
        return {
            "available": stt.available(),
            "loaded": stt.is_loaded(),
            "model": s.stt_model,
            "enabled": s.stt_enabled,
            "language": s.stt_language,
        }

    @app.post("/api/stt")
    async def post_stt(request: Request):
        """Transcribe a recording from the browser's mic. The body is the raw
        blob MediaRecorder produced -- raw rather than multipart so this needs
        no python-multipart dependency, and faster-whisper decodes webm/opus
        itself."""
        from fastapi import Response

        if not stt.available():
            raise HTTPException(
                status_code=503,
                detail="faster-whisper belum terinstal. Jalankan: "
                       "pip install -e .[voice]")

        settings = config.load_settings()
        if not settings.stt_enabled:
            raise HTTPException(
                status_code=403,
                detail="Voice input dimatikan di pengaturan Suara")

        audio = await request.body()
        if len(audio) > stt.MAX_AUDIO_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Rekaman terlalu panjang (maksimal "
                       f"{stt.MAX_AUDIO_BYTES // (1024 * 1024)} MB)")

        # Transcription is seconds of synchronous CPU work. Run straight from
        # this coroutine it would freeze the whole event loop -- including the
        # SSE feed the dashboard lives on and any chat stream in flight.
        try:
            text = await asyncio.to_thread(
                stt.transcribe, audio, settings.stt_language, settings.stt_model)
        except stt.SttUnavailable as e:
            raise HTTPException(status_code=503, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=413, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if not text.strip():
            return Response(status_code=204)
        return {"text": text.strip()}



    return app
