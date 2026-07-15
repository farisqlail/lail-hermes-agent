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


async def test_notify_restart_sends_one_digest_per_chat():
    sent = []
    async def sender(chat, text): sent.append((chat, text))
    swept = [
        {"task_id": "t1", "chat_id": 5, "text": "refactor auth", "status": "running"},
        {"task_id": "t2", "chat_id": 7, "text": "build apk", "status": "queued"},
    ]
    assert await main._notify_restart(swept, sender) == 2
    assert {c for c, _ in sent} == {5, 7}


async def test_notify_restart_with_nothing_swept():
    async def sender(chat, text): raise AssertionError("nothing to say")
    assert await main._notify_restart([], sender) == 0


async def test_notify_restart_survives_one_bad_chat():
    """A chat that blocked the bot must not silence the others, nor take
    startup down with it."""
    sent = []
    async def sender(chat, text):
        if chat == 5:
            raise RuntimeError("Forbidden: bot was blocked by the user")
        sent.append(chat)
    swept = [
        {"task_id": "t1", "chat_id": 5, "text": "x", "status": "running"},
        {"task_id": "t2", "chat_id": 7, "text": "y", "status": "running"},
    ]
    assert await main._notify_restart(swept, sender) == 1
    assert sent == [7]


def test_console_safe_output_always_survives_cp1252():
    """Every except handler in run() reports through _console_safe, so its
    output must be encodable by the real cp1252 console no matter what the
    exception message contains."""
    for nasty in ("❌ Forbidden: bot заблокирован", "плохой токен", "ok ascii",
                  "\udcff surrogate", ""):
        main._console_safe(RuntimeError(nasty)).encode("cp1252")  # must not raise


async def test_notify_restart_survives_unprintable_error(monkeypatch):
    """A chat error whose message can't be rendered by the console must not
    escape _notify_restart either.

    Hermes runs on a Windows console whose stdout is cp1252 (deploy/start.bat
    sets no PYTHONUTF8, PYTHONIOENCODING, or chcp 65001). Under pytest, stdout
    is captured with a UTF-8-capable encoding, so simply calling
    _notify_restart with a non-ASCII exception message would pass here for
    the wrong reason even against unguarded code. To actually exercise the
    hazard, stand in for that cp1252 console: monkeypatch the builtin print
    that _notify_restart's except handler calls with a fake that raises
    UnicodeEncodeError for any text a real cp1252 console couldn't encode,
    exactly like the real console would.
    """
    def cp1252_console_print(*args, **kwargs):
        text = " ".join(str(a) for a in args)
        text.encode("cp1252")  # raises UnicodeEncodeError, like the real console

    monkeypatch.setattr("builtins.print", cp1252_console_print)

    sent = []
    async def sender(chat, text):
        if chat == 5:
            raise RuntimeError("❌ Forbidden: bot заблокирован")
        sent.append(chat)
    swept = [
        {"task_id": "t1", "chat_id": 5, "text": "x", "status": "running"},
        {"task_id": "t2", "chat_id": 7, "text": "y", "status": "running"},
    ]
    assert await main._notify_restart(swept, sender) == 1
    assert sent == [7]
