from __future__ import annotations
import re, subprocess, time
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from pathlib import Path
from pydantic import BaseModel, ValidationError, field_validator
from . import config, paths
from .session_store import Store

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

def create_app(store: Store, lifespan=None) -> FastAPI:
    # lifespan carries the ask MCP server's session manager when main.py mounts
    # it here: a mounted sub-app's own lifespan is ignored by Starlette, so the
    # manager has to be started by the parent or the /ask-mcp endpoint is dead.
    app = FastAPI(lifespan=lifespan)

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
    def tasks(): return store.list_tasks()

    @app.get("/api/tasks/{task_id}")
    def task(task_id: str):
        t = store.get_task(task_id) or {}
        return {"task": t, "logs": store.get_logs(task_id),
                "artifacts": store.get_artifacts(task_id)}

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
