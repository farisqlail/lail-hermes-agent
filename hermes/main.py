from __future__ import annotations
import asyncio, json, subprocess
from pathlib import Path
from openai import AsyncOpenAI
import uvicorn
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, MessageHandler, CommandHandler, filters
from . import config, paths
from .session_store import Store
from .mcp_hub import McpHub, RealMcpSession, to_openai_tools
from .orchestrator import Orchestrator
from .telegram_bridge import Bridge
from .web_ui import create_app
from . import build_runner, engine_runner, test_runner, project_detect
from . import ask_server, ask_ui
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
        return ok and "emulator-" in out

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
        "You are Hermes' planner. Read the user's task and output ONLY a JSON "
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
        "as a clear, self-contained task, in the language the user used.")
    async def planner(text: str, context: str = "") -> str:
        if not secrets.nvidia_api_key:
            raise ValueError("NVIDIA API Key is missing. Please configure it in Settings.")
        client = AsyncOpenAI(base_url=settings.nvidia_base_url, api_key=secrets.nvidia_api_key,
                             timeout=PLANNER_REQUEST_TIMEOUT_S)
        try:
            discovered = await asyncio.wait_for(hub.list_tools(), MCP_DISCOVERY_TIMEOUT_S)
        except asyncio.TimeoutError:
            print(f"MCP tool discovery timed out after {MCP_DISCOVERY_TIMEOUT_S}s; planning without tools")
            discovered = []
        oa_tools = to_openai_tools(discovered)
        # Project facts ride as their own system message: the rules above are
        # the law, this is the evidence, and the user's message stays the
        # user's words. Rules 2-4 are unobeyable without it — nothing else
        # tells the planner whether this project can produce an APK.
        msgs = [{"role": "system", "content": system}]
        if context:
            msgs.append({"role": "system", "content": context})
        msgs.append({"role": "user", "content": text})
        for _ in range(MAX_TOOL_ROUNDS):
            resp = await _completion_with_retry(
                lambda: client.chat.completions.create(
                    model=settings.model, messages=msgs,
                    temperature=settings.planner_temperature,
                    tools=oa_tools or None))
            m = resp.choices[0].message
            if m.tool_calls:
                msgs.append(m.model_dump())
                for tc in m.tool_calls:
                    result = await hub.call(tc.function.name,
                                            json.loads(tc.function.arguments or "{}"))
                    msgs.append({"role": "tool", "tool_call_id": tc.id, "content": result})
                continue
            return m.content or ""
        raise ValueError(f"planner exceeded {MAX_TOOL_ROUNDS} tool-call rounds without a final answer")
    return planner

def real_mcp_session_factory(srv):
    return RealMcpSession(srv)

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


def _make_sender(bot):
    """Outbound text chokepoint: clip, then send.

    html=True switches Telegram's HTML parser on for that one message — used
    by the change-summary table's <pre> block. It stays opt-in per call
    because every other message is raw text that may contain `<` or `&`, and
    parsing those as markup would corrupt or reject them.
    """
    async def sender(chat_id, text, html: bool = False):
        kw = {"parse_mode": "HTML"} if html else {}
        await _telegram_send_with_retry(lambda: bot.send_message(
            chat_id=chat_id, text=_clip_for_telegram(text, html=html), **kw))
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

async def run():
    settings = config.load_settings()
    secrets = config.load_secrets()
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    # Unconditional, and before the bot: anything still marked live is a lie
    # left by the last exit, and the dashboard must be honest even when no
    # token is configured. Notifying is a bonus, not a precondition.
    swept = store.sweep_interrupted()
    if swept:
        print(f"Startup recovery: retired {len(swept)} interrupted task(s).")

    hub = McpHub(settings.mcp_servers, session_factory=real_mcp_session_factory)
    await hub.connect()
    planner = build_nim_planner(settings, secrets, hub)

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
                await app.bot.edit_message_reply_markup(
                    chat_id=chat_id, message_id=message_id, reply_markup=markup)

            async def _send_ask(a):
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

            async def on_chat(update: Update, ctx):
                if not await check_auth_and_respond(update):
                    return
                c = update.effective_chat.id
                # A free-text reply to an open question is the answer, not chat:
                # consume it before falling through to the greeting.
                if await on_ask_text(c, update.message.text or ""):
                    return
                from .telegram_bridge import help_text
                await sender(c, "Halo! Saya Hermes, asisten orkestrasi Anda.\n\n"
                                + help_text())

            app.add_handler(CommandHandler("task", on_task))
            app.add_handler(CallbackQueryHandler(on_confirm, pattern=r"^confirm:"))
            app.add_handler(CallbackQueryHandler(on_ask, pattern=r"^ask:"))
            app.add_handler(CommandHandler("start", on_chat))
            app.add_handler(CommandHandler("help", on_help))
            app.add_handler(CommandHandler("projects", on_projects))
            app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_chat))
            print("Telegram bot initialized successfully.")
        except Exception as e:
            # _console_safe: a bare {e} could raise UnicodeEncodeError on a
            # redirected stdout and escape run() entirely -> start.bat crash loop.
            print(f"Error initializing Telegram bot: {_console_safe(e)}. Bot features will be disabled.")
            app = None
    else:
        print("WARNING: TELEGRAM_BOT_TOKEN is not configured. Telegram bot features will be disabled.")

    # streamable_http_app() creates the session manager; the parent lifespan
    # runs it, because Starlette ignores a mounted sub-app's own lifespan.
    ask_asgi = ask_mcp.streamable_http_app()
    web = create_app(store, lifespan=lambda _app: ask_mcp.session_manager.run())
    web.mount(ask_server.MOUNT_PREFIX, ask_asgi)
    web.state.mcp_factory = real_mcp_session_factory
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
