from __future__ import annotations
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from . import config
from .session_store import Store

_DASH = "<h1>Hermes</h1><ul id=t></ul><script>fetch('/api/tasks').then(r=>r.json())" \
        ".then(x=>t.innerHTML=x.map(k=>`<li>${k.task_id} ${k.status}</li>`).join(''))</script>" \
        "<a href=/settings>settings</a>"
_SET = "<h1>Settings</h1><p>Edit via /api/settings, /api/secrets, /api/mcp.</p>"

def create_app(store: Store) -> FastAPI:
    app = FastAPI()

    @app.get("/", response_class=HTMLResponse)
    def dashboard(): return _DASH

    @app.get("/settings", response_class=HTMLResponse)
    def settings_page(): return _SET

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
    def post_settings(body: dict):
        config.save_settings(config.Settings.model_validate(body))
        return {"ok": True}

    @app.get("/api/secrets/status")
    def secrets_status():
        s = config.load_secrets()
        return {"nvidia_api_key_set": bool(s.nvidia_api_key),
                "telegram_bot_token_set": bool(s.telegram_bot_token)}

    @app.post("/api/secrets")
    def post_secrets(body: dict):
        cur = config.load_secrets()
        def keep(new, old): return old if new in ("", "***", None) else new
        config.save_secrets(config.Secrets(
            nvidia_api_key=keep(body.get("nvidia_api_key"), cur.nvidia_api_key),
            telegram_bot_token=keep(body.get("telegram_bot_token"), cur.telegram_bot_token)))
        return {"ok": True}

    @app.get("/api/mcp")
    def get_mcp(): return [m.model_dump() for m in config.load_settings().mcp_servers]

    @app.post("/api/mcp")
    def post_mcp(body: list):
        s = config.load_settings()
        s.mcp_servers = [config.McpServer.model_validate(m) for m in body]
        config.save_settings(s)
        return {"ok": True}

    @app.post("/api/mcp/test")
    async def mcp_test(body: dict):
        from .mcp_hub import McpHub
        from .config import McpServer
        srv = McpServer.model_validate(body)
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
