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

Each server is one row in the MCP panel:

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

## Gmail

Read, search, and (gated) send email. Community servers exist — e.g.
`@gongrzhe/server-gmail-autoauth-mcp`; verify the latest package before trusting
it. All require **your own Google OAuth credentials** (below).

```
name:    gmail
type:    stdio
command: npx
args:    ["-y", "@gongrzhe/server-gmail-autoauth-mcp"]
env:     { "GMAIL_CREDENTIALS_PATH": "D:\\Hermes\\config\\google_credentials.json" }
```

(Env var names vary by server — read its README.)

## Calendar

Read/create/update events (writes gated). Community servers exist — e.g.
`@cocal/google-calendar-mcp` or `mcp-google-calendar`; again, verify the package.
Same Google OAuth credentials as Gmail.

```
name:    calendar
type:    stdio
command: npx
args:    ["-y", "@cocal/google-calendar-mcp"]
env:     { "GOOGLE_OAUTH_CREDENTIALS": "D:\\Hermes\\config\\google_credentials.json" }
```

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
5. First tool call opens a browser consent once; the server caches a refresh
   token next to the credentials. Grant only the scopes you need (read-only vs
   send/modify) — the server's README lists them.

Restart Hermes after adding servers so discovery picks up the new tools.

## Security

- **File scope** is the whole safety story for filesystem — the server can reach
  exactly the roots you list, nothing above them.
- **Writes are gated in web chat** — the agent cannot send an email or delete a
  file on its own; a human runs those. Do not remove the gate in
  `hermes/mcp_risk.py` without replacing it with an explicit confirm step.
- **Credentials are secrets** — store OAuth JSON under `config\`, never commit it,
  never paste it into a task or chat.
- Grant the **least Google scope** that does the job (read-only where possible).
