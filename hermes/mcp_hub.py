from __future__ import annotations
import json
from typing import Callable
from .config import McpServer


def failure_reason(result: str) -> str | None:
    """Why a tool result should be treated as failed, or None if it looks fine.

    `hub.call` always hands back text, so a caller cannot tell "done" from "did
    nothing" by type alone. Two shapes must never be reported as success: empty
    output, and an {"error": ...} payload (what call_tool mints from MCP's
    isError, and what the hub itself returns for an unknown tool). Central so
    the chat dispatch and the confirm-card resolver agree on what failed means.
    """
    text = (result or "").strip()
    if not text:
        return "tool tidak mengembalikan hasil apa pun"
    try:
        data = json.loads(text)
    except ValueError:
        return None          # ordinary prose output — nothing to object to
    if isinstance(data, dict):
        err = data.get("error")
        if err:
            return "tool melaporkan error" if err is True else str(err)
    return None


# How long a discovered tool list is reused before re-querying every server.
# Short enough that a just-added integration appears in the next plan or two;
# long enough that a burst of tasks doesn't re-pay per-server discovery.
TOOLS_CACHE_TTL_S = 30

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
        # tools/list is queried on every plan. The result only changes when a
        # server is added/removed or restarts, so re-paying discovery per task
        # (subprocess round-trips to each server) is wasted latency on the path
        # the operator waits on. Cache it briefly; a new integration shows up in
        # planning within TOOLS_CACHE_TTL_S, and connect/close drop the cache so
        # a config change is never stale.
        self._tools_cache: list[dict] | None = None
        self._tools_cache_at = 0.0

    def _invalidate_tools_cache(self) -> None:
        self._tools_cache = None

    async def connect(self) -> None:
        import logging
        self._invalidate_tools_cache()
        for srv in self.servers:
            if not srv.enabled:
                continue
            try:
                self._sessions[srv.name] = self.session_factory(srv)
            except Exception as e:
                logging.getLogger("hermes.mcp_hub").warning(
                    "MCP server %r could not be started, skipping: %s", srv.name, e)

    async def list_tools(self) -> list[dict]:
        """Every connected server's tools. A server that fails is skipped, not
        fatal — one dead integration must not cost the agent the others.

        Queried concurrently: each stdio server spawns its own subprocess, so
        sequential discovery cost the sum of every server's cold start (two
        servers were already 20+ seconds) on the first turn after a restart.
        """
        import asyncio, logging, time
        if (self._tools_cache is not None
                and time.monotonic() - self._tools_cache_at < TOOLS_CACHE_TTL_S):
            return self._tools_cache
        names = list(self._sessions)
        results = await asyncio.gather(
            *(self._sessions[n].list_tools() for n in names),
            return_exceptions=True)
        out = []
        for name, tools in zip(names, results):
            if isinstance(tools, BaseException):
                logging.getLogger("hermes.mcp_hub").warning(
                    "MCP server %r failed to list tools, skipping: %s", name, tools)
                continue
            for t in tools:
                out.append({"server": name, "name": t["name"],
                            "description": t.get("description", ""),
                            "input_schema": t.get("input_schema",
                                                  {"type": "object", "properties": {}})})
        self._tools_cache = out
        self._tools_cache_at = time.monotonic()
        return out

    async def call(self, fn_name: str, arguments: dict) -> str:
        import json
        server, sep, tool = fn_name.partition("__")
        if not sep or server not in self._sessions:
            return json.dumps(
                {"error": f"Tool '{fn_name}' is not supported or not connected on this client. "
                          "Please output the final plan JSON or call only registered tools."},
                ensure_ascii=False)
        sess = self._sessions[server]
        return await sess.call_tool(tool, arguments)

    async def close(self):
        self._invalidate_tools_cache()
        for sess in self._sessions.values():
            close = getattr(sess, "close", None)
            if close:
                await close()
        self._sessions.clear()

# Transport + initialize handshake. 60s, not 20: a stdio server is an `npx`
# subprocess, and `@wonderwhy-er/desktop-commander` measured 16.8s to first
# tools/list on a warm npx cache (~7s of that is npx resolving the package, the
# rest its own startup). At 20s it intermittently lost the race, hub.list_tools
# skipped it, and the chat agent then told the operator it had no disk access
# while the server sat enabled in the settings.
OPEN_TIMEOUT_S = 60
LIST_TIMEOUT_S = 20    # tools/list
CALL_TIMEOUT_S = 120   # tools/call


def transport_for(srv: McpServer) -> str:
    """Which client transport this server speaks.

    An empty `transport` means the config predates the one-link flow, so it
    keeps the legacy SSE behaviour it was written under. Changing that default
    would silently re-protocol every server already in someone's settings.
    """
    if srv.type == "stdio":
        return "stdio"
    return srv.transport or "sse"


class RealMcpSession:
    """MCP client session over stdio or HTTP/SSE.

    Construction is cheap and never raises; the transport is opened lazily on
    first use so `McpHub.connect` (which calls the factory synchronously) can
    register servers without blocking on subprocess/network startup. Every
    remote operation is bounded — a wedged server must never stall planning.
    """

    def __init__(self, srv: McpServer, auth=None):
        self.srv = srv
        # An httpx.Auth — in practice the SDK's OAuthClientProvider, which is
        # one. Passed in rather than built here so this class keeps knowing
        # nothing about token storage or browsers.
        self.auth = auth
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
            elif transport_for(self.srv) == "streamable-http":
                from mcp.client.streamable_http import streamablehttp_client
                # Three values, not two: the third is a session-id getter this
                # client does not need.
                read, write, _ = await stack.enter_async_context(
                    streamablehttp_client(self.srv.url,
                                          headers=self.srv.headers or None,
                                          auth=self.auth))
            else:
                from mcp.client.sse import sse_client
                read, write = await stack.enter_async_context(
                    sse_client(self.srv.url, headers=self.srv.headers or None,
                               auth=self.auth))
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
        text = "\n".join(parts)
        # MCP signals a tool-level failure with isError on a perfectly successful
        # call — no exception is raised. Dropping that flag made every call look
        # like it worked, so an approved action was reported "selesai" while the
        # tool had actually refused. Surface it in the shape failure_reason reads.
        if getattr(res, "isError", False):
            return json.dumps({"error": text or "tool melaporkan error tanpa pesan"},
                              ensure_ascii=False)
        return text

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
