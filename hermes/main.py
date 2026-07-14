from __future__ import annotations
import asyncio, subprocess
from pathlib import Path
from openai import AsyncOpenAI
import uvicorn
from telegram import Update
from telegram.ext import Application, MessageHandler, CommandHandler, filters
from . import config, paths
from .session_store import Store
from .mcp_hub import McpHub, to_openai_tools
from .orchestrator import Orchestrator
from .telegram_bridge import Bridge
from .web_ui import create_app
from . import build_runner, engine_runner, test_runner, project_detect

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
    async def launch(self):
        return await self._run([self.adb, "shell", "monkey", "-p",
                                "%PKG%", "-c", "android.intent.category.LAUNCHER", "1"])
    async def screencap(self, dest):
        p = await asyncio.create_subprocess_exec(
            self.adb, "exec-out", "screencap", "-p", stdout=asyncio.subprocess.PIPE)
        out, _ = await p.communicate()
        Path(dest).write_bytes(out)
        return (p.returncode == 0, "")

def build_nim_planner(settings, secrets, hub):
    system = ("You are Hermes' planner. Output ONLY JSON: "
              '{"steps":[{"type":"code|build|test","engine":"claude|antigravity",'
              '"prompt":"...","target":"apk","mode":"browser|emulator"}]}')
    async def planner(text: str, tools: list) -> str:
        if not secrets.nvidia_api_key:
            raise ValueError("NVIDIA API Key is missing. Please configure it in Settings.")
        client = AsyncOpenAI(base_url=settings.nvidia_base_url, api_key=secrets.nvidia_api_key)
        discovered = await hub.list_tools()
        oa_tools = to_openai_tools(discovered)
        msgs = [{"role": "system", "content": system},
                {"role": "user", "content": text}]
        while True:
            resp = await client.chat.completions.create(
                model=settings.model, messages=msgs,
                tools=oa_tools or None)
            m = resp.choices[0].message
            if m.tool_calls:
                msgs.append(m.model_dump())
                for tc in m.tool_calls:
                    import json
                    result = await hub.call(tc.function.name,
                                            json.loads(tc.function.arguments or "{}"))
                    msgs.append({"role": "tool", "tool_call_id": tc.id, "content": result})
                continue
            return m.content or ""
    return planner

def real_mcp_session_factory(srv):
    raise NotImplementedError  # fill with mcp.client stdio/sse at integration time

async def run():
    settings = config.load_settings()
    secrets = config.load_secrets()
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    hub = McpHub(settings.mcp_servers, session_factory=real_mcp_session_factory)
    await hub.connect()
    planner = build_nim_planner(settings, secrets, hub)

    adb = Adb(settings)
    deps = dict(
        run_engine=engine_runner.run_engine,
        build_apk=build_runner.build_apk,
        detect=project_detect.detect,
        test_emulator=lambda apk, out: test_runner.test_emulator(
            apk, settings.emulator_avd, out, settings.timeout_test_s, adb=adb),
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

            bridge = Bridge(settings, store, orch, sender)

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
                asyncio.create_task(bridge.handle_task(update.effective_user.id, c, prompt))

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
            app.add_handler(CommandHandler("start", on_chat))
            app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_chat))
            print("Telegram bot initialized successfully.")
        except Exception as e:
            print(f"Error initializing Telegram bot: {e}. Bot features will be disabled.")
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
                await app.updater.start_polling()
                await server.serve()
                await app.updater.stop()
        except Exception as e:
            print(f"Error starting Telegram polling: {e}. Bot features will be disabled.")
            await server.serve()
    else:
        await server.serve()

if __name__ == "__main__":
    asyncio.run(run())
