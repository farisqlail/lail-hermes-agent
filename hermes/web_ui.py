from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from pathlib import Path
from pydantic import BaseModel
from . import config, paths
from .session_store import Store

class SecretsUpdate(BaseModel):
    nvidia_api_key: str | None = None
    telegram_bot_token: str | None = None

def load_spa_html() -> str:
    path = Path(__file__).parent / "spa.html"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return "<h1>Hermes: spa.html not found!</h1>"

def create_app(store: Store) -> FastAPI:
    app = FastAPI()

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
