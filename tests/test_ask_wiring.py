"""The step-3 transport contract: the ask MCP server mounts on the web app and
answers a real MCP handshake. Guards the wiring main.py depends on — a mounted
sub-app whose lifespan the parent must run, at the host/path the run token URL
points at — so it cannot silently regress into a dead endpoint.
"""
import httpx
import pytest
from hermes.ask import AskRegistry
from hermes import ask_server
from hermes.web_ui import create_app
from hermes.session_store import Store


def _web(store):
    reg = AskRegistry(log=store.append_log)
    mcp = ask_server.build_ask_server(reg)
    asgi = mcp.streamable_http_app()          # creates the session manager
    web = create_app(store, lifespan=lambda _a: mcp.session_manager.run())
    web.mount(ask_server.MOUNT_PREFIX, asgi)
    return web


def test_create_app_still_builds_without_a_lifespan(tmp_path):
    store = Store(tmp_path / "t.db"); store.init_schema()
    assert create_app(store) is not None       # default path unchanged


async def test_mounted_ask_server_answers_an_mcp_initialize(tmp_path):
    store = Store(tmp_path / "t.db"); store.init_schema()
    web = _web(store)
    path = f"{ask_server.MOUNT_PREFIX}{ask_server.STREAM_PATH}"
    transport = httpx.ASGITransport(app=web)
    # 127.0.0.1 because FastMCP's DNS-rebinding guard rejects an unknown Host,
    # and 127.0.0.1:8799 is exactly what the run token URL resolves to.
    async with web.router.lifespan_context(web):
        async with httpx.AsyncClient(transport=transport,
                                     base_url="http://127.0.0.1:8799") as c:
            r = await c.post(path, headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream"},
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                      "params": {"protocolVersion": "2025-06-18",
                                 "capabilities": {},
                                 "clientInfo": {"name": "c", "version": "1"}}})
    assert r.status_code == 200
    assert f'"name":"{ask_server.SERVER_NAME}"' in r.text


async def test_unknown_host_is_refused_not_served(tmp_path):
    """The DNS-rebinding guard is load-bearing: a request with a foreign Host
    must never reach the tool. Proves the endpoint is the MCP handler, not a
    catch-all."""
    store = Store(tmp_path / "t.db"); store.init_schema()
    web = _web(store)
    path = f"{ask_server.MOUNT_PREFIX}{ask_server.STREAM_PATH}"
    transport = httpx.ASGITransport(app=web)
    async with web.router.lifespan_context(web):
        async with httpx.AsyncClient(transport=transport,
                                     base_url="http://evil.example") as c:
            r = await c.post(path, headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream"},
                json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert r.status_code == 421
