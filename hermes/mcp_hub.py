from __future__ import annotations
from typing import Callable
from .config import McpServer

def to_openai_tools(discovered: list[dict]) -> list[dict]:
    tools = []
    for d in discovered:
        tools.append({
            "type": "function",
            "function": {
                "name": f'{d["server"]}__{d["name"]}',
                "description": d.get("description", ""),
                "parameters": d.get("input_schema", {"type": "object", "properties": {}}),
            },
        })
    return tools

class McpHub:
    def __init__(self, servers: list[McpServer],
                 session_factory: Callable | None = None):
        self.servers = servers
        self.session_factory = session_factory or _default_session
        self._sessions: dict[str, object] = {}

    async def connect(self) -> None:
        import logging
        for srv in self.servers:
            if not srv.enabled:
                continue
            try:
                self._sessions[srv.name] = self.session_factory(srv)
            except Exception as e:
                logging.getLogger("hermes.mcp_hub").warning(
                    "MCP server %r could not be started, skipping: %s", srv.name, e)

    async def list_tools(self) -> list[dict]:
        out = []
        for name, sess in self._sessions.items():
            for t in await sess.list_tools():
                out.append({"server": name, "name": t["name"],
                            "description": t.get("description", ""),
                            "input_schema": t.get("input_schema",
                                                  {"type": "object", "properties": {}})})
        return out

    async def call(self, fn_name: str, arguments: dict) -> str:
        server, _, tool = fn_name.partition("__")
        sess = self._sessions[server]
        return await sess.call_tool(tool, arguments)

    async def close(self):
        for sess in self._sessions.values():
            close = getattr(sess, "close", None)
            if close:
                await close()
        self._sessions.clear()

def _default_session(srv: McpServer):
    # Real MCP transport wired in Task 12; unit tests inject a fake factory.
    raise NotImplementedError("real MCP session created at runtime in main wiring")
