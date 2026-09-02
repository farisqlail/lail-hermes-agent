from __future__ import annotations
import asyncio, json, re, subprocess, sys, time
from datetime import datetime
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel, ValidationError, field_validator
from . import brain, cleanup, config, ics, paths, postmortem, skills, stt, uploads, voice, desktop_api, mcp_hub, mcp_risk, launcher, mcp_integrate, mcp_oauth, imagegen, ytclip, office_routes
from .chat_engine import ChatEngine, wants_code_task, CHAT_TOOLS, AUTO_TASK_NOTE, IMAGE_MARKER, DOCUMENT_MARKER, CHAT_HISTORY_LIMIT, RESUME_NUDGE, START_TASK_DECISION_TIMEOUT_S
from .pending_actions import PendingStore

from .project_resolve import parse_project_ref
from .session_store import Store
from .telegram_bridge import new_task_id

class TaskSubmit(BaseModel):
    text: str
    session_id: str | None = None
    images: list[str] = []
    documents: list[str] = []
    resume: bool = False
    project: str | None = None
    engine: str | None = None
    # Reply-to-message: the quoted snippet + its role, captured client-side
    # from the bubble the operator hit "reply" on. Not a message id — the
    # target may be a message that streamed in this same session and hasn't
    # round-tripped a server id yet.
    reply_snippet: str | None = None
    reply_role: str | None = None
    # Per-turn override for the conversational LLM, picked from the live
    # catalog /api/chat-models returns for whatever endpoint Settings.
    # nvidia_base_url points at (NVIDIA NIM, DeepSeek, a local 9Router
    # gateway, or any other OpenAI-compatible "custom" target). Empty/None
    # falls back to Settings.chat_model/model as before.
    chat_model: str | None = None

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

class SkillBody(BaseModel):
    """The API shape of a skill: config.Skill's metadata plus the SKILL.md
    body that never lives in Settings.skills — see hermes/skills.py."""
    id: str
    name: str
    description: str
    enabled: bool = True
    content: str = ""

class InstallTapBody(BaseModel):
    tap: str
    skill_path: str

class InstallCatalogBody(BaseModel):
    slug: str

class SessionRename(BaseModel):
    title: str

class SessionSettings(BaseModel):
    title: str | None = None
    project: str | None = None
    engine: str | None = None
    chat_model: str | None = None

class ResolveBody(BaseModel):
    """Approve or decline one parked write action.

    Module scope is load-bearing, for the reason spelled out above: declared
    inside create_app it was invisible to FastAPI, which silently demoted it to
    a query parameter — so every confirm, by button or by voice, came back 422
    and no gated MCP action could ever be approved.
    """
    id: str | None = None
    approved: bool
    # Which conversation is confirming. Without it an id-less (voice) confirm
    # resolves the oldest action across every open session, which is another
    # session's write action.
    session_id: str | None = None


class ScheduledJobBody(BaseModel):
    job_id: str | None = None
    description: str
    interval_s: int = 0
    delay_s: int = 60
    chat_id: int = 0




# The web operator holds one continuous conversation. Localhost, single user,
# so a fixed id is enough; a per-browser session id is only needed once the
# dashboard is multi-user.
CONV_WEB = "web"


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
    ansi_re = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
    for line in res.stdout.splitlines():
        line = ansi_re.sub("", line)
        line = line.strip().lstrip("*-•·> ").strip()
        line = (
            line.replace("’", "'")
            .replace("‘", "'")
            .replace("“", '"')
            .replace("”", '"')
            .replace("–", "-")
            .replace("—", "-")
        )
        line = "".join(c for c in line if c.isascii() and c.isprintable()).strip()
        # skip blanks and header-ish lines ("Available models:", "Usage: ...")
        if not line or line.endswith(":") or line.lower().startswith("usage"):
            continue
        models.append(line)
    return models or None

_CHAT_MODELS_CACHE_TTL_S = 300   # a provider's own catalog rarely changes
_CHAT_MODELS_NEG_TTL_S = 30      # a down/misconfigured gateway shouldn't block the dropdown long
_chat_models_cache: dict = {"at": 0.0, "models": None, "base_url": None}

def list_chat_models(base_url: str, api_key: str, timeout_s: float = 8.0) -> list[str] | None:
    """Ask the OpenAI-compatible endpoint Settings.nvidia_base_url already
    points at for its live model catalog. Whatever that endpoint proxies is
    exactly what comes back — point it at a local 9Router gateway and its
    connected upstreams appear, point it at DeepSeek's own API and DeepSeek's
    models appear, same idea as list_agy_models above. None means "could not
    ask" — the caller falls back rather than caching an empty answer."""
    if not base_url or not api_key:
        return None
    try:
        import openai
        client = openai.OpenAI(base_url=base_url, api_key=api_key, timeout=timeout_s)
        ids = sorted({m.id for m in client.models.list().data if getattr(m, "id", None)})
        return ids or None
    except Exception:
        return None

class SecretsUpdate(BaseModel):
    nvidia_api_key: str | None = None
    telegram_bot_token: str | None = None
    github_app_id: str | None = None
    github_app_private_key: str | None = None
    github_app_installation_id: str | None = None

    @field_validator("github_app_id", "github_app_installation_id")
    @classmethod
    def _github_app_numeric_id_shape(cls, v):
        # "" and "***" mean keep-current, same convention as the other secrets.
        if v in ("", "***", None):
            return v
        if not v.isdigit():
            raise ValueError("must be numeric — GitHub App/installation ids are plain numbers")
        return v

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

if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    STATIC_DIR = Path(sys._MEIPASS) / "hermes" / "static"
elif getattr(sys, "frozen", False):
    STATIC_DIR = Path(sys.executable).parent / "hermes" / "static"
else:
    STATIC_DIR = Path(__file__).parent / "static"

INDEX_HTML_CACHE: str | None = None

# The HTML entry point must never be served from a browser cache. Its own body
# is what names the hashed chunk files, so a stale copy silently boots a stale
# app: the old chunk names it points at are still on disk and still load, and
# nothing errors — the UI just stays on yesterday's build after a deploy.
# The chunks themselves are content-hashed and stay cacheable.
NO_STORE = {"Cache-Control": "no-store, must-revalidate"}


def load_index_html() -> str:
    path = STATIC_DIR / "index.html"
    if path.exists():
        return path.read_text(encoding="utf-8")
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

def create_app(store: Store, bridge=None, ask_registry=None, chat=None,
               lifespan=None, hub=None, facts=None, engine=None, title_gen=None,
               compressor=None, approval_note=None, mcp_router=None, office=None) -> FastAPI:
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
    app.state.engine = engine if engine is not None else ChatEngine(
        store, bridge=bridge, hub=hub, facts=facts, compressor=compressor,
        approval_note=approval_note, mcp_router=mcp_router)
    # Write actions the chat agent proposed, awaiting operator approval (button
    # or voice). Executed only from the resolve endpoint, never in the tool loop.
    app.state.pending = app.state.engine.pending

    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR), check_dir=False), name="static")
    app.mount("/_next", StaticFiles(directory=str(STATIC_DIR / "_next"), check_dir=False), name="next_static")

    @app.get("/logo-landscape.png")
    def get_logo():
        logo_path = STATIC_DIR / "logo-landscape.png"
        if logo_path.exists():
            return FileResponse(str(logo_path), media_type="image/png")
        raise HTTPException(status_code=404, detail="Logo not found")

    # Voice output has no dependency on store/bridge/ask_registry, so it lives
    # in its own module instead of this factory's closure.
    app.include_router(voice.router)

    # Tray-helper <-> browser bridge (wake word + voice-state heartbeat). One
    # DesktopState per app, kept on app.state so tests can read it back.
    app.state.desktop = desktop_api.DesktopState()
    app.include_router(desktop_api.build_router(app.state.desktop))

    # Office mode: dynamically-created AI "employee" personas/teams. None
    # disables the surface (roster routes 503 instead of crashing at import),
    # mirroring how chat/hub/facts are nullable dependencies above.
    app.state.office = office
    app.include_router(office_routes.build_router(app.state.office))

    # async (history, tools=, dispatch=) -> str; None when no NIM chat is wired
    # (the conversational branch then falls back to a canned reply).
    app.state.chat = chat
    # async (user_text, reply) -> [{"key","value"}]; None disables learning.
    # Injected like chat so a test can wire a fake — or nothing, and the chat
    # still works, it just stops remembering.
    app.state.facts = facts
    # async (text) -> str; "" or None disables the LLM title upgrade — the
    # truncated first-message title (set synchronously below) still applies.
    app.state.title_gen = title_gen
    app.state.integrate_runs = {}
    app.state.pending_auth = mcp_oauth.PendingAuth()

    INTEGRATE_TOOLS = [
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
    ]

    async def _integrate_extra(images=None) -> dict:
        """The three integrate_* tool handlers, as ChatEngine.wrap_dispatch's
        `extra` map. `_start_integrate`/`app.state.integrate_runs` are the
        same closures the /api/mcp/integrate/* endpoints already use below —
        one registry either surface reads."""
        async def do_integrate_mcp(args):
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

        async def do_integrate_status(args):
            run = app.state.integrate_runs.get(str(args.get("run_id") or ""))
            if run is None:
                return json.dumps({"error": "run tidak ditemukan"}, ensure_ascii=False)
            return json.dumps(
                {"state": run.state, "pending_secret": run.pending_secret,
                 "login_url": run.login_url, "server": run.server,
                 "events": run.events[-12:]}, ensure_ascii=False)

        async def do_integrate_secret(args):
            run = app.state.integrate_runs.get(str(args.get("run_id") or ""))
            if run is None:
                return json.dumps({"error": "run tidak ditemukan"}, ensure_ascii=False)
            ok = run.answer_secret(str(args.get("value") or ""))
            return json.dumps({"ok": ok}, ensure_ascii=False)

        return {"integrate_mcp": do_integrate_mcp,
                "integrate_status": do_integrate_status,
                "integrate_secret": do_integrate_secret}

    async def _chat_tools(text: str | None = None) -> list[dict]:
        engine = app.state.engine
        tools = await engine.chat_tools(text)
        idx = next((i for i, t in enumerate(tools) if t["function"]["name"] == "open_app"), -1)
        if idx != -1:
            return tools[:idx + 1] + INTEGRATE_TOOLS + tools[idx + 1:]
        return tools + INTEGRATE_TOOLS

    @app.get("/api/chat/pending")
    def get_chat_pending(session_id: str | None = None):
        """Write actions awaiting approval — rendered as cards and polled by the
        voice loop so 'konfirmasi' knows whether anything is pending. Scoped to
        one conversation: a card belongs on the thread that proposed it."""
        return [{"id": a.id, "tool": a.tool, "summary": a.summary(), "args": a.args,
                "risk_note": a.risk_note}
                for a in app.state.pending.list(session_id or CONV_WEB)]

    @app.post("/api/chat/pending/resolve")
    async def resolve_chat_pending(body: ResolveBody):
        """Approve/decline a parked action. No `id` resolves the oldest action of
        THIS conversation — the shape a voice 'konfirmasi' / 'batal' uses, since
        speech carries no id. An explicit id from another conversation is refused
        rather than run: the confirm is the operator's authority over one thread."""
        pending = app.state.pending
        sid = body.session_id or CONV_WEB
        items = pending.list(sid)
        pa = pending.get(body.id) if body.id else (items[0] if items else None)
        if pa is not None and pa.conv_id != sid:
            pa = None
        if pa is None:
            return {"ok": False, "error": "tidak ada aksi tertunda"}
        out = await app.state.engine.resolve_pending(pa, body.approved)
        return {"ok": True, **out}

    @app.get("/", response_class=HTMLResponse)
    def dashboard():
        return HTMLResponse(content=load_index_html(), headers=NO_STORE)

    @app.get("/settings", response_class=HTMLResponse)
    def settings_page():
        return HTMLResponse(content=load_index_html(), headers=NO_STORE)

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
            ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
            ".mp4": "video/mp4", ".webm": "video/webm",
        }.get(resolved.suffix.lower(), "application/octet-stream")
        return FileResponse(str(resolved), media_type=media_type)

    @app.get("/api/artifacts")
    def list_artifacts(limit: int = 200):
        art_dir = paths.artifacts_dir()
        paths.ensure_dirs()
        items = []

        def format_size(size_bytes: int) -> str:
            if size_bytes < 1024:
                return f"{size_bytes} B"
            elif size_bytes < 1024 * 1024:
                return f"{size_bytes / 1024:.1f} KB"
            elif size_bytes < 1024 * 1024 * 1024:
                return f"{size_bytes / (1024 * 1024):.1f} MB"
            return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"

        def classify_type(ext: str) -> str:
            ext = ext.lower()
            if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"}:
                return "image"
            if ext in {".mp4", ".webm", ".mov", ".mkv", ".avi"}:
                return "video"
            if ext in {".mp3", ".wav", ".ogg", ".flac", ".m4a"}:
                return "audio"
            if ext in {".md", ".txt", ".rtf", ".pdf", ".docx", ".doc"}:
                return "document"
            if ext in {".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".json", ".yaml", ".yml", ".sql", ".sh", ".rs", ".go", ".c", ".cpp"}:
                return "code"
            if ext in {".zip", ".tar", ".gz", ".7z", ".rar"}:
                return "archive"
            return "other"

        if art_dir.exists():
            for p in art_dir.rglob("*"):
                if p.is_file():
                    try:
                        stat = p.stat()
                        ext = p.suffix.lower()
                        rel = str(p.relative_to(art_dir)).replace("\\", "/")
                        items.append({
                            "name": p.name,
                            "path": str(p),
                            "rel_path": rel,
                            "size": stat.st_size,
                            "size_fmt": format_size(stat.st_size),
                            "type": classify_type(ext),
                            "extension": ext,
                            "mtime": stat.st_mtime,
                            "mtime_fmt": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                            "view_url": f"/api/artifacts/view?path={quote(str(p))}",
                            "download_url": f"/api/artifacts/download?path={quote(str(p))}",
                        })
                    except (OSError, ValueError):
                        continue

        items.sort(key=lambda x: x["mtime"], reverse=True)
        return {"artifacts": items[:limit], "total": len(items)}

    @app.get("/api/artifacts/content")
    def get_artifact_content(path: str):
        resolved = Path(path).resolve()
        if not resolved.exists() or not resolved.is_file():
            raise HTTPException(status_code=404, detail="Artifact file not found")
        try:
            resolved.relative_to(paths.home().resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied")
        if resolved.stat().st_size > 2 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large for live preview (max 2MB)")
        try:
            text = resolved.read_text(encoding="utf-8", errors="replace")
            return {"name": resolved.name, "content": text, "size": resolved.stat().st_size}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.delete("/api/artifacts")
    def delete_artifact(path: str):
        resolved = Path(path).resolve()
        if not resolved.exists() or not resolved.is_file():
            raise HTTPException(status_code=404, detail="Artifact file not found")
        try:
            resolved.relative_to(paths.home().resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied")
        try:
            resolved.unlink()
            return {"ok": True, "deleted": resolved.name}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to delete artifact: {e}")

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
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except Exception as e:
                print("API: listener exception:", e)

        store.subscribe(listener)

        async def event_generator():
            try:
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=15.0)
                        yield brain.sse(event)
                        # Speech is decided here, not in the browser: the old
                        # notify effect lived in the Dashboard component, so a
                        # task that finished while the operator was on any
                        # other page was never announced. Every connected
                        # client gets the same utterance, on every page.
                        #
                        # Gated on the type first: `load_settings()` reads a
                        # file, and a live engine trace publishes hundreds of
                        # events a run that could never speak.
                        if event.get("type") in brain.SPEAKABLE_EVENTS:
                            utterance = brain.speech_for(
                                event, config.load_settings(),
                                task_text=lambda tid: (store.get_task(tid) or {}).get("text", ""))
                            if utterance:
                                yield brain.sse(utterance)
                    except asyncio.TimeoutError:
                        yield "data: {\"type\": \"keep-alive\"}\n\n"
            finally:
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
            # The planner's steps, rendered as the timeline's plan checklist.
            # Small and bounded (a plan is a handful of rows), unlike the
            # trace — which is why this rides along instead of getting its own
            # endpoint.
            "steps": store.get_steps(task_id),
            "pending_confirm": pending_confirm,
            "pending_ask": pending_ask
        }

    @app.get("/api/tasks/{task_id}/trace")
    def task_trace(task_id: str, after: int = 0):
        """What the engine actually did, distilled (hermes/engine_stream.py).

        Its own endpoint rather than a field on /api/tasks/{id}: a trace runs to
        thousands of rows, and the timeline pulls it incrementally with `after`
        — the same rows arrive live over SSE, so this is the initial load and
        the gap-filler after a reconnect.
        """
        return store.get_trace_events(task_id, after_id=after)

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
            if body.engine:
                kwargs["engine"] = body.engine
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
            engine = app.state.engine
            images = engine.take_images(sid, body.images)
            documents = engine.take_documents(sid, body.documents)
            store.add_message(sid, "user", text
                              + (IMAGE_MARKER if images else "")
                              + (DOCUMENT_MARKER if documents else ""),
                              reply_snippet=body.reply_snippet, reply_role=body.reply_role)
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
                    dispatch = engine.wrap_dispatch(engine.make_dispatch(sid, images),
                                                    await _integrate_extra())
                    turn, auto_id = await engine.history_for_turn(
                        sid, text, images, dispatch, documents,
                        reply_quote_text=body.reply_snippet, reply_quote_role=body.reply_role)
                    reply = await chat(turn, tools=await _chat_tools(text), dispatch=dispatch,
                                       **({"model": body.chat_model} if body.chat_model else {}))
                except Exception as e:
                    safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                    reply = f"(Maaf, chat gagal: {safe})"
            clean, _ = voice.strip_voice_tag(reply)
            clean += engine.task_card_suffix(clean, auto_id)
            store.add_message(sid, "assistant", clean)
            store.set_task_status(task_id, "done")
            store.append_log(task_id, f"answer: {clean}")
            uploads.discard(images)
            uploads.discard(documents)
            await engine.learn_from_turn(text, clean)
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

    @app.post("/api/sessions/{session_id}/settings")
    def update_session_settings(session_id: str, body: SessionSettings):
        ok = store.update_session_settings(session_id, project=body.project, engine=body.engine,
                                           title=body.title, chat_model=body.chat_model)
        if not ok:
            raise HTTPException(status_code=404, detail="Session not found")
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
        return {"messages": store.get_messages_full(sid, limit=CHAT_HISTORY_LIMIT)}

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
        engine = app.state.engine
        images = engine.take_images(sid, body.images)
        documents = engine.take_documents(sid, body.documents)
        # A resume turn has no operator message behind it — the trigger was the
        # confirm button — so nothing is recorded as a user turn and the thread
        # shows only the outcome plus the agent picking the work back up.
        if not body.resume:
            store.add_message(sid, "user", text
                              + (IMAGE_MARKER if images else "")
                              + (DOCUMENT_MARKER if documents else ""),
                              reply_snippet=body.reply_snippet, reply_role=body.reply_role)
        chat = getattr(app.state, "chat", None)

        # Auto update session project/engine/chat_model if supplied
        if (body.project is not None or body.engine is not None or body.chat_model is not None) and sid != CONV_WEB:
            store.update_session_settings(sid, project=body.project, engine=body.engine,
                                          chat_model=body.chat_model)

        # Auto rename session if it was default name: an instant truncation
        # first (no flash of "Percakapan Baru" while any LLM call is in
        # flight), then upgraded fire-and-forget to a proper LLM title once
        # title_gen resolves — the stream must not wait on it.
        if sid != CONV_WEB and not body.resume:
            sessions = store.list_sessions()
            curr = next((s for s in sessions if s["session_id"] == sid), None)
            if curr and curr["title"] == "Percakapan Baru":
                fallback_title = text[:30] + "..." if len(text) > 30 else text
                store.rename_session(sid, fallback_title)
                title_gen = getattr(app.state, "title_gen", None)
                if title_gen:
                    async def _upgrade_title():
                        better = await title_gen(text)
                        if better:
                            store.rename_session(sid, better)
                    asyncio.create_task(_upgrade_title())

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
                dispatch = engine.wrap_dispatch(engine.make_dispatch(sid, images),
                                                await _integrate_extra())
                history, auto_id = await engine.history_for_turn(
                    sid, text, images, dispatch, documents,
                    reply_quote_text=body.reply_snippet, reply_quote_role=body.reply_role)
                if body.resume:
                    # Ephemeral, not stored: it steers this one turn and would be
                    # noise in the thread. Also guarantees the prompt ends on a
                    # user turn — the outcome line before it is an assistant
                    # message, which some providers will not complete after.
                    history = [*history, {"role": "user", "content": RESUME_NUDGE}]
                try:
                    async for kind, payload in chat.stream(
                            history,
                            tools=await _chat_tools(text),
                            dispatch=dispatch,
                            **({"model": body.chat_model} if body.chat_model else {})):
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
            suffix = engine.task_card_suffix(clean, auto_id)
            if suffix:
                yield sse({"delta": suffix})
                clean += suffix
            store.add_message(sid, "assistant", clean)
            uploads.discard(images)      # looked at, answered, gone
            uploads.discard(documents)
            yield sse({"done": True, "usage": usage})
            # After the client has its answer: learning is a background chore,
            # and holding the stream open for a second model call would show up
            # as a pause with the reply already fully written. A resume turn has
            # no operator utterance to learn from, so it is skipped.
            if not body.resume:
                await engine.learn_from_turn(text, clean)
                await engine.maybe_compress(sid)

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

    @app.post("/api/uploads/document")
    async def post_upload_document(request: Request, filename: str,
                                   session_id: str | None = None):
        """Accept one non-image file (text/code, PDF, DOCX, XLSX) for a
        conversation. Same raw-body shape as /api/uploads; `filename` carries
        the extension, which content-sniffing can't recover for plain text."""
        data = await request.body()
        if not data:
            raise HTTPException(status_code=400, detail="Body kosong")
        try:
            name, ext = uploads.save_document(paths.uploads_dir(),
                                              session_id or CONV_WEB, filename, data)
        except uploads.UnsupportedDocument as e:
            raise HTTPException(status_code=415, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=413, detail=str(e))
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Gagal menyimpan: {e}")
        return {"id": name, "ext": ext, "bytes": len(data)}

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

    @app.get("/api/scheduled-jobs")
    def get_scheduled_jobs():
        if hasattr(store, "list_scheduled_jobs"):
            return store.list_scheduled_jobs()
        return []

    @app.post("/api/scheduled-jobs")
    def post_scheduled_job(body: ScheduledJobBody):
        import time
        from uuid import uuid4
        job_id = body.job_id or f"job_{uuid4().hex[:6]}"
        now = time.time()
        next_run = now + max(1, body.delay_s)
        if hasattr(store, "create_scheduled_job"):
            store.create_scheduled_job(
                job_id=job_id, description=body.description,
                interval_s=body.interval_s, next_run_ts=next_run,
                chat_id=body.chat_id)
            return {"ok": True, "job_id": job_id, "next_run_ts": next_run}
        raise HTTPException(status_code=500, detail="Store does not support scheduled jobs")

    @app.post("/api/scheduled-jobs/{job_id}/run")
    async def run_scheduled_job_now(job_id: str):
        if not hasattr(store, "get_scheduled_job"):
            raise HTTPException(status_code=404, detail="Not found")
        job = store.get_scheduled_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if bridge:
            t = asyncio.create_task(
                bridge.handle_task(
                    user_id=0, chat_id=job.get("chat_id") or 0,
                    text=job.get("description") or "", trusted=True))
            t.add_done_callback(_bg_crash_cb(store, f"sched-{job_id}"))
        return {"ok": True, "job_id": job_id}

    @app.delete("/api/scheduled-jobs/{job_id}")
    def delete_scheduled_job(job_id: str):
        if hasattr(store, "delete_scheduled_job"):
            ok = store.delete_scheduled_job(job_id)
            return {"ok": ok, "job_id": job_id}
        return {"ok": False}

    @app.get("/api/stitch/gallery")
    def get_stitch_gallery():
        from urllib.parse import quote
        stitch_dir = paths.artifacts_dir() / "stitch"
        if not stitch_dir.is_dir():
            return []
        items = []
        for p in sorted(stitch_dir.glob("*.png"), key=lambda x: x.stat().st_mtime, reverse=True):
            items.append({
                "filename": p.name,
                "path": str(p),
                "url": f"/api/artifacts/view?path={quote(str(p))}",
                "created": p.stat().st_mtime,
            })
        return items


    @app.get("/api/settings")
    def get_settings(): return config.load_settings().model_dump()

    @app.post("/api/settings")
    def post_settings(body: config.Settings):
        config.save_settings(body)
        return {"ok": True}

    @app.post("/api/cleanup/images")
    def trigger_image_cleanup(days: int | None = None):
        s = config.load_settings()
        retention = days if days is not None else s.image_retention_days
        target_dirs = [
            paths.artifacts_dir() / "generated",
            paths.uploads_dir(),
            paths.artifacts_dir(),
        ]
        res = cleanup.cleanup_old_images(target_dirs, retention)
        return {"ok": True, "retention_days": retention, **res}

    @app.get("/api/secrets/status")
    def secrets_status():
        s = config.load_secrets()
        return {"nvidia_api_key_set": bool(s.nvidia_api_key),
                "telegram_bot_token_set": bool(s.telegram_bot_token),
                "github_app_configured": bool(
                    s.github_app_id and s.github_app_private_key and s.github_app_installation_id)}

    @app.post("/api/secrets")
    def post_secrets(body: SecretsUpdate):
        cur = config.load_secrets()
        def keep(new, old): return old if new in ("", "***", None) else new
        config.save_secrets(config.Secrets(
            nvidia_api_key=keep(body.nvidia_api_key, cur.nvidia_api_key),
            telegram_bot_token=keep(body.telegram_bot_token, cur.telegram_bot_token),
            unsplash_access_key=cur.unsplash_access_key,
            github_app_id=keep(body.github_app_id, cur.github_app_id),
            github_app_private_key=keep(body.github_app_private_key, cur.github_app_private_key),
            github_app_installation_id=keep(body.github_app_installation_id, cur.github_app_installation_id)))
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

    @app.get("/api/chat-models")
    def chat_models():
        # Distinct from /api/engine-models above: that one picks which CLI
        # (claude/agy) runs a background @project task. This one picks which
        # model answers casual conversation (chat_engine.run_turn/history_
        # for_turn) — a plain OpenAI-compatible completion, so any endpoint
        # Settings.nvidia_base_url points at can be asked for its live list.
        s = config.load_settings()
        secrets = config.load_secrets()
        now = time.time()
        # A base_url change (operator flips provider in Settings) must bust
        # the cache immediately rather than waiting out the TTL, or the
        # dropdown keeps showing the OLD provider's models after a switch.
        if _chat_models_cache["base_url"] != s.nvidia_base_url:
            _chat_models_cache.update(at=0.0, models=None, base_url=s.nvidia_base_url)
        ttl = _CHAT_MODELS_CACHE_TTL_S if _chat_models_cache["models"] is not None else _CHAT_MODELS_NEG_TTL_S
        if now - _chat_models_cache["at"] > ttl:
            live = list_chat_models(s.nvidia_base_url, secrets.nvidia_api_key)
            _chat_models_cache["at"] = now
            if live is not None:
                _chat_models_cache["models"] = live
        models = _chat_models_cache["models"]
        default = s.chat_model or s.model
        return {"models": models if models is not None else ([default] if default else []),
                "live": models is not None,
                "default": default}

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

    @app.get("/api/skills")
    def get_skills():
        s = config.load_settings()
        out = []
        for sk in s.skills:
            on_disk = skills.read_skill_file(paths.skills_dir(), sk.id)
            out.append({"id": sk.id, "name": sk.name, "description": sk.description,
                       "enabled": sk.enabled, "content": on_disk["content"] if on_disk else ""})
        return out

    @app.post("/api/skills")
    def post_skills(body: list[SkillBody]):
        """Full-list replace, like /api/mcp: whatever id was in Settings.skills
        but is missing from `body` is a removal, so its SKILL.md is deleted
        along with the entry — not just the metadata."""
        s = config.load_settings()
        old_ids = {sk.id for sk in s.skills}
        new_ids = {b.id for b in body}
        for gone_id in old_ids - new_ids:
            skills.delete_skill_file(paths.skills_dir(), gone_id)
        for b in body:
            skills.write_skill_file(paths.skills_dir(), b.id, b.name, b.description, b.content)
        s.skills = [config.Skill(id=b.id, name=b.name, description=b.description, enabled=b.enabled)
                   for b in body]
        config.save_settings(s)
        return {"ok": True}

    @app.post("/api/skills/install_tap")
    async def post_skills_install_tap(body: InstallTapBody):
        """Install a SKILL.md straight from a trusted GitHub tap (see
        skills.TRUSTED_TAPS) — the official anthropics/openai/nvidia/
        huggingface skill repos, no scanner needed because these are
        vendor-published, not arbitrary community content."""
        try:
            fetched = await skills.fetch_github_skill(body.tap, body.skill_path)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            raise HTTPException(status_code=502, detail=f"Gagal mengambil skill: {safe}")
        skill_id = f"{body.tap.split('/')[0]}-{body.skill_path.rsplit('/', 1)[-1]}"
        name = fetched["name"] or body.skill_path.rsplit("/", 1)[-1]
        description = fetched["description"] or f"Skill dari {body.tap}/{body.skill_path}"
        skills.write_skill_file(paths.skills_dir(), skill_id, name, description, fetched["content"])
        s = config.load_settings()
        s.skills = [sk for sk in s.skills if sk.id != skill_id] + [
            config.Skill(id=skill_id, name=name, description=description, enabled=True)]
        config.save_settings(s)
        return {"id": skill_id, "name": name, "description": description,
                "enabled": True, "content": fetched["content"]}

    @app.get("/api/skills/catalog")
    async def get_skills_catalog(force: bool = False):
        return await skills.fetch_agenticskills_catalog(force=force)

    @app.post("/api/skills/install_catalog")
    async def post_skills_install_catalog(body: InstallCatalogBody):
        """Install straight from the agenticskills.io catalog — a
        community aggregator, not a vendor-published tap. Lands disabled
        (enabled=False) on purpose: nothing here scans arbitrary GitHub
        content before it can end up in the model's context, so the
        operator has to look at it and flip it on themselves."""
        try:
            fetched = await skills.fetch_agenticskills_skill(body.slug)
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            raise HTTPException(status_code=502, detail=f"Gagal memasang skill: {safe}")
        skill_id = f"agenticskills-{body.slug}"
        name = fetched["name"] or body.slug
        description = fetched["description"] or f"Skill dari agenticskills.io/{body.slug}"
        skills.write_skill_file(paths.skills_dir(), skill_id, name, description, fetched["content"])
        s = config.load_settings()
        s.skills = [sk for sk in s.skills if sk.id != skill_id] + [
            config.Skill(id=skill_id, name=name, description=description, enabled=False)]
        config.save_settings(s)
        return {"id": skill_id, "name": name, "description": description,
                "enabled": False, "content": fetched["content"]}

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
        # Bias the decoder toward the names it will actually hear here: the
        # agent's own name and every registered project. Without this "Sayur"
        # and the like decode phonetically ("sa yur", "sahur") on the base/small
        # model, which no amount of language setting fixes.
        hotwords = stt.build_hotwords(
            [settings.agent_name, *settings.projects.keys()])
        try:
            text = await asyncio.to_thread(
                stt.transcribe, audio, settings.stt_language, settings.stt_model,
                hotwords)
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
