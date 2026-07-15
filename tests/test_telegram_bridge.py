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
        async def run_task(self, task_id, chat_id, text, report, proj=None):
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


def test_detect_risky_deletion_needs_a_filesystem_object():
    """A deletion verb aimed at code constructs is a refactor, not a risk.
    Only verb + filesystem object (same clause) gates."""
    for benign in ("hapus warning di console",
                   "remove unused imports",
                   "delete the deprecated login function",
                   "hapus duplikasi logika di auth",
                   "drop the extra whitespace"):
        assert detect_risky(benign) == []
    for risky in ("hapus file config lama",
                  "delete old files",
                  "remove the build directory",
                  "wipe the database",
                  "drop table users",
                  "hapus semuanya"):
        assert detect_risky(risky) == ["deletes files"]


def test_detect_risky_explicit_commands_gate_on_their_own():
    for cmd in ("rm -rf build", "rm -r temp", "rmdir out", "git clean -fd"):
        assert detect_risky(cmd) == ["deletes files"]


def test_detect_risky_reports_deletion_once():
    """Both delete patterns can match the same text; one reason, not two."""
    assert detect_risky("rm -rf build and delete old files") == ["deletes files"]

async def test_risky_task_awaits_confirmation(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(allowed_user_ids=[1])
    ran, asked = [], []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): asked.append((task_id, reasons))
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None): ran.append(task_id)
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
        async def run_task(self, task_id, chat_id, text, report, proj=None): ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm)
    tid = await b.handle_task(user_id=1, chat_id=5, text="git push it")
    assert ran == [tid]


def _store(home):
    from hermes.session_store import Store
    s = Store(home / "t.db"); s.init_schema()
    return s


async def test_unregistered_project_rejected_before_planning(hermes_home):
    store = _store(hermes_home)
    settings = Settings(allowed_user_ids=[1], projects={})
    sent = []
    async def sender(chat, text): sent.append(text)
    class FakeOrch:
        async def run_task(self, *a, **k): raise AssertionError("planner must not run")
    b = Bridge(settings, store, FakeOrch(), sender)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@nope fix login")
    assert tid is None
    assert "not registered" in sent[0]
    assert store.list_tasks() == []          # no task row created


async def test_registered_but_missing_path_rejected(hermes_home):
    store = _store(hermes_home)
    gone = hermes_home / "moved-away"
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(gone)})
    sent = []
    async def sender(chat, text): sent.append(text)
    class FakeOrch:
        async def run_task(self, *a, **k): raise AssertionError("planner must not run")
    b = Bridge(settings, store, FakeOrch(), sender)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@myprofit fix login")
    assert tid is None
    assert "gone" in sent[0]
    assert store.list_tasks() == []          # no task row created


async def test_clean_project_runs_without_gate(hermes_home):
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    got = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): raise AssertionError("clean tree must not gate")
    async def git_dirty(path): return False
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            got.append((text, proj))
    b = Bridge(settings, store, FakeOrch(), sender,
               ask_confirm=ask_confirm, git_dirty=git_dirty)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@myprofit refactor auth")
    assert tid is not None
    assert got == [("refactor auth", proj)]      # sigil stripped, proj threaded


async def test_dirty_project_gates(hermes_home):
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    ran, asked = [], []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): asked.append(reasons)
    async def git_dirty(path): return True
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(proj)
    b = Bridge(settings, store, FakeOrch(), sender,
               ask_confirm=ask_confirm, git_dirty=git_dirty)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@myprofit refactor auth")
    assert store.get_task(tid)["status"] == "awaiting_confirm"
    assert ran == []
    assert any("uncommitted" in r for r in asked[0])

    # approving must still reach the resolved project, not a fresh workspace
    assert await b.resolve_confirm(user_id=1, task_id=tid, approved=True)
    assert ran == [proj]


async def test_no_undo_available_gates(hermes_home):
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    asked = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): asked.append(reasons)
    async def git_dirty(path): return None
    class FakeOrch:
        async def run_task(self, *a, **k): pass
    b = Bridge(settings, store, FakeOrch(), sender,
               ask_confirm=ask_confirm, git_dirty=git_dirty)

    await b.handle_task(user_id=1, chat_id=5, text="@myprofit refactor auth")
    assert any("no usable git undo" in r for r in asked[0])


async def test_risky_text_and_dirty_tree_both_reported(hermes_home):
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    asked = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): asked.append(reasons)
    async def git_dirty(path): return True
    class FakeOrch:
        async def run_task(self, *a, **k): pass
    b = Bridge(settings, store, FakeOrch(), sender,
               ask_confirm=ask_confirm, git_dirty=git_dirty)

    await b.handle_task(user_id=1, chat_id=5, text="@myprofit fix then git push")
    assert any("git push" in r for r in asked[0])
    assert any("uncommitted" in r for r in asked[0])


async def test_no_sigil_still_creates_fresh_workspace(hermes_home):
    """No @ means proj=None — the orchestrator makes projects/<task-id>."""
    store = _store(hermes_home)
    settings = Settings(allowed_user_ids=[1])
    got = []
    async def sender(chat, text): pass
    async def git_dirty(path): raise AssertionError("no project, nothing to check")
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            got.append(proj)
    b = Bridge(settings, store, FakeOrch(), sender, git_dirty=git_dirty)

    await b.handle_task(user_id=1, chat_id=5, text="buat app counter Flutter")
    assert got == [None]


async def test_git_dirty_raising_still_gates(hermes_home):
    """An injected git_dirty that raises must be treated like None (can't
    tell -> gate), not crash handle_task and strand the task at 'queued'."""
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    asked = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): asked.append(reasons)
    async def git_dirty(path): raise RuntimeError("git blew up")
    class FakeOrch:
        async def run_task(self, *a, **k): raise AssertionError("must not run before confirm")
    b = Bridge(settings, store, FakeOrch(), sender,
               ask_confirm=ask_confirm, git_dirty=git_dirty)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@myprofit refactor auth")
    assert tid is not None
    assert any("no usable git undo" in r for r in asked[0])
    assert store.get_task(tid)["status"] != "queued"
    assert store.get_task(tid)["status"] == "awaiting_confirm"


async def test_named_project_recorded_in_log(hermes_home):
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    async def sender(chat, text): pass
    async def git_dirty(path): return False
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None): pass
    b = Bridge(settings, store, FakeOrch(), sender, git_dirty=git_dirty)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@myprofit fix login")
    assert tid is not None
    assert any(f"project: {proj}" in line for line in store.get_logs(tid))


async def test_send_file_is_bound_to_the_chat(hermes_home):
    """Bridge hands the orchestrator a chat-bound wrapper: the orchestrator
    knows kinds and paths, never chat ids."""
    store = _store(hermes_home)
    settings = Settings(allowed_user_ids=[1])
    sent, got = [], []
    async def sender(chat, text): pass
    async def send_file(chat_id, kind, path): sent.append((chat_id, kind, path))
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None,
                           send_file=None):
            got.append(send_file)
            await send_file("apk", "app.apk")
    b = Bridge(settings, store, FakeOrch(), sender, send_file=send_file)

    await b.handle_task(user_id=1, chat_id=5, text="build app")
    assert got and got[0] is not None
    assert sent == [(5, "apk", "app.apk")]


async def test_without_send_file_orchestrator_keeps_narrow_signature(hermes_home):
    """No send_file configured -> the kwarg is not passed at all, so existing
    orchestrator fakes (and doubles) without it keep working."""
    store = _store(hermes_home)
    settings = Settings(allowed_user_ids=[1])
    ran = []
    async def sender(chat, text): pass
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(task_id)   # would TypeError if send_file were passed
    b = Bridge(settings, store, FakeOrch(), sender)

    tid = await b.handle_task(user_id=1, chat_id=5, text="build app")
    assert ran == [tid]


async def test_clean_project_runs_when_git_dirty_not_configured(hermes_home):
    """Production wiring: Bridge() with no git_dirty means the gate is
    skipped entirely and the task runs against the resolved project."""
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    got = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): raise AssertionError("no git_dirty means no gate")
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            got.append((text, proj))
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@myprofit refactor auth")
    assert tid is not None
    assert got == [("refactor auth", proj)]
