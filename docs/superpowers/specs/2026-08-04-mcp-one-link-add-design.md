# Add an MCP server from one link

**Date:** 2026-08-04
**Status:** approved, ready for an implementation plan

## The problem

Adding an MCP server today means filling a six-field form: name, type, command,
args, env, enabled. The operator has to already know the package name, its
arguments, which environment variables it reads, and whether it needs
credentials — facts that live in a README somewhere. Two of the three servers
configured on this machine took a documentation round-trip to get right.

Worse, the servers worth adding most are the ones the form cannot express.
`RealMcpSession` speaks stdio and legacy SSE only, with no auth headers, so
every modern remote MCP server (Notion, Linear, Zapier, Sentry) is unreachable
no matter what is typed into the form.

## What we are building

One input: a link. One button: Integrate. Hermes probes the link, works out how
to talk to it, and keeps trying until it has a working tool list — opening a
login popup if the server needs one, and pausing to ask for an API key if it
needs that instead. The same flow is available from chat.

### Decisions taken

| Question | Decision |
|---|---|
| What kind of link? | Remote MCP URLs **and** npm/GitHub package links |
| How autonomous? | One permission up front, then the loop runs on its own |
| Where does it live? | MCP panel **and** chat, over one backend |
| Server needs a manual API key? | Pause, ask, resume — not "report and give up" |
| A step fails? | Feed it back into the next round; do not abort the run |

## Architecture

Four units, each with one job.

### `hermes/mcp_integrate.py` (new)

The ladder. One async entry point:

```python
async def integrate(link, *, emit, ask_secret, open_url, session_factory,
                    propose_config=None, sleep=asyncio.sleep,
                    now=time.monotonic) -> IntegrationResult
```

Knows nothing about FastAPI, writes nothing to disk, opens no browser. Every
outward interaction goes through an injected callback, which is what makes the
whole ladder testable without a network, a browser, or a model.

- `emit(event)` — progress out
- `ask_secret(name, hint) -> str` — blocks the run until the operator answers
- `open_url(url)` — the login popup, however the caller opens one
- `propose_config(readme, errors) -> dict | None` — the LLM step. Returns
  `{"command": str, "args": list[str], "env": dict[str, str]}`, where an env
  value of `""` means "this key is required but I do not know its value" and
  routes to the secret branch. Passing `propose_config=None` disables the step
  entirely, degrading to convention-only package handling.

### `hermes/mcp_oauth.py` (new)

The two pieces OAuth needs that the repo does not have:

- `FileTokenStorage` — implements the SDK's four-method `TokenStorage`
  (`get_tokens` / `set_tokens` / `get_client_info` / `set_client_info`), one
  JSON file per server under `%HERMES_HOME%\config\mcp_tokens\`.
- A pending-authorization registry — the bridge between the SDK, which awaits a
  `(code, state)` tuple inline, and HTTP, where that tuple arrives minutes later
  on a different request. `redirect_handler` parks the authorization URL;
  `callback_handler` awaits a future the callback endpoint resolves.

### `hermes/mcp_hub.py` (changed)

`RealMcpSession._ensure` grows from two transport branches to three — stdio,
`streamable-http`, `sse` — and forwards `headers` and `auth`. The SDK already
supports this: `streamablehttp_client(...)` and `sse_client(...)` both accept
`auth: httpx.Auth | None`, and `OAuthClientProvider` *is* an `httpx.Auth`.

### `hermes/web_ui.py` (changed)

Thin endpoints that all delegate to `mcp_integrate`:

| Endpoint | Purpose |
|---|---|
| `POST /api/mcp/integrate` | start a run from `{link}`, return `{run_id}` |
| `GET /api/mcp/integrate/{run_id}/events` | SSE progress stream |
| `POST /api/mcp/integrate/{run_id}/secret` | supply a value the run asked for |
| `POST /api/mcp/integrate/{run_id}/cancel` | operator abort |
| `GET /api/mcp/oauth/callback` | receive `code`+`state`, return popup-closing HTML |

### Chat surface mechanics

Chat has no SSE stream and cannot hold a turn open for ten minutes, so it gets
three thin tools over the same run registry rather than one blocking call:

| Tool | Behaviour |
|---|---|
| `integrate_mcp(link)` | starts the run in the background, returns `run_id` immediately |
| `integrate_status(run_id)` | current state plus the round history so far |
| `integrate_secret(run_id, value)` | answers a run parked on `need_secret` |

A run started from chat opens its login popup through `launcher.open_app`, so
the browser appears whether or not the panel is on screen. The operator can
also finish a chat-started run from the panel — same registry, same run.

### Front-end

`ConfigMcp.tsx` gains a link field and an Integrate button above the existing
form. The manual form stays for editing.

**The separation that matters:** `mcp_integrate` does not know whether its
caller is the panel or chat. The panel injects callbacks that write to an SSE
stream and open a `window.open` popup; chat injects callbacks that write to the
conversation and call `launcher.open_app`. One ladder, two consumers.

## The ladder

### Step 0 — classify the link

Pure function, no network. An http(s) URL becomes a remote-server candidate; a
`github.com/owner/repo` URL, an `npmjs.com/package/x` URL, or a bare package
name (`@scope/name`) becomes a package candidate; anything else is rejected with
a clear message.

### Remote path (no model involved)

1. Build the candidate endpoint list. A URL already ending in `/mcp` or `/sse`
   is used as-is; otherwise try `<url>`, `<url>/mcp`, `<url>/sse`. The list is
   bounded — there is no open-ended crawling.
2. Try each candidate against `streamable-http` first, then `sse`: open a
   session, `initialize`, `list_tools`, on a short timeout.
3. Branch on the outcome:
   - **Success** → done: `McpServer(type="http", transport=…, url=…)`
   - **401/403 with `WWW-Authenticate`** → OAuth branch
   - **401 without OAuth metadata** → secret branch
   - **Connection error or 404** → next candidate

### OAuth branch

Build an `OAuthClientProvider` with `client_name="Hermes"` and
`redirect_uris=["http://127.0.0.1:<port>/api/mcp/oauth/callback"]`.
`redirect_handler` opens nothing itself — it emits `{kind: "login", url}`, and
the caller decides whether that means `window.open` or the system browser. The
operator logs in, the provider redirects back with `?code=&state=`, the callback
endpoint resolves the awaited future, the SDK exchanges the code for tokens and
persists them through `FileTokenStorage`, and the connection is retried with
`auth=provider`.

Client registration uses **Dynamic Client Registration**, which is exactly why
this path needs no developer console anywhere: a server that supports DCR
registers Hermes on the spot.

The wait is bounded by the SDK's 300-second default.

### Secret branch

The server wants a manual key. Emit `{kind: "need_secret", hint}` and await
`ask_secret`. The panel renders a field; chat asks. The answer goes into that
server's `headers`, and the loop continues from there rather than restarting.

### Package path

1. Normalise to an npm package name (a GitHub URL resolves through its
   `package.json` `name`).
2. Candidate config `npx -y <pkg>`, tested through the same session machinery.
3. On failure, call `propose_config` with the README (npm registry or raw
   GitHub) and the accumulated errors; apply the proposal and retry.
4. If the proposal names env keys without values (`API_KEY`, a credentials
   path), fall into the secret branch and ask for each.

## Loop control: a failure is input, not an ending

The ladder is a state machine with memory, not a straight line that returns on
the first failure.

**Carried between rounds:** which `(url × transport)` candidates have been
tried, which package configs have been tried, which secrets have been obtained,
and the list of failure signatures seen.

**Each round takes the next untried action.** A failure records its error and
signature, emits an event, and the loop moves on. A dead branch does not end the
run: OAuth refused → try the secret branch; `npx` failed → try an LLM repair; a
dead `/mcp` candidate → try `/sse`.

**LLM repair is repeatable, not one-shot.** Each call receives the accumulated
errors, so the third round knows what the first two already ruled out.

**Transient errors do not consume a round.** They sleep `failure.delay_for(n)`
and retry the same action.

`failure.signature()` (`hermes/failure.py:141`) is reused as the
no-progress fingerprint — it already flattens line numbers, paths, and hashes,
answering the only question that matters here: is this the same wall as last
round? `failure.delay_for()` is reused for backoff.

### The five stopping conditions

1. **Success** — `list_tools` returned a list.
2. **Going in circles** — no untried action remains **and** the last proposal
   produced a failure signature already seen. This is what separates "not yet"
   from "the same wall again"; without it, "never stop" means burning tokens
   forever.
3. **Bounds** — 10 rounds or a 10-minute deadline. Time spent waiting on a
   human does not count, or a slow login would be recorded as the cause of
   failure.
4. **A human wait expired** — OAuth's 300 seconds, or the secret prompt.
5. **Operator cancelled.**

Whichever fires, the run emits its full per-round history — what was tried and
the exact error — and offers the best configuration reached for manual saving
through the existing form.

## Config, storage, and security

### `McpServer` gains three fields, all defaulted

Existing configs parse unchanged; no migration.

- `transport: "" | "streamable-http" | "sse"` — empty means unprobed (today's
  behaviour).
- `headers: dict[str, str]` — for API-key servers. Deliberately **not** `env`:
  `env` is a stdio process environment, a header is HTTP. Merging them would
  send the key to the wrong place in half the cases.
- `oauth: bool` — this server's session must attach an `OAuthClientProvider`.

### Token storage

OAuth tokens do **not** go in `config.yaml`. One file per server under
`%HERMES_HOME%\config\mcp_tokens\<name>.json`. The reason is concrete:
`GET /api/settings` returns the whole settings object to the browser on every
page load, so a refresh token stored there would be shipped to the front-end
every time.

Stated plainly rather than glossed: `headers` (the API key) **is** returned to
the panel, exactly as `env` already is — `env` currently holds `EMAIL_PASS`.
That is pre-existing behaviour on a localhost single-user app. Masking those
is separate work, not part of this change.

### Four binding security decisions

1. **The redirect URI is derived from the running app's port**, never
   hardcoded. If Hermes moves ports, `redirect_uris` moves with it; otherwise
   the provider fails with a `redirect_uri_mismatch` that explains nothing.
2. **`state` is verified at the callback.** The endpoint accepts only a `state`
   matching a run that is currently waiting; a mismatch returns 400 with no
   side effect. This is what stops anything else on this machine from injecting
   an authorization code.
3. **`npx -y` executes third-party code.** The permission is the single
   up-front Integrate press, and the run log names exactly which package was
   executed, so there is a trace.
4. **The LLM prompt never carries secrets.** Only README text and error text
   reach the model; tokens and API keys are filtered out of errors first.

### One permission, two surfaces

The chat tool `integrate_mcp(link)` goes through the existing `pending_actions`
mechanism — the operator confirms once before the run starts. In the panel, the
Integrate button is that permission. Both surfaces mean the same thing: one
human approval before foreign code runs.

## Error handling

No failure leaves `integrate()` as an exception. Every failure becomes an event,
the run survives it, and endpoints keep returning data. That is what makes
"don't stop when a step fails" a property of the code rather than an intention.

Three things that are easy to miss and are deliberately pinned down:

- **Probe sessions are always closed**, success or failure, through
  `AsyncExitStack` as `RealMcpSession` already does. Ten rounds without this is
  ten orphaned `npx` subprocesses.
- **Per-probe timeout is short** (~15 s) and separate from the run deadline. One
  hanging server must not consume the ten minutes that belong to every
  candidate.
- **The run registry is bounded** and evicted on completion plus a TTL, so
  `app.state` does not accumulate dead runs.

## Testing

Because `integrate()` takes `emit`, `ask_secret`, `open_url`, `session_factory`,
`propose_config`, and `sleep` from its caller, the whole ladder is testable with
no network, no browser, and no model.

- Link classification — table of cases, pure function.
- First candidate 404, second succeeds — proves a failure does not abort, and
  pins the candidate ordering.
- 401 with `WWW-Authenticate` → OAuth branch runs, login event emitted, callback
  resolves, retry succeeds.
- 401 without OAuth metadata → `need_secret`; once supplied, the next round uses
  that header.
- Same signature twice → stops with history rather than looping.
- Round cap and deadline.
- Transient error → injected sleep, same action retried, round budget unspent.
- Package path: `npx` fails → faked proposal succeeds; and a proposal that
  reproduces the same failure stops the run.
- Name derivation and collision de-duplication.

Beyond the ladder: `mcp_hub` selects the transport from the field and forwards
`headers`/`auth`; `FileTokenStorage` round-trips; the pending registry accepts a
matching `state` and **rejects** a mismatched one; the integrate endpoints and
the OAuth callback; the chat tool routing through pending confirmation.

The existing suites (609 Python, 74 web) must stay green — the `McpServer` and
`mcp_hub` changes touch already-tested paths.

## Out of scope

- Masking existing secrets (`env`, `headers`) in the settings API response.
- A server catalogue or registry search. This takes a link the operator already
  has.
- Editing an integrated server through the new flow; the manual form does that.
- Re-running OAuth when a refresh token expires — the SDK refreshes; a hard
  expiry means integrating again.

## Facts this design rests on

Verified on this machine, 2026-08-04:

- `mcp` SDK **1.29.0** is installed, satisfying the existing `>=1.0,<2` pin.
- `mcp.client.auth` exports `OAuthClientProvider`, `OAuthFlowError`,
  `OAuthRegistrationError`, `OAuthTokenError`.
- `OAuthClientProvider(server_url, client_metadata, storage, redirect_handler,
  callback_handler, timeout=300.0, client_metadata_url=None)`.
- `TokenStorage` requires exactly `get_tokens`, `set_tokens`, `get_client_info`,
  `set_client_info`.
- `streamablehttp_client(url, headers, timeout, sse_read_timeout,
  terminate_on_close, httpx_client_factory, auth)` and `sse_client(url, headers,
  timeout, sse_read_timeout, httpx_client_factory, auth, on_session_created)`
  both accept `auth`.
- `POST /api/mcp/test` and the panel's "Test Server" button already exist
  (`hermes/web_ui.py:1011`, `web/src/pages/ConfigMcp.tsx`).

**No new Python or npm dependency is required.**
