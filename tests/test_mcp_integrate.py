import pytest

from hermes import mcp_integrate as mi


def test_classify_remote_url():
    link = mi.classify("https://mcp.notion.com/mcp")
    assert link.kind == "remote" and link.url == "https://mcp.notion.com/mcp"


def test_classify_github_and_npm_links_are_packages():
    assert mi.classify("https://github.com/owner/repo").kind == "package"
    assert mi.classify("https://www.npmjs.com/package/@cocal/x").kind == "package"


def test_classify_bare_package_name():
    link = mi.classify("@cocal/google-calendar-mcp")
    assert link.kind == "package" and link.package == "@cocal/google-calendar-mcp"


def test_classify_rejects_nonsense_with_a_readable_message():
    with pytest.raises(ValueError) as e:
        mi.classify("not a link at all!!")
    assert "link" in str(e.value).lower()


def test_remote_candidates_leaves_an_explicit_endpoint_alone():
    """A URL that already names its endpoint is used as-is; guessing extra
    paths against it only produces 404s in the log."""
    assert mi.remote_candidates("https://x.dev/mcp") == ["https://x.dev/mcp"]
    assert mi.remote_candidates("https://x.dev/sse") == ["https://x.dev/sse"]


def test_remote_candidates_expands_a_bare_host():
    assert mi.remote_candidates("https://x.dev") == [
        "https://x.dev", "https://x.dev/mcp", "https://x.dev/sse"]


def test_remote_candidates_does_not_double_a_trailing_slash():
    assert mi.remote_candidates("https://x.dev/") == [
        "https://x.dev", "https://x.dev/mcp", "https://x.dev/sse"]


def test_derive_name_from_host_and_package():
    assert mi.derive_name(mi.classify("https://mcp.notion.com/mcp"), set()) == "notion"
    assert mi.derive_name(mi.classify("@cocal/google-calendar-mcp"),
                          set()) == "google-calendar"


def test_derive_name_dedupes_against_taken_names():
    assert mi.derive_name(mi.classify("https://mcp.notion.com/mcp"),
                          {"notion"}) == "notion-2"


from hermes.config import McpServer


class FakeSession:
    """Stands in for RealMcpSession. `script` maps a url to the outcome."""

    def __init__(self, srv, auth=None, script=None):
        self.srv = srv
        self.script = script or {}

    async def list_tools(self):
        outcome = self.script.get(self.srv.url, "fail")
        if outcome == "ok":
            return [{"name": "search", "description": "", "input_schema": {}}]
        raise ConnectionError(f"404 not found at {self.srv.url}")

    async def close(self):
        return None


def _factory(script):
    return lambda srv, auth=None: FakeSession(srv, auth, script)


def _recorder():
    events = []
    async def emit(ev):
        events.append(ev)
    return events, emit


async def _never_asked(name, hint):
    raise AssertionError("ask_secret must not be called in this test")


async def _never_opened(url):
    raise AssertionError("open_url must not be called in this test")


async def test_a_failing_candidate_does_not_end_the_run():
    """The first endpoint 404s and the second works — the run must reach the
    second, which is the whole point of treating a failure as input."""
    events, emit = _recorder()
    script = {"https://x.dev/mcp": "ok"}

    res = await mi.integrate("https://x.dev", emit=emit,
                             ask_secret=_never_asked, open_url=_never_opened,
                             session_factory=_factory(script))

    assert res.ok is True and res.reason == "success"
    assert res.server.url == "https://x.dev/mcp"
    assert res.server.transport == "streamable-http"
    assert res.server.type == "http"
    # the failed first candidate is still in the history, not swallowed
    assert any(not a.ok for a in res.history)
    assert [e["kind"] for e in events][-1] == "done"


async def test_streamable_http_is_tried_before_sse():
    events, emit = _recorder()
    res = await mi.integrate("https://x.dev/mcp", emit=emit,
                             ask_secret=_never_asked, open_url=_never_opened,
                             session_factory=_factory({"https://x.dev/mcp": "ok"}))
    assert res.server.transport == "streamable-http"
    assert res.history[0].action.startswith("streamable-http")


async def test_every_candidate_fails_and_the_run_reports_the_history():
    events, emit = _recorder()
    res = await mi.integrate("https://x.dev", emit=emit,
                             ask_secret=_never_asked, open_url=_never_opened,
                             session_factory=_factory({}))
    assert res.ok is False
    assert res.reason in ("circles", "rounds")
    # 3 candidates x 2 transports, all recorded
    assert len(res.history) == 6
    assert all(not a.ok for a in res.history)


async def test_round_cap_stops_the_run():
    events, emit = _recorder()
    res = await mi.integrate("https://x.dev", emit=emit,
                             ask_secret=_never_asked, open_url=_never_opened,
                             session_factory=_factory({}), max_rounds=2)
    assert res.ok is False and res.reason == "rounds"
    assert len(res.history) == 2


async def test_deadline_stops_the_run():
    events, emit = _recorder()
    clock = iter([0.0, 0.0, 1000.0, 1000.0, 1000.0])

    res = await mi.integrate("https://x.dev", emit=emit,
                             ask_secret=_never_asked, open_url=_never_opened,
                             session_factory=_factory({}),
                             now=lambda: next(clock), deadline_s=600.0)
    assert res.ok is False and res.reason == "deadline"


async def test_a_transient_error_sleeps_and_retries_without_spending_a_round():
    slept = []

    async def fake_sleep(s):
        slept.append(s)

    calls = {"n": 0}

    class FlakySession:
        def __init__(self, srv, auth=None):
            self.srv = srv

        async def list_tools(self):
            calls["n"] += 1
            if calls["n"] == 1:
                raise TimeoutError("connection timed out")
            return [{"name": "t", "description": "", "input_schema": {}}]

        async def close(self):
            return None

    events, emit = _recorder()
    res = await mi.integrate("https://x.dev/mcp", emit=emit,
                             ask_secret=_never_asked, open_url=_never_opened,
                             session_factory=lambda srv, auth=None: FlakySession(srv),
                             sleep=fake_sleep)
    assert res.ok is True
    assert slept, "a transient failure must back off, not burn a round"


async def test_probe_always_closes_the_session():
    """Ten rounds without this is ten orphaned npx subprocesses."""
    closed = []

    class TrackedSession:
        def __init__(self, srv, auth=None): self.srv = srv
        async def list_tools(self): raise ConnectionError("nope")
        async def close(self): closed.append(True)

    srv = McpServer(name="x", type="http", url="https://x.dev/mcp",
                    transport="streamable-http")
    ok, err, tools = await mi.probe(srv, lambda s, auth=None: TrackedSession(s))
    assert ok is False and closed == [True]
