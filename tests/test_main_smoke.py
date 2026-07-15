import inspect
from hermes import main

def test_run_is_coroutine():
    assert inspect.iscoroutinefunction(main.run)

def test_adb_has_protocol_methods():
    from hermes.config import Settings
    adb = main.Adb(Settings())
    for m in ("is_running", "start", "install", "launch", "screencap"):
        assert inspect.iscoroutinefunction(getattr(adb, m))

def test_build_bridge_injects_git_dirty(tmp_path):
    """A missing git_dirty makes the dirty-tree gate fail open in silence —
    Bridge reads None as 'skip the check'. Assert the wiring, not the source."""
    from hermes.config import Settings
    from hermes.session_store import Store
    store = Store(tmp_path / "t.db"); store.init_schema()

    async def sender(chat, text): pass

    b = main._build_bridge(Settings(), store, orchestrator=None, sender=sender,
                           ask_confirm=None)
    assert b.git_dirty is not None
    assert inspect.iscoroutinefunction(b.git_dirty)
