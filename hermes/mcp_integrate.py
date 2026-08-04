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


async def integrate(link: str, *, emit, ask_secret, open_url, session_factory,
                    propose_config=None, sleep=asyncio.sleep,
                    now=time.monotonic, taken=frozenset(),
                    max_rounds: int = MAX_ROUNDS,
                    deadline_s: float = DEADLINE_S,
                    probe_timeout_s: float = PROBE_TIMEOUT_S,
                    oauth_runner=None, pending=None,
                    redirect_uri: str = "",
                    read_readme=None,
                    secrets=frozenset()) -> IntegrationResult:
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

    started = now()
    name = derive_name(parsed, set(taken))

    if parsed.kind == "package":
        return await _integrate_package(
            parsed, name=name, emit=emit, ask_secret=ask_secret,
            session_factory=session_factory, propose_config=propose_config,
            read_readme=read_readme, secrets=secrets, history=history,
            finish=finish, now=now, started=started, deadline_s=deadline_s,
            max_rounds=max_rounds, probe_timeout_s=probe_timeout_s)
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

        history.append(Attempt(action=label, ok=ok, error=err))
        await emit({"kind": "attempt", "action": label, "ok": ok, "error": err,
                    "tools": tools})
        if ok:
            return await finish(True, srv, "success")
        signatures.add(failure.signature(err))

    return await finish(False, None, "circles")

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
