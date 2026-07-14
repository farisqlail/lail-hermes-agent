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
        import logging
        out = []
        for name, sess in self._sessions.items():
            try:
                tools = await sess.list_tools()
            except Exception as e:
                logging.getLogger("hermes.mcp_hub").warning(
                    "MCP server %r failed to list tools, skipping: %s", name, e)
                continue
            for t in tools:
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

OPEN_TIMEOUT_S = 20    # transport + initialize handshake
LIST_TIMEOUT_S = 20    # tools/list
CALL_TIMEOUT_S = 120   # tools/call

class RealMcpSession:
    """MCP client session over stdio or HTTP/SSE.

    Construction is cheap and never raises; the transport is opened lazily on
    first use so `McpHub.connect` (which calls the factory synchronously) can
    register servers without blocking on subprocess/network startup. Every
    remote operation is bounded — a wedged server must never stall planning.
    """

    def __init__(self, srv: McpServer):
        self.srv = srv
        self._stack = None
        self._session = None

    async def _ensure(self):
        if self._session is not None:
            return self._session
        import os
        from contextlib import AsyncExitStack
        from mcp import ClientSession, StdioServerParameters
        stack = AsyncExitStack()
        try:
            if self.srv.type == "stdio":
                from mcp.client.stdio import stdio_client
                params = StdioServerParameters(
                    command=self.srv.command, args=self.srv.args,
                    env={**os.environ, **self.srv.env})
                read, write = await stack.enter_async_context(stdio_client(params))
            else:
                from mcp.client.sse import sse_client
                read, write = await stack.enter_async_context(sse_client(self.srv.url))
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
        except BaseException:
            await stack.aclose()
            raise
        self._stack, self._session = stack, session
        return session

    async def list_tools(self) -> list[dict]:
        import asyncio
        s = await asyncio.wait_for(self._ensure(), OPEN_TIMEOUT_S)
        res = await asyncio.wait_for(s.list_tools(), LIST_TIMEOUT_S)
        return [{"name": t.name,
                 "description": t.description or "",
                 "input_schema": t.inputSchema or {"type": "object", "properties": {}}}
                for t in res.tools]

    async def call_tool(self, name: str, arguments: dict) -> str:
        import asyncio
        s = await asyncio.wait_for(self._ensure(), OPEN_TIMEOUT_S)
        res = await asyncio.wait_for(s.call_tool(name, arguments), CALL_TIMEOUT_S)
        parts = []
        for c in getattr(res, "content", None) or []:
            text = getattr(c, "text", None)
            parts.append(text if text is not None else str(c))
        return "\n".join(parts)

    async def close(self):
        if self._stack is None:
            return
        try:
            await self._stack.aclose()
        except Exception:
            # anyio cancel scopes must unwind in the task that opened them;
            # closing from another task is best-effort.
            pass
        self._stack = self._session = None

def _default_session(srv: McpServer):
    return RealMcpSession(srv)
