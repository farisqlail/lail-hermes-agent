from __future__ import annotations
import asyncio, json, re, subprocess, time
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from pathlib import Path
from pydantic import BaseModel, ValidationError, field_validator
from . import config, paths
from .session_store import Store
from .telegram_bridge import new_task_id

class TaskSubmit(BaseModel):
    text: str

class TaskConfirm(BaseModel):
    approved: bool

class TaskAnswer(BaseModel):
    ask_id: str
    text: str | None = None
    options: list[int] | None = None

# The web operator holds one continuous conversation. Localhost, single user,
# so a fixed id is enough; a per-browser session id is only needed once the
# dashboard is multi-user.
CONV_WEB = "web"
CHAT_HISTORY_LIMIT = 20   # turns fed back to the model — caps prompt cost

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
        "name": "start_task",
        "description": ("Antre task orkestrasi baru. Task TIDAK berjalan sampai operator "
                        "menekan Run — kamu hanya mengusulkan. Sertakan @nama-proyek bila relevan."),
        "parameters": {"type": "object", "properties": {
            "description": {"type": "string",
                            "description": "instruksi task, mis. '@myprofit jalankan pengujian'"}},
            "required": ["description"]}}},
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

def load_spa_html() -> str:
    path = Path(__file__).parent / "spa.html"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return "<h1>Hermes: spa.html not found!</h1>"

def create_app(store: Store, bridge=None, ask_registry=None, chat=None, lifespan=None) -> FastAPI:
    # lifespan carries the ask MCP server's session manager when main.py mounts
    # it here: a mounted sub-app's own lifespan is ignored by Starlette, so the
    # manager has to be started by the parent or the /ask-mcp endpoint is dead.
    app = FastAPI(lifespan=lifespan)
    app.state.bridge = bridge
    app.state.ask_registry = ask_registry
    # async (history, tools=, dispatch=) -> str; None when no NIM chat is wired
    # (the conversational branch then falls back to a canned reply).
    app.state.chat = chat

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
            if name == "start_task":
                bridge = getattr(app.state, "bridge", None)
                if not bridge:
                    return json.dumps({"error": "bridge tidak tersedia — tidak bisa antre task"},
                                      ensure_ascii=False)
                desc = str(args.get("description") or "").strip()
                if not desc:
                    return json.dumps({"error": "deskripsi task kosong"}, ensure_ascii=False)
                new_id = new_task_id()
                t = asyncio.create_task(bridge.handle_task(
                    user_id=0, chat_id=0, text=desc, task_id=new_id,
                    trusted=True, force_confirm=True))
                t.add_done_callback(_bg_crash_cb(store, new_id))
                return json.dumps(
                    {"task_id": new_id, "status": "awaiting_confirm",
                     "note": "Task diantre; menunggu operator menekan Run sebelum berjalan."},
                    ensure_ascii=False)
            return json.dumps({"error": f"tool tak dikenal: {name}"}, ensure_ascii=False)
        except Exception as e:  # a tool failure is data for the model, not a 500
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            return json.dumps({"error": f"tool gagal: {safe}"}, ensure_ascii=False)

    @app.get("/", response_class=HTMLResponse)
    def dashboard():
        return HTMLResponse(content=load_spa_html())

    @app.get("/settings", response_class=HTMLResponse)
    def settings_page():
        return HTMLResponse(content=load_spa_html())

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
        media_type = "image/png" if resolved.suffix.lower() in (".png", ".jpg", ".jpeg") else "application/octet-stream"
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

        # chat_id sentinels below: /task -> 0 (a real queued task, listed);
        # every other branch is a synchronous stub answered inline and stored
        # with chat_id=-1 so it stays out of the task list. See /api/tasks.
        # Only /task needs the bridge (it queues real work); /help, /projects
        # and conversation answer inline, so they must still work bridge-less.
        if text.lower().startswith("/task"):
            if not bridge:
                raise HTTPException(status_code=503, detail="Bridge not configured")
            prompt = text[5:].strip()
            t = asyncio.create_task(bridge.handle_task(user_id=0, chat_id=0, text=prompt, task_id=task_id, trusted=True))
            t.add_done_callback(_bg_crash_cb(store, task_id))
            return {"task_id": task_id, "status": "queued"}
        elif text.lower().startswith("/help"):
            from .telegram_bridge import help_text
            answer = help_text()
            store.create_task(task_id, -1, text)
            store.set_task_status(task_id, "done")
            store.append_log(task_id, "ask: Bantuan Penggunaan")
            store.append_log(task_id, f"answer: {answer}")
            # Record in the thread too: /help and /projects are conversational
            # Q&A, so they belong in the chat log the pane renders, unlike /task
            # which is real work tracked in the task list.
            store.add_message(CONV_WEB, "user", text)
            store.add_message(CONV_WEB, "assistant", answer)
            return {"task_id": task_id, "status": "done"}
        elif text.lower().startswith("/projects"):
            from .telegram_bridge import projects_overview
            answer = projects_overview(config.load_settings())
            store.create_task(task_id, -1, text)
            store.set_task_status(task_id, "done")
            store.append_log(task_id, "ask: Proyek Terdaftar")
            store.append_log(task_id, f"answer: {answer}")
            store.add_message(CONV_WEB, "user", text)
            store.add_message(CONV_WEB, "assistant", answer)
            return {"task_id": task_id, "status": "done"}
        else:
            store.create_task(task_id, -1, text)
            store.append_log(task_id, "ask: Chat Conversation")
            # Record the user's turn first, so the history handed to the model
            # includes the message it is replying to.
            store.add_message(CONV_WEB, "user", text)
            chat = getattr(app.state, "chat", None)
            if chat is None:
                reply = (
                    "Halo! Saya Hermes, asisten orkestrasi Anda.\n\n"
                    "Untuk menjalankan tugas, gunakan `/task <deskripsi>` — "
                    "mis. `/task @myproject jalankan pengujian`.\n"
                    "Gunakan `/projects` untuk daftar proyek atau `/help` untuk bantuan."
                )
            else:
                try:
                    history = store.get_messages(CONV_WEB, limit=CHAT_HISTORY_LIMIT)
                    reply = await chat(history, tools=CHAT_TOOLS, dispatch=chat_dispatch)
                except Exception as e:
                    # A NIM outage or missing key must not 500 the chat pane;
                    # surface it as the assistant's turn so the thread stays
                    # coherent and the operator sees the cause.
                    safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                    reply = f"(Maaf, chat gagal: {safe})"
            store.add_message(CONV_WEB, "assistant", reply)
            store.set_task_status(task_id, "done")
            store.append_log(task_id, f"answer: {reply}")
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

    @app.get("/api/chat")
    def chat_history():
        # The whole conversational thread, oldest-first, for the chat pane to
        # render on load. Slash-command tasks live in /api/tasks, not here.
        return {"messages": store.get_messages(CONV_WEB, limit=CHAT_HISTORY_LIMIT)}

    @app.post("/api/chat/reset")
    def chat_reset():
        store.clear_messages(CONV_WEB)
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
    def post_mcp(body: list[config.McpServer]):
        s = config.load_settings()
        s.mcp_servers = body
        config.save_settings(s)
        return {"ok": True}

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

    return app
