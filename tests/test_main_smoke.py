import asyncio
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

    async def sender(chat, text, html=False): pass

    b = main._build_bridge(Settings(), store, orchestrator=None, sender=sender,
                           ask_confirm=None)
    assert b.git_dirty is not None
    assert inspect.iscoroutinefunction(b.git_dirty)


async def test_notify_restart_sends_one_digest_per_chat():
    sent = []
    async def sender(chat, text, html=False): sent.append((chat, text))
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


def _nim_status_error(code):
    import httpx, openai
    req = httpx.Request("POST", "http://nim.test/v1/chat/completions")
    resp = httpx.Response(code, request=req)
    return openai.APIStatusError("boom", response=resp, body=None)


def test_is_transient_nim_error_classification():
    for code in (429, 500, 502, 503, 504):
        assert main._is_transient_nim_error(_nim_status_error(code))
    for code in (400, 401, 403, 404, 422):
        assert not main._is_transient_nim_error(_nim_status_error(code))
    assert not main._is_transient_nim_error(ValueError("no api key"))


async def test_completion_retry_outlasts_a_busy_spell():
    """Two 503s then success: the caller sees the result, and the waits are
    the configured backoff, not tight-loop hammering."""
    calls, slept = [], []
    async def create():
        calls.append(1)
        if len(calls) < 3:
            raise _nim_status_error(503)
        return "plan"
    async def sleep(s): slept.append(s)

    assert await main._completion_with_retry(create, sleep=sleep) == "plan"
    assert slept == [5, 15]


async def test_completion_retry_exhausted_says_resubmit():
    """A NIM that stays saturated must surface as an actionable message, not
    the raw 503 JSON."""
    import pytest
    slept = []
    async def create(): raise _nim_status_error(503)
    async def sleep(s): slept.append(s)

    with pytest.raises(ValueError) as e:
        await main._completion_with_retry(create, sleep=sleep)
    assert "overloaded" in str(e.value)
    assert "resubmit" in str(e.value)
    assert slept == [5, 15, 30]


async def test_completion_retry_passes_real_errors_through():
    """401/400 are not capacity problems; retrying hides a broken config."""
    import pytest
    async def create(): raise _nim_status_error(401)
    async def sleep(s): raise AssertionError("must not retry an auth error")

    with pytest.raises(Exception) as e:
        await main._completion_with_retry(create, sleep=sleep)
    assert getattr(e.value, "status_code", None) == 401


async def test_telegram_send_retry_absorbs_a_timeout_blip():
    """A single TimedOut on an outbound send must not surface: retry, then the
    task's status message gets through. This is the exact path that used to die
    as 'Internal error - task crashed: Timed out' the moment a /task was sent."""
    from telegram.error import TimedOut
    calls, slept = [], []
    async def send():
        calls.append(1)
        if len(calls) < 2:
            raise TimedOut()
        return "ok"
    async def sleep(s): slept.append(s)

    assert await main._telegram_send_with_retry(send, sleep=sleep) == "ok"
    assert slept == [1]   # one backoff, first configured delay


async def test_telegram_send_retry_exhausted_reraises():
    """A real Telegram outage (every attempt times out) must still surface, not
    be swallowed — the final attempt re-raises after the backoff is spent."""
    import pytest
    from telegram.error import TimedOut
    slept = []
    async def send(): raise TimedOut()
    async def sleep(s): slept.append(s)

    with pytest.raises(TimedOut):
        await main._telegram_send_with_retry(send, sleep=sleep)
    assert slept == list(main._SEND_RETRY_DELAYS_S)


async def test_telegram_send_retry_passes_non_network_errors_through():
    """A bad request (unauthorized chat, oversized message) is not a blip;
    retrying hides it. Only NetworkError/TimedOut should retry."""
    import pytest
    from telegram.error import BadRequest
    async def send(): raise BadRequest("chat not found")
    async def sleep(s): raise AssertionError("must not retry a BadRequest")

    with pytest.raises(BadRequest):
        await main._telegram_send_with_retry(send, sleep=sleep)


def test_clip_for_telegram_passes_short_messages_unchanged():
    assert main._clip_for_telegram("task complete") == "task complete"
    exactly_at_limit = "x" * main._TELEGRAM_CLIP_AT
    assert main._clip_for_telegram(exactly_at_limit) == exactly_at_limit


def test_clip_for_telegram_keeps_long_messages_under_the_hard_limit():
    """A full Gradle stacktrace must clip below Telegram's 4096-char cap,
    keep its head (where the actual error usually is), and say it was cut."""
    long = "gradle error line\n" * 1000
    clipped = main._clip_for_telegram(long)
    assert len(clipped) <= 4096
    assert clipped.endswith("...(truncated)")
    assert clipped.startswith("gradle error line")


def test_clip_for_telegram_closes_a_cut_pre_block():
    """Clipping mid-<pre> leaves an unclosed tag, and Telegram rejects the
    whole message with a parse error — the summary would vanish entirely."""
    long = "<pre>" + "M  file.txt  +1 -0\n" * 1000 + "</pre>"
    clipped = main._clip_for_telegram(long, html=True)
    assert len(clipped) <= 4096
    assert clipped.count("<pre>") == clipped.count("</pre>") == 1
    assert clipped.endswith("</pre>")


def test_clip_for_telegram_never_cuts_an_html_entity_in_half():
    """A half-written `&amp;` is itself a parse error."""
    long = "<pre>" + "&amp;" * 2000 + "</pre>"
    clipped = main._clip_for_telegram(long, html=True)
    assert "&am" not in clipped.replace("&amp;", "")


async def test_sender_uses_html_parse_mode_only_when_asked():
    class FakeBot:
        def __init__(self): self.calls = []
        async def send_message(self, **kw): self.calls.append(kw)

    bot = FakeBot()
    sender = main._make_sender(bot)
    await sender(7, "plain <not markup>")
    await sender(7, "<pre>table</pre>", html=True)
    assert "parse_mode" not in bot.calls[0]
    assert bot.calls[1]["parse_mode"] == "HTML"


def test_console_safe_output_is_pure_ascii():
    """Every except handler in run() reports through _console_safe. An
    attached Windows console is UTF-8 (PEP 528) and never raises; the hazard
    is a *redirected* stdout, which gets the locale's legacy codec — cp1252
    here, cp932 on a Japanese host. ASCII output is the one invariant that
    survives all of them, so pin that, not any single codec."""
    for nasty in ("❌ Forbidden: bot заблокирован", "плохой токен", "ok ascii",
                  "\udcff surrogate", "café", ""):
        main._console_safe(RuntimeError(nasty)).encode("ascii")  # must not raise


async def test_crash_reporter_still_notifies_on_an_unprintable_crash(monkeypatch):
    """A crash whose repr the console cannot encode must still reach the user.

    repr() does not escape non-ASCII, so `{exc!r}` is not safe just because it
    is a repr. The print sits inside a done-callback: a raise there is
    swallowed by asyncio's exception handler and the sender() after it never
    runs, so the user is never told the task died — the exact silent failure
    the callback exists to prevent.
    """
    def cp1252_console_print(*args, **kwargs):
        " ".join(str(a) for a in args).encode("cp1252")  # raises, like the console

    monkeypatch.setattr("builtins.print", cp1252_console_print)

    sent = []
    async def sender(chat_id, text):
        sent.append((chat_id, text))

    async def boom():
        raise RuntimeError("❌ Forbidden: bot заблокирован")

    t = asyncio.create_task(boom())
    try:
        await t
    except RuntimeError:
        pass

    main._make_crash_reporter(sender)(5)(t)   # must not raise
    await asyncio.sleep(0)                    # let the queued sender() run
    assert [c for c, _ in sent] == [5]


async def test_notify_restart_survives_unprintable_error(monkeypatch):
    """A chat error whose message can't be rendered by the console must not
    escape _notify_restart either.

    A redirected Hermes stdout (start.bat > log.txt, a service, a scheduler)
    gets the locale's legacy codec, cp1252 on this host. Under pytest, stdout
    is captured with a UTF-8-capable encoding, so simply calling
    _notify_restart with a non-ASCII exception message would pass here for
    the wrong reason even against unguarded code. To actually exercise the
    hazard, stand in for that redirected stream: monkeypatch the builtin
    print that _notify_restart's except handler calls with a fake that raises
    UnicodeEncodeError for any text cp1252 couldn't encode, exactly like the
    real redirected stdout would.
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
