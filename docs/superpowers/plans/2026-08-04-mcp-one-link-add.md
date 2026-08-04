# Add an MCP Server From One Link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator paste one link — a remote MCP URL or an npm/GitHub package — and have Hermes probe, authenticate, and register a working MCP server without filling in a form.

**Architecture:** A pure ladder module (`hermes/mcp_integrate.py`) receives every outward interaction as an injected callback, so the whole retry loop is testable with no network, browser, or model. `hermes/mcp_oauth.py` bridges the MCP SDK's inline `(code, state)` await to an HTTP callback that arrives minutes later. `hermes/mcp_hub.py` grows a third transport. `hermes/web_ui.py` adds five thin endpoints and three chat tools that all delegate to the ladder.

**Tech Stack:** Python 3.11, FastAPI, pytest (`asyncio_mode = "auto"`), `mcp` SDK 1.29.0, httpx, React + esbuild.

## Global Constraints

- **No new Python or npm dependency.** The `mcp>=1.0,<2` pin in `pyproject.toml` stays; 1.29.0 is installed and has everything needed.
- **Branch:** `feat/mcp-one-link-add`. Commit after every task.
- **Existing suites must stay green:** 609 Python tests, 74 web tests. Run `python -m pytest -q` and `npm --prefix web test` before each commit.
- **Windows/Git Bash:** run `pytest` from `E:/lail-hermes-agent`. Do not use PowerShell here-strings in Bash.
- **Comment style:** this codebase explains *why*, not *what*. Every non-obvious decision gets a comment naming the reason. Match the density of `hermes/mcp_hub.py` and `hermes/git_status.py`.
- **Indonesian for operator-facing strings**, English for code, comments, and commits — the convention already in `CHAT_TOOLS` and `web_ui.py`.
- **`emit` events are dicts** with a `"kind"` key. The five kinds: `attempt`, `login`, `need_secret`, `round`, `done`.
- **No secret ever reaches the model.** The `propose_config` prompt carries README text and error text only.
- **Round budget:** 10 rounds, 600-second deadline, 15-second per-probe timeout. Time spent awaiting a human does not count against the deadline.

---

## File Structure

| File | Responsibility |
|---|---|
| `hermes/config.py` (modify) | `McpServer` gains `transport`, `headers`, `oauth` |
| `hermes/mcp_hub.py` (modify) | three transports; forward `headers` and `auth` |
| `hermes/mcp_oauth.py` (create) | `FileTokenStorage` + pending-authorization registry |
| `hermes/mcp_integrate.py` (create) | link classification, candidates, the round loop |
| `hermes/web_ui.py` (modify) | integrate endpoints, OAuth callback, three chat tools |
| `hermes/main.py` (modify) | inject the real `propose_config` (model call) |
| `web/src/api/types.ts` (modify) | `McpServer` new fields; integrate run types |
| `web/src/pages/ConfigMcp.tsx` (modify) | link input, Integrate button, live log, popup |
| `tests/test_mcp_oauth.py` (create) | token storage + pending registry |
| `tests/test_mcp_integrate.py` (create) | the ladder, end to end, no I/O |
| `tests/test_mcp_hub.py` (modify) | transport selection and passthrough |
| `tests/test_web_ui.py` (modify) | endpoints, callback, chat tools |

---

### Task 1: `McpServer` gains transport, headers, and oauth

**Files:**
- Modify: `hermes/config.py:17-24`
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `McpServer(name, type, command, args, url, env, enabled, transport, headers, oauth)` where `transport: Literal["", "streamable-http", "sse"] = ""`, `headers: dict[str, str] = {}`, `oauth: bool = False`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_config.py`:

```python
def test_mcp_server_defaults_keep_old_configs_parsing():
    """Every new field is defaulted, so a config written before this change
    still loads — there is no migration step."""
    s = config.Settings.model_validate_json(
        '{"mcp_servers": [{"name": "pc", "type": "stdio", "command": "npx"}]}')
    srv = s.mcp_servers[0]
    assert srv.transport == ""
    assert srv.headers == {}
    assert srv.oauth is False


def test_mcp_server_accepts_new_fields():
    srv = config.McpServer(name="notion", type="http",
                           url="https://mcp.notion.com/mcp",
                           transport="streamable-http",
                           headers={"X-Api-Key": "k"}, oauth=True)
    assert srv.transport == "streamable-http"
    assert srv.headers["X-Api-Key"] == "k"
    assert srv.oauth is True


def test_mcp_server_rejects_unknown_transport():
    import pytest
    with pytest.raises(Exception):
        config.McpServer(name="x", type="http", transport="carrier-pigeon")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_config.py -q -k mcp_server`
Expected: FAIL — `AttributeError` / `ValidationError` on `transport`.

- [ ] **Step 3: Write minimal implementation**

In `hermes/config.py`, replace the `McpServer` class body:

```python
class McpServer(BaseModel):
    name: str
    type: Literal["stdio", "http"]
    command: str = ""
    args: list[str] = Field(default_factory=list)
    url: str = ""
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    # "" means the transport has not been probed yet, which is how every
    # config written before the one-link flow reads — those keep today's
    # behaviour (legacy SSE) instead of silently changing protocol.
    transport: Literal["", "streamable-http", "sse"] = ""
    # HTTP headers for a server that wants a manual API key. Deliberately not
    # `env`: env is a stdio process environment, a header is HTTP. Merging the
    # two would send the key to the wrong place for half the servers.
    headers: dict[str, str] = Field(default_factory=dict)
    # This server's session must attach an OAuthClientProvider. The tokens
    # themselves live outside the settings file — see hermes/mcp_oauth.py.
    oauth: bool = False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_config.py -q && python -m pytest -q`
Expected: PASS, and the full suite still reports 609+ passed.

- [ ] **Step 5: Commit**

```bash
git add hermes/config.py tests/test_config.py
git commit -m "feat: give an MCP server a transport, headers, and an oauth flag"
```

---

### Task 2: Three transports in the hub

**Files:**
- Modify: `hermes/mcp_hub.py:95-130` (`RealMcpSession._ensure`)
- Test: `tests/test_mcp_hub.py`

**Interfaces:**
- Consumes: `McpServer.transport`, `.headers`, `.oauth` from Task 1.
- Produces: `RealMcpSession(srv, auth=None)` — an optional second constructor argument carrying an `httpx.Auth`. `mcp_hub.transport_for(srv) -> str` returns the transport name a server should use.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_mcp_hub.py`:

```python
def test_transport_for_defaults_to_sse_for_legacy_configs():
    """A config saved before the transport field existed must keep working
    exactly as it did — legacy SSE, not a silent protocol change."""
    srv = McpServer(name="x", type="http", url="https://x/sse")
    assert mcp_hub.transport_for(srv) == "sse"


def test_transport_for_honours_an_explicit_choice():
    srv = McpServer(name="x", type="http", url="https://x/mcp",
                    transport="streamable-http")
    assert mcp_hub.transport_for(srv) == "streamable-http"


def test_transport_for_stdio_is_stdio():
    srv = McpServer(name="x", type="stdio", command="npx")
    assert mcp_hub.transport_for(srv) == "stdio"


async def test_real_session_passes_headers_and_auth_to_streamable_http(monkeypatch):
    seen = {}

    class FakeStream:
        async def __aenter__(self): return ("read", "write", None)
        async def __aexit__(self, *a): return False

    def fake_streamable(url, headers=None, auth=None, **kw):
        seen.update(url=url, headers=headers, auth=auth)
        return FakeStream()

    monkeypatch.setattr("mcp.client.streamable_http.streamablehttp_client",
                        fake_streamable)

    class FakeSession:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def initialize(self): return None

    monkeypatch.setattr("mcp.ClientSession", FakeSession)

    srv = McpServer(name="n", type="http", url="https://x/mcp",
                    transport="streamable-http", headers={"X-Key": "v"})
    sess = mcp_hub.RealMcpSession(srv, auth="AUTH-OBJ")
    await sess._ensure()

    assert seen["url"] == "https://x/mcp"
    assert seen["headers"] == {"X-Key": "v"}
    assert seen["auth"] == "AUTH-OBJ"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_mcp_hub.py -q -k "transport_for or headers_and_auth"`
Expected: FAIL — `mcp_hub has no attribute 'transport_for'`.

- [ ] **Step 3: Write minimal implementation**

In `hermes/mcp_hub.py`, add above `RealMcpSession`:

```python
def transport_for(srv: McpServer) -> str:
    """Which client transport this server speaks.

    An empty `transport` means the config predates the one-link flow, so it
    keeps the legacy SSE behaviour it was written under. Changing that default
    would silently re-protocol every server already in someone's settings.
    """
    if srv.type == "stdio":
        return "stdio"
    return srv.transport or "sse"
```

Replace `RealMcpSession.__init__` and the transport branch in `_ensure`:

```python
    def __init__(self, srv: McpServer, auth=None):
        self.srv = srv
        # An httpx.Auth — in practice the SDK's OAuthClientProvider, which is
        # one. Passed in rather than built here so this class keeps knowing
        # nothing about token storage or browsers.
        self.auth = auth
        self._stack = None
        self._session = None
```

```python
            if self.srv.type == "stdio":
                from mcp.client.stdio import stdio_client
                params = StdioServerParameters(
                    command=self.srv.command, args=self.srv.args,
                    env={**os.environ, **self.srv.env})
                read, write = await stack.enter_async_context(stdio_client(params))
            elif transport_for(self.srv) == "streamable-http":
                from mcp.client.streamable_http import streamablehttp_client
                # Three values, not two: the third is a session-id getter this
                # client does not need.
                read, write, _ = await stack.enter_async_context(
                    streamablehttp_client(self.srv.url,
                                          headers=self.srv.headers or None,
                                          auth=self.auth))
            else:
                from mcp.client.sse import sse_client
                read, write = await stack.enter_async_context(
                    sse_client(self.srv.url, headers=self.srv.headers or None,
                               auth=self.auth))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_mcp_hub.py -q && python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes/mcp_hub.py tests/test_mcp_hub.py
git commit -m "feat: speak streamable HTTP, and carry headers and auth to a remote server"
```

---

### Task 3: OAuth token storage and the pending-authorization registry

**Files:**
- Create: `hermes/mcp_oauth.py`
- Test: `tests/test_mcp_oauth.py`

**Interfaces:**
- Consumes: `paths.config_dir()`.
- Produces:
  - `FileTokenStorage(name: str)` with async `get_tokens()`, `set_tokens(t)`, `get_client_info()`, `set_client_info(info)`.
  - `PendingAuth` registry: `registry.start() -> str` (returns a `wait_id`), `await registry.wait(wait_id) -> tuple[str, str | None]`, `registry.resolve(state, code) -> bool`, `registry.set_state(wait_id, state)`, `registry.cancel(wait_id)`.
  - `token_dir() -> Path`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_mcp_oauth.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_mcp_oauth.py -q`
Expected: FAIL — `ModuleNotFoundError: hermes.mcp_oauth`.

- [ ] **Step 3: Write minimal implementation**

Create `hermes/mcp_oauth.py`:

```python
"""The two things OAuth needs that this codebase does not already have.

The MCP SDK's OAuthClientProvider awaits a `(code, state)` tuple inline, but
that tuple arrives minutes later on a completely different HTTP request — the
provider redirected a browser away and something has to catch the return. That
mismatch is what PendingAuth bridges.

FileTokenStorage keeps tokens out of config.yaml on purpose: GET /api/settings
returns the whole settings object to the browser on every page load, so a
refresh token stored there would be shipped to the front-end every time.
"""
from __future__ import annotations
import asyncio
import itertools
import json
from pathlib import Path

from . import paths


def token_dir() -> Path:
    return paths.config_dir() / "mcp_tokens"


def _safe(name: str) -> str:
    # A server name reaches this from a pasted link, so it must not be able to
    # climb out of the token directory.
    return "".join(c for c in name if c.isalnum() or c in "-_") or "server"


class FileTokenStorage:
    """The SDK's TokenStorage protocol, one JSON file per server."""

    def __init__(self, name: str) -> None:
        self.name = _safe(name)

    def _path(self, kind: str) -> Path:
        suffix = "" if kind == "tokens" else "-client"
        return token_dir() / f"{self.name}{suffix}.json"

    async def _read(self, kind: str, model):
        p = self._path(kind)
        if not p.exists():
            return None
        try:
            return model.model_validate_json(p.read_text(encoding="utf-8"))
        except Exception:
            # A corrupt or half-written file must read as "not authorised yet",
            # which re-runs the flow, rather than crashing every connect.
            return None

    async def _write(self, kind: str, obj) -> None:
        token_dir().mkdir(parents=True, exist_ok=True)
        self._path(kind).write_text(obj.model_dump_json(), encoding="utf-8")

    async def get_tokens(self):
        from mcp.shared.auth import OAuthToken
        return await self._read("tokens", OAuthToken)

    async def set_tokens(self, tokens) -> None:
        await self._write("tokens", tokens)

    async def get_client_info(self):
        from mcp.shared.auth import OAuthClientInformationFull
        return await self._read("client", OAuthClientInformationFull)

    async def set_client_info(self, client_info) -> None:
        await self._write("client", client_info)


class PendingAuth:
    """Authorizations waiting for a browser to come back.

    Single process, single event loop, so a dict is enough — the same reasoning
    as PendingStore in pending_actions.py.
    """

    def __init__(self) -> None:
        self._futures: dict[str, asyncio.Future] = {}
        self._states: dict[str, str] = {}
        self._counter = itertools.count(1)

    def start(self) -> str:
        wait_id = f"a{next(self._counter)}"
        self._futures[wait_id] = asyncio.get_event_loop().create_future()
        return wait_id

    def set_state(self, wait_id: str, state: str) -> None:
        self._states[wait_id] = state

    def authorize_url_state(self, wait_id: str) -> str:
        return self._states.get(wait_id, "")

    def resolve(self, state: str, code: str) -> bool:
        """True when `state` matched a run that is currently waiting.

        A mismatch is answered False and changes nothing — this is what stops
        anything else on this machine from injecting an authorization code.
        """
        for wait_id, s in self._states.items():
            if s and s == state:
                fut = self._futures.get(wait_id)
                if fut is not None and not fut.done():
                    fut.set_result((code, state))
                    return True
        return False

    async def wait(self, wait_id: str, timeout_s: float = 300.0):
        fut = self._futures[wait_id]
        try:
            return await asyncio.wait_for(fut, timeout_s)
        finally:
            self.cancel(wait_id)

    def cancel(self, wait_id: str) -> None:
        fut = self._futures.pop(wait_id, None)
        self._states.pop(wait_id, None)
        if fut is not None and not fut.done():
            fut.cancel()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_mcp_oauth.py -q && python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes/mcp_oauth.py tests/test_mcp_oauth.py
git commit -m "feat: store MCP OAuth tokens outside the settings file, and park authorizations"
```

---

### Task 4: Link classification, candidates, and name derivation

**Files:**
- Create: `hermes/mcp_integrate.py`
- Test: `tests/test_mcp_integrate.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Link` dataclass: `.kind` (`"remote"` | `"package"`), `.url`, `.package`.
  - `classify(link: str) -> Link` — raises `ValueError` with an operator-readable message.
  - `remote_candidates(url: str) -> list[str]`
  - `TRANSPORTS = ("streamable-http", "sse")`
  - `derive_name(link: Link, taken) -> str`

- [ ] **Step 1: Write the failing test**

Create `tests/test_mcp_integrate.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_mcp_integrate.py -q`
Expected: FAIL — `ModuleNotFoundError: hermes.mcp_integrate`.

- [ ] **Step 3: Write minimal implementation**

Create `hermes/mcp_integrate.py`:

```python
"""Turn one pasted link into a working MCP server.

Adding a server by hand means already knowing the package name, its arguments,
and which environment variables it reads. This module works those out instead:
it probes the link, tries the transports in order, runs OAuth when the server
asks for it, and pauses for an API key when it asks for that.

Everything that reaches outside — progress, a question for the operator, a
browser — arrives as an injected callback, so the whole ladder runs in a test
with no network, no browser, and no model.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

TRANSPORTS = ("streamable-http", "sse")

# A URL that already names its MCP endpoint. Guessing further paths against one
# of these only fills the log with 404s.
_EXPLICIT_ENDPOINT = re.compile(r"/(mcp|sse)/?$", re.I)

_PACKAGE_HOSTS = {"github.com", "www.github.com",
                  "npmjs.com", "www.npmjs.com"}

# npm package name: optional @scope, then the name.
_BARE_PACKAGE = re.compile(r"^(@[a-z0-9][\w.-]*/)?[a-z0-9][\w.-]*$", re.I)


@dataclass
class Link:
    kind: str            # "remote" | "package"
    url: str = ""
    package: str = ""


def classify(link: str) -> Link:
    """Sort a pasted string into the two paths. Never touches the network."""
    text = (link or "").strip()
    if not text:
        raise ValueError("link kosong")
    if text.startswith(("http://", "https://")):
        host = (urlparse(text).hostname or "").lower()
        if host in _PACKAGE_HOSTS:
            return Link(kind="package", url=text, package=_package_from_url(text))
        return Link(kind="remote", url=text.rstrip("/") or text)
    if _BARE_PACKAGE.match(text):
        return Link(kind="package", package=text)
    raise ValueError(
        "bukan link yang dikenali — tempel URL server MCP (https://...), "
        "link GitHub/npm, atau nama paket npm")


def _package_from_url(url: str) -> str:
    """npm URLs carry the package name; GitHub URLs only carry owner/repo, and
    the real name lives in that repo's package.json — resolved later, over the
    network, not here."""
    parts = [p for p in urlparse(url).path.split("/") if p]
    host = (urlparse(url).hostname or "").lower()
    if "npmjs.com" in host and parts and parts[0] == "package":
        return "/".join(parts[1:])
    return ""


def remote_candidates(url: str) -> list[str]:
    base = url.rstrip("/")
    if _EXPLICIT_ENDPOINT.search(url):
        return [url.rstrip("/") if url.endswith("/") else url]
    return [base, f"{base}/mcp", f"{base}/sse"]


def derive_name(link: Link, taken) -> str:
    """A short id for the server list.

    Hosts lose their `mcp.` prefix and TLD, packages lose their scope and the
    `-mcp` suffix, because "notion" is what the operator will type, not
    "mcp.notion.com".
    """
    if link.kind == "remote":
        host = (urlparse(link.url).hostname or "server").lower()
        parts = [p for p in host.split(".") if p not in ("www", "mcp", "com",
                                                         "io", "dev", "ai",
                                                         "org", "net")]
        base = parts[0] if parts else "server"
    else:
        pkg = link.package or "server"
        base = pkg.split("/")[-1]
        base = re.sub(r"^(server|mcp)-|-(server|mcp)$", "", base)
    base = re.sub(r"[^a-z0-9-]", "-", base.lower()).strip("-") or "server"
    if base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_mcp_integrate.py -q`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add hermes/mcp_integrate.py tests/test_mcp_integrate.py
git commit -m "feat: classify a pasted MCP link and derive its candidates and name"
```

---

### Task 5: The round loop — a failure is input, not an ending

**Files:**
- Modify: `hermes/mcp_integrate.py`
- Test: `tests/test_mcp_integrate.py`

**Interfaces:**
- Consumes: `classify`, `remote_candidates`, `TRANSPORTS`, `derive_name` (Task 4); `failure.signature`, `failure.delay_for`.
- Produces:
  - `Attempt(action: str, ok: bool, error: str)`
  - `IntegrationResult(ok: bool, server: McpServer | None, reason: str, history: list[Attempt])` where `reason` is one of `"success" | "circles" | "rounds" | "deadline" | "cancelled" | "auth_timeout" | "rejected"`.
  - `async probe(srv, session_factory, timeout_s=15.0) -> tuple[bool, str, list[str]]`
  - `async integrate(link, *, emit, ask_secret, open_url, session_factory, propose_config=None, sleep=asyncio.sleep, now=time.monotonic, taken=frozenset(), max_rounds=10, deadline_s=600.0, probe_timeout_s=15.0) -> IntegrationResult`

This task implements the remote path only; Task 6 adds the auth branches and Task 7 the package path. `integrate` must already be callable and green at the end of this task.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_mcp_integrate.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_mcp_integrate.py -q -k "candidate or transport or history or cap or deadline or transient or closes"`
Expected: FAIL — `module 'hermes.mcp_integrate' has no attribute 'integrate'`.

- [ ] **Step 3: Write minimal implementation**

Append to `hermes/mcp_integrate.py`:

```python
import asyncio
import time

from . import failure
from .config import McpServer

PROBE_TIMEOUT_S = 15.0
MAX_ROUNDS = 10
DEADLINE_S = 600.0
# A transient failure is the world being busy, not a wrong configuration, so it
# is retried in place. Bounded so a permanently flaky endpoint cannot stall the
# whole run on one candidate.
MAX_TRANSIENT_RETRIES = 3


@dataclass
class Attempt:
    action: str
    ok: bool
    error: str = ""


@dataclass
class IntegrationResult:
    ok: bool
    server: McpServer | None
    reason: str
    history: list[Attempt] = field(default_factory=list)


async def probe(srv: McpServer, session_factory, timeout_s: float = PROBE_TIMEOUT_S,
                auth=None) -> tuple[bool, str, list[str]]:
    """Can this configuration list tools? Returns (ok, error, tool_names).

    Never raises: the caller's whole design is that a failure is data. The
    session is closed on every path — ten rounds of leaked stdio servers is ten
    orphaned subprocesses.
    """
    sess = session_factory(srv, auth)
    try:
        tools = await asyncio.wait_for(sess.list_tools(), timeout_s)
        return (True, "", [t["name"] for t in tools])
    except Exception as e:
        return (False, f"{type(e).__name__}: {e}", [])
    finally:
        close = getattr(sess, "close", None)
        if close is not None:
            try:
                await close()
            except Exception:
                pass


def _is_transient(msg: str) -> bool:
    return failure.classify(msg) == failure.TRANSIENT


def _remote_actions(url: str) -> list[tuple[str, str]]:
    """(transport, url) pairs in the order they should be tried."""
    return [(t, c) for c in remote_candidates(url) for t in TRANSPORTS]


async def integrate(link: str, *, emit, ask_secret, open_url, session_factory,
                    propose_config=None, sleep=asyncio.sleep,
                    now=time.monotonic, taken=frozenset(),
                    max_rounds: int = MAX_ROUNDS,
                    deadline_s: float = DEADLINE_S,
                    probe_timeout_s: float = PROBE_TIMEOUT_S) -> IntegrationResult:
    """Work a pasted link into a connectable MCP server.

    A failed step feeds the next round instead of ending the run. Only five
    things end it: success, going in circles, the round or deadline bound, a
    human wait expiring, and cancellation.
    """
    history: list[Attempt] = []

    async def finish(ok, server, reason):
        await emit({"kind": "done", "ok": ok, "reason": reason,
                    "server": server.model_dump() if server else None,
                    "history": [vars(a) for a in history]})
        return IntegrationResult(ok=ok, server=server, reason=reason,
                                 history=history)

    try:
        parsed = classify(link)
    except ValueError as e:
        history.append(Attempt(action="classify", ok=False, error=str(e)))
        return await finish(False, None, "rejected")

    if parsed.kind != "remote":
        # Task 7 fills this in; until then the package path reports honestly
        # rather than pretending to have tried.
        history.append(Attempt(action="package", ok=False,
                               error="jalur paket belum tersedia"))
        return await finish(False, None, "rejected")

    started = now()
    name = derive_name(parsed, set(taken))
    signatures: set[str] = set()
    actions = _remote_actions(parsed.url)
    rounds = 0

    for transport, url in actions:
        if rounds >= max_rounds:
            return await finish(False, None, "rounds")
        if now() - started > deadline_s:
            return await finish(False, None, "deadline")
        rounds += 1
        label = f"{transport} {url}"
        await emit({"kind": "round", "n": rounds, "action": label})

        srv = McpServer(name=name, type="http", url=url, transport=transport)
        transient_retries = 0
        while True:
            ok, err, tools = await probe(srv, session_factory, probe_timeout_s)
            if ok or not _is_transient(err) or transient_retries >= MAX_TRANSIENT_RETRIES:
                break
            # The world was busy: wait and repeat the same action. This does
            # not spend a round — a slow network is not a wrong guess.
            await sleep(failure.delay_for(transient_retries))
            transient_retries += 1

        history.append(Attempt(action=label, ok=ok, error=err))
        await emit({"kind": "attempt", "action": label, "ok": ok, "error": err,
                    "tools": tools})
        if ok:
            return await finish(True, srv, "success")
        signatures.add(failure.signature(err))

    return await finish(False, None, "circles")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_mcp_integrate.py -q && python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes/mcp_integrate.py tests/test_mcp_integrate.py
git commit -m "feat: probe a remote MCP link round by round, treating each failure as input"
```

---

### Task 6: The OAuth branch and the secret branch

**Files:**
- Modify: `hermes/mcp_integrate.py`
- Test: `tests/test_mcp_integrate.py`

**Interfaces:**
- Consumes: `probe`, `integrate` (Task 5); `mcp_oauth.PendingAuth`, `mcp_oauth.FileTokenStorage` (Task 3).
- Produces:
  - `is_auth_error(msg: str) -> bool`
  - `async try_oauth(srv, session_factory, *, emit, open_url, pending, redirect_uri, probe_timeout_s) -> tuple[bool, str, list[str]]`
  - `integrate(...)` gains keyword arguments `pending=None`, `redirect_uri=""`.

**Implementation note (a refinement on the spec):** the spec described branching on a `WWW-Authenticate` header. In practice the SDK's `OAuthClientProvider` performs its own metadata discovery and raises `OAuthRegistrationError` / `OAuthFlowError` when a server does not support it. Detecting by *attempting* discovery is therefore both simpler and more accurate than parsing a header this client never sees — a server with no OAuth metadata falls to the secret branch exactly as the spec requires.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_mcp_integrate.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_mcp_integrate.py -q -k "auth_error or oauth_branch or secret_branch or declined"`
Expected: FAIL — `has no attribute 'is_auth_error'` and unexpected `oauth_runner` keyword.

- [ ] **Step 3: Write minimal implementation**

Append to `hermes/mcp_integrate.py`:

```python
_AUTH_MARKERS = ("401", "403", "unauthorized", "forbidden", "invalid_token")


def is_auth_error(msg: str) -> bool:
    low = (msg or "").lower()
    return any(m in low for m in _AUTH_MARKERS)


async def run_oauth(srv: McpServer, session_factory, *, emit, open_url, pending,
                    redirect_uri: str, probe_timeout_s: float = PROBE_TIMEOUT_S,
                    auth_timeout_s: float = 300.0):
    """Authorise against `srv` and re-probe with the resulting credentials.

    Raises OAuthRegistrationError / OAuthFlowError when the server does not
    support OAuth at all — the caller reads that as "ask for a manual key".
    Registration is dynamic (DCR), which is the reason this path needs no
    developer console anywhere.
    """
    from mcp.client.auth import OAuthClientProvider
    from mcp.shared.auth import OAuthClientMetadata
    from .mcp_oauth import FileTokenStorage

    wait_id = pending.start()

    async def redirect_handler(auth_url: str) -> None:
        # The state the provider put in the URL is what the callback must match.
        from urllib.parse import parse_qs, urlparse as _u
        state = (parse_qs(_u(auth_url).query).get("state") or [""])[0]
        pending.set_state(wait_id, state)
        await emit({"kind": "login", "url": auth_url})
        await open_url(auth_url)

    async def callback_handler():
        return await pending.wait(wait_id, auth_timeout_s)

    provider = OAuthClientProvider(
        server_url=srv.url,
        client_metadata=OAuthClientMetadata(
            client_name="Hermes",
            redirect_uris=[redirect_uri],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"]),
        storage=FileTokenStorage(srv.name),
        redirect_handler=redirect_handler,
        callback_handler=callback_handler,
        timeout=auth_timeout_s)
    try:
        return await probe(srv, session_factory, probe_timeout_s, auth=provider)
    finally:
        pending.cancel(wait_id)
```

Then, inside `integrate`, replace the block that appends the attempt after a
failed probe. The new signature line and the auth handling:

```python
async def integrate(link: str, *, emit, ask_secret, open_url, session_factory,
                    propose_config=None, sleep=asyncio.sleep,
                    now=time.monotonic, taken=frozenset(),
                    max_rounds: int = MAX_ROUNDS,
                    deadline_s: float = DEADLINE_S,
                    probe_timeout_s: float = PROBE_TIMEOUT_S,
                    oauth_runner=None, pending=None,
                    redirect_uri: str = "") -> IntegrationResult:
```

and, immediately after the transient-retry `while` loop, before the history
append:

```python
        if not ok and is_auth_error(err):
            runner = oauth_runner or run_oauth
            if pending is not None or oauth_runner is not None:
                try:
                    ok, err, tools = await runner(
                        srv, session_factory, emit=emit, open_url=open_url,
                        pending=pending, redirect_uri=redirect_uri,
                        probe_timeout_s=probe_timeout_s)
                    if ok:
                        srv.oauth = True
                except asyncio.TimeoutError:
                    history.append(Attempt(action=f"{label} oauth", ok=False,
                                           error="login tidak selesai tepat waktu"))
                    return await finish(False, None, "auth_timeout")
                except Exception as e:
                    # No OAuth metadata (OAuthRegistrationError) or a refused
                    # flow: fall through to asking for a key by hand.
                    err = f"{type(e).__name__}: {e}"
            if not ok:
                await emit({"kind": "need_secret", "name": "Authorization",
                            "hint": f"{url} menolak tanpa kredensial"})
                value = await ask_secret("Authorization", url)
                if value:
                    srv.headers = {"Authorization": value}
                    ok, err, tools = await probe(srv, session_factory,
                                                 probe_timeout_s)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_mcp_integrate.py -q && python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes/mcp_integrate.py tests/test_mcp_integrate.py
git commit -m "feat: log in through OAuth, or pause for an API key, without ending the run"
```

---

### Task 7: The package path and the LLM repair step

**Files:**
- Modify: `hermes/mcp_integrate.py`
- Test: `tests/test_mcp_integrate.py`

**Interfaces:**
- Consumes: everything from Tasks 4–6.
- Produces: `integrate` handles `Link(kind="package")`. `propose_config(readme: str, errors: list[str]) -> dict | None` returns `{"command": str, "args": list[str], "env": dict[str, str]}`; an `env` value of `""` means "required, value unknown" and routes to the secret branch. `fetch_readme(package: str) -> str` is injected via the `read_readme` keyword (default `None`, meaning no README is available).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_mcp_integrate.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_mcp_integrate.py -q -k package or model`
Expected: FAIL — package path still returns `"rejected"`.

- [ ] **Step 3: Write minimal implementation**

In `hermes/mcp_integrate.py`, add the keyword arguments `read_readme=None` and
`secrets=frozenset()` to `integrate`, then replace the placeholder package
branch with a call to a new helper, and add the helper:

```python
def _scrub(text: str, secrets) -> str:
    """Nothing the operator typed as a secret may reach the model."""
    for s in secrets:
        if s:
            text = text.replace(s, "***")
    return text


async def _integrate_package(parsed, *, name, emit, ask_secret, session_factory,
                             propose_config, read_readme, secrets, history,
                             finish, now, started, deadline_s, max_rounds,
                             probe_timeout_s):
    pkg = parsed.package
    if not pkg:
        history.append(Attempt(action="resolve package", ok=False,
                               error="nama paket tidak bisa ditentukan dari link"))
        return await finish(False, None, "rejected")

    # Convention first: almost every published MCP server runs this way, and it
    # costs nothing to try before spending a model call.
    srv = McpServer(name=name, type="stdio", command="npx", args=["-y", pkg])
    errors: list[str] = []
    signatures: set[str] = set()
    readme = ""

    for rounds in range(1, max_rounds + 1):
        if now() - started > deadline_s:
            return await finish(False, None, "deadline")
        label = f"{srv.command} {' '.join(srv.args)}"
        await emit({"kind": "round", "n": rounds, "action": label})
        ok, err, tools = await probe(srv, session_factory, probe_timeout_s)
        history.append(Attempt(action=label, ok=ok, error=err))
        await emit({"kind": "attempt", "action": label, "ok": ok, "error": err,
                    "tools": tools})
        if ok:
            return await finish(True, srv, "success")

        sig = failure.signature(err)
        if sig in signatures:
            # The same wall as a previous round: another proposal would only
            # prove it again.
            return await finish(False, None, "circles")
        signatures.add(sig)
        errors.append(_scrub(err, secrets))

        if propose_config is None:
            return await finish(False, None, "circles")
        if not readme and read_readme is not None:
            try:
                readme = _scrub(await read_readme(pkg), secrets)
            except Exception:
                readme = ""
        proposal = await propose_config(readme, list(errors))
        if not proposal:
            return await finish(False, None, "circles")

        srv = McpServer(name=name, type="stdio",
                        command=proposal.get("command") or "npx",
                        args=list(proposal.get("args") or ["-y", pkg]),
                        env=dict(proposal.get("env") or {}))
        # An empty value means "required, value unknown" — that is the operator's
        # to supply, not the model's to invent.
        for key, value in list(srv.env.items()):
            if value == "":
                await emit({"kind": "need_secret", "name": key,
                            "hint": f"{pkg} membutuhkan {key}"})
                srv.env[key] = await ask_secret(key, pkg) or ""

    return await finish(False, None, "rounds")
```

and in `integrate`, replace the placeholder branch with:

```python
    started = now()
    name = derive_name(parsed, set(taken))
    if parsed.kind == "package":
        return await _integrate_package(
            parsed, name=name, emit=emit, ask_secret=ask_secret,
            session_factory=session_factory, propose_config=propose_config,
            read_readme=read_readme, secrets=secrets, history=history,
            finish=finish, now=now, started=started, deadline_s=deadline_s,
            max_rounds=max_rounds, probe_timeout_s=probe_timeout_s)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_mcp_integrate.py -q && python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes/mcp_integrate.py tests/test_mcp_integrate.py
git commit -m "feat: work out a package server's command from its README, asking for what only a human has"
```

---

### Task 8: The integrate endpoints and the OAuth callback

**Files:**
- Modify: `hermes/web_ui.py` (imports at line 8; endpoints after `/api/mcp/test` at line 1011)
- Test: `tests/test_web_ui.py`

**Interfaces:**
- Consumes: `mcp_integrate.integrate`, `mcp_oauth.PendingAuth`.
- Produces:
  - `POST /api/mcp/integrate` `{"link": str}` → `{"run_id": str}`
  - `GET /api/mcp/integrate/{run_id}` → `{"state", "history", "pending_secret", "login_url", "server"}`
  - `GET /api/mcp/integrate/{run_id}/events` → SSE, one `brain.sse(event)` per event
  - `POST /api/mcp/integrate/{run_id}/secret` `{"value": str}` → `{"ok": bool}`
  - `POST /api/mcp/integrate/{run_id}/cancel` → `{"ok": true}`
  - `GET /api/mcp/oauth/callback?code=&state=` → HTML; 400 on an unknown state
  - `app.state.integrate_runs: dict[str, IntegrateRun]`, `app.state.pending_auth: PendingAuth`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_web_ui.py`:

```python
def test_integrate_endpoint_starts_a_run_and_reports_it(hermes_home, monkeypatch):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def fake_integrate(link, **kw):
        await kw["emit"]({"kind": "attempt", "action": "streamable-http", "ok": True})
        from hermes.mcp_integrate import IntegrationResult
        from hermes.config import McpServer
        return IntegrationResult(
            ok=True, reason="success",
            server=McpServer(name="notion", type="http", url=link,
                             transport="streamable-http"),
            history=[])

    monkeypatch.setattr("hermes.web_ui.mcp_integrate.integrate", fake_integrate)
    client = TestClient(create_app(store))

    r = client.post("/api/mcp/integrate", json={"link": "https://mcp.notion.com/mcp"})
    assert r.status_code == 200
    run_id = r.json()["run_id"]

    for _ in range(50):
        body = client.get(f"/api/mcp/integrate/{run_id}").json()
        if body["state"] == "done":
            break
    assert body["state"] == "done"
    assert body["server"]["name"] == "notion"
    # a successful run registers the server
    assert [s.name for s in config.load_settings().mcp_servers] == ["notion"]


def test_integrate_run_can_be_answered_with_a_secret(hermes_home, monkeypatch):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def fake_integrate(link, **kw):
        await kw["emit"]({"kind": "need_secret", "name": "Authorization",
                          "hint": link})
        value = await kw["ask_secret"]("Authorization", link)
        from hermes.mcp_integrate import IntegrationResult
        return IntegrationResult(ok=bool(value), server=None,
                                 reason="success" if value else "circles",
                                 history=[])

    monkeypatch.setattr("hermes.web_ui.mcp_integrate.integrate", fake_integrate)
    client = TestClient(create_app(store))
    run_id = client.post("/api/mcp/integrate",
                         json={"link": "https://x.dev/mcp"}).json()["run_id"]

    for _ in range(50):
        body = client.get(f"/api/mcp/integrate/{run_id}").json()
        if body["pending_secret"]:
            break
    assert body["pending_secret"] == "Authorization"

    r = client.post(f"/api/mcp/integrate/{run_id}/secret", json={"value": "Bearer K"})
    assert r.json()["ok"] is True


def test_oauth_callback_rejects_an_unknown_state(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    r = client.get("/api/mcp/oauth/callback?code=C&state=NOBODY-WAITS-FOR-THIS")
    assert r.status_code == 400


def test_oauth_callback_accepts_a_waiting_state(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    app = create_app(store)
    client = TestClient(app)
    wait_id = app.state.pending_auth.start()
    app.state.pending_auth.set_state(wait_id, "STATE-OK")
    r = client.get("/api/mcp/oauth/callback?code=C&state=STATE-OK")
    assert r.status_code == 200
    assert "window.close" in r.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_web_ui.py -q -k "integrate or oauth_callback"`
Expected: FAIL — 404 on `/api/mcp/integrate`.

- [ ] **Step 3: Write minimal implementation**

Change the import line in `hermes/web_ui.py`:

```python
from . import (brain, cleanup, config, ics, launcher, mcp_integrate, mcp_oauth,
               mcp_risk, paths, postmortem, stt, uploads, voice, desktop_api)
```

In `create_app`, next to the other `app.state` setup:

```python
    # One registry of in-flight integration runs, shared by the panel and chat
    # so a run started in one can be finished in the other.
    app.state.integrate_runs = {}
    app.state.pending_auth = mcp_oauth.PendingAuth()
```

After the `/api/mcp/test` endpoint, add:

```python
    INTEGRATE_RUN_TTL_S = 1800     # a finished run stays readable for a while
    INTEGRATE_RUNS_MAX = 20

    class IntegrateRun:
        """One integration attempt, readable while it runs.

        The ladder is a coroutine that outlives a request, so its progress has
        to live somewhere both the SSE stream and a plain GET can read.
        """

        def __init__(self, run_id: str, link: str):
            self.id = run_id
            self.link = link
            self.state = "running"       # running | done
            self.events: list[dict] = []
            self.queue: asyncio.Queue = asyncio.Queue()
            self.pending_secret = ""
            self.login_url = ""
            self.server = None
            self.result = None
            self.finished_at = 0.0
            self._secret: asyncio.Future | None = None

        async def emit(self, ev: dict):
            self.events.append(ev)
            if ev.get("kind") == "login":
                self.login_url = ev.get("url", "")
            if ev.get("kind") == "done":
                self.state = "done"
                self.server = ev.get("server")
                self.finished_at = time.time()
            await self.queue.put(ev)

        async def ask_secret(self, name: str, hint: str) -> str:
            self.pending_secret = name
            self._secret = asyncio.get_running_loop().create_future()
            try:
                # Bounded like the OAuth wait: an unanswered prompt must not
                # hold a run open forever.
                return await asyncio.wait_for(self._secret, 300.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                return ""
            finally:
                self.pending_secret = ""

        def answer_secret(self, value: str) -> bool:
            if self._secret is None or self._secret.done():
                return False
            self._secret.set_result(value)
            return True

    def _evict_old_runs():
        runs = app.state.integrate_runs
        cutoff = time.time() - INTEGRATE_RUN_TTL_S
        for rid, run in list(runs.items()):
            if run.state == "done" and run.finished_at < cutoff:
                runs.pop(rid, None)
        while len(runs) > INTEGRATE_RUNS_MAX:
            runs.pop(next(iter(runs)))

    async def _open_login(url: str):
        # From the panel the front-end opens its own popup on the `login`
        # event; opening here as well covers a run started from chat, where no
        # panel is listening.
        launcher.open_app(url)

    def _start_integrate(link: str) -> str:
        _evict_old_runs()
        run_id = f"i{int(time.time() * 1000)}"
        run = IntegrateRun(run_id, link)
        app.state.integrate_runs[run_id] = run
        settings = config.load_settings()
        port = getattr(app.state, "port", 8799)

        async def go():
            try:
                res = await mcp_integrate.integrate(
                    link,
                    emit=run.emit,
                    ask_secret=run.ask_secret,
                    open_url=_open_login,
                    session_factory=getattr(app.state, "mcp_factory", None)
                    or (lambda s, auth=None: None),
                    propose_config=getattr(app.state, "propose_mcp_config", None),
                    read_readme=getattr(app.state, "read_readme", None),
                    pending=app.state.pending_auth,
                    # Derived from the running port, not hardcoded: a provider
                    # rejects a redirect_uri that does not match exactly.
                    redirect_uri=f"http://127.0.0.1:{port}/api/mcp/oauth/callback",
                    taken={s.name for s in settings.mcp_servers})
                run.result = res
                if res.ok and res.server is not None:
                    await _save_integrated(res.server)
            except Exception as e:
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                await run.emit({"kind": "done", "ok": False,
                                "reason": "error", "error": safe})
        asyncio.create_task(go())
        return run_id

    async def _save_integrated(srv: config.McpServer):
        """Append the server and reconnect the hub, reusing the same path the
        MCP panel's save uses so there is only one way a server is registered."""
        s = config.load_settings()
        s.mcp_servers = [m for m in s.mcp_servers if m.name != srv.name] + [srv]
        config.save_settings(s)
        hub = getattr(app.state, "hub", None)
        if hub is not None:
            try:
                await hub.close()
                hub.servers = s.mcp_servers
                await hub.connect()
                app.state._mcp_tools_cache = None
            except Exception:
                pass

    class IntegrateBody(BaseModel):
        link: str

    class SecretBody(BaseModel):
        value: str

    @app.post("/api/mcp/integrate")
    async def mcp_integrate_start(body: IntegrateBody):
        return {"run_id": _start_integrate(body.link)}

    @app.get("/api/mcp/integrate/{run_id}")
    async def mcp_integrate_state(run_id: str):
        run = app.state.integrate_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run tidak ditemukan")
        return {"state": run.state, "events": run.events,
                "pending_secret": run.pending_secret,
                "login_url": run.login_url, "server": run.server}

    @app.get("/api/mcp/integrate/{run_id}/events")
    async def mcp_integrate_events(run_id: str, request: Request):
        run = app.state.integrate_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run tidak ditemukan")

        async def gen():
            for ev in list(run.events):        # whatever already happened
                yield brain.sse(ev)
            while run.state != "done":
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(run.queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield brain.sse(ev)
        return StreamingResponse(gen(), media_type="text/event-stream")

    @app.post("/api/mcp/integrate/{run_id}/secret")
    async def mcp_integrate_secret(run_id: str, body: SecretBody):
        run = app.state.integrate_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run tidak ditemukan")
        return {"ok": run.answer_secret(body.value)}

    @app.post("/api/mcp/integrate/{run_id}/cancel")
    async def mcp_integrate_cancel(run_id: str):
        run = app.state.integrate_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run tidak ditemukan")
        run.answer_secret("")
        await run.emit({"kind": "done", "ok": False, "reason": "cancelled"})
        return {"ok": True}

    @app.get("/api/mcp/oauth/callback")
    async def mcp_oauth_callback(code: str = "", state: str = ""):
        """Where the identity provider sends the browser back.

        Only a state this process is currently waiting on is accepted; anything
        else is refused without side effect, which is what stops another
        program on this machine from injecting an authorization code.
        """
        if not app.state.pending_auth.resolve(state, code):
            raise HTTPException(status_code=400, detail="state tidak dikenal")
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'>"
            "<p>Login selesai. Jendela ini bisa ditutup.</p>"
            "<script>window.close()</script>")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_web_ui.py -q && python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hermes/web_ui.py tests/test_web_ui.py
git commit -m "feat: run an MCP integration over HTTP, and catch the OAuth callback"
```

---

### Task 9: The three chat tools

**Files:**
- Modify: `hermes/web_ui.py` (`CHAT_TOOLS` at line 60, `chat_dispatch` at line 317)
- Test: `tests/test_web_ui.py`

**Interfaces:**
- Consumes: `_start_integrate`, `app.state.integrate_runs` (Task 8), `app.state.pending` (`PendingStore`).
- Produces: chat tools `integrate_mcp(link)`, `integrate_status(run_id)`, `integrate_secret(run_id, value)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_web_ui.py`:

```python
async def test_chat_can_start_and_follow_an_integration(hermes_home, monkeypatch):
    """Chat cannot hold a turn open for ten minutes, so starting a run returns
    a run_id immediately and progress is read back with a second tool."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def fake_integrate(link, **kw):
        await kw["emit"]({"kind": "attempt", "action": "npx", "ok": True})
        from hermes.mcp_integrate import IntegrationResult
        await kw["emit"]({"kind": "done", "ok": True, "reason": "success",
                          "server": None, "history": []})
        return IntegrationResult(ok=True, server=None, reason="success", history=[])

    monkeypatch.setattr("hermes.web_ui.mcp_integrate.integrate", fake_integrate)

    seen = {}
    async def fake_chat(history, tools=None, dispatch=None):
        seen["tools"] = [t["function"]["name"] for t in tools]
        seen["start"] = json.loads(await dispatch("integrate_mcp",
                                                  {"link": "https://x.dev/mcp"}))
        return "sedang kupasang"

    client = TestClient(create_app(store, chat=fake_chat))
    client.post("/api/tasks", json={"text": "pasang https://x.dev/mcp"})

    assert "integrate_mcp" in seen["tools"]
    assert "integrate_status" in seen["tools"]
    assert "integrate_secret" in seen["tools"]
    assert seen["start"]["run_id"]


async def test_chat_integrate_status_reports_a_missing_run(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    seen = {}
    async def fake_chat(history, tools=None, dispatch=None):
        seen["missing"] = json.loads(
            await dispatch("integrate_status", {"run_id": "nope"}))
        return "tidak ada"

    client = TestClient(create_app(store, chat=fake_chat))
    client.post("/api/tasks", json={"text": "status?"})
    assert "error" in seen["missing"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_web_ui.py -q -k chat_can_start or integrate_status`
Expected: FAIL — `tool tak dikenal: integrate_mcp`.

- [ ] **Step 3: Write minimal implementation**

Add to `CHAT_TOOLS`, after `calendar_events`:

```python
    {"type": "function", "function": {
        "name": "integrate_mcp",
        "description": ("Pasang server MCP baru dari satu link (URL server remote, "
                        "link GitHub/npm, atau nama paket npm). Berjalan di latar: "
                        "kembalikan run_id lalu pantau dengan integrate_status. "
                        "Bila prosesnya minta kredensial, jawab dengan integrate_secret."),
        "parameters": {"type": "object", "properties": {
            "link": {"type": "string", "description": "link atau nama paket"}},
            "required": ["link"]}}},
    {"type": "function", "function": {
        "name": "integrate_status",
        "description": "Keadaan dan riwayat sebuah integrasi MCP yang sedang berjalan.",
        "parameters": {"type": "object", "properties": {
            "run_id": {"type": "string"}}, "required": ["run_id"]}}},
    {"type": "function", "function": {
        "name": "integrate_secret",
        "description": ("Isi kredensial yang diminta sebuah integrasi yang sedang "
                        "menunggu (lihat pending_secret dari integrate_status)."),
        "parameters": {"type": "object", "properties": {
            "run_id": {"type": "string"}, "value": {"type": "string"}},
            "required": ["run_id", "value"]}}},
```

Add to `chat_dispatch`, before the MCP block:

```python
                if name == "integrate_mcp":
                    link = str(args.get("link") or "").strip()
                    if not link:
                        return json.dumps({"error": "link kosong"}, ensure_ascii=False)
                    run_id = _start_integrate(link)
                    return json.dumps(
                        {"run_id": run_id, "state": "running",
                         "note": ("Integrasi berjalan di latar. Pantau dengan "
                                  "integrate_status; jangan mengaku sudah selesai "
                                  "sebelum state-nya 'done'.")},
                        ensure_ascii=False)
                if name == "integrate_status":
                    run = app.state.integrate_runs.get(str(args.get("run_id") or ""))
                    if run is None:
                        return json.dumps({"error": "run tidak ditemukan"},
                                          ensure_ascii=False)
                    return json.dumps(
                        {"state": run.state, "pending_secret": run.pending_secret,
                         "login_url": run.login_url, "server": run.server,
                         "events": run.events[-12:]}, ensure_ascii=False)
                if name == "integrate_secret":
                    run = app.state.integrate_runs.get(str(args.get("run_id") or ""))
                    if run is None:
                        return json.dumps({"error": "run tidak ditemukan"},
                                          ensure_ascii=False)
                    ok = run.answer_secret(str(args.get("value") or ""))
                    return json.dumps({"ok": ok}, ensure_ascii=False)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_web_ui.py -q && python -m pytest -q`
Expected: PASS. The `tool_names` assertion in
`test_the_agent_can_read_its_own_failure_history`'s sibling test must be updated
to include the three new names in order.

- [ ] **Step 5: Commit**

```bash
git add hermes/web_ui.py tests/test_web_ui.py
git commit -m "feat: let the chat agent start and follow an MCP integration"
```

---

### Task 10: The panel — one link, one button, a live log

**Files:**
- Modify: `web/src/api/types.ts`, `web/src/api/index.ts` (or wherever `testMcpServer` lives), `web/src/pages/ConfigMcp.tsx`
- Test: `npm --prefix web test` and `npm --prefix web run typecheck`

**Interfaces:**
- Consumes: the endpoints from Task 8.
- Produces: `api.startIntegrate(link) -> {run_id}`, `api.getIntegrate(runId)`, `api.answerIntegrateSecret(runId, value)`.

- [ ] **Step 1: Add the types**

In `web/src/api/types.ts`, extend `McpServer` and add the run shape:

```ts
export interface McpServer {
  name: string;
  type: 'stdio' | 'http';
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  enabled: boolean;
  transport: '' | 'streamable-http' | 'sse';
  headers: Record<string, string>;
  oauth: boolean;
}

export interface IntegrateEvent {
  kind: 'round' | 'attempt' | 'login' | 'need_secret' | 'done';
  action?: string;
  ok?: boolean;
  error?: string;
  url?: string;
  name?: string;
  hint?: string;
  reason?: string;
}

export interface IntegrateRun {
  state: 'running' | 'done';
  events: IntegrateEvent[];
  pending_secret: string;
  login_url: string;
  server: McpServer | null;
}
```

- [ ] **Step 2: Add the API calls**

In the api module beside `testMcpServer`:

```ts
export const startIntegrate = (link: string) =>
  post<{ run_id: string }>('/api/mcp/integrate', { link });

export const getIntegrate = (runId: string) =>
  get<IntegrateRun>(`/api/mcp/integrate/${runId}`);

export const answerIntegrateSecret = (runId: string, value: string) =>
  post<{ ok: boolean }>(`/api/mcp/integrate/${runId}/secret`, { value });
```

Match the existing helpers' names and signatures in that file; if it exposes a
single `api` object, add these as members of it instead of bare exports.

- [ ] **Step 3: Add the panel UI**

At the top of `ConfigMcp.tsx`'s returned markup, above the server list:

```tsx
const [link, setLink] = useState('');
const [runId, setRunId] = useState<string | null>(null);
const [run, setRun] = useState<IntegrateRun | null>(null);
const [secret, setSecret] = useState('');

useEffect(() => {
  if (!runId) return;
  // Polling, not SSE: the run is short and this avoids a second event-source
  // lifecycle in a page that already has one.
  const id = setInterval(async () => {
    const r = await api.getIntegrate(runId);
    setRun(r);
    if (r.login_url) window.open(r.login_url, '_blank', 'width=520,height=640');
    if (r.state === 'done') {
      clearInterval(id);
      fetchServers();
    }
  }, 1000);
  return () => clearInterval(id);
}, [runId]);

const handleIntegrate = async () => {
  const { run_id } = await api.startIntegrate(link);
  setRunId(run_id);
  setRun(null);
};
```

```tsx
<section style={{ marginBottom: '20px' }}>
  <Field label="Pasang dari link"
         helpText="URL server MCP remote, link GitHub/npm, atau nama paket npm. Hermes yang cari transport, login, dan tools-nya.">
    <div style={{ display: 'flex', gap: '8px' }}>
      <input className="field-input" value={link}
             onChange={(e) => setLink(e.target.value)}
             placeholder="https://mcp.notion.com/mcp" />
      <Button onClick={handleIntegrate}
              loading={run?.state === 'running'}
              disabled={!link.trim()}>Integrate</Button>
    </div>
  </Field>

  {run && (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
                  marginTop: '12px' }}>
      {run.events.map((ev, i) => (
        <div key={i} style={{ color: ev.ok === false ? 'var(--err)' : 'var(--fg)' }}>
          {ev.kind === 'attempt' && `${ev.ok ? '✓' : '✗'} ${ev.action} ${ev.error || ''}`}
          {ev.kind === 'round' && `→ ${ev.action}`}
          {ev.kind === 'login' && 'menunggu login di jendela baru…'}
          {ev.kind === 'done' && `selesai: ${ev.reason}`}
        </div>
      ))}
      {run.pending_secret && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <input className="field-input" value={secret} type="password"
                 placeholder={`isi ${run.pending_secret}`}
                 onChange={(e) => setSecret(e.target.value)} />
          <Button onClick={async () => {
            await api.answerIntegrateSecret(runId!, secret);
            setSecret('');
          }}>Kirim</Button>
        </div>
      )}
    </div>
  )}
</section>
```

- [ ] **Step 4: Typecheck, build, and test**

```bash
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web test
```

Expected: clean typecheck, successful build, 74 web tests passing. Fix any
`McpServer` construction in `ConfigMcp.tsx` that now misses the three new
required fields by adding `transport: '', headers: {}, oauth: false` to the
blank-form initialiser at lines 21 and 57.

- [ ] **Step 5: Commit**

```bash
git add web/src hermes/static
git commit -m "feat: add an MCP server from one pasted link in the panel"
```

---

### Task 11: Wire the real model call and the README fetch

**Files:**
- Modify: `hermes/main.py` (near `real_mcp_session_factory`, line 425)
- Test: `tests/test_main_smoke.py`

**Interfaces:**
- Consumes: `config.load_settings`, `config.load_secrets`, `AsyncOpenAI`.
- Produces: `main.build_propose_mcp_config() -> callable`, `main.fetch_readme(pkg) -> str`, both attached to `web.state`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_main_smoke.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_main_smoke.py -q -k propose or readme_url`
Expected: FAIL — `module 'hermes.main' has no attribute 'build_propose_mcp_config'`.

- [ ] **Step 3: Write minimal implementation**

In `hermes/main.py`, beside `real_mcp_session_factory`:

```python
def readme_url(pkg: str) -> str:
    # The registry wants the scope separator escaped; an unescaped "@scope/name"
    # resolves to a different path and 404s.
    return f"https://registry.npmjs.org/{pkg.replace('/', '%2f')}"


async def fetch_readme(pkg: str) -> str:
    """The package's README, or "" when it cannot be had.

    Never raises: a missing README means the model gets less context, not that
    the integration fails.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
            r = await c.get(readme_url(pkg))
            r.raise_for_status()
            return (r.json().get("readme") or "")[:12000]
    except Exception:
        return ""


PROPOSE_SYSTEM = (
    "You configure MCP servers. Given a package README and the errors from "
    "previous attempts, answer ONLY with JSON: "
    '{"command": str, "args": [str], "env": {str: str}}. '
    "Use an empty string for an env value the README says is required but "
    "whose value only the operator can know. No prose, no code fence."
)


def build_propose_mcp_config():
    """The one LLM step in the integration ladder.

    Returns None on any failure — no key, a refusal, unparseable JSON — which
    the ladder reads as "no proposal", stopping the run cleanly instead of
    retrying a guess it does not have.
    """
    async def propose(readme: str, errors: list[str]):
        secrets = config.load_secrets()
        if not secrets.nvidia_api_key:
            return None
        s = config.load_settings()
        client = AsyncOpenAI(base_url=s.nvidia_base_url,
                             api_key=secrets.nvidia_api_key, timeout=30)
        try:
            resp = await client.chat.completions.create(
                model=s.chat_model or s.model,
                messages=[{"role": "system", "content": PROPOSE_SYSTEM},
                          {"role": "user",
                           "content": f"README:\n{readme}\n\nERRORS:\n"
                                      + "\n".join(errors[-5:])}],
                temperature=0, max_tokens=400)
            raw = (resp.choices[0].message.content or "").strip()
            raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```")
            out = json.loads(raw)
        except Exception as e:
            print(f"MCP config proposal failed: {_console_safe(e)}")
            return None
        if not isinstance(out, dict) or "command" not in out:
            return None
        return out
    return propose
```

Then, beside `web.state.mcp_factory = real_mcp_session_factory`:

```python
    web.state.propose_mcp_config = build_propose_mcp_config()
    web.state.read_readme = fetch_readme
    web.state.port = 8799
```

Add `import json` at the top of `main.py` if it is not already imported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest -q && npm --prefix web test`
Expected: PASS — full Python suite and 74 web tests.

- [ ] **Step 5: Commit**

```bash
git add hermes/main.py tests/test_main_smoke.py
git commit -m "feat: wire the README fetch and the model that proposes a package config"
```

---

### Task 12: Document the flow

**Files:**
- Modify: `docs/INTEGRATIONS.md`

- [ ] **Step 1: Rewrite the "Add a server" section**

Replace the table-of-fields opening with the link-first flow, keeping the manual
table below it as the fallback. State plainly:

- what a pasted link may be (remote URL, GitHub/npm link, bare package name);
- that Integrate is the single permission, and that a package link runs
  third-party code through `npx`;
- that OAuth uses dynamic client registration, so no Google Cloud or other
  developer console is involved;
- that a server asking for a manual API key pauses the run and asks;
- where tokens are stored (`%HERMES_HOME%\config\mcp_tokens\`) and that they are
  secrets which must not be committed.

Also correct the Gmail and Calendar sections: those servers were removed from
this machine's configuration in favour of the IMAP + ICS route, and the doc
still describes the Google Cloud path as though it were current.

- [ ] **Step 2: Commit**

```bash
git add docs/INTEGRATIONS.md
git commit -m "docs: describe adding an MCP server from one link"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `McpServer` gains `transport`, `headers`, `oauth` | 1 |
| Three transports, headers and auth forwarded | 2 |
| `FileTokenStorage`, pending-authorization registry | 3 |
| Link classification, candidates, name derivation | 4 |
| Round loop, failure-as-input, signature guard, caps, backoff | 5 |
| OAuth branch (DCR, popup, callback), secret branch | 6 |
| Package path, repeatable LLM repair, empty-env → ask | 7 |
| Five endpoints, run registry with TTL, state validation | 8 |
| Three chat tools over one registry | 9 |
| Panel link input, live log, popup, secret field | 10 |
| Real `propose_config` and README fetch | 11 |
| Documentation | 12 |

Two spec points deserve a note rather than a task:

- **Redirect URI derived from the running port** — implemented in Task 8 via
  `app.state.port`, set in Task 11. It is a single value today because uvicorn
  is started on 8799 in `main.py`; if that ever becomes configurable, this is
  the one place to read it from.
- **Per-probe timeout separate from the deadline** — Task 5's `probe_timeout_s`
  and `deadline_s` are independent parameters, checked independently.

**Placeholder scan:** none. Every code step carries the code; every test step
carries the assertions.

**Type consistency:** `IntegrationResult(ok, server, reason, history)` is used
identically in Tasks 5–9. `probe(...) -> (ok, error, tools)` is unpacked the
same way everywhere. `emit` always receives a dict with `"kind"`. The chat tool
names `integrate_mcp` / `integrate_status` / `integrate_secret` match between
`CHAT_TOOLS` and `chat_dispatch`.

**Known ordering trap:** Task 9 changes the tool list, and
`tests/test_web_ui.py` asserts `out["tool_names"]` exactly. That assertion must
be updated in Task 9, not left to fail in Task 10.
