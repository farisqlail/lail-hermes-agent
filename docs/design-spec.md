# Hermes Agent — Design Spec

- **Date:** 2026-07-14
- **Status:** Approved (brainstorming complete)
- **Target platform:** Windows 10, local PC. Data root is `%HERMES_HOME%` (operator's choice);
  the app runs from the repo checkout.

## 1. Purpose

Hermes is a locally-installed orchestration agent, driven by Telegram chat, that
receives coding/testing tasks and executes them by driving existing terminal
coding agents (Claude Code CLI and Antigravity CLI). Hermes can build Android
APKs and test results in a headless browser or an Android emulator, then report
status and artifacts back to the Telegram chat. A local web UI provides settings
and a task dashboard.

Hermes is an **orchestrator**, not a coder itself. The actual code writing is
delegated to Claude Code (`claude -p`) and Antigravity (`agy -p`). Hermes' own
brain (a NVIDIA NIM model) plans tasks, selects an engine, runs build/test, and
reports.

## 2. Constraints & Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Coding engines | Claude Code CLI + Antigravity CLI | Already installed; both have non-interactive print mode (`claude -p`, `agy -p`) |
| Hermes brain | NVIDIA NIM (build.nvidia.com), OpenAI-compatible | User's API source |
| Language/stack | Python 3.11+ | Mature Windows libs for all needs |
| Install location | `%HERMES_HOME%\` data root, app from the repo checkout | Originally a fixed absolute path; made configurable so the install is not tied to one machine's drive letters |
| Settings UI | Local web (FastAPI, `127.0.0.1:8799`) | Lightweight, doubles as dashboard |
| MCP support (v1) | Orchestrator/NIM only (option B) | User choice; engine-level MCP deferred |

**Corrected 2026-07-21:** an earlier revision claimed `agy -p "prompt" --output-format ...`.
It does not — `agy --help` lists no `--output-format` at all. Only `claude` emits structured
output (`--output-format json`); `agy` is read as plain text. `agy` does have `--print-timeout`,
which defaults to 5m and must be raised to match the configured step budget.
Claude Code supports `claude -p "prompt"`. Both drivable via subprocess.

## 3. Architecture

```
Telegram  ──▶  telegram_bridge  ──▶  orchestrator (NVIDIA NIM)
  ▲                │                        │  plan steps, pick engine
  │                ▼                        ▼
  │           web_ui (FastAPI)         engine_runner
  │           127.0.0.1:8799           ├─ claude -p "..."
  │                                    └─ agy -p "..."
  │                                         │  code result (diff/commit)
  │                                    build_runner
  │                                    ├─ APK: gradle / flutter build
  │                                    test_runner
  │                                    ├─ browser: playwright headless
  │                                    └─ emulator: adb + emulator
  │           mcp_hub ◀──tools──▶ orchestrator
  └──── status / artifacts ◀────────────┘
```

## 4. Components

Each unit has one purpose, a defined interface, and is testable in isolation.

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `telegram_bridge` | Receive tasks, stream status/logs, send artifacts | python-telegram-bot |
| `orchestrator` | NIM brain: parse task → step plan → select engine → drive execution → recover on failure | OpenAI SDK → NIM |
| `engine_runner` | Run `claude -p` / `agy -p` in project dir, capture output, enforce timeout | subprocess/asyncio |
| `build_runner` | Detect project type, build APK | shell (gradle/flutter) |
| `test_runner` | Browser test (playwright) / emulator test (adb+emulator), capture screenshots | playwright, Android SDK |
| `mcp_hub` | Connect MCP servers, expose their tools as OpenAI function schemas to NIM, execute `tools/call` | MCP client |
| `session_store` | Task state, logs, artifact index (SQLite at `%HERMES_HOME%\hermes.db`) | sqlite3 |
| `config` | Load/save settings and secrets | pydantic |
| `web_ui` | Settings pages + task dashboard | FastAPI + minimal HTML/JS |

## 5. Task Flow

1. Telegram message (from a whitelisted user): e.g. *"build a Flutter counter app, build APK, test on emulator"*.
2. `orchestrator` (NIM) produces a structured step plan:
   ```json
   {
     "steps": [
       {"type": "code",  "engine": "claude", "prompt": "..."},
       {"type": "build", "target": "apk"},
       {"type": "test",  "mode": "emulator"}
     ]
   }
   ```
3. `engine_runner` sends the coding prompt to Claude Code / Antigravity in an
   isolated project dir `%HERMES_HOME%\projects\<task-id>`.
4. `build_runner` detects project type and builds (e.g. Flutter → `flutter build apk`).
5. `test_runner` starts the emulator, `adb install`, runs, captures screenshots.
6. `telegram_bridge` replies with per-step status, the APK, and screenshots.

### Engine selection (mode `auto`)

- Large / multi-file / refactor task → Antigravity (`agy`, parallel subagents).
- Quick / 1–2 file / fix task → Claude Code (`claude -p`).
- Default follows settings; per-task override supported: `engine=claude`.

### Project type detection (for build)

- `pubspec.yaml` → Flutter
- `package.json` + `android/` → React Native
- `build.gradle` → native Android

## 6. Web UI (`127.0.0.1:8799`)

### Settings page (persisted to `%HERMES_HOME%\config`)

| Field | Notes |
|-------|-------|
| NVIDIA API Key | masked, stored in `.env` |
| NVIDIA Base URL | default `https://integrate.api.nvidia.com/v1` |
| Model | dropdown; badge "tool-calling ✓" on supported models |
| Telegram Bot Token | masked |
| Allowed Telegram User ID(s) | whitelist — required |
| Default engine | Claude Code / Antigravity / auto |
| Projects path | default `%HERMES_HOME%\projects` |
| Android SDK path | for adb/emulator/gradle |
| Emulator AVD | dropdown from `emulator -list-avds` |
| Default test mode | browser / emulator / none |
| Step timeouts | coding / build / test |

Buttons: **Save**, **Test Connection** (ping NIM + check `claude`/`agy`/`adb` on PATH), **Restart Hermes**.

### MCP Servers tab

- Add/edit/delete/toggle MCP servers.
- Fields: name, type (stdio/http), command/url, args, env vars.
- **Test** button (connect + list tools) before save.
- Persisted to `%HERMES_HOME%\config\mcp.json`.
- New server → security flag + confirmation prompt.

### Dashboard

- Task list (id, status, engine, timestamps), live via polling/SSE.
- Task detail → streamed logs, steps, artifact links (APK/screenshots).
- **Stop** button for a running task.

## 7. MCP for Orchestrator (option B)

`mcp_hub` bridges MCP to the OpenAI-compatible NIM brain:

```
NIM (orchestrator) ──tools=[mcp functions]──▶ decide tool call
      ▲                                            │
      │  tool result                               ▼
   mcp_hub  ◀────── tools/call ──────  MCP server (fs/github/etc.)
```

- Connects stdio or HTTP/SSE MCP servers.
- `tools/list` → translate MCP tool schema → OpenAI function schema.
- NIM decides tool calls → `mcp_hub` executes `tools/call` → result fed back.
- Requires a NIM model with function/tool calling
  (deepseek-v3, qwen2.5-coder-32b, Nemotron all qualify).
- Coding engines (Claude Code / Antigravity) do **not** receive MCP in v1
  (engine-level MCP is a later option A/C).

## 8. Security

Hermes runs shell commands on the local PC, so guardrails are mandatory.

- **Telegram user-ID whitelist.** Tasks from non-listed IDs are rejected and logged. Non-negotiable.
- Secrets stored in `%HERMES_HOME%\config\.env`, masked in UI, never sent to Telegram or logs.
- Coding engines run inside an isolated project dir (`%HERMES_HOME%\projects\<task-id>`), never a drive root.
- **Optional confirmation gate:** tasks that touch files outside the project dir, delete files, or run `git push` prompt for Telegram confirmation first.
- Web UI binds `127.0.0.1` only (not `0.0.0.0`) — not exposed to LAN.
- MCP servers execute external code: each new server is flagged and requires confirmation; MCP secrets are masked, never logged.

## 9. Error Handling

- Per-step timeouts (defaults: coding 15m, build 20m, test 10m; configurable in UI).
- Engine failure → capture stderr → NIM analyzes → one corrected retry → if still failing, report to Telegram with an error excerpt.
- Build/test failure → logs retained; artifact links sent.
- Hermes crash → task state in SQLite → resumable.
- All step output logged to `%HERMES_HOME%\artifacts\<task-id>\`.

## 10. Testing (of Hermes itself)

- **Unit:** orchestrator plan parsing, config load/save, project-type detection, whitelist gate, MCP schema translation.
- **Integration (mocked):** `engine_runner` with fake `claude`/`agy` echo scripts — verify output capture and timeout; `mcp_hub` against a stub MCP server.
- **Smoke (manual):** one Flutter counter task end-to-end → APK + emulator screenshot.
- Strategy: stub NIM/emulator early; final smoke uses the real stack.

## 11. Directory Layout

**Corrected 2026-07-21.** This spec originally fixed the install root at one absolute path and
placed the source *inside* it. Neither holds. The data root is wherever `HERMES_HOME` points,
and the app runs from the repo checkout — the installer no longer copies source anywhere.

```
%HERMES_HOME%\          # data root — operator's choice, named by the env var
├─ config\
│  ├─ config.yaml
│  ├─ .env              # secrets
│  └─ mcp.json          # MCP server list
├─ projects\            # per-task workspaces
├─ artifacts\           # apk, screenshots, logs
├─ hermes.db            # session store
└─ start.bat            # stub: sets HERMES_HOME, calls the repo's deploy\start.bat

<repo>\                 # checkout — operator's choice, independent of the data root
├─ hermes\              # package
├─ tests\
├─ docs\                # this spec
├─ deploy\              # install.ps1, start.bat
└─ .venv\               # virtualenv
```

## 12. Installation

`deploy\install.ps1` (PowerShell):

1. Check prerequisites: Python 3.11+, `claude`, `agy`, `adb`/`emulator`, `flutter`/`gradle` on PATH → report anything missing.
2. Create the `%HERMES_HOME%\` structure and persist `HERMES_HOME` for the current user.
3. Create the venv in the repo checkout and `pip install` deps.
4. Create empty `config.yaml` + `.env` (filled via UI).
5. Write a `start.bat` stub into `%HERMES_HOME%` that sets `HERMES_HOME` and delegates to
   `<repo>\deploy\start.bat`.
6. Open `http://127.0.0.1:8799` for first-time setup.

**Set `HERMES_HOME` before running the installer.** Its fallback and the one in
`hermes/paths.py` are different absolute paths left over from the first machine this ran on,
so an unset variable gives `start.bat` and `python -m hermes.main` two different data roots,
with no error from either.

Usage:
- `%HERMES_HOME%\start.bat` → start bot + web UI.
- Send tasks via Telegram chat.

## 13. Out of Scope (v1)

- Antigravity desktop GUI automation (CLI headless only).
- Engine-level MCP for Claude Code / Antigravity (orchestrator MCP only).
- Remote/LAN access to the web UI.
- Non-Windows platforms.
