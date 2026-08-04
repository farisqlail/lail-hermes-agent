import asyncio
import pytest

from hermes import mcp_oauth, paths


async def test_token_storage_roundtrip(hermes_home):
    """Tokens persist per server, and a server with none reads back None
    rather than raising — a first-time integration is the normal case."""
    st = mcp_oauth.FileTokenStorage("notion")
    assert await st.get_tokens() is None

    class Tok:
        def model_dump_json(self): return '{"access_token": "a"}'
    await st.set_tokens(Tok())

    raw = (mcp_oauth.token_dir() / "notion.json").read_text(encoding="utf-8")
    assert "access_token" in raw


async def test_token_storage_is_not_in_the_settings_file(hermes_home):
    """Settings are shipped to the browser on every page load, so a token must
    never live there."""
    st = mcp_oauth.FileTokenStorage("notion")

    class Tok:
        def model_dump_json(self): return '{"access_token": "a"}'
    await st.set_tokens(Tok())

    settings_file = paths.config_dir() / "config.yaml"
    assert not settings_file.exists() or "access_token" not in settings_file.read_text(
        encoding="utf-8")


async def test_pending_registry_resolves_a_matching_state():
    reg = mcp_oauth.PendingAuth()
    wait_id = reg.start()
    reg.set_state(wait_id, "STATE-1")

    task = asyncio.create_task(reg.wait(wait_id))
    await asyncio.sleep(0)
    assert reg.resolve("STATE-1", "CODE-1") is True

    code, state = await asyncio.wait_for(task, 1)
    assert (code, state) == ("CODE-1", "STATE-1")


async def test_pending_registry_rejects_an_unknown_state():
    """Anything else on this machine could POST the callback; only a state this
    process is currently waiting on may resolve a run."""
    reg = mcp_oauth.PendingAuth()
    wait_id = reg.start()
    reg.set_state(wait_id, "STATE-1")
    assert reg.resolve("SOMEONE-ELSE", "CODE") is False
    reg.cancel(wait_id)


async def test_pending_registry_wait_times_out():
    reg = mcp_oauth.PendingAuth()
    wait_id = reg.start()
    reg.set_state(wait_id, "S")
    with pytest.raises(asyncio.TimeoutError):
        await reg.wait(wait_id, timeout_s=0.01)
