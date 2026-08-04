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


def test_is_auth_error_recognises_401_and_403():
    assert mi.is_auth_error("HTTPStatusError: 401 Unauthorized") is True
    assert mi.is_auth_error("HTTPStatusError: 403 Forbidden") is True
    assert mi.is_auth_error("ConnectionError: 404 not found") is False


async def test_oauth_branch_opens_a_login_and_retries_after_the_callback():
    """The server refuses until it is authorised; the run must open a login,
    wait for the callback, and then succeed on the retry."""
    from hermes import mcp_oauth

    state = {"authorised": False}

    class AuthSession:
        def __init__(self, srv, auth=None):
            self.srv = srv
            self.auth = auth

        async def list_tools(self):
            if self.auth is None and not state["authorised"]:
                raise PermissionError("401 Unauthorized")
            return [{"name": "search", "description": "", "input_schema": {}}]

        async def close(self):
            return None

    opened = []

    async def open_url(url):
        opened.append(url)
        # Standing in for the operator finishing the login in a browser.
        state["authorised"] = True

    async def fake_oauth(srv, session_factory, **kw):
        await kw["emit"]({"kind": "login", "url": "https://idp/authorize"})
        await kw["open_url"]("https://idp/authorize")
        return await mi.probe(srv, session_factory, auth="TOKEN")

    events, emit = _recorder()
    res = await mi.integrate("https://x.dev/mcp", emit=emit,
                             ask_secret=_never_asked, open_url=open_url,
                             session_factory=lambda s, auth=None: AuthSession(s, auth),
                             oauth_runner=fake_oauth,
                             pending=mcp_oauth.PendingAuth(),
                             redirect_uri="http://127.0.0.1:8799/api/mcp/oauth/callback")

    assert res.ok is True
    assert opened == ["https://idp/authorize"]
    assert res.server.oauth is True
    assert any(e["kind"] == "login" for e in events)


async def test_secret_branch_asks_then_retries_with_the_header():
    """No OAuth metadata, so the run must ask for a key and carry it as a
    header on the next attempt rather than starting over."""
    asked = []

    class KeySession:
        def __init__(self, srv, auth=None):
            self.srv = srv

        async def list_tools(self):
            if self.srv.headers.get("Authorization") != "Bearer K":
                raise PermissionError("401 Unauthorized")
            return [{"name": "t", "description": "", "input_schema": {}}]

        async def close(self):
            return None

    async def ask_secret(name, hint):
        asked.append(name)
        return "Bearer K"

    async def no_oauth(srv, session_factory, **kw):
        from mcp.client.auth import OAuthRegistrationError
        raise OAuthRegistrationError("server has no OAuth metadata")

    events, emit = _recorder()
    res = await mi.integrate("https://x.dev/mcp", emit=emit,
                             ask_secret=ask_secret, open_url=_never_opened,
                             session_factory=lambda s, auth=None: KeySession(s),
                             oauth_runner=no_oauth)

    assert res.ok is True
    assert asked == ["Authorization"]
    assert res.server.headers["Authorization"] == "Bearer K"
    assert any(e["kind"] == "need_secret" for e in events)


async def test_a_declined_secret_does_not_end_the_run():
    """Declining the key on one candidate must still let the next candidate be
    tried — a refusal is input like any other failure."""
    async def ask_secret(name, hint):
        return ""

    async def no_oauth(srv, session_factory, **kw):
        from mcp.client.auth import OAuthRegistrationError
        raise OAuthRegistrationError("no metadata")

    class Locked:
        def __init__(self, srv, auth=None): self.srv = srv
        async def list_tools(self): raise PermissionError("401 Unauthorized")
        async def close(self): return None

    events, emit = _recorder()
    res = await mi.integrate("https://x.dev", emit=emit, ask_secret=ask_secret,
                             open_url=_never_opened,
                             session_factory=lambda s, auth=None: Locked(s),
                             oauth_runner=no_oauth)
    assert res.ok is False
    assert len(res.history) == 6      # every candidate still attempted


async def test_package_link_tries_npx_by_convention_first():
    seen = []

    class PkgSession:
        def __init__(self, srv, auth=None):
            self.srv = srv
            seen.append((srv.command, tuple(srv.args)))

        async def list_tools(self):
            return [{"name": "read", "description": "", "input_schema": {}}]

        async def close(self): return None

    events, emit = _recorder()
    res = await mi.integrate("@cocal/google-calendar-mcp", emit=emit,
                             ask_secret=_never_asked, open_url=_never_opened,
                             session_factory=lambda s, auth=None: PkgSession(s))
    assert res.ok is True
    assert res.server.type == "stdio"
    assert seen[0] == ("npx", ("-y", "@cocal/google-calendar-mcp"))


async def test_package_failure_asks_the_model_and_retries():
    """Convention fails, the model proposes args and env, and the retry works."""
    class PkgSession:
        def __init__(self, srv, auth=None): self.srv = srv

        async def list_tools(self):
            if self.srv.args == ["-y", "pkg", "--stdio"]:
                return [{"name": "t", "description": "", "input_schema": {}}]
            raise RuntimeError("missing required flag --stdio")

        async def close(self): return None

    async def propose(readme, errors):
        assert "--stdio" in readme
        return {"command": "npx", "args": ["-y", "pkg", "--stdio"], "env": {}}

    async def read_readme(pkg):
        return "run it with --stdio"

    events, emit = _recorder()
    res = await mi.integrate("pkg", emit=emit, ask_secret=_never_asked,
                             open_url=_never_opened,
                             session_factory=lambda s, auth=None: PkgSession(s),
                             propose_config=propose, read_readme=read_readme)
    assert res.ok is True
    assert res.server.args == ["-y", "pkg", "--stdio"]


async def test_a_proposal_naming_an_empty_env_asks_the_operator():
    asked = []

    class PkgSession:
        def __init__(self, srv, auth=None): self.srv = srv

        async def list_tools(self):
            if self.srv.env.get("API_KEY") == "SECRET":
                return [{"name": "t", "description": "", "input_schema": {}}]
            raise RuntimeError("API_KEY is not set")

        async def close(self): return None

    async def propose(readme, errors):
        return {"command": "npx", "args": ["-y", "pkg"], "env": {"API_KEY": ""}}

    async def ask_secret(name, hint):
        asked.append(name)
        return "SECRET"

    events, emit = _recorder()
    res = await mi.integrate("pkg", emit=emit, ask_secret=ask_secret,
                             open_url=_never_opened,
                             session_factory=lambda s, auth=None: PkgSession(s),
                             propose_config=propose,
                             read_readme=lambda p: _async_value(""))
    assert res.ok is True and asked == ["API_KEY"]


async def _async_value(v):
    return v


async def test_a_proposal_that_repeats_the_same_failure_stops_the_run():
    """Never stopping must not mean looping on the same wall."""
    class PkgSession:
        def __init__(self, srv, auth=None): self.srv = srv
        async def list_tools(self): raise RuntimeError("missing flag --stdio")
        async def close(self): return None

    proposals = []

    async def propose(readme, errors):
        proposals.append(errors)
        return {"command": "npx", "args": ["-y", "pkg"], "env": {}}

    events, emit = _recorder()
    res = await mi.integrate("pkg", emit=emit, ask_secret=_never_asked,
                             open_url=_never_opened,
                             session_factory=lambda s, auth=None: PkgSession(s),
                             propose_config=propose,
                             read_readme=lambda p: _async_value(""))
    assert res.ok is False and res.reason == "circles"
    # the model was consulted, and the accumulated errors were handed to it
    assert proposals and len(proposals[-1]) >= 1


async def test_the_model_never_receives_a_secret():
    captured = {}

    class PkgSession:
        def __init__(self, srv, auth=None): self.srv = srv
        async def list_tools(self): raise RuntimeError("bad token SECRET-VALUE")
        async def close(self): return None

    async def propose(readme, errors):
        captured["errors"] = errors
        return None

    events, emit = _recorder()
    await mi.integrate("pkg", emit=emit, ask_secret=_never_asked,
                       open_url=_never_opened,
                       session_factory=lambda s, auth=None: PkgSession(s),
                       propose_config=propose, secrets={"SECRET-VALUE"},
                       read_readme=lambda p: _async_value(""))
    assert all("SECRET-VALUE" not in e for e in captured["errors"])
