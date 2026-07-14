from hermes.telegram_bridge import Bridge, detect_risky, is_allowed, new_task_id
from hermes.config import Settings
from hermes.session_store import Store

def test_is_allowed():
    s = Settings(allowed_user_ids=[1, 2])
    assert is_allowed(1, s) and not is_allowed(9, s)

def test_task_id_unique():
    assert new_task_id() != new_task_id()

async def test_reject_unlisted(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(allowed_user_ids=[1])
    sent = []
    async def sender(chat, text): sent.append((chat, text))
    class FakeOrch:
        async def run_task(self, *a, **k): raise AssertionError("should not run")
    b = Bridge(settings, store, FakeOrch(), sender)
    tid = await b.handle_task(user_id=99, chat_id=5, text="hi")
    assert tid is None
    assert "not authorized" in sent[0][1].lower()

async def test_accept_listed(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
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

def test_detect_risky():
    assert detect_risky("build app then git push to origin") == ["runs `git push`"]
    assert "deletes files" in detect_risky("hapus folder lama")
    assert "deletes files" in detect_risky("rm -rf build")
    assert any("outside the project" in r for r in detect_risky(r"copy to C:\Windows"))
    assert detect_risky("buat app counter Flutter") == []

async def test_risky_task_awaits_confirmation(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(allowed_user_ids=[1])
    ran, asked = [], []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): asked.append((task_id, reasons))
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report): ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm)

    tid = await b.handle_task(user_id=1, chat_id=5, text="build app then git push")
    assert tid is not None
    assert store.get_task(tid)["status"] == "awaiting_confirm"
    assert asked and asked[0][0] == tid
    assert ran == []  # not run until confirmed

    # approve → runs
    assert await b.resolve_confirm(user_id=1, task_id=tid, approved=True)
    assert ran == [tid]

async def test_risky_task_cancelled_on_deny(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(allowed_user_ids=[1])
    ran = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): pass
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report): ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm)

    tid = await b.handle_task(user_id=1, chat_id=5, text="delete old files")
    assert await b.resolve_confirm(user_id=1, task_id=tid, approved=False)
    assert ran == []
    assert store.get_task(tid)["status"] == "cancelled"

async def test_confirm_gate_disabled_runs_directly(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(allowed_user_ids=[1], confirm_risky=False)
    ran = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): raise AssertionError("gate disabled")
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report): ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm)
    tid = await b.handle_task(user_id=1, chat_id=5, text="git push it")
    assert ran == [tid]
