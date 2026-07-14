from hermes.telegram_bridge import Bridge, is_allowed, new_task_id
from hermes.config import Settings
from hermes.session_store import Store

def test_is_allowed():
    s = Settings(allowed_user_ids=[1, 2])
    assert is_allowed(1, s) and not is_allowed(9, s)

def test_task_id_unique():
    assert new_task_id() != new_task_id()

async def test_reject_unlisted(tmp_path):
    store = Store(tmp_path / "t.db"); store.init_schema()
    settings = Settings(allowed_user_ids=[1])
    sent = []
    async def sender(chat, text): sent.append((chat, text))
    class FakeOrch:
        async def run_task(self, *a, **k): raise AssertionError("should not run")
    b = Bridge(settings, store, FakeOrch(), sender)
    tid = await b.handle_task(user_id=99, chat_id=5, text="hi")
    assert tid is None
    assert "not authorized" in sent[0][1].lower()

async def test_accept_listed(tmp_path):
    store = Store(tmp_path / "t.db"); store.init_schema()
    settings = Settings(allowed_user_ids=[1])
    ran = []
    async def sender(chat, text): pass
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report):
            ran.append(task_id); await report(task_id, "hello")
    b = Bridge(settings, store, FakeOrch(), sender)
    tid = await b.handle_task(user_id=1, chat_id=5, text="build app")
    assert tid is not None and ran == [tid]
    assert store.get_task(tid)["status"] in ("queued", "running", "done")
