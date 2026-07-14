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
