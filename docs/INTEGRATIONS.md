# Integrations — file, browser, Gmail, calendar

Hermes controls external systems through **MCP servers**, not bespoke code. Each
capability is a small server process Hermes connects to; its tools then appear to
the agent as function calls. Add servers in the **MCP panel** at
`http://127.0.0.1:8799` (or edit `%HERMES_HOME%\config\mcp.json`), no code change.

## Two surfaces, one gate

- **Telegram planner** (`/task ...`) — already calls MCP tools inside an engine
  run. Adding a server is enough.
- **Web chat / voice** — the conversational agent gets the same tools. **Reads
  run immediately; writes/sends/deletes are gated**: the agent proposes the
  action and reports it is waiting for confirmation, but does **not** execute it.
  Run a gated (write) action deliberately via Telegram `/task`, or approve it
  through the confirm flow. The read/write split is decided in
  `hermes/mcp_risk.py` from the tool name (a verb heuristic; unknown verbs are
  gated, never run).

Destructive-by-nature tools (send email, delete file, submit a form) are risky by
this rule. Reads (list, search, read, screenshot) are not.

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
