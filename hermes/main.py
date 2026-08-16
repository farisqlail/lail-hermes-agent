from __future__ import annotations
import asyncio, json, subprocess
from pathlib import Path
from openai import AsyncOpenAI
import uvicorn
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, MessageHandler, CommandHandler, filters
from . import brain, cleanup, config, paths, uploads, voice
from .session_store import Store
from .mcp_hub import McpHub, RealMcpSession, to_openai_tools
from .orchestrator import Orchestrator
from .telegram_bridge import Bridge
from .web_ui import create_app
from .chat_engine import ChatEngine

from . import build_runner, engine_runner, test_runner, project_detect
from . import ask_server, ask_ui, tg_format
from .ask import AskRegistry
from .git_status import git_dirty
from .recovery import group_digests

class Adb:
    def __init__(self, settings: config.Settings):
        sdk = Path(settings.android_sdk_path) if settings.android_sdk_path else Path()
        self.adb = str(sdk / "platform-tools" / "adb.exe") if settings.android_sdk_path else "adb"
        self.emulator = str(sdk / "emulator" / "emulator.exe") if settings.android_sdk_path else "emulator"

    async def _run(self, argv):
        p = await asyncio.create_subprocess_exec(
            *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await p.communicate()
        return (p.returncode == 0, (out + err).decode(errors="replace"))

    async def is_running(self):
        ok, out = await self._run([self.adb, "devices"])
        if not ok:
            return False
        lines = [l for l in out.splitlines() if l.strip() and not l.startswith("List of")]
        return any(l.endswith("device") or "emulator-" in l for l in lines)


    async def start(self, avd):
        subprocess.Popen([self.emulator, "-avd", avd])
        ok, out = await self._run([self.adb, "wait-for-device"])
        return (ok, out)

    async def install(self, apk): return await self._run([self.adb, "install", "-r", apk])
    async def launch(self, pkg):
        return await self._run([self.adb, "shell", "monkey", "-p",
                                pkg, "-c", "android.intent.category.LAUNCHER", "1"])
    async def screencap(self, dest):
        p = await asyncio.create_subprocess_exec(
            self.adb, "exec-out", "screencap", "-p", stdout=asyncio.subprocess.PIPE)
        out, _ = await p.communicate()
        Path(dest).write_bytes(out)
        return (p.returncode == 0, "")

MAX_TOOL_ROUNDS = 8  # bound NIM tool round-trips so a misbehaving model/tool can't loop forever
PLANNER_REQUEST_TIMEOUT_S = 120   # single NIM completion call
MCP_DISCOVERY_TIMEOUT_S = 20      # tool discovery must never stall planning
MAX_EMPTY_PLANNER_ROUNDS = 1      # nudges spent on a provider that answered with nothing

# Reaching MAX_TOOL_ROUNDS used to end the turn with an apology and nothing
# else: every tool result already fetched was discarded and the user was told
# there had been too many rounds, which is not their problem and not an answer.
# The cap exists to stop an endless loop, not to cancel the reply. So the last
# round runs with the tools withdrawn and this nudge appended — with nothing to
# call, the model can only answer in prose, and it answers from the tool output
# already in the message list. The wall becomes a deadline.
FINAL_ROUND_NUDGE = (
    "Batas pemanggilan alat sudah tercapai. JANGAN panggil alat lagi. "
    "Jawab SEKARANG memakai hasil alat yang sudah kamu terima di atas. "
    "Bila datanya belum lengkap, katakan apa yang sudah kamu ketahui, apa yang "
    "belum, dan langkah berikutnya — jangan meminta maaf tanpa jawaban."
)

# Same defect the planner already nudges past (MAX_EMPTY_PLANNER_ROUNDS), on
# the chat path: a round can end with no tool call and no prose. The turn then
# reaches the operator as the web UI's "(tidak ada balasan)" placeholder and is
# persisted as an empty assistant message. Two ways it happens, both covered by
# one check on the visible text: the provider answers with nothing, or the model
# emits only the <voice> opener, which is stripped before display. One retry is
# enough to tell a hiccup from a model that will never answer.
MAX_EMPTY_REPLY_ROUNDS = 1
EMPTY_REPLY_NUDGE = (
    "Balasan sebelumnya kosong — pengguna tidak melihat apa pun. Tulis SEKARANG "
    "jawaban teks biasa untuk permintaan terakhir. Jangan hanya mengirim tag "
    "suara, jangan memanggil alat lagi."
)

# Appended to a replayed result so the model sees why it got no fresh call.
_REPEAT_TOOL_NOTE = ("\n\n[catatan sistem: panggilan alat ini sudah dilakukan "
                     "persis sama pada giliran ini; ini hasil yang sama. "
                     "Jangan ulangi — lanjutkan menjawab.]")


def _has_visible_prose(content: str) -> bool:
    """True when the operator would actually see something.

    The <voice> opener is stripped before display, so a reply consisting only of
    a tag renders as nothing at all — indistinguishable, to the operator, from a
    provider that answered with an empty string. Both are "no reply".
    """
    display, _ = voice.strip_voice_tag(content or "")
    return bool(display.strip())


async def _call_tool_once(seen: dict, call, name: str, raw_args: str) -> str:
    """Dispatch a tool call, replaying the result if this turn already made it.

    A model that re-issues `list_projects` with identical arguments five times
    is not making progress, it is stuck — and each repeat spends a round the cap
    then blames on the user. Identical arguments cannot yield a different answer
    within one turn, so replaying the first result costs no round-trip and
    breaks the cycle. It also stops a repeated `start_task` from queueing the
    same work twice.
    """
    key = f"{name}({raw_args or '{}'})"
    if key in seen:
        return seen[key] + _REPEAT_TOOL_NOTE
    try:
        args = json.loads(raw_args or "{}")
    except json.JSONDecodeError:
        args = {}
    seen[key] = await call(name, args)
    return seen[key]

# Phase 3 Step 1 of docs/figma-uiux-roadmap.md: the model otherwise never
# actually SEES its own Figma build — figma_web_design's result is just a
# JSON string with a screenshot path, text the model cannot visually reason
# over. Wrapping that screenshot as an inline image in a followup user
# message (same data_url pattern as a human's uploaded mockup) lets the model
# compare its own output against what was asked and self-correct next round,
# instead of confidently reporting success on a build it never looked at.
_FIGMA_SELFCHECK_PROMPT = (
    "Ini screenshot hasil desain Figma yang baru saja kamu buat. Bandingkan "
    "dengan mockup/referensi yang diberikan pengguna (kalau ada gambar "
    "terlampir sebelumnya di percakapan ini) atau dengan permintaan "
    "pengguna. Sebutkan SECARA KONKRET kalau ada yang meleset — warna, "
    "elemen hilang/salah urutan, teks salah, ukuran/spacing janggal. Jangan "
    "memuji generik kalau sebenarnya ada yang salah. Kalau sudah sesuai, "
    "cukup katakan singkat sudah sesuai."
)

# Phase 4's own note (docs/figma-uiux-roadmap.md): a multi-frame screenshot
# is a genuinely different shape to check than a single build — several
# frames side by side in ONE image, compared against a request that
# describes several screens/steps, not one. A model told to "compare this
# screenshot to the request" without being told there are multiple frames
# in it could plausibly check only the first one and call the rest
# sudah-sesuai by default. This variant names that explicitly instead of
# reusing the single-frame prompt as-is.
_FIGMA_SELFCHECK_FLOW_PROMPT = (
    "Ini screenshot BEBERAPA frame Figma yang baru saja kamu buat sekaligus "
    "(disusun berjejer ke kanan dalam satu gambar). Periksa SETIAP frame "
    "satu per satu terhadap bagian permintaan pengguna yang sesuai (mis. "
    "frame pertama = layar/langkah pertama yang diminta, dst) — jangan "
    "cuma cek frame pertama lalu anggap sisanya juga benar. Sebutkan "
    "SECARA KONKRET kalau ada yang meleset di frame MANA PUN — warna, "
    "elemen hilang/salah urutan, teks salah, ukuran/spacing janggal, atau "
    "urutan alur yang tertukar. Jangan memuji generik kalau sebenarnya ada "
    "yang salah. Kalau semua frame sudah sesuai, cukup katakan singkat "
    "semua sudah sesuai."
)


def _figma_selfcheck_message(tool_name: str, result_content: str) -> dict | None:
    """A followup user message carrying the build's own screenshot, or None
    for any other tool / a build that produced no usable screenshot.

    `figma_web_fix_photo` (Phase 3 Step 2) and `figma_web_design_flow`
    (Phase 4) are included so a delta fix or a multi-frame build get the
    same close-the-loop treatment as a single full build — otherwise the
    model would report success on faith, the exact blind confidence Step 1
    exists to prevent. `figma_web_design_flow` gets its own prompt variant
    (`_FIGMA_SELFCHECK_FLOW_PROMPT`) rather than reusing the single-frame
    one — its screenshot shows several frames side by side in one image,
    and a prompt that doesn't say so risks the model only really checking
    the first one.
    """
    if tool_name not in ("figma_web_design", "figma_web_fix_photo", "figma_web_design_flow"):
        return None
    try:
        data = json.loads(result_content)
    except json.JSONDecodeError:
        return None
    shot = data.get("screenshot_path")
    if not data.get("ok") or not shot:
        return None
    p = Path(shot)
    if not p.is_file():
        return None
    prompt = (_FIGMA_SELFCHECK_FLOW_PROMPT if tool_name == "figma_web_design_flow"
              else _FIGMA_SELFCHECK_PROMPT)
    try:
        parts = uploads.as_content_parts(prompt, [p])
    except uploads.UnsupportedImage:
        return None
    return {"role": "user", "content": parts}

# python-telegram-bot's default HTTP timeouts (connect/read ~5s) are tight for
# a slow or flaky uplink to api.telegram.org: a single timed-out send raised
# telegram.error.TimedOut ("Timed out"), which — uncaught in handle_task —
# escaped to crash_reporter as "Internal error - task crashed: Timed out",
# killing a task before the engine even ran. Widen the window here; retry below.
BOT_HTTP_TIMEOUT_S = 20
# Backoff for transient Telegram send failures. Absorbs a network blip so a
# status message (e.g. handle_task's opening "queued") can't abort the task.
_SEND_RETRY_DELAYS_S = (1, 3, 6)

# The shared NIM endpoint saturates for whole minutes at a time
# ("ResourceExhausted: Worker local total request limit reached"). The OpenAI
# SDK's built-in retries (2, near-instant) don't outlast that, so we add our
# own, spaced widely enough to.
_PLANNER_RETRY_DELAYS_S = (5, 15, 30)

# One AsyncOpenAI client per (endpoint, key, timeout) instead of a fresh one on
# every completion. A new client each turn meant a new httpx pool and a new TLS
# handshake to the gateway before the first token — pure latency on a path the
# user waits on. The client is safe to reuse across concurrent requests. Keyed
# on the live settings, so changing the endpoint/key in the panel yields a new
# client (the old one just lingers, harmless); the timeout is part of the key
# because call sites want different ceilings (chat 120s, fact-extract 20s).
_CLIENT_CACHE: dict[tuple[str, str, int], AsyncOpenAI] = {}

def _client(base_url: str, api_key: str, timeout: int) -> AsyncOpenAI:
    key = (base_url or "", api_key or "", timeout)
    c = _CLIENT_CACHE.get(key)
    if c is None:
        c = AsyncOpenAI(base_url=base_url, api_key=api_key, timeout=timeout)
        _CLIENT_CACHE[key] = c
    return c

def _is_transient_nim_error(e: BaseException) -> bool:
    """Worth retrying: capacity/rate limits, gateway blips, connection drops.

    Auth errors (401), bad requests (400), and anything non-HTTP are real
    failures and must surface immediately.
    """
    import openai
    if isinstance(e, (openai.APIConnectionError, openai.RateLimitError)):
        return True
    return (isinstance(e, openai.APIStatusError)
            and e.status_code in (429, 500, 502, 503, 504))

async def _completion_with_retry(create, sleep=asyncio.sleep):
    """Run `create()` (an async completion call), retrying transient errors.

    Exhausting the retries turns the raw HTTP error into a message the person
    on Telegram can act on — the raw 503 JSON reads like a Hermes bug when it
    is really "the shared model endpoint is full, resubmit later".
    """
    for delay in _PLANNER_RETRY_DELAYS_S:
        try:
            return await create()
        except Exception as e:
            if not _is_transient_nim_error(e):
                raise
            print(f"Model endpoint busy ({_console_safe(e)}); retrying in {delay}s")
            await sleep(delay)
    try:
        return await create()
    except Exception as e:
        if not _is_transient_nim_error(e):
            raise
        raise ValueError(
            "The model endpoint is overloaded right now (shared NVIDIA NIM "
            f"capacity limit). Hermes retried {len(_PLANNER_RETRY_DELAYS_S) + 1} "
            f"times over ~{sum(_PLANNER_RETRY_DELAYS_S)}s without getting "
            "through. Nothing is wrong with your task — please resubmit it in "
            "a few minutes.") from e

def build_nim_planner(settings, secrets, hub):
    system = (
        "You are Lail Hermes' planner. Read the user's task and output ONLY a JSON "
        "object, no prose:\n"
        '{"steps":[{"type":"code|build|test","engine":"claude|antigravity",'
        '"prompt":"...","target":"apk","mode":"browser|emulator"}]}\n'
        "\n"
        "Rules:\n"
        "1. Most tasks are a SINGLE code step. Investigating, fixing, debugging, "
        "checking, refactoring, or adding a feature is a `code` step: the engine "
        "opens the project and edits it directly. Do NOT add a test step merely "
        "to 'verify' — a code step verifies its own work.\n"
        "2. `build`, and `test` with mode `emulator` / target `apk`, are ONLY "
        "for Android projects — an app that compiles to an APK (Gradle, an "
        "`android/` module). For a web app, backend, script, or anything "
        "non-Android, never use emulator mode or an apk target.\n"
        "3. If a web app genuinely needs a test, use mode `browser`; otherwise "
        "omit the test step entirely.\n"
        "4. Never emit a `test` step unless a `build` step precedes it in the "
        "same plan: an emulator test with no prior build has no APK to install "
        "and always fails.\n"
        "5. `prompt` is the instruction handed to the coding engine — write it "
        "as a clear, self-contained task, in the language the user used. Carry "
        "over EVERY concrete detail the user gave (file names, endpoints, "
        "field names, error text, versions) word for word: the engine acts on "
        "your sentence, and a detail you drop is a detail it has to guess. "
        "Equally, do NOT invent details the user did not give — no made-up "
        "file paths, endpoints, function names, or libraries. You have not "
        "opened this repository; a name you guess sends the engine editing the "
        "wrong file. Where the user was vague, stay vague and say what to "
        "achieve, letting the engine find the real code.\n"
        "6. OUTPUT SHAPE IS FIXED. The top-level key MUST be exactly `steps`, a "
        "list, and every element MUST have a `type` of `code`, `build`, or "
        "`test`. Do NOT invent keys like `implementation_plan`, `feature`, or "
        "steps shaped `{step,title,details}`. A whole feature is ONE code step "
        "whose `prompt` describes it — not a step per sub-task.\n"
        "Example for “add a status filter tab to the transaction list”:\n"
        '{"steps":[{"type":"code","engine":"claude","prompt":"Tambahkan tab '
        'filter status di halaman Daftar Transaksi: ambil opsi dari '
        "{{front}}/orders/statuses, render tab dinamis + tab 'Semua', simpan "
        "status_id aktif, dan kirim sebagai query param ke API daftar "
        'transaksi."}]}')
    async def planner(text: str, context: str = "") -> str:
        current_secrets = config.load_secrets()
        if not current_secrets.nvidia_api_key:
            raise ValueError("AI API Key is missing. Please configure it in Settings.")
        current_settings = config.load_settings()
        client = _client(current_settings.nvidia_base_url, current_secrets.nvidia_api_key,
                         PLANNER_REQUEST_TIMEOUT_S)
        # Split the clock: discovery (MCP subprocess round-trips, cold-start
        # heavy) vs the planning LLM rounds. Read the log to see which half of a
        # slow plan start is the cache miss and which is the model.
        import time
        _t_disc = time.monotonic()
        try:
            discovered = await asyncio.wait_for(hub.list_tools(), MCP_DISCOVERY_TIMEOUT_S)
        except asyncio.TimeoutError:
            print(f"MCP tool discovery timed out after {MCP_DISCOVERY_TIMEOUT_S}s; planning without tools")
            discovered = []
        print(f"[timing plan] discovery {time.monotonic() - _t_disc:.2f}s "
              f"(tools={len(discovered)})")
        _t_plan = time.monotonic()
        oa_tools = to_openai_tools(discovered)
        # Project facts ride INSIDE the rules message. They used to be a second
        # system message, which reads cleaner but broke the plan contract
        # outright on an OpenAI-compatible gateway: measured against the
        # configured endpoint, the same task planned 3/3 with one system
        # message and 0/3 with two — the model answered with JavaScript for the
        # task instead of a plan, or with zero completion tokens, which is what
        # surfaced as "planner returned empty output". Keep this one message.
        # Rules 2-4 are unobeyable without the facts — nothing else tells the
        # planner whether this project can produce an APK.
        msgs = [{"role": "system",
                 "content": f"{system}\n\n{context}" if context else system},
                {"role": "user", "content": text}]
        empty_rounds = 0
        called: dict = {}
        for i in range(MAX_TOOL_ROUNDS):
            if i == MAX_TOOL_ROUNDS - 1:
                msgs.append({"role": "user", "content": FINAL_ROUND_NUDGE})
            round_tools = None if i == MAX_TOOL_ROUNDS - 1 else (oa_tools or None)
            resp = await _completion_with_retry(
                lambda: client.chat.completions.create(
                    model=current_settings.model, messages=msgs,
                    temperature=current_settings.planner_temperature,
                    tools=round_tools))
            m = resp.choices[0].message
            if m.tool_calls:
                msgs.append(m.model_dump())
                for tc in m.tool_calls:
                    result = await _call_tool_once(called, hub.call, tc.function.name,
                                                   tc.function.arguments)
                    msgs.append({"role": "tool", "tool_call_id": tc.id, "content": result})
                continue
            content = m.content or ""
            if content.strip() or empty_rounds >= MAX_EMPTY_PLANNER_ROUNDS:
                print(f"[timing plan] llm {time.monotonic() - _t_plan:.2f}s")
                return content
            # An empty completion with no tool call is a provider hiccup, not a
            # plan: the task text is still unanswered. Observed twice in one
            # morning against a local gateway, each time failing the task with
            # "no JSON object in planner output" and nothing to show for it.
            # One nudge is enough to tell a hiccup from a model that will never
            # answer; past that the caller reports the empty output honestly.
            empty_rounds += 1
            # A user turn, not a system one: a second system message is exactly
            # what makes this endpoint answer with nothing, and a nudge that
            # reproduces the fault it is recovering from is no nudge at all.
            msgs.append({"role": "user",
                         "content": "Balasan sebelumnya kosong. Keluarkan "
                                    "SEKARANG objek JSON rencananya saja."})
        raise ValueError(f"planner exceeded {MAX_TOOL_ROUNDS} tool-call rounds without a final answer")
    return planner

# When the operator turns off confirm_risky, the gate is waived on every
# surface. The static template still describes write tools as "held for
# confirmation"; this later paragraph overrides that so the model stops telling
# the user an action is pending when it now runs straight through.
_NO_CONFIRM_NOTE = (
    "\n\nOVERRIDE PENTING: konfirmasi operator DIMATIKAN. Semua alat "
    "TULIS/KIRIM/HAPUS/klik/shell LANGSUNG dijalankan tanpa persetujuan dan "
    "tanpa 'needs_confirmation'. Abaikan instruksi sebelumnya soal aksi "
    "ditahan/menunggu persetujuan. Jalankan permintaan pengguna langsung, lalu "
    "laporkan hasil nyatanya. Ini TIDAK berlaku untuk `start_task`: status "
    "`awaiting_confirm` dari alat itu tetap berarti task ditahan menunggu Run, "
    "dan tetap harus kamu sampaikan apa adanya."
)


def _confirm_note(s) -> str:
    return "" if s.confirm_risky else _NO_CONFIRM_NOTE


def build_nim_chat(settings, secrets):
    """The conversational agent behind the web UI chat pane.

    Deliberately tool-free, unlike build_nim_planner: the MCP hub exposes
    ask_user, which only means something inside a live engine run (it needs a
    Run token and a deadline to suspend). A plain chat turn calling it would
    block on a question nobody can answer. Tools in chat are a later tier; this
    one just talks. It executes work only through `start_task`, and only within
    that tool's own gate: a named project with a clean repository and no risky
    verb starts immediately, anything else is held for the operator's Run. The
    agent never touches a repo directly and cannot invent a result it never
    produced.
    """
    system_template = (
        "Kamu adalah {agent_name}, asisten orkestrasi rekayasa perangkat lunak untuk Lail Hermes. "
        "Jawab ringkas dan membantu, dalam bahasa yang dipakai pengguna "
        "(default Bahasa Indonesia). Kamu menjelaskan cara kerja Lail Hermes, "
        "membantu menyusun instruksi, dan menjawab pertanyaan teknis.\n"
        "Selalu gunakan format Markdown yang bersih dan terstruktur untuk menyusun jawabanmu: "
        "gunakan header (## atau ###) untuk memisahkan topik/judul, garis horizontal (---) untuk memisahkan bagian besar, "
        "serta tabel (|---|---|) atau poin bullet untuk menyajikan daftar/rincian data agar mudah dibaca.\n"
        "Kamu punya alat: `list_projects` (proyek terdaftar), `recent_tasks` "
        "(task terakhir + status), `get_task_detail` (rincian satu task), "
        "`failure_report` (kegagalan terakhir dikelompokkan per jenis), dan "
        "`start_task` (antre task orkestrasi baru). Pakai alat baca untuk "
        "menjawab pertanyaan soal proyek/status secara akurat — jangan menebak "
        "atau mengarang status.\n"
        "Bila ditanya kenapa task sering gagal, apa yang perlu diperbaiki, atau "
        "bagaimana kondisi sistem belakangan ini: panggil `failure_report` dan "
        "jawab dari angkanya. Sebutkan jenis kegagalan yang paling banyak dan "
        "apa tindakan yang masuk akal — kegagalan lingkungan butuh perbaikan di "
        "mesin, struktural butuh rencana lain, sesaat cukup dikirim ulang.\n"
        "MENGERJAKAN KODE: bila permintaan menyebut sebuah proyek dengan "
        "`@nama-proyek` DAN menyangkut kode atau berkas (menambah, mengubah, "
        "memperbaiki, refactor, menghapus), kamu WAJIB memanggil `start_task` "
        "dengan permintaan itu apa adanya, termasuk `@nama-proyek`-nya. Dalam "
        "hal itu kamu DILARANG menulis patch, diff, atau blok kode "
        "implementasi di dalam jawaban chat: yang mengerjakan kodenya adalah "
        "task, bukan kamu, dan kode yang cuma ditempel di chat tidak pernah "
        "sampai ke proyek.\n"
        "Bila permintaan TIDAK menyebut `@nama-proyek`, itu diskusi — jawab "
        "saja, jangan panggil `start_task`.\n"
        "Baca `status` dari hasil `start_task` dan sampaikan apa adanya: "
        "`running` berarti task sudah mulai berjalan sendiri; "
        "`awaiting_confirm` berarti task ditahan sampai operator menekan Run, "
        "dan kamu harus menyebutkan isi `reasons`; `cancelled` atau `rejected` "
        "berarti task tidak jadi jalan. Jangan mengarang status. `running` "
        "berarti dimulai, BUKAN selesai — jangan mengaku pekerjaannya sudah "
        "beres atau mengarang hasil eksekusi.\n"
        "DILARANG KERAS menulis task ID yang tidak kamu terima dari hasil alat "
        "pada giliran ini. Task ID hanya sah bila dikembalikan `start_task`, "
        "`recent_tasks`, atau `get_task_detail` barusan — jangan menyalin pola "
        "ID dari percakapan sebelumnya, jangan menyusun ID dari tanggal/jam, "
        "dan jangan menebak. Sebaliknya, jika `start_task` sukses dipanggil, "
        "kamu WAJIB menuliskan Task ID hasil pemanggilan alat tersebut di dalam respons teks Anda "
        "agar sistem Web UI dapat merender kartu tugas dengan tombol Run/Cancel secara inline. "
        "Bila kamu tidak punya ID dari alat, jangan sebut ID sama sekali: panggil `recent_tasks` "
        "dulu. ID karangan membuat pengguna menunggu task yang tidak pernah ada.\n"
        "Kalau pengguna minta 'run'/'jalankan' task yang sudah diantre: kamu "
        "TIDAK bisa menekan Run. Arahkan ke kartu task di panel chat ini — "
        "kartu itu punya tombol Run/Cancel dan tautan 'Lihat Log & Langkah "
        "Lengkap'. Jangan mengarang lokasi menu lain.\n\n"
        "ALAT INTEGRASI (bila terpasang lewat MCP: file, browser, email, "
        "kalender): pakai untuk menjalankan perintah pengguna secara nyata. "
        "Untuk melihat isi folder atau membaca berkas, pakai alat baca yang "
        "sudah ada (`list_directory`, `read_file`, `get_file_info`, "
        "`start_search`) — jangan membungkusnya sebagai perintah shell lewat "
        "`start_process`: alat baca langsung jalan, sedangkan shell ditahan "
        "untuk konfirmasi, jadi pengguna diminta menyetujui hal yang "
        "sebenarnya cuma membaca. Shell hanya untuk yang memang butuh "
        "menjalankan program. "
        "Alat BACA (membaca file, mencari email, melihat kalender, screenshot) "
        "langsung dijalankan. Alat TULIS/KIRIM/HAPUS (kirim email, buat/ubah "
        "event, tulis/hapus file, klik/isi form browser) DITAHAN untuk "
        "konfirmasi operator — hasil alat akan berkata 'needs_confirmation'. "
        "Bila itu terjadi, sampaikan ke pengguna bahwa aksi menunggu persetujuan "
        "dan JANGAN mengaku sudah melakukannya.\n\n"
        "MEMBUKA APLIKASI / URL: untuk membuka app desktop yang dikenal (paint, "
        "notepad, calculator, explorer, wordpad) atau sebuah URL, pakai alat "
        "`open_app` — BUKAN shell/`start_process`. `open_app` langsung dijalankan "
        "tanpa konfirmasi operator; bila hasilnya 'opened', katakan app/URL sudah "
        "dibuka. Bila 'unknown_app', app itu di luar daftar aman — sampaikan belum "
        "dibuka dan sebut app yang tersedia.\n\n"
        "MEMBUAT GAMBAR: bila pengguna minta dibuatkan gambar/ilustrasi/logo/ikon/"
        "foto, panggil `generate_image` dengan prompt sedetail mungkin. Bila "
        "hasilnya berstatus 'generated', SERTAKAN nilai field `markdown` APA ADANYA "
        "di jawabanmu agar gambarnya tampil inline; jangan cuma menautkannya dan "
        "jangan mengarang bahwa gambar sudah jadi tanpa memanggil alatnya. Bila "
        "'error', sampaikan gagalnya, jangan berpura-pura ada gambar.\n\n"
        "MEMBUAT KLIP VIDEO: bila pengguna memberi waktu mulai & selesai, panggil "
        "`youtube_clip` (url, start, end). Bila pengguna minta dicarikan bagian "
        "yang menarik/viral ATAU memberi URL TANPA waktu, panggil `viral_clip` "
        "(url) — ia otomatis memilih bagian paling banyak diputar ulang (maks 60 "
        "detik); JANGAN meminta waktu mulai/selesai dulu, langsung panggil. Untuk "
        "keduanya, bila 'clipped' SERTAKAN field `markdown` APA ADANYA agar "
        "videonya tampil, dan sebutkan `start`-`end` serta `reason` bila ada. Bila "
        "pengguna minta BEBERAPA pilihan/kandidat atau 'top 3', panggil "
        "`viral_clips` — hasilnya daftar `candidates`, dan kamu WAJIB menampilkan "
        "`markdown` SETIAP kandidat (judul + video) apa adanya, satu per satu. Bila "
        "'error', sampaikan gagalnya apa adanya; jangan mengarang klip. Klip "
        "viral otomatis dibuat 9:16 (vertikal, siap Shorts/TikTok); bila pengguna "
        "mau rasio asli, pakai vertical='none'.\n\n"
    )

    async def chat(history: list[dict], tools=None, dispatch=None) -> str:
        if not secrets.nvidia_api_key:
            raise ValueError("NVIDIA API Key is missing. Please configure it in Settings.")
        current_settings = config.load_settings()
        agent_name = current_settings.agent_name or "Lail Agent"
        system = system_template.format(agent_name=agent_name) + voice.voice_tag_instruction(current_settings) + _confirm_note(current_settings)
        client = _client(current_settings.nvidia_base_url, secrets.nvidia_api_key,
                         PLANNER_REQUEST_TIMEOUT_S)
        msgs = [{"role": "system", "content": system}, *history]
        # tools + dispatch are a curated, safe set supplied by the web layer
        # (list_projects, recent_tasks, get_task_detail, start_task) — NOT the
        # MCP hub, which carries ask_user and would deadlock a chat turn. Absent,
        # the agent is a plain talker (the fallback for a bad key or no wiring).
        if not (tools and dispatch):
            resp = await _completion_with_retry(
                lambda: client.chat.completions.create(
                    model=current_settings.chat_model or current_settings.model, messages=msgs,
                    temperature=current_settings.chat_temperature))
            return resp.choices[0].message.content or ""
        called: dict = {}
        empty_rounds = 0
        # The empty-reply retries get their own rounds on top of the tool budget:
        # spending a tool round on a provider hiccup would punish the answer for
        # the provider's fault.
        for i in range(MAX_TOOL_ROUNDS + MAX_EMPTY_REPLY_ROUNDS):
            last = i >= MAX_TOOL_ROUNDS - 1
            if i == MAX_TOOL_ROUNDS - 1:
                msgs.append({"role": "user", "content": FINAL_ROUND_NUDGE})
            kwargs = dict(model=current_settings.chat_model or current_settings.model,
                          messages=msgs, temperature=current_settings.chat_temperature)
            if not last:
                kwargs["tools"] = tools
            resp = await _completion_with_retry(
                lambda: client.chat.completions.create(**kwargs))
            m = resp.choices[0].message
            if m.tool_calls and not last:
                msgs.append(m.model_dump())
                selfchecks = []
                for tc in m.tool_calls:
                    result = await _call_tool_once(called, dispatch, tc.function.name,
                                                   tc.function.arguments)
                    msgs.append({"role": "tool", "tool_call_id": tc.id, "content": result})
                    sc = _figma_selfcheck_message(tc.function.name, result)
                    if sc:
                        selfchecks.append(sc)
                msgs.extend(selfchecks)
                continue
            content = m.content or ""
            if _has_visible_prose(content) or empty_rounds >= MAX_EMPTY_REPLY_ROUNDS:
                return content
            empty_rounds += 1
            if content:
                msgs.append({"role": "assistant", "content": content})
            msgs.append({"role": "user", "content": EMPTY_REPLY_NUDGE})
        return ""

    async def stream(history: list[dict], tools=None, dispatch=None):
        """Token-streaming twin of chat(): yields ("token", str) as the model
        emits, ("usage", {...}) once at the end. Tool rounds run inline — their
        content is not the final answer, so the loop resolves them and only the
        final round's prose reaches the caller as tokens.

        Not wrapped in _completion_with_retry: a retry cannot resume a stream
        mid-flight, so a transient NIM error surfaces to the SSE handler, which
        renders it as the assistant's turn rather than silently retrying.
        """
        if not secrets.nvidia_api_key:
            raise ValueError("NVIDIA API Key is missing. Please configure it in Settings.")
        current_settings = config.load_settings()
        agent_name = current_settings.agent_name or "Lail Agent"
        system = system_template.format(agent_name=agent_name) + voice.voice_tag_instruction(current_settings) + _confirm_note(current_settings)
        client = _client(current_settings.nvidia_base_url, secrets.nvidia_api_key,
                         PLANNER_REQUEST_TIMEOUT_S)
        msgs = [{"role": "system", "content": system}, *history]
        use_tools = bool(tools and dispatch)
        # Timing on the path the operator watches fill. TTFT is measured from the
        # first request, not per round, so a tool round-trip shows up as the gap
        # it is; total covers every round. Read the log to know whether a slow
        # reply is the gateway (high TTFT) or extra tool rounds (rounds > 1).
        import time
        t0 = time.monotonic()
        ttft = None
        rounds = 0
        called: dict = {}
        empty_rounds = 0
        for i in range(MAX_TOOL_ROUNDS + MAX_EMPTY_REPLY_ROUNDS):
            rounds += 1
            last = i >= MAX_TOOL_ROUNDS - 1
            if i == MAX_TOOL_ROUNDS - 1 and use_tools:
                msgs.append({"role": "user", "content": FINAL_ROUND_NUDGE})
            kwargs = dict(model=current_settings.chat_model or current_settings.model, messages=msgs,
                          temperature=current_settings.chat_temperature, stream=True,
                          stream_options={"include_usage": True})
            if use_tools and not last:
                kwargs["tools"] = tools
            resp = await client.chat.completions.create(**kwargs)
            content_buf = ""
            tool_acc: dict = {}   # index -> {id, name, args}
            usage = None
            async for chunk in resp:
                if getattr(chunk, "usage", None):
                    u = chunk.usage
                    usage = {"prompt": u.prompt_tokens, "completion": u.completion_tokens,
                             "total": u.total_tokens}
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    if ttft is None:
                        ttft = time.monotonic() - t0
                        print(f"[timing chat] TTFT {ttft:.2f}s "
                              f"(model={kwargs['model']}, rounds_before_prose={rounds})")
                    content_buf += delta.content
                    yield ("token", delta.content)
                for tcd in (getattr(delta, "tool_calls", None) or []):
                    slot = tool_acc.setdefault(tcd.index, {"id": "", "name": "", "args": ""})
                    if tcd.id:
                        slot["id"] = tcd.id
                    if tcd.function and tcd.function.name:
                        slot["name"] += tcd.function.name
                    if tcd.function and tcd.function.arguments:
                        slot["args"] += tcd.function.arguments
            if tool_acc and not last:
                msgs.append({"role": "assistant", "content": content_buf or None,
                             "tool_calls": [
                                 {"id": s["id"], "type": "function",
                                  "function": {"name": s["name"], "arguments": s["args"] or "{}"}}
                                 for s in tool_acc.values()]})
                selfchecks = []
                for s in tool_acc.values():
                    result = await _call_tool_once(called, dispatch, s["name"], s["args"])
                    msgs.append({"role": "tool", "tool_call_id": s["id"], "content": result})
                    sc = _figma_selfcheck_message(s["name"], result)
                    if sc:
                        selfchecks.append(sc)
                msgs.extend(selfchecks)
                continue
            # A round that streamed nothing the operator can see is the
            # "(tidak ada balasan)" placeholder in the making. Retry once with
            # the tools withdrawn rather than closing an empty turn. Anything
            # already streamed stays on screen — the retry appends to it.
            if not _has_visible_prose(content_buf) and empty_rounds < MAX_EMPTY_REPLY_ROUNDS:
                empty_rounds += 1
                if content_buf:
                    msgs.append({"role": "assistant", "content": content_buf})
                msgs.append({"role": "user", "content": EMPTY_REPLY_NUDGE})
                continue
            if usage:
                yield ("usage", usage)
            print(f"[timing chat] total {time.monotonic() - t0:.2f}s "
                  f"(rounds={rounds}, tokens={usage.get('total') if usage else '?'})")
            return
        # Unreachable: the tool rounds end tool-free and the empty-reply budget is
        # smaller than the extra rounds it was given, so the final iteration can
        # only fall through to the return above. A guard, not an apology — an
        # empty turn reaching the operator is a bug, not a message.
        raise RuntimeError("chat stream exhausted its rounds without returning")

    chat.stream = stream
    return chat

def build_nim_facts(settings, secrets):
    """The fact extractor behind the operator memory.

    A separate, deliberately small call rather than a tool on the chat agent:
    a tool the agent may call is a tool it forgets to call, and this prompt has
    to be blunt in a way the conversational one cannot. Returns [] on any
    failure — learning nothing from a turn is a normal outcome (most turns hold
    no durable fact), so it must never surface as a chat error.
    """
    async def extract(user_text: str, reply: str) -> list[dict]:
        current_secrets = config.load_secrets()
        if not current_secrets.nvidia_api_key:
            return []
        s = config.load_settings()
        client = _client(s.nvidia_base_url, current_secrets.nvidia_api_key, 20)
        try:
            resp = await client.chat.completions.create(
                model=s.chat_model or s.model,
                messages=[{"role": "system", "content": brain.FACT_SYSTEM},
                          {"role": "user",
                           "content": brain.conversation_snippet(user_text, reply)}],
                temperature=0, max_tokens=300)
        except Exception as e:
            print(f"Fact extraction failed: {_console_safe(e)}")
            return []
        return brain.parse_facts(resp.choices[0].message.content or "")
    return extract

def real_mcp_session_factory(srv):
    return RealMcpSession(srv)


def readme_url(pkg: str) -> str:
    # The registry wants the scope separator escaped; an unescaped "@scope/name"
    # resolves to a different path and 404s.
    return f"https://registry.npmjs.org/{pkg.replace('/', '%2f')}"


async def fetch_readme(pkg: str) -> str:
    """The package's README, or "" when it cannot be had.

    Never raises: a missing README means the model gets less context, not that
    the integration fails.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
            r = await c.get(readme_url(pkg))
            r.raise_for_status()
            return (r.json().get("readme") or "")[:12000]
    except Exception:
        return ""


PROPOSE_SYSTEM = (
    "You configure MCP servers. Given a package README and the errors from "
    "previous attempts, answer ONLY with JSON: "
    '{"command": str, "args": [str], "env": {str: str}}. '
    "Use an empty string for an env value the README says is required but "
    "whose value only the operator can know. No prose, no code fence."
)


def build_propose_mcp_config():
    """The one LLM step in the integration ladder.

    Returns None on any failure — no key, a refusal, unparseable JSON — which
    the ladder reads as "no proposal", stopping the run cleanly instead of
    retrying a guess it does not have.
    """
    async def propose(readme: str, errors: list[str]):
        secrets = config.load_secrets()
        if not secrets.nvidia_api_key:
            return None
        s = config.load_settings()
        client = _client(s.nvidia_base_url, secrets.nvidia_api_key, 30)
        try:
            resp = await client.chat.completions.create(
                model=s.chat_model or s.model,
                messages=[{"role": "system", "content": PROPOSE_SYSTEM},
                          {"role": "user",
                           "content": f"README:\n{readme}\n\nERRORS:\n"
                                      + "\n".join(errors[-5:])}],
                temperature=0, max_tokens=400)
            raw = (resp.choices[0].message.content or "").strip()
            raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```")
            out = json.loads(raw)
        except Exception as e:
            print(f"MCP config proposal failed: {_console_safe(e)}")
            return None
        if not isinstance(out, dict) or "command" not in out:
            return None
        return out
    return propose

def _build_bridge(settings, store, orchestrator, sender, ask_confirm,
                  send_file=None):
    """Construct the Bridge with its real collaborators.

    Extracted from run() so the wiring is testable: Bridge treats a missing
    git_dirty as "skip the dirty-tree check", so a dropped injection would
    disable the gate with every test still green.
    """
    return Bridge(settings, store, orchestrator, sender,
                  ask_confirm=ask_confirm, git_dirty=git_dirty,
                  send_file=send_file)

_TELEGRAM_CLIP_AT = 3800  # headroom under Telegram's hard 4096-char limit
_TRUNCATION_SUFFIX = "...(truncated)"

def _clip_for_telegram(text: str, html: bool = False) -> str:
    """Keep a message under Telegram's 4096-char limit.

    An oversized message (e.g. a full Gradle stacktrace in a step report)
    makes send_message() raise; that error then reaches crash_reporter, which
    tries to send it — long again — and the failure loops. Clipping at the
    sender chokepoint breaks the loop for every caller at once.

    With html=True the cut must also leave valid markup: a message ending
    mid-`<pre>` or mid-`&amp;` is rejected outright by Telegram's parser, so
    the whole summary would be lost rather than merely shortened.
    """
    if len(text) <= _TELEGRAM_CLIP_AT:
        return text
    cut = text[:_TELEGRAM_CLIP_AT]
    if not html:
        return cut + _TRUNCATION_SUFFIX
    # Drop a half-written entity (`&amp;` is 5 chars, `&quot;` 6 — never look
    # back further than the longest one we emit).
    amp = cut.rfind("&")
    if amp != -1 and ";" not in cut[amp:]:
        cut = cut[:amp]
    if cut.count("<pre>") > cut.count("</pre>"):
        cut = cut[:cut.rfind("<")] if cut.rstrip().endswith("<") else cut
        return cut + _TRUNCATION_SUFFIX + "</pre>"
    return cut + _TRUNCATION_SUFFIX


#: chat_id the web UI passes for a task it queued itself — it reads progress
#: from the store, so there is no Telegram chat to notify. Telegram rejects it
#: with BadRequest("Chat not found"), which killed every web-queued task before
#: its first log line. 0 is safe as the sentinel: a real chat id is never 0, and
#: a group is a large *negative* id that must keep sending normally.
NO_CHAT = 0

def has_chat(chat_id) -> bool:
    return chat_id != NO_CHAT

def _make_sender(bot):
    """Outbound text chokepoint: clip, then send.

    html=True switches Telegram's HTML parser on for that one message — used
    by the change-summary table's <pre> block. It stays opt-in per call
    because every other message is raw text that may contain `<` or `&`, and
    parsing those as markup would corrupt or reject them.

    A plain message is stripped of Markdown on the way out. With no parse_mode
    there is nothing to consume an engine's `**bold**` or `> quote`, so the
    markers would land on the operator's screen as punctuation. html=True is
    exempt: that markup is Hermes' own and is meant to be parsed.
    """
    async def sender(chat_id, text, html: bool = False):
        if not has_chat(chat_id):
            return
        kw = {"parse_mode": "HTML"} if html else {}
        body = text if html else tg_format.strip_markdown(text)
        await _telegram_send_with_retry(lambda: bot.send_message(
            chat_id=chat_id, text=_clip_for_telegram(body, html=html), **kw))
    return sender

def _console_safe(e: object) -> str:
    """Render an exception (or anything) so print() can never itself raise.

    An *attached* Windows console is UTF-8 regardless of codepage (PEP 528),
    so the documented deploy/start.bat launch path cannot raise here. The
    hazard is a *redirected* stdout — `start.bat > log.txt`, a service, a
    scheduler — which gets the locale's legacy codec (cp1252 here, cp932 on a
    Japanese host, ...). If str(e) contains a character outside that codec —
    plausible in Telegram/httpx error text — printing it raises
    UnicodeEncodeError *from the except block doing the reporting*, escaping
    that handler entirely (the f3499e0 / 193e532 bug class). Coercing to
    ASCII with backslashreplace survives every legacy codec, and loses
    nothing a narrower codec would have kept: non-ASCII detail is escaped
    either way.
    """
    return str(e).encode("ascii", errors="backslashreplace").decode("ascii")

async def _telegram_send_with_retry(send, sleep=asyncio.sleep):
    """Run an outbound Telegram call, retrying transient network failures.

    A single TimedOut/NetworkError on a status message must not abort the whole
    task: handle_task's first act is a "queued" send, and an uncaught TimedOut
    there escaped to crash_reporter as "Internal error - task crashed: Timed
    out" -- killing a task the engine never even started. Retrying absorbs the
    blip; exhausting the delays lets the final attempt re-raise, so a real
    Telegram outage still surfaces instead of being swallowed.

    Retry only genuinely transient failures. TimedOut is a NetworkError
    subclass (caught), but so is BadRequest -- "chat not found", an oversized
    message -- which is a permanent rejection: retrying it just burns the
    backoff and buries the real cause, so re-raise it at once. Forbidden (bot
    blocked) is not a NetworkError, so it already propagates untouched.
    """
    from telegram.error import BadRequest, NetworkError
    for delay in _SEND_RETRY_DELAYS_S:
        try:
            return await send()
        except NetworkError as e:
            if isinstance(e, BadRequest):
                raise
            print(f"Telegram send failed ({_console_safe(e)}); retrying in {delay}s")
            await sleep(delay)
    return await send()

def _make_crash_reporter(sender):
    """Build the done-callback for fire-and-forget tasks.

    Without it, a crash outside run_task's try/except is silently dropped.
    Module-level (rather than nested in run()) so it is directly testable.
    """
    def crash_reporter(chat_id):
        def _cb(t: asyncio.Task):
            if t.cancelled():
                return
            exc = t.exception()
            if exc:
                # _console_safe, because repr() does NOT escape non-ASCII: a
                # bare {exc!r} raises UnicodeEncodeError on a redirected
                # legacy-codepage stdout. That raise happens inside a done-callback,
                # so asyncio swallows it into the loop's exception handler and
                # the sender() below never runs -- losing the crash report
                # this callback exists to deliver.
                print(f"Background task crashed: {_console_safe(repr(exc))}")
                asyncio.create_task(sender(
                    chat_id, f"Internal error — task crashed: {exc}"))
        return _cb
    return crash_reporter

async def _notify_restart(swept: list[dict], sender) -> int:
    """Tell each affected chat once that its tasks did not survive the restart.

    Returns the number of chats successfully notified. Each send is guarded on
    its own: a chat that blocked the bot must not silence the others, and must
    not take startup down with it.
    """
    sent = 0
    for chat_id, msg in group_digests(swept):
        try:
            await sender(chat_id, msg)
            sent += 1
        except Exception as e:
            print(f"Could not notify chat {chat_id} of restart: {_console_safe(e)}")
    return sent

def sweep_orphan_files(store) -> tuple[list[str], list[str]]:
    """Delete on-disk leftovers no live row owns any more.

    Two sources, both real: conversations deleted before anything cleaned up
    after them (every artifact directory ever created is still on disk), and
    uploads whose request died between writing the file and recording it.

    The keep-set is the union of session rows and conversations that still hold
    messages — the second is load-bearing, since the default "web" conversation
    has messages but no session row and would otherwise be swept every start.
    Never raises: a failed sweep is untidy, not a reason to refuse to boot.
    """
    try:
        keep = store.conversation_ids() | {s["session_id"] for s in store.list_sessions()}
        live_tasks = {t["task_id"] for t in store.list_tasks(limit=100000)}
        uploads = cleanup.purge_orphans(paths.uploads_dir(), keep)
        artifacts = cleanup.purge_orphans(paths.artifacts_dir(), live_tasks)
        retention = config.load_settings().image_retention_days
        if retention > 0:
            img_res = cleanup.cleanup_old_images(
                [paths.artifacts_dir() / "generated", paths.uploads_dir(), paths.artifacts_dir()],
                retention
            )
            if img_res["deleted_count"] > 0:
                print(f"Startup image cleanup: deleted {img_res['deleted_count']} old image file(s) (> {retention} days), freed {img_res['freed_bytes']} bytes.")
    except Exception as e:
        print(f"Could not sweep orphan files: {_console_safe(e)}")
        return ([], [])
    if uploads or artifacts:
        print(f"Startup cleanup: removed {len(uploads)} orphan upload folder(s) "
              f"and {len(artifacts)} orphan artifact folder(s).")
    return (uploads, artifacts)

async def run():
    settings = config.load_settings()
    secrets = config.load_secrets()
    paths.ensure_dirs()
    # Seed a valid .obsidian config so the default `obsidian` MCP server starts
    # against a fresh install's empty vault instead of refusing it.
    paths.ensure_vault()
    # Put the vault under git and snapshot whatever the last session left, so the
    # agent's knowledge has a history and a backup. Best-effort: no git, no harm.
    from . import vault_git
    vault_git.ensure_repo(paths.vault_dir())
    vault_git.autocommit(paths.vault_dir(), "vault: session start")
    # Off-machine backup, opt-in: pushes only when the operator has added a
    # remote to the vault. No remote -> no-op. Once per boot, so a session's own
    # task commits sync on the next start rather than paying network per task.
    vault_git.push(paths.vault_dir())
    store = Store(paths.db_path()); store.init_schema()
    # Unconditional, and before the bot: anything still marked live is a lie
    # left by the last exit, and the dashboard must be honest even when no
    # token is configured. Notifying is a bonus, not a precondition.
    swept = store.sweep_interrupted()
    if swept:
        print(f"Startup recovery: retired {len(swept)} interrupted task(s).")
    sweep_orphan_files(store)

    hub = McpHub(settings.mcp_servers, session_factory=real_mcp_session_factory)
    await hub.connect()
    planner = build_nim_planner(settings, secrets, hub)
    chat = build_nim_chat(settings, secrets)
    facts = build_nim_facts(settings, secrets)

    # The engine's channel to the operator. Built before the bot so the
    # orchestrator can carry it into every code step; its on_ask/on_close are
    # bound to Telegram inside the bot block below. Unbound (no bot) is a
    # degradation the tool reports as NO_CHANNEL, never an error. Logging asks
    # and answers to the task is best-effort — losing a log must never lose an
    # answer, so append_log is passed as the optional sink.
    ask_registry = AskRegistry(log=store.append_log)
    ask_mcp = ask_server.build_ask_server(ask_registry)
    ask_url = (f"http://127.0.0.1:8799"
               f"{ask_server.MOUNT_PREFIX}{ask_server.STREAM_PATH}")

    adb = Adb(settings)
    deps = dict(
        run_engine=engine_runner.run_engine,
        build_apk=build_runner.build_apk,
        detect=project_detect.detect,
        detect_app_id=project_detect.detect_app_id,
        test_unit=lambda proj: test_runner.test_unit(proj, settings.timeout_test_s),
        test_emulator=lambda apk, out, pkg: test_runner.test_emulator(
            apk, settings.emulator_avd, out, settings.timeout_test_s, adb=adb, pkg=pkg),
        test_browser=lambda url, out: test_runner.test_browser(
            url, out, settings.timeout_test_s),
        ask_registry=ask_registry,
        ask_url=ask_url,
    )

    orch = Orchestrator(settings, store, planner, deps)

    bot_token = secrets.telegram_bot_token
    app = None
    bridge = None
    if bot_token and bot_token.strip():
        try:
            app = (Application.builder().token(bot_token)
                   .connect_timeout(BOT_HTTP_TIMEOUT_S)
                   .read_timeout(BOT_HTTP_TIMEOUT_S)
                   .write_timeout(BOT_HTTP_TIMEOUT_S)
                   .pool_timeout(BOT_HTTP_TIMEOUT_S)
                   .build())

            sender = _make_sender(app.bot)

            async def send_file(chat_id, kind, path):
                if not has_chat(chat_id):
                    return
                # Screenshots land inline as photos; anything else (apk,
                # logs) as a document. Callers guard failures — Telegram's
                # 50 MB bot upload cap can reject a big APK. The file is
                # (re)opened inside the retried coroutine, not before it: a
                # retry after a partial upload must start from a fresh handle,
                # never a spent one parked at EOF.
                async def _do():
                    with open(path, "rb") as f:
                        if kind == "screenshot":
                            return await app.bot.send_photo(chat_id=chat_id, photo=f)
                        return await app.bot.send_document(
                            chat_id=chat_id, document=f,
                            filename=Path(path).name)
                await _telegram_send_with_retry(_do)

            crash_reporter = _make_crash_reporter(sender)

            async def ask_confirm(chat_id, task_id, reasons):
                # No Telegram chat: handle_task has already parked the task at
                # awaiting_confirm, and the web UI draws its own Run/Cancel from
                # that status via /api/tasks/{id}/confirm. Staying silent here
                # leaves the task confirmable instead of crashing it.
                if not has_chat(chat_id):
                    return
                kb = InlineKeyboardMarkup([[
                    InlineKeyboardButton("✅ Run", callback_data=f"confirm:{task_id}:yes"),
                    InlineKeyboardButton("❌ Cancel", callback_data=f"confirm:{task_id}:no"),
                ]])
                # Clipped like every other outgoing message: reasons are short
                # today, but an unclipped send raises, and this one carries the
                # only buttons that can approve or cancel the task.
                await _telegram_send_with_retry(lambda: app.bot.send_message(
                    chat_id=chat_id,
                    text=_clip_for_telegram(
                        f"Task {task_id} needs confirmation before running:\n- "
                        + "\n- ".join(reasons)),
                    reply_markup=kb))

            bridge = _build_bridge(settings, store, orch, sender, ask_confirm,
                                   send_file=send_file)

            # Bind the ask registry to Telegram: how a question is drawn, how a
            # closed one strips its dead keyboard, and how a multi-select redraw
            # edits in place.
            async def _edit_ask_markup(chat_id, message_id, markup):
                if not has_chat(chat_id):
                    return
                await app.bot.edit_message_reply_markup(
                    chat_id=chat_id, message_id=message_id, reply_markup=markup)

            async def _send_ask(a):
                # A web-queued task's question is answered through the web ask
                # endpoints; only the Telegram drawing is skipped, so the ask
                # stays open and answerable rather than dying on send.
                if not has_chat(a.chat_id):
                    return
                markup = ask_ui.to_markup(ask_ui.keyboard_rows(a))
                msg = await _telegram_send_with_retry(lambda: app.bot.send_message(
                    chat_id=a.chat_id,
                    text=_clip_for_telegram(ask_ui.question_text(a)),
                    reply_markup=markup))
                a.message_id = getattr(msg, "message_id", None)

            async def _close_ask(a, state):
                # Best-effort: strip the keyboard so the operator cannot tap a
                # button that will no longer resolve anything. A failure here
                # must not change what the engine was already told.
                if a.message_id is None:
                    return
                try:
                    await app.bot.edit_message_reply_markup(
                        chat_id=a.chat_id, message_id=a.message_id, reply_markup=None)
                except Exception:
                    pass

            ask_registry.on_ask = _send_ask
            ask_registry.on_close = _close_ask
            on_ask_callback, on_ask_text = ask_ui.make_handlers(
                ask_registry, sender, _edit_ask_markup)

            async def check_auth_and_respond(update: Update) -> bool:
                u = update.effective_user.id
                c = update.effective_chat.id
                from .telegram_bridge import is_allowed
                settings = bridge.get_settings()
                if not is_allowed(u, settings):
                    await sender(c, f"You are not authorized to use this bot. Your Telegram User ID is: {u}\n\nPlease add this ID to the allowed user list in the settings UI at http://127.0.0.1:8799")
                    return False
                return True

            async def on_task(update: Update, ctx):
                if not await check_auth_and_respond(update):
                    return
                c = update.effective_chat.id
                text = update.message.text or ""
                prompt = text[5:].strip() if text.lower().startswith("/task") else ""
                if not prompt:
                    await sender(c, "Harap sertakan deskripsi tugas. Contoh: /task buat app counter Flutter")
                    return
                t = asyncio.create_task(bridge.handle_task(update.effective_user.id, c, prompt))
                t.add_done_callback(crash_reporter(c))

            async def on_confirm(update: Update, ctx):
                q = update.callback_query
                await q.answer()
                parts = (q.data or "").split(":", 2)
                if len(parts) != 3:
                    return
                _, task_id, ans = parts
                from .telegram_bridge import is_allowed
                if not is_allowed(q.from_user.id, bridge.get_settings()):
                    return
                c = q.message.chat_id
                t = asyncio.create_task(
                    bridge.resolve_confirm(q.from_user.id, task_id, ans == "yes"))
                t.add_done_callback(crash_reporter(c))

            async def on_ask(update: Update, ctx):
                q = update.callback_query
                parsed = ask_ui.parse_callback(q.data)
                if parsed is None:
                    await q.answer()
                    return
                from .telegram_bridge import is_allowed
                if not is_allowed(q.from_user.id, bridge.get_settings()):
                    await q.answer()
                    return
                ask_id, kind, idx = parsed
                # message_id lets a multi-select tap redraw its own keyboard.
                toast = await on_ask_callback(ask_id, kind, idx,
                                              q.message.message_id)
                await q.answer(toast or None)

            async def on_help(update: Update, ctx):
                if not await check_auth_and_respond(update):
                    return
                from .telegram_bridge import help_text
                await sender(update.effective_chat.id, help_text())

            async def on_projects(update: Update, ctx):
                if not await check_auth_and_respond(update):
                    return
                from .telegram_bridge import projects_overview
                await sender(update.effective_chat.id,
                             projects_overview(bridge.get_settings()))

            from . import pending_ui

            async def _push_pending(chat_id: int, pending: list[dict]):
                """Send an approve/decline card for each write action this
                turn just parked. `pending` items come straight off
                ChatEngine.run_turn's return value."""
                for item in pending:
                    pa = engine.pending.get(item["id"])
                    if pa is None:      # resolved by the time we get here
                        continue
                    await _telegram_send_with_retry(lambda pa=pa: app.bot.send_message(
                        chat_id=chat_id,
                        text=_clip_for_telegram(pending_ui.pending_text(pa)),
                        reply_markup=pending_ui.keyboard(pa)))

            async def _run_chat_turn(user_id: int, chat_id: int, text: str,
                                     images=None):
                session_id = f"tg-{chat_id}"
                store.ensure_session(session_id, f"Telegram {chat_id}")
                try:
                    out = await engine.run_turn(
                        session_id, text, images=images, chat=chat,
                        chat_id=chat_id, user_id=user_id)
                except Exception as e:
                    await sender(chat_id, f"(Maaf, chat gagal: {_console_safe(e)})")
                    return
                await sender(chat_id, out["reply"])
                await _push_pending(chat_id, out["pending"])

            async def on_start(update: Update, ctx):
                if not await check_auth_and_respond(update):
                    return
                from .telegram_bridge import help_text
                current_settings = bridge.get_settings()
                agent_name = current_settings.agent_name or "Lail Agent"
                await sender(update.effective_chat.id,
                             f"Halo! Saya {agent_name}, asisten orkestrasi Anda.\n\n"
                             + help_text())

            async def on_chat(update: Update, ctx):
                if not await check_auth_and_respond(update):
                    return
                c = update.effective_chat.id
                u = update.effective_user.id
                text = update.message.text or ""
                # A free-text reply to an open question is the answer, not chat:
                # consume it before falling through to the conversational agent.
                if await on_ask_text(c, text):
                    return
                t = asyncio.create_task(_run_chat_turn(u, c, text))
                t.add_done_callback(crash_reporter(c))

            async def on_pending(update: Update, ctx):
                q = update.callback_query
                parsed = pending_ui.parse_callback(q.data)
                if parsed is None:
                    await q.answer()
                    return
                from .telegram_bridge import is_allowed
                if not is_allowed(q.from_user.id, bridge.get_settings()):
                    await q.answer()
                    return
                pid, approved = parsed
                pa = engine.pending.get(pid)
                if pa is None:
                    await q.answer("Aksi sudah diproses atau kedaluwarsa.")
                    return
                await q.answer("Diproses...")
                try:
                    await app.bot.edit_message_reply_markup(
                        chat_id=q.message.chat_id,
                        message_id=q.message.message_id,
                        reply_markup=None)
                except Exception:
                    pass
                c = q.message.chat_id
                u = q.from_user.id

                async def _do_resolve():
                    out = await engine.resolve_pending(pa, approved)
                    if not out.get("resume"):
                        return
                    res = await engine.run_resume_turn(
                        pa.conv_id, chat=chat, chat_id=c, user_id=u)
                    await sender(c, res["reply"])
                    await _push_pending(c, res["pending"])

                t = asyncio.create_task(_do_resolve())
                t.add_done_callback(crash_reporter(c))

            async def on_photo(update: Update, ctx):
                if not await check_auth_and_respond(update):
                    return
                c = update.effective_chat.id
                u = update.effective_user.id
                msg = update.message
                if not msg:
                    return
                tg_file = None
                if msg.photo:
                    tg_file = await msg.photo[-1].get_file()
                elif msg.document:
                    tg_file = await msg.document.get_file()
                if not tg_file:
                    return
                data = await tg_file.download_as_bytearray()
                session_id = f"tg-{c}"
                try:
                    name, _ = uploads.save(paths.uploads_dir(), session_id, bytes(data))
                except Exception as e:
                    await sender(c, f"Gagal menyimpan gambar: {_console_safe(e)}")
                    return
                img_path = uploads.resolve(paths.uploads_dir(), session_id, name)
                images = [img_path] if img_path else []
                text = msg.caption or ""
                t = asyncio.create_task(_run_chat_turn(u, c, text, images=images))
                t.add_done_callback(crash_reporter(c))

            async def on_voice(update: Update, ctx):
                if not await check_auth_and_respond(update):
                    return
                c = update.effective_chat.id
                u = update.effective_user.id
                msg = update.message
                if not msg:
                    return
                current_settings = bridge.get_settings()
                if not current_settings.stt_enabled:
                    await sender(c, "Fitur suara (STT) tidak diaktifkan dalam setelan.")
                    return
                from . import stt
                if not stt.available():
                    await sender(c, "STT tidak tersedia: library `faster-whisper` belum terpasang.")
                    return
                tg_file = None
                if msg.voice:
                    tg_file = await msg.voice.get_file()
                elif msg.audio:
                    tg_file = await msg.audio.get_file()
                if not tg_file:
                    return
                data = await tg_file.download_as_bytearray()
                try:
                    text = await asyncio.to_thread(
                        stt.transcribe, bytes(data),
                        language=current_settings.stt_language,
                        model_size=current_settings.stt_model,
                        hotwords=stt.build_hotwords(
                            [current_settings.agent_name,
                             *current_settings.projects.keys()]))
                except Exception as e:
                    await sender(c, f"Gagal mentranskripsi suara: {_console_safe(e)}")
                    return
                text = text.strip()
                if not text:
                    await sender(c, "(tidak ada ucapan yang terdeteksi)")
                    return
                if await on_ask_text(c, text):
                    return
                await sender(c, f"\U0001f399\ufe0f \"{text}\"")
                t = asyncio.create_task(_run_chat_turn(u, c, text))
                t.add_done_callback(crash_reporter(c))

            app.add_handler(CommandHandler("task", on_task))
            app.add_handler(CallbackQueryHandler(on_confirm, pattern=r"^confirm:"))
            app.add_handler(CallbackQueryHandler(on_ask, pattern=r"^ask:"))
            app.add_handler(CallbackQueryHandler(on_pending, pattern=r"^pend:"))
            app.add_handler(CommandHandler("start", on_start))
            app.add_handler(CommandHandler("help", on_help))
            app.add_handler(CommandHandler("projects", on_projects))
            app.add_handler(MessageHandler(filters.PHOTO | filters.Document.IMAGE, on_photo))
            app.add_handler(MessageHandler(filters.VOICE | filters.AUDIO, on_voice))
            app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_chat))



            print("Telegram bot initialized successfully.")
        except Exception as e:
            # _console_safe: a bare {e} could raise UnicodeEncodeError on a
            # redirected stdout and escape run() entirely -> start.bat crash loop.
            print(f"Error initializing Telegram bot: {_console_safe(e)}. Bot features will be disabled.")
            app = None
    else:
        print("WARNING: TELEGRAM_BOT_TOKEN is not configured. Telegram bot features will be disabled.")

    if not bridge:
        async def dummy_sender(chat_id, text, html=False):
            print(f"[Web UI Chat] {text}")
        async def dummy_ask_confirm(chat_id, task_id, reasons):
            print(f"[Web UI Confirm Required] Task {task_id}: {reasons}")
        bridge = _build_bridge(settings, store, orch, dummy_sender, dummy_ask_confirm)

        async def dummy_on_ask(a):
            print(f"[Web UI Ask Required] {a.question}")
        async def dummy_on_close(a, state):
            print(f"[Web UI Ask Closed] {a.question} -> {state}")
        ask_registry.on_ask = dummy_on_ask
        ask_registry.on_close = dummy_on_close

    engine = ChatEngine(store, bridge=bridge, hub=hub, facts=facts)

    # The one self-initiated thread in the process: a daily brief, a folder
    # watcher, and transient auto-retry, all off unless enabled in Settings. It
    # pushes through the same Bridge as a human task, so its work still passes
    # the risk gate. Fire-and-forget with a crash reporter — its own loop
    # already swallows per-tick errors, so this only catches a fault in the loop
    # scaffolding itself.
    from . import ics, proactive
    proactive_task = asyncio.create_task(
        proactive.run_loop(store=store, bridge=bridge, ics_upcoming=ics.upcoming))
    proactive_task.add_done_callback(
        lambda t: t.exception() and print(
            f"[proactive] loop exited: {_console_safe(t.exception())}")
        if not t.cancelled() else None)

    # streamable_http_app() creates the session manager; the parent lifespan
    # runs it, because Starlette ignores a mounted sub-app's own lifespan.
    ask_asgi = ask_mcp.streamable_http_app()
    web = create_app(store, bridge=bridge, ask_registry=ask_registry, chat=chat, hub=hub, facts=facts, engine=engine, lifespan=lambda _app: ask_mcp.session_manager.run())

    web.mount(ask_server.MOUNT_PREFIX, ask_asgi)
    web.state.mcp_factory = real_mcp_session_factory
    web.state.propose_mcp_config = build_propose_mcp_config()
    web.state.read_readme = fetch_readme
    web.state.port = 8799
    server = uvicorn.Server(uvicorn.Config(web, host="127.0.0.1", port=8799, log_level="info"))

    if app:
        try:
            async with app:
                await app.start()
                # Publish the command menu so "/" in Telegram autocompletes.
                # Best-effort: a failure here must not take the bot down.
                try:
                    from telegram import BotCommand
                    await app.bot.set_my_commands([
                        BotCommand("task", "Buat tugas: /task [@nama] <deskripsi>"),
                        BotCommand("projects", "Daftar project terdaftar"),
                        BotCommand("help", "Panduan perintah"),
                    ])
                except Exception as e:
                    print(f"Could not publish the command menu: {_console_safe(e)}")
                # Before polling, so the restart notice lands ahead of any
                # newly submitted task's output.
                await _notify_restart(swept, sender)
                await app.updater.start_polling()
                await server.serve()
                await app.updater.stop()
        except Exception as e:
            # _console_safe: a bare {e} could raise UnicodeEncodeError on a
            # redirected stdout and skip the fallback server.serve() below.
            print(f"Error starting Telegram polling: {_console_safe(e)}. Bot features will be disabled.")
            await server.serve()
    else:
        await server.serve()

if __name__ == "__main__":
    asyncio.run(run())
