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


async def test_sender_strips_markdown_from_a_plain_message():
    """Last line of defence: any plain-text path — a step report echoing engine
    prose, a crash report — is sent with no parse_mode, so markers would land
    literally on the operator's screen."""
    class FakeBot:
        def __init__(self): self.calls = []
        async def send_message(self, **kw): self.calls.append(kw)

    bot = FakeBot()
    sender = main._make_sender(bot)
    await sender(7, '> *"Jalankan testing untuk @myprofit"*')
    assert bot.calls[0]["text"] == '"Jalankan testing untuk @myprofit"'


async def test_sender_leaves_an_html_message_alone():
    """The change summary's <pre> table is deliberate markup; stripping it as
    if it were engine Markdown would destroy the alignment it exists for."""
    class FakeBot:
        def __init__(self): self.calls = []
        async def send_message(self, **kw): self.calls.append(kw)

    bot = FakeBot()
    sender = main._make_sender(bot)
    await sender(7, "<pre>M  a_b.txt  *</pre>", html=True)
    assert bot.calls[0]["text"] == "<pre>M  a_b.txt  *</pre>"


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


async def test_sender_drops_a_message_with_no_telegram_chat():
    """The web UI queues tasks with chat_id=0 meaning "no Telegram chat". The
    bridge notifies unconditionally, so without this guard the first send
    reaches Telegram as chat_id=0 and comes back BadRequest("Chat not found"),
    killing the whole task. 0 is safe as the sentinel: a real chat id is never
    0, and a group's id is a large *negative* number that must still send."""
    class FakeBot:
        def __init__(self): self.calls = []
        async def send_message(self, **kw): self.calls.append(kw)

    bot = FakeBot()
    sender = main._make_sender(bot)
    await sender(0, "Task 123 queued.")
    assert bot.calls == []

    # a real chat still sends, including a negative supergroup id
    await sender(7, "hello")
    await sender(-1001234567890, "group hello")
    assert [c["chat_id"] for c in bot.calls] == [7, -1001234567890]

async def test_chat_system_prompt_asks_for_the_voice_tag_only_when_smart(hermes_home, monkeypatch):
    """The instruction costs ~90 prompt tokens per turn — an operator with
    speech off must not pay for it."""
    from hermes import config, main, voice

    seen: list[str] = []

    class FakeCompletions:
        async def create(self, **kwargs):
            seen.append(kwargs["messages"][0]["content"])
            msg = type("M", (), {"content": "ok", "tool_calls": None})()
            return type("R", (), {"choices": [type("C", (), {"message": msg})()]})()

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(main, "AsyncOpenAI", FakeClient)
    secrets = config.Secrets(nvidia_api_key="nvapi-test")

    config.save_settings(config.Settings(tts_enabled=False))
    chat = main.build_nim_chat(config.load_settings(), secrets)
    await chat([{"role": "user", "content": "halo"}])
    assert voice.VOICE_TAG_OPEN not in seen[-1]

    config.save_settings(config.Settings(tts_enabled=True, tts_mode="smart"))
    chat = main.build_nim_chat(config.load_settings(), secrets)
    await chat([{"role": "user", "content": "halo"}])
    assert voice.VOICE_TAG_OPEN in seen[-1]

async def test_chat_stream_carries_the_same_instruction(hermes_home, monkeypatch):
    from hermes import config, main, voice

    seen: list[str] = []

    class FakeStream:
        def __aiter__(self):
            async def gen():
                delta = type("D", (), {"content": "hai", "tool_calls": None})()
                yield type("K", (), {"choices": [type("C", (), {"delta": delta})()],
                                     "usage": None})()
            return gen()

    class FakeCompletions:
        async def create(self, **kwargs):
            seen.append(kwargs["messages"][0]["content"])
            return FakeStream()

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(main, "AsyncOpenAI", FakeClient)
    config.save_settings(config.Settings(tts_enabled=True, tts_mode="smart"))
    chat = main.build_nim_chat(config.load_settings(),
                               config.Secrets(nvidia_api_key="nvapi-test"))
    async for _ in chat.stream([{"role": "user", "content": "halo"}]):
        pass
    assert voice.VOICE_TAG_OPEN in seen[-1]


class _StuckToolCall:
    """One tool call, reissued verbatim every round — the shape that used to
    burn all eight rounds and end the turn with an apology."""
    def __init__(self, call_id="call_1", name="recent_tasks", args="{}"):
        self.id = call_id
        self.type = "function"
        self.function = type("F", (), {"name": name, "arguments": args})()


class _StuckMessage:
    def __init__(self, tool_calls=None, content=None):
        self.content = content
        self.tool_calls = tool_calls

    def model_dump(self):
        return {"role": "assistant", "content": self.content, "tool_calls": []}


class _StuckCompletions:
    """Calls a tool for as long as it is offered one; answers in prose the
    moment the tools are withdrawn."""
    def __init__(self, calls):
        self._calls = calls

    async def create(self, **kwargs):
        self._calls.append(kwargs)
        msg = (_StuckMessage(tool_calls=[_StuckToolCall()]) if "tools" in kwargs
               else _StuckMessage(content="3 task terakhir berhenti di tahap build."))
        return type("R", (), {"choices": [type("C", (), {"message": msg})()]})()


class _StuckStream:
    """Streaming twin of _StuckCompletions."""
    def __init__(self, with_tools):
        self._with_tools = with_tools

    def __aiter__(self):
        async def gen():
            if self._with_tools:
                tcd = type("T", (), {
                    "index": 0, "id": "call_1",
                    "function": type("F", (), {"name": "recent_tasks",
                                               "arguments": "{}"})()})()
                delta = type("D", (), {"content": None, "tool_calls": [tcd]})()
            else:
                delta = type("D", (), {"content": "sudah dicek", "tool_calls": None})()
            yield type("K", (), {"choices": [type("C", (), {"delta": delta})()],
                                 "usage": None})()
        return gen()


async def test_chat_answers_on_the_last_round_instead_of_apologising(hermes_home, monkeypatch):
    """Hitting MAX_TOOL_ROUNDS must not throw the turn away.

    The cap bounds tool round-trips; it is not a reason to tell the user
    "terlalu banyak putaran alat" and discard every result already fetched. The
    last round runs tool-free, so the model can only answer in prose — and it
    answers from the tool output already in the message list.
    """
    from hermes import config, main

    calls: list[dict] = []
    dispatched: list[str] = []

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": _StuckCompletions(calls)})()

    async def dispatch(name, args):
        dispatched.append(name)
        return "[]"

    monkeypatch.setattr(main, "AsyncOpenAI", FakeClient)
    config.save_settings(config.Settings(tts_enabled=False))
    chat = main.build_nim_chat(config.load_settings(),
                               config.Secrets(nvidia_api_key="nvapi-test"))
    out = await chat([{"role": "user", "content": "kenapa task gagal"}],
                     tools=[{"type": "function",
                             "function": {"name": "recent_tasks", "parameters": {}}}],
                     dispatch=dispatch)

    assert out == "3 task terakhir berhenti di tahap build."
    assert "putaran alat" not in out
    assert len(calls) == main.MAX_TOOL_ROUNDS
    assert "tools" not in calls[-1]
    assert main.FINAL_ROUND_NUDGE in calls[-1]["messages"][-1]["content"]
    # Repeat guard: seven identical calls, one real dispatch.
    assert dispatched == ["recent_tasks"]


async def test_chat_stream_answers_on_the_last_round(hermes_home, monkeypatch):
    """Same defect on the path the operator watches fill: the SSE turn used to
    end by streaming the apology as if it were the answer."""
    from hermes import config, main

    calls: list[dict] = []

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return _StuckStream("tools" in kwargs)

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    async def dispatch(name, args):
        return "[]"

    monkeypatch.setattr(main, "AsyncOpenAI", FakeClient)
    config.save_settings(config.Settings(tts_enabled=False))
    chat = main.build_nim_chat(config.load_settings(),
                               config.Secrets(nvidia_api_key="nvapi-test"))
    text = ""
    async for kind, payload in chat.stream(
            [{"role": "user", "content": "kenapa task gagal"}],
            tools=[{"type": "function",
                    "function": {"name": "recent_tasks", "parameters": {}}}],
            dispatch=dispatch):
        if kind == "token":
            text += payload

    assert text == "sudah dicek"
    assert "putaran alat" not in text
    assert "tools" not in calls[-1]


async def test_chat_stream_retries_once_when_the_round_streams_nothing(hermes_home, monkeypatch):
    """The SSE path closes the turn on whatever it streamed, so a round that
    streamed nothing is exactly what renders as "(tidak ada balasan)"."""
    from hermes import config, main

    calls: list[dict] = []
    chunks = [None, "akhirnya jawab"]

    class OneChunkStream:
        def __init__(self, content):
            self._content = content

        def __aiter__(self):
            async def gen():
                delta = type("D", (), {"content": self._content, "tool_calls": None})()
                yield type("K", (), {"choices": [type("C", (), {"delta": delta})()],
                                     "usage": None})()
            return gen()

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return OneChunkStream(chunks.pop(0))

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(main, "AsyncOpenAI", FakeClient)
    config.save_settings(config.Settings(tts_enabled=False))
    chat = main.build_nim_chat(config.load_settings(),
                               config.Secrets(nvidia_api_key="nvapi-test"))
    text = ""
    async for kind, payload in chat.stream([{"role": "user", "content": "status"}]):
        if kind == "token":
            text += payload

    assert text == "akhirnya jawab"
    assert len(calls) == 2
    assert main.EMPTY_REPLY_NUDGE in calls[1]["messages"][-1]["content"]


async def test_chat_retries_once_when_the_reply_is_empty(hermes_home, monkeypatch):
    """An empty completion reaches the operator as "(tidak ada balasan)" and is
    persisted as an empty assistant turn. It is a provider hiccup, not an
    answer — nudge once rather than closing the turn on nothing."""
    from hermes import config, main

    calls: list[dict] = []
    replies = ["", "Task terakhir sukses."]

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return type("R", (), {"choices": [type("C", (), {
                "message": _StuckMessage(content=replies.pop(0))})()]})()

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(main, "AsyncOpenAI", FakeClient)
    config.save_settings(config.Settings(tts_enabled=False))
    chat = main.build_nim_chat(config.load_settings(),
                               config.Secrets(nvidia_api_key="nvapi-test"))
    out = await chat([{"role": "user", "content": "status"}],
                     tools=[{"type": "function",
                             "function": {"name": "recent_tasks", "parameters": {}}}],
                     dispatch=lambda *a: None)

    assert out == "Task terakhir sukses."
    assert len(calls) == 2
    assert main.EMPTY_REPLY_NUDGE in calls[1]["messages"][-1]["content"]


async def test_chat_treats_a_voice_tag_only_reply_as_empty(hermes_home, monkeypatch):
    """The <voice> opener is stripped before display, so a reply that is only a
    tag renders as nothing — same symptom as an empty completion, same fix."""
    from hermes import config, main, voice

    calls: list[dict] = []
    tag_only = f"{voice.VOICE_TAG_OPEN}Sebentar ya{voice.VOICE_TAG_CLOSE}"
    replies = [tag_only, "Ini jawabannya."]

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return type("R", (), {"choices": [type("C", (), {
                "message": _StuckMessage(content=replies.pop(0))})()]})()

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(main, "AsyncOpenAI", FakeClient)
    config.save_settings(config.Settings(tts_enabled=True, tts_mode="smart"))
    chat = main.build_nim_chat(config.load_settings(),
                               config.Secrets(nvidia_api_key="nvapi-test"))
    out = await chat([{"role": "user", "content": "status"}],
                     tools=[{"type": "function",
                             "function": {"name": "recent_tasks", "parameters": {}}}],
                     dispatch=lambda *a: None)

    assert out == "Ini jawabannya."
    assert len(calls) == 2


async def test_chat_stops_retrying_an_endlessly_empty_provider(hermes_home, monkeypatch):
    """One nudge tells a hiccup from a model that will never answer; past that
    the empty reply is reported honestly rather than looping."""
    from hermes import config, main

    calls: list[dict] = []

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return type("R", (), {"choices": [type("C", (), {
                "message": _StuckMessage(content="")})()]})()

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(main, "AsyncOpenAI", FakeClient)
    config.save_settings(config.Settings(tts_enabled=False))
    chat = main.build_nim_chat(config.load_settings(),
                               config.Secrets(nvidia_api_key="nvapi-test"))
    assert await chat([{"role": "user", "content": "status"}],
                      tools=[{"type": "function",
                              "function": {"name": "recent_tasks", "parameters": {}}}],
                      dispatch=lambda *a: None) == ""
    assert len(calls) == main.MAX_EMPTY_REPLY_ROUNDS + 1


class _FakeMessage:
    def __init__(self, content):
        self.content = content
        self.tool_calls = None


class _FakeCompletions:
    """Replays a scripted list of completion contents, recording the prompts."""
    def __init__(self, contents, seen):
        self._contents = list(contents)
        self._seen = seen

    async def create(self, **kwargs):
        self._seen.append(kwargs["messages"][-1]["content"])
        content = self._contents.pop(0)
        return type("R", (), {"choices": [type("C", (), {"message": _FakeMessage(content)})()]})()


class _FakeClient:
    def __init__(self, contents, seen):
        self.chat = type("Chat", (), {"completions": _FakeCompletions(contents, seen)})()


class _EmptyHub:
    async def list_tools(self):
        return []


class _RecordingCompletions:
    """Like _FakeCompletions but keeps the whole message list of every call."""
    def __init__(self, contents, calls):
        self._contents = list(contents)
        self._calls = calls

    async def create(self, **kwargs):
        self._calls.append(kwargs["messages"])
        content = self._contents.pop(0)
        return type("R", (), {"choices": [type("C", (), {"message": _FakeMessage(content)})()]})()


class _RecordingClient:
    def __init__(self, contents, calls):
        self.chat = type("Chat", (), {"completions": _RecordingCompletions(contents, calls)})()


async def test_planner_sends_the_project_context_in_one_system_message(hermes_home, monkeypatch):
    """Project facts ride inside the rules message, not a second system turn.

    A second system message made the configured endpoint drop the plan contract
    outright: measured against the real gateway, the same task planned 3/3 with
    one system message and 0/3 with two — answering with JavaScript, or with
    zero completion tokens, which surfaced as "planner returned empty output".
    """
    from hermes import config
    config.save_secrets(config.Secrets(nvidia_api_key="k", telegram_bot_token=""))
    calls = []
    plan = '{"steps":[{"type":"code","prompt":"perbaiki"}]}'
    monkeypatch.setattr(main, "AsyncOpenAI",
                        lambda **kw: _RecordingClient([plan], calls))

    planner = main.build_nim_planner(config.load_settings(), config.load_secrets(), _EmptyHub())
    await planner("perbaiki checkout", "# Project context\nTarget: myprofit-v3.")

    msgs = calls[0]
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert "Target: myprofit-v3." in msgs[0]["content"]
    assert "Lail Hermes' planner" in msgs[0]["content"]


async def test_planner_nudge_is_not_a_second_system_message(hermes_home, monkeypatch):
    """Same defect, retry path: the nudge exists to recover from an empty
    answer, so it must not use the one message shape that causes them."""
    from hermes import config
    config.save_secrets(config.Secrets(nvidia_api_key="k", telegram_bot_token=""))
    calls = []
    plan = '{"steps":[{"type":"code","prompt":"perbaiki"}]}'
    monkeypatch.setattr(main, "AsyncOpenAI",
                        lambda **kw: _RecordingClient(["", plan], calls))

    planner = main.build_nim_planner(config.load_settings(), config.load_secrets(), _EmptyHub())
    await planner("perbaiki checkout", "# Project context\nTarget: myprofit-v3.")

    assert [m["role"] for m in calls[1]].count("system") == 1
    assert "kosong" in calls[1][-1]["content"]


async def test_planner_nudges_once_when_the_provider_answers_with_nothing(hermes_home, monkeypatch):
    """An empty completion is a provider hiccup, not a plan. It failed two real
    tasks with 'no JSON object in planner output' and nothing to show."""
    from hermes import config
    config.save_secrets(config.Secrets(nvidia_api_key="k", telegram_bot_token=""))
    seen = []
    plan = '{"steps":[{"type":"code","prompt":"perbaiki"}]}'
    monkeypatch.setattr(main, "AsyncOpenAI",
                        lambda **kw: _FakeClient(["", plan], seen))

    planner = main.build_nim_planner(config.load_settings(), config.load_secrets(), _EmptyHub())
    assert await planner("perbaiki checkout") == plan
    assert len(seen) == 2 and "kosong" in seen[1]


async def test_planner_stops_nudging_and_reports_the_empty_answer(hermes_home, monkeypatch):
    """A provider that keeps answering with nothing must not spin: the caller
    reports the empty output honestly rather than burning every round."""
    from hermes import config
    config.save_secrets(config.Secrets(nvidia_api_key="k", telegram_bot_token=""))
    seen = []
    monkeypatch.setattr(main, "AsyncOpenAI",
                        lambda **kw: _FakeClient(["", "", ""], seen))

    planner = main.build_nim_planner(config.load_settings(), config.load_secrets(), _EmptyHub())
    assert await planner("perbaiki checkout") == ""
    assert len(seen) == main.MAX_EMPTY_PLANNER_ROUNDS + 1


async def test_propose_mcp_config_returns_none_without_a_key(hermes_home):
    """No API key is a normal state — the package path degrades to convention
    only, it does not raise."""
    from hermes import main
    propose = main.build_propose_mcp_config()
    assert await propose("readme", ["error"]) is None


def test_fetch_readme_url_is_the_npm_registry():
    from hermes import main
    assert main.readme_url("@cocal/x") == "https://registry.npmjs.org/@cocal%2fx"
    assert main.readme_url("pkg") == "https://registry.npmjs.org/pkg"
