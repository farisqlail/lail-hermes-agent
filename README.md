# Hermes Agent

A Windows-local, **Telegram-driven** orchestrator for coding and testing tasks. You send a task
in a Telegram chat; Hermes plans it with a NVIDIA NIM model, delegates the actual coding to the
CLI agents you already have (**Claude Code** and **Antigravity**), builds Android APKs, tests the
result in a headless browser or an Android emulator, and reports back — all configured from a local
web UI.

Hermes is an **orchestrator, not a coder**. Its own brain (a NVIDIA NIM / OpenAI-compatible model)
plans and drives; `claude -p` and `agy -p` do the code writing.

## How it works

```
Telegram  ──▶  telegram_bridge  ──▶  orchestrator (NVIDIA NIM)
  ▲                │                        │  plan steps, pick engine
  │                ▼                        ▼
  │           web_ui (FastAPI)         engine_runner
  │           127.0.0.1:8799           ├─ claude -p "..."
  │                                    └─ agy -p "..."
  │                                    build_runner   (gradle / flutter → APK)
  │                                    test_runner    (playwright / adb+emulator)
  │           mcp_hub ◀──tools──▶ orchestrator
  └──── status / artifacts ◀────────────┘
```

## Features

- **Telegram control** with a strict numeric user-ID whitelist (non-listed senders are rejected).
- **Two coding engines** driven headlessly: Claude Code (`claude -p`) and Antigravity (`agy -p`),
  auto-selected or overridden per task.
- **APK builds** with automatic project-type detection (Flutter / React Native / native Android).
- **Testing** in a headless browser (Playwright) or an Android emulator (adb), returning screenshots.
- **Local web UI** (`127.0.0.1:8799`) for settings, secrets (masked), an MCP-server manager, and a
  live task dashboard.
- **MCP bridge** exposing MCP tools to the NIM brain as OpenAI function calls *(transport wiring is a
  documented follow-up — see below)*.
- **SQLite session store** — tasks, steps, logs, and artifacts persist and survive restarts.

## Layout

```
E:\Hermes\
├─ app\          # this repo — hermes package + tests
├─ config\       # config.yaml, .env (secrets), mcp.json   (created at install)
├─ projects\     # per-task workspaces
├─ artifacts\    # apk, screenshots, logs
├─ install.ps1   # installer  (also in app/deploy/)
└─ start.bat     # launcher    (also in app/deploy/)
```

## Install

Prerequisites on PATH: `python` 3.11+, `claude` (Claude Code CLI), `agy` (Antigravity CLI),
`adb`/`emulator` (Android SDK). For browser testing, the optional `[browser]` extra installs
Playwright.

```powershell
powershell -ExecutionPolicy Bypass -File E:\Hermes\install.ps1
E:\Hermes\start.bat
```

Then open <http://127.0.0.1:8799> and fill in: NVIDIA API key (build.nvidia.com), model, Telegram bot
token, your allowed Telegram user ID, Android SDK path, and emulator AVD.

## Develop / test

```bash
cd app
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pytest -q          # 37 passing
```

Tests are hermetic — no real network, NIM, emulator, or `claude`/`agy` binaries. Engines, build,
test, MCP transport, and the NIM planner are all injected as fakes.

## Known follow-ups

- **MCP transport** — `main.real_mcp_session_factory` is a stub; MCP is inert (but safe) until real
  stdio/SSE sessions are wired.
- **Emulator launch** — `Adb.launch` uses a `%PKG%` placeholder; the real app package id must be
  threaded from the build before emulator tests are trustworthy.
- **Test timeouts** — `test_runner` does not yet enforce `timeout_s` (hang risk on a stuck
  emulator/browser).

## Docs

- [`docs/design-spec.md`](docs/design-spec.md) — architecture and decisions
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — task-by-task build plan
- [`docs/SMOKE.md`](docs/SMOKE.md) — smoke-test checklist

## Security notes

- Secrets live in `config/.env`, are masked in the UI, and are never sent to Telegram or logs.
- The web UI binds `127.0.0.1` only.
- Coding engines run inside an isolated per-task project directory.
