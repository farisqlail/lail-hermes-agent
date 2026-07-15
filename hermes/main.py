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

def build_nim_planner(settings, secrets, hub):
    system = ("You are Hermes' planner. Output ONLY JSON: "
              '{"steps":[{"type":"code|build|test","engine":"claude|antigravity",'
              '"prompt":"...","target":"apk","mode":"browser|emulator"}]}')
    async def planner(text: str, tools: list) -> str:
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
        msgs = [{"role": "system", "content": system},
                {"role": "user", "content": text}]
        for _ in range(MAX_TOOL_ROUNDS):
            resp = await client.chat.completions.create(
                model=settings.model, messages=msgs,
                tools=oa_tools or None)
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

def _build_bridge(settings, store, orchestrator, sender, ask_confirm):
    """Construct the Bridge with its real collaborators.

    Extracted from run() so the wiring is testable: Bridge treats a missing
    git_dirty as "skip the dirty-tree check", so a dropped injection would
    disable the gate with every test still green.
    """
    return Bridge(settings, store, orchestrator, sender,
                  ask_confirm=ask_confirm, git_dirty=git_dirty)

def _console_safe(e: object) -> str:
    """Render an exception (or anything) so print() can never itself raise.

    Hermes's Windows console (see deploy/start.bat, which sets none of
    PYTHONUTF8, PYTHONIOENCODING, or chcp 65001) renders stdout as cp1252. If
    str(e) contains a character outside cp1252 -- plausible in Telegram/httpx
    error text -- printing it raises UnicodeEncodeError *from the except block
    doing the reporting*, escaping that handler entirely (the f3499e0 /
    193e532 bug class). backslashreplace guarantees an encodable string while
    still telling the operator roughly what happened.
    """
    return str(e).encode("cp1252", errors="backslashreplace").decode("cp1252")

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
    )
    orch = Orchestrator(settings, store, planner, deps)

    bot_token = secrets.telegram_bot_token
    app = None
    if bot_token and bot_token.strip():
        try:
            app = Application.builder().token(bot_token).build()

            async def sender(chat_id, text):
                await app.bot.send_message(chat_id=chat_id, text=text)

            def crash_reporter(chat_id):
                # done-callback for fire-and-forget tasks: without it, a crash
                # outside run_task's try/except is silently dropped.
                def _cb(t: asyncio.Task):
                    if t.cancelled():
                        return
                    exc = t.exception()
                    if exc:
                        print(f"Background task crashed: {exc!r}")
                        asyncio.create_task(sender(
                            chat_id, f"Internal error — task crashed: {exc}"))
                return _cb

            async def ask_confirm(chat_id, task_id, reasons):
                kb = InlineKeyboardMarkup([[
                    InlineKeyboardButton("✅ Run", callback_data=f"confirm:{task_id}:yes"),
                    InlineKeyboardButton("❌ Cancel", callback_data=f"confirm:{task_id}:no"),
                ]])
                await app.bot.send_message(
                    chat_id=chat_id,
                    text=(f"Task {task_id} needs confirmation before running:\n- "
                          + "\n- ".join(reasons)),
                    reply_markup=kb)

            bridge = _build_bridge(settings, store, orch, sender, ask_confirm)

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

            async def on_chat(update: Update, ctx):
                if not await check_auth_and_respond(update):
                    return
                c = update.effective_chat.id
                await sender(c, "Halo! Saya adalah Hermes, asisten orkestrasi Anda.\n\n"
                                "Untuk memberikan tugas coding, build APK, atau testing, silakan gunakan perintah:\n"
                                "`/task <deskripsi tugas>`\n\n"
                                "Contoh:\n"
                                "`/task buat app counter Flutter, build APK, test di emulator`")

            app.add_handler(CommandHandler("task", on_task))
            app.add_handler(CallbackQueryHandler(on_confirm, pattern=r"^confirm:"))
            app.add_handler(CommandHandler("start", on_chat))
            app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_chat))
            print("Telegram bot initialized successfully.")
        except Exception as e:
            # _console_safe: a bare {e} could raise UnicodeEncodeError on the
            # cp1252 console and escape run() entirely -> start.bat crash loop.
            print(f"Error initializing Telegram bot: {_console_safe(e)}. Bot features will be disabled.")
            app = None
    else:
        print("WARNING: TELEGRAM_BOT_TOKEN is not configured. Telegram bot features will be disabled.")

    web = create_app(store)
    web.state.mcp_factory = real_mcp_session_factory
    server = uvicorn.Server(uvicorn.Config(web, host="127.0.0.1", port=8799, log_level="info"))

    if app:
        try:
            async with app:
                await app.start()
                # Before polling, so the restart notice lands ahead of any
                # newly submitted task's output.
                await _notify_restart(swept, sender)
                await app.updater.start_polling()
                await server.serve()
                await app.updater.stop()
        except Exception as e:
            # _console_safe: a bare {e} could raise UnicodeEncodeError on the
            # cp1252 console and skip the fallback server.serve() below.
            print(f"Error starting Telegram polling: {_console_safe(e)}. Bot features will be disabled.")
            await server.serve()
    else:
        await server.serve()

if __name__ == "__main__":
    asyncio.run(run())
