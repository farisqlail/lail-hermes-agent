from hermes import mcp_hub
from hermes.config import McpServer

def test_to_openai_tools():
    discovered = [{"server": "fs", "name": "read", "description": "read file",
                   "input_schema": {"type": "object", "properties": {}}}]
    tools = mcp_hub.to_openai_tools(discovered)
    assert tools[0]["type"] == "function"
    assert tools[0]["function"]["name"] == "fs__read"

class FakeSession:
    async def list_tools(self):
        return [{"name": "read", "description": "d",
                 "input_schema": {"type": "object", "properties": {}}}]
    async def call_tool(self, name, arguments):
        return f"called {name} {arguments}"

async def test_hub_discovery_and_call():
    servers = [McpServer(name="fs", type="stdio", command="x")]
    hub = mcp_hub.McpHub(servers, session_factory=lambda s: FakeSession())
    await hub.connect()
    disc = await hub.list_tools()
    assert disc[0]["server"] == "fs" and disc[0]["name"] == "read"
    out = await hub.call("fs__read", {"path": "a"})
    assert "called read" in out
    await hub.close()

async def test_disabled_server_skipped():
    servers = [McpServer(name="fs", type="stdio", command="x", enabled=False)]
    hub = mcp_hub.McpHub(servers, session_factory=lambda s: FakeSession())
    await hub.connect()
    assert await hub.list_tools() == []

async def test_failing_factory_skipped():
    def boom(s):
        raise NotImplementedError("no transport yet")
    servers = [McpServer(name="fs", type="stdio", command="x")]
    hub = mcp_hub.McpHub(servers, session_factory=boom)
    await hub.connect()          # must NOT raise
    assert await hub.list_tools() == []
    await hub.close()

async def test_broken_session_skipped_in_list_tools():
    class BrokenSession:
        async def list_tools(self):
            raise ConnectionError("server died")
    servers = [McpServer(name="bad", type="stdio", command="x"),
               McpServer(name="fs", type="stdio", command="x")]
    def factory(s):
        return BrokenSession() if s.name == "bad" else FakeSession()
    hub = mcp_hub.McpHub(servers, session_factory=factory)
    await hub.connect()
    disc = await hub.list_tools()   # broken server skipped, healthy one listed
    assert [d["server"] for d in disc] == ["fs"]

def test_default_factory_is_lazy_real_session():
    srv = McpServer(name="fs", type="stdio", command="definitely-not-a-real-binary")
    sess = mcp_hub._default_session(srv)
    assert isinstance(sess, mcp_hub.RealMcpSession)  # construction must not spawn anything

async def test_real_session_close_before_open_is_noop():
    sess = mcp_hub.RealMcpSession(
        McpServer(name="fs", type="stdio", command="x"))
    await sess.close()  # must not raise
