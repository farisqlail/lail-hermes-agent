# Integrations — file, browser, Gmail, calendar

Hermes controls external systems through **MCP servers**, not bespoke code. Each
capability is a small server process Hermes connects to; its tools then appear to
the agent as function calls. Add servers in the **MCP panel** at
`http://127.0.0.1:8799` (or edit `%HERMES_HOME%\config\mcp.json`), no code change.

## Two surfaces, one gate

- **Telegram planner** (`/task ...`) — calls MCP tools inside an engine run.
- **Telegram free-text chat & Web chat** — the conversational agent gets the same tools on both surfaces. **Reads run immediately; writes/sends/deletes are gated**: the agent proposes the action and parks it for confirmation, sending an inline approve/decline card to Telegram or drawing a card in the Web UI. Approving executes the action and resumes the agent's turn. The read/write split is decided in `hermes/mcp_risk.py` from the tool name (a verb heuristic; unknown verbs are gated, never run).


Destructive-by-nature tools (send email, delete file, submit a form) are risky by
this rule. Reads (list, search, read, screenshot) are not.

## What ships by default

A fresh install (no `config.yaml` yet) starts with eight servers, defined in
`_default_mcp_servers` in `hermes/config.py`:

| server | on | needs |
|---|---|---|
| `pc` | ✅ | Node |
| `browser` | ✅ | Node (downloads a browser engine on first run) |
| `win` | ✅ | `uv` — `install.ps1` puts it in the venv |
| `obsidian` | ✅ | Node — vault auto-seeded, see [Obsidian vault](#obsidian-vault) |
| `mail` | ⛔ | Gmail address + app password |
| `web` | ⛔ | Tavily API key — usually unnecessary, see [Web search](#web-search) |
| `spotify` | ⛔ | Spotify Client ID + a one-time `auth` run |
| `figma` | ⛔ | Figma personal access token, see [Figma](#figma) |

The four disabled ones are templates with empty credential slots, so a first
boot never fails on a missing key: fill them in the MCP panel and toggle them on.

**Defaults only apply to a fresh install.** `load_settings` falls back to them
when no settings file exists; once `config.yaml` is written it is the only
source of truth, so pulling a new version never re-adds a server you removed nor
re-enables one you turned off. To adopt a later default set, delete the
`mcp_servers` list from `config.yaml` (or the file, losing every other setting).

## Add a server

The easiest way to add a server is using the **one-link integration** in the MCP panel or through the chat agent.

Paste or type a single link/name:
- **Remote URL**: An SSE endpoint (e.g. `http://localhost:3000/sse` or `https://x.dev/mcp`).
- **GitHub / npm Link**: The source repository or npm page for an MCP package.
- **Package Name**: A bare npm package name (e.g. `@modelcontextprotocol/server-filesystem`).

Hermes will automatically:
1. Probe the remote SSE endpoint or test standard local command conventions (like running `npx -y <package>`).
2. Discover capabilities, like dynamic client registration (DCR) for OAuth where identity providers present an auth URL.
3. Fetch the README to understand the server parameters and command config.
4. Prompt the operator for any required credentials or API keys when needed, pausing the run.
5. Save the configuration and connect the server.

> [!IMPORTANT]
> - **Integrate runs third-party code**: Pasting an npm package name or GitHub repository runs it locally via `npx`. Make sure you trust the package.
> - **No developer consoles needed for OAuth**: Identity providers supporting DCR configure themselves automatically via Hermes' Dynamic Client Registration flow.
> - **Token storage**: Active OAuth credentials and session refresh tokens are saved securely outside of settings under `%HERMES_HOME%\config\mcp_tokens\`. Never commit these files.

### Manual Configuration (Fallback)

If automatic integration fails or you have a custom local setup, you can still add or edit servers manually:

| Field | Meaning |
|---|---|
| name | short id; tools show as `name__tool` |
| type | `stdio` (a local command) or `http` (SSE URL) |
| command / args | for stdio: the executable and its arguments |
| env | environment variables (API keys, credential paths) |
| enabled | toggle without deleting |

`npx`-based servers need Node on PATH (already required for the web UI build).

---

## File

Read/write/search local files. **Scope it to a specific folder** — the path
argument is the only directory the server can touch. Never point it at your home
directory or a drive root.

```
name:    filesystem
type:    stdio
command: npx
args:    ["-y", "@modelcontextprotocol/server-filesystem", "D:\\work\\allowed"]
```

Add more allowed roots as extra args. Writes/deletes are gated in web chat.

## PC (files + terminal)

Whole-machine file access plus a terminal, in one server:

```
name:    pc
type:    stdio
command: npx
args:    ["-y", "@wonderwhy-er/desktop-commander"]
```

26 tools. Reads (`read_file`, `list_directory`, `get_file_info`, `start_search`) run
immediately; `write_file`, `edit_block`, `start_process` and `kill_process` are gated.

Unlike the filesystem server above it has **no folder scope** — every file the account can
read, the model can read, and there is no confirmation on reads. Prefer the scoped filesystem
server unless the agent genuinely needs to run programs. It is also slow to start: about 17
seconds to its first tool list (≈7 s of that is `npx` resolving the package), which is why
`OPEN_TIMEOUT_S` in `hermes/mcp_hub.py` is 60 s.

## Browser

Drive a real browser: navigate, click, fill, screenshot. Playwright's MCP server:

```
name:    browser
type:    stdio
command: npx
args:    ["-y", "@playwright/mcp@latest"]
```

First run downloads a browser engine. `browser_snapshot` / screenshots are reads;
`browser_click` / `browser_type` / `browser_navigate` are gated in web chat.

## Windows desktop (GUI)

Read the screen and drive native Windows apps — what the `pc` terminal cannot do:
click a button, type into a dialog, read a window's UI tree.

```
name:    win
type:    stdio
command: uvx
args:    ["windows-mcp", "serve"]
```

[CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP), 20 tools.
It is a Python package run through `uvx`, which `install.ps1` puts in the venv
that `start.bat` activates — so the bare command resolves. Launching Hermes some
other way means `uvx` may not be on its PATH; give the absolute path to
`uvx.exe` then. First run installs ~90 dependencies; warm the cache with
`uvx windows-mcp --help` once so the 60 s `OPEN_TIMEOUT_S` is not the first thing
it hits.

Only `Snapshot` and `Screenshot` run ungated. Everything else — `Click`, `Type`,
`PowerShell`, `Registry`, `Clipboard`, `Process` — is gated in web chat, so
hands-free GUI automation there means approving every step. Drive long GUI
sequences through Telegram `/task` instead.

## Memory (knowledge graph) — optional, not a default

**No longer shipped by default.** The [Obsidian vault](#obsidian-vault) is the
memory store now — operator facts and the task archive live there as markdown —
so the flat-fact use this server was carrying is covered without a second
always-on subprocess. Add it back only if you specifically want a graph of
*relations between entities*, which the vault does not model:

```
name:    memory
type:    stdio
command: npx
args:    ["-y", "@modelcontextprotocol/server-memory"]
env:     { "MEMORY_FILE_PATH": "C:\\Hermes\\config\\memory.jsonl" }
```

Set `MEMORY_FILE_PATH` — the default writes `memory.jsonl` inside the npx package
directory, which a cache clear deletes.

`read_graph` / `search_nodes` are reads; every `create_*` / `delete_*` /
`add_observations` is gated, which means the agent cannot record a memory on its
own in web chat.

## Obsidian vault

The agent's markdown knowledge store: the operator facts and per-task archive
Hermes writes itself, plus any notes the operator keeps, as plain files under
`HERMES_HOME/vault`.

```
name:    obsidian
type:    stdio
command: npx
args:    ["-y", "obsidian-mcp", "C:\\Hermes\\vault"]
```

Two things use the vault. Hermes reads and writes the facts (`vault/facts/`) and
task notes (`vault/tasks/`) directly on disk — this is the source of truth for
what it remembers, replacing the old `user_facts` SQLite table. The MCP server
is the *agent's* live-access layer over the same files: `read-note`,
`search-vault`, `create-note`, `edit-note`, tags, etc.

The vault path is auto-derived per install (`paths.vault_dir()`), so the default
needs no editing. `paths.ensure_vault()` seeds a valid `.obsidian/` config at
startup — the server refuses a folder without one — while leaving any files an
operator has already put there untouched.

Network note: `npx -y obsidian-mcp` downloads the package on first `tools/list`.
`install.ps1` pre-warms the npx cache so a fresh install starts cleanly; on a
machine where the npm registry is slow or blocked, pre-warm it manually (or
install it locally and point `command`/`args` at `node <path>/build/main.js`).

Versioning + backup. The vault is put under git at startup and committed on each
finished task (`hermes/vault_git.py`), so knowledge has a history and edits are
recoverable — no setup needed, and nothing happens if git is not installed. For
off-machine backup, add a remote once and Hermes pushes it at each startup:

```
git -C C:\Hermes\vault remote add origin <url>
```

## Web search

**Use the `browser` server above.** `browser_navigate` to
`https://www.bing.com/search?q=...` followed by `browser_snapshot` needs no key,
no account and no extra long-running process — Playwright is spawned per call and
exits after. Both tools are ungated, so search works in web chat without an
approval step. It costs ~5–10 s per query against ~1 s for a search API, and the
snapshot is written to `.playwright-mcp\page-*.yml` rather than returned inline,
so the agent reads it back through `pc__read_file`.

A dedicated `web` server is configured but left **disabled**; enable it only if
that latency becomes the bottleneck:

```
name:    web
type:    stdio
command: npx
args:    ["-y", "tavily-mcp@latest"]
env:     { "TAVILY_API_KEY": "tvly-..." }
```

Key from [tavily.com](https://app.tavily.com) — 1000 searches/month, no credit
card. All of its tools are reads, so they run ungated.

### Why not a keyless search server

Measured from an Indonesian residential connection (Telkom), 2026-08-05. Every
free/open-source option was tried and none survived; do not re-run this search
without new information:

| Option | Result |
|---|---|
| Any DuckDuckGo-backed server (`duckduckgo-mcp-server`, …) | `html.duckduckgo.com` resolves to `36.86.63.185` (Telkom) and serves an expired cert — `SEC_E_CERT_EXPIRED` / `ERR_CERT_COMMON_NAME_INVALID`. ISP block, not bot detection. The package's `[browser]` TLS-impersonation extra does not help. |
| `mcp-searxng` against public instances | 12 instances tried; none expose the JSON API `mcp-searxng` needs. Nine answered `Too Many Requests`, the rest returned HTML. `SEARXNG_HTML_FALLBACK=true` parses that HTML but returns results for some queries and nothing for others. |
| `mcp-searxng` against a self-hosted instance | Works in principle — Google and Bing are both reachable — but needs a permanently running SearXNG container. Rejected: too much starts up alongside the agent. |
| `open-websearch` | Ignores its `engine` argument, always queries Bing, and Bing answers `301` to this IP. `totalResults: 0` for every engine. |
| `s.jina.ai` | `401` — needs a key. (`r.jina.ai` is keyless but only reads a URL you already have.) |
| Brave Search API | Free tier is 2000/month but registration requires a credit card. |

## Spotify

Playback control and playlists:

```
name:    spotify
type:    stdio
command: npx
args:    ["-y", "spotify-mcp@latest"]
env:     { "SPOTIFY_CLIENT_ID": "..." }
```

Create an app at the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard),
add `http://127.0.0.1:8888/callback` as a redirect URI **exactly**, then authorise
once — `$env:SPOTIFY_CLIENT_ID="..."; npx spotify-mcp@latest auth`. Tokens cache in
`%USERPROFILE%\.spotify-mcp\tokens.json` and refresh themselves. No client secret:
it uses PKCE.

## Figma

Read Figma files — nodes, styles, layout, images — through the community
[Framelink](https://github.com/GLips/Figma-Context-MCP) server:

```
name:    figma
type:    stdio
command: npx
args:    ["-y", "figma-developer-mcp", "--stdio"]
env:     { "FIGMA_API_KEY": "figd_..." }
```

Token: Figma → avatar → **Settings → Security → Personal access tokens →
Generate new token**, `File content: Read-only` scope is enough. Copy it once —
it does not show again. All of its tools are reads, so they run ungated.

## Gmail (Legacy)

Read, search, and (gated) send email.
> [!NOTE]
> Gmail integration has been removed from this machine's default configuration in favor of the direct IMAP + SMTP route which requires no OAuth project setup. If you still wish to run a custom Gmail MCP server, community servers exist (e.g., `@gongrzhe/server-gmail-autoauth-mcp`). All require your own Google OAuth credentials (below).

```
name:    gmail
type:    stdio
command: npx
args:    ["-y", "@gongrzhe/server-gmail-autoauth-mcp"]
```

This one takes no env var: it looks for `gcp-oauth.keys.json` in the working
directory or `%USERPROFILE%\.gmail-mcp\`, and refuses to start without it. Put
the OAuth JSON there, then authorise once with
`npx @gongrzhe/server-gmail-autoauth-mcp auth` before enabling the server.
(Other Gmail servers use env vars instead — read whichever one you pick.)

## Calendar (Legacy)

Read/create/update events (writes gated).
> [!NOTE]
> Calendar integration has been removed from this machine's default configuration in favor of the read-only ICS route. If you still wish to run a custom Google Calendar MCP server, community servers exist (e.g., `@cocal/google-calendar-mcp` or `mcp-google-calendar`). All require your own Google OAuth credentials (below).

```
name:    calendar
type:    stdio
command: npx
args:    ["-y", "@cocal/google-calendar-mcp"]
env:     { "GOOGLE_OAUTH_CREDENTIALS": "D:\\Hermes\\config\\google_credentials.json" }
```

Authorise once before enabling it: `npx @cocal/google-calendar-mcp auth` (it reads
the same `GOOGLE_OAUTH_CREDENTIALS` path).

---

## Google OAuth (Gmail + Calendar) — one-time, on your side

Hermes cannot do this headless; it is account access you must grant.

1. **Google Cloud Console** → create (or pick) a project.
2. **APIs & Services → Enable APIs** → enable **Gmail API** and **Google
   Calendar API**.
3. **OAuth consent screen** → External → add yourself under **Test users** (a
   test-mode app avoids Google's verification review).
4. **Credentials → Create credentials → OAuth client ID → Desktop app** →
   download the JSON. Save it where the server's env var points
   (e.g. `%HERMES_HOME%\config\google_credentials.json`) — this is a secret; keep
   it out of git.
5. Run each server's `auth` command once (above). It opens a browser consent and
   caches a refresh token. Grant only the scopes you need (read-only vs
   send/modify) — the server's README lists them.

Saving the server list reconnects the live hub, so no restart is needed. To check what
actually connected — as opposed to what is configured — call `GET /api/mcp/tools`; it
reports the connected servers, every tool name, and which of them are gated. A server that
failed to start is skipped silently apart from a console warning, and the agent then tells
you it has no such access at all.

## Security

- **File scope** is the whole safety story for filesystem — the server can reach
  exactly the roots you list, nothing above them.
- **Writes are gated in web chat** — the agent cannot send an email or delete a
  file on its own; a human runs those. Do not remove the gate in
  `hermes/mcp_risk.py` without replacing it with an explicit confirm step.
- **Credentials are secrets** — store OAuth JSON under `config\`, never commit it,
  never paste it into a task or chat.
- Grant the **least Google scope** that does the job (read-only where possible).
