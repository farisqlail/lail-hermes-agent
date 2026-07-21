# Hermes Agent

A Windows-local, **Telegram-driven** orchestrator for coding and testing tasks. You send a task
in a Telegram chat; Hermes plans it with a NVIDIA NIM model, delegates the actual coding to the
CLI agents you already have (**Claude Code** and **Antigravity**), builds Android APKs, tests the
result in a headless browser or an Android emulator, and reports back — all configured from a local
web UI.

Hermes is an **orchestrator, not a coder**. Its own brain (a NVIDIA NIM / OpenAI-compatible model)
plans and drives; `claude -p` and `agy -p` do the code writing.

## How it works

<table>
  <tr>
    <td width="25%" align="center">
      <h3>1️⃣ Send</h3>
      <b>Telegram</b><br/><br/>
      <code>/task buat app counter Flutter</code><br/><br/>
      <sub>Numeric user-ID whitelist; risky tasks (git push / delete / outside paths) ask for ✅/❌ confirmation first</sub>
    </td>
    <td width="25%" align="center">
      <h3>2️⃣ Plan</h3>
      <b>NVIDIA NIM brain</b><br/><br/>
      <code>{"steps":[code, build, test]}</code><br/><br/>
      <sub>An OpenAI-compatible NIM model plans the steps and picks an engine; MCP tools available as function calls</sub>
    </td>
    <td width="25%" align="center">
      <h3>3️⃣ Execute</h3>
      <b>Engines &amp; runners</b><br/><br/>
      <code>claude -p</code> · <code>agy -p</code><br/><br/>
      <sub>Coding in an isolated per-task dir, APK build (Flutter/RN/Gradle), test via Playwright or adb + emulator</sub>
    </td>
    <td width="25%" align="center">
      <h3>4️⃣ Report</h3>
      <b>Back to your chat</b><br/><br/>
      <code>step 0 [code]: done ✔</code><br/><br/>
      <sub>Live progress per step; APK + screenshots land in the dashboard and SQLite store</sub>
    </td>
  </tr>
</table>

```mermaid
flowchart LR
    TG(["📱 Telegram<br/>/task ..."])

    subgraph HERMES["🏛️ LAIL HERMES"]
        direction LR
        BR["🔐 telegram_bridge<br/><sub>whitelist · confirm gate</sub>"]
        OR["🧠 orchestrator<br/><sub>NVIDIA NIM planner</sub>"]
        HUB["🔌 mcp_hub<br/><sub>stdio / SSE tools</sub>"]

        subgraph EXEC["execution"]
            direction TB
            ENG["⚙️ engine_runner<br/><sub>claude -p · agy -p</sub>"]
            BLD["📦 build_runner<br/><sub>flutter / gradle → APK</sub>"]
            TST["🧪 test_runner<br/><sub>playwright · adb emulator</sub>"]
            ENG --> BLD --> TST
        end

        UI["🖥️ web_ui · FastAPI<br/><sub>127.0.0.1:8799</sub>"]
        DB[("🗄️ SQLite<br/><sub>tasks · logs · artifacts</sub>")]

        BR --> OR
        OR <-.->|"tool calls"| HUB
        OR --> EXEC
        OR --> DB
        UI --- DB
    end

    TG -->|"/task"| BR
    OR -.->|"status · APK · screenshots"| TG

    classDef ext fill:#229ED9,stroke:#1a7fb0,color:#fff
    classDef brain fill:#76B900,stroke:#5a8c00,color:#fff
    classDef store fill:#f5f0e6,stroke:#c9b896,color:#333
    class TG ext
    class OR brain
    class DB store
```

## Features

- **Telegram control** with a strict numeric user-ID whitelist (non-listed senders are rejected).
  `/help` shows the full command guide, `/projects` lists the registered `@name`s, and the
  commands are published to Telegram's `/` autocomplete menu.
- **Two coding engines** driven headlessly: Claude Code (`claude -p`) and Antigravity (`agy -p`),
  auto-selected or overridden per task. Model and effort are configurable per engine from the
  web UI (`--model` for both, `--effort` for claude only — `agy` has no such flag).
- **Engine completion contract** — every code step asks the engine to print a completion
  sentinel after verifying its own work; a session that errors or exits without it gets up to
  two fix-up sessions, and the full transcript is saved as a task artifact.
- **Structured engine output** — `claude` runs with `--output-format json`, so Hermes reads the
  model's own closing message, the session id, the cost and any API error rather than scraping
  stdout. Fix-up rounds `--resume` that session instead of re-sending the task and the previous
  output. `agy` has no such flag, so it stays on text and fresh sessions — the same fallback
  path taken whenever an envelope cannot be parsed.
- **Planner project context** — before planning, the planner is told what it is planning
  against: an existing registered project and its detected type, or a fresh empty workspace.
  For a project with no Android markers it is told outright not to emit a `build` step or an
  emulator test — the conclusion is drawn in Python rather than left to the model.
- **APK builds** with automatic project-type detection (Flutter / React Native / native Android).
- **Testing** in a headless browser (Playwright) or an Android emulator (adb), returning screenshots.
- **Local web UI** (`127.0.0.1:8799`) for settings (engine model/effort dropdowns backed by
  live `agy models` output where reachable), secrets (masked), an MCP-server manager, a
  Projects Registry panel (add/edit/delete with an OK/Missing badge per path), and a live task
  dashboard.
- **MCP bridge** exposing MCP tools to the NIM brain as OpenAI function calls (stdio + HTTP/SSE
  transports, lazily connected, every remote call time-bounded).
- **Existing projects** — register a name-to-path map in settings, then aim a task at it with
  `/task @myprofit fix login`. Without `@`, a fresh workspace is created as before.
- **Confirmation gate** — tasks that `git push`, delete files, touch paths outside the project
  dir, or target a registered project with no usable git undo (dirty tree, not a repo,
  git-ignored, or git unavailable) wait for an inline-keyboard ✅/❌ in Telegram before running.
- **Risky-but-ungated disclosure** — with `confirm_risky` off, risky tasks still run, but the
  queued message says exactly what the gate saw instead of proceeding silently.
- **SQLite session store** — tasks, steps, logs, and artifacts persist and survive restarts.
- **Startup recovery** — on start, tasks stranded in `running`/`queued`/`awaiting_confirm` are
  retired to `interrupted` and each affected chat gets one digest telling them what died and
  what to resubmit.
- **Self-healing launcher** — `start.bat` auto-restarts Hermes 5s after any crash/exit.

## Working on an existing project

Register the project once in the **Projects Registry panel** on the settings tab at
http://127.0.0.1:8799 — a name plus an absolute folder path per project (cards show an
OK/Missing badge; the folder itself is never touched). Then aim a task at it with the
`@name` sigil:

```
/task @myprofit fix the login bug
```

Without `@`, Hermes creates a fresh workspace under `projects_path` as before.
`@name` is deliberately the *only* trigger — a bare "project myprofit" in prose
starts a new workspace, so that a folder named `app` or `test` can never be
matched out of ordinary task text.

An unregistered `@name` is rejected with the list of registered names; it does
not silently fall back to a new workspace. When no projects are registered at
all, the rejection instead says so and points at the settings UI. If the name
*is* registered but its directory has since been moved or deleted, Hermes
rejects the task with a different message pointing at the settings UI, instead
of the name list.

If the target has no usable git undo — uncommitted changes, not a git repo, git-ignored by
an enclosing repo, or git itself unavailable (missing binary, no subprocess support, or a
timeout) — Hermes asks for confirmation first (`confirm_risky` is on by default). With the
gate off, the task runs anyway but the queued message carries a warning listing what the
gate saw — never silently.

## Layout

Two locations, and they are independent. The app runs from this repo checkout
(`<repo>` below — wherever you cloned it). Runtime data lives under a separate
data root named by the `HERMES_HOME` environment variable (`%HERMES_HOME%`
below). Neither has a required location; put them wherever suits the machine.

```
%HERMES_HOME%\           # data root — you choose where
├─ config\               # config.yaml, .env (secrets), mcp.json
├─ projects\             # per-task workspaces
├─ artifacts\            # apk, screenshots, logs
├─ hermes.db             # task history
└─ start.bat             # stub → sets HERMES_HOME, calls deploy\start.bat in the repo

<repo>\                  # app dir (this checkout) — you choose where
├─ hermes\               # package
├─ tests\
└─ deploy\               # install.ps1 + start.bat (banner + auto-restart)
```

## Install

Prerequisites on PATH: `python` 3.11+, `claude` (Claude Code CLI), `agy` (Antigravity CLI),
`adb`/`emulator` (Android SDK). For browser testing, the optional `[browser]` extra installs
Playwright.

**Set `HERMES_HOME` first, explicitly.** The installer honours it and stores it for your user;
left unset, different entry points disagree about where the data root is (see below).

```powershell
[Environment]::SetEnvironmentVariable("HERMES_HOME", "D:\Hermes", "User")   # your choice
$env:HERMES_HOME = "D:\Hermes"                                             # this session too
powershell -ExecutionPolicy Bypass -File <repo>\deploy\install.ps1
& "$env:HERMES_HOME\start.bat"
```

### If you do not set it

The fallbacks were written for one particular machine and do not agree with each other:
`deploy\install.ps1` and `deploy\start.bat` fall back to `C:\Hermes`, while `hermes\paths.py`
falls back to `E:\Hermes`. Launching through `start.bat` and launching with
`python -m hermes.main` then read **different** config files, different registries, and
different task databases — with no error, because both roots are valid.

Setting `HERMES_HOME` explicitly removes the question entirely. Reconciling those defaults is
tracked in [`docs/TODO.md`](docs/TODO.md).

Then open <http://127.0.0.1:8799> and fill in: NVIDIA API key (build.nvidia.com), model, Telegram bot
token, your allowed Telegram user ID, Android SDK path, and emulator AVD.

## Planner evals

The unit suite proves the planner is *called* correctly. It cannot prove the planner *plans*
correctly — that is model behaviour, and it changes whenever the model, the temperature or the
system prompt changes.

```powershell
python -m hermes.evals                 # every case once
python -m hermes.evals --list          # case ids, no model calls
python -m hermes.evals --repeat 5      # how steady is a case?
python -m hermes.evals --only web-fix-detail-page
python -m hermes.evals --no-context    # ablation, see below
```

### Can the set fail?

A scorecard that reads 100% is worthless until you know it *can* read less. `--no-context`
plans every case with no project context, the way the planner worked before it was given one.
Cases whose task text pulls toward an APK on a project that has none are expected to fail
there. If a full run and an ablation run score the same, the set is not measuring the context
and needs a harder case, not a victory lap.

Baseline, measured 2026-07-21 on `deepseek-ai/deepseek-v4-flash` at temperature 0:

| Run | Result |
|-----|--------|
| `python -m hermes.evals` | **10/10** |
| `python -m hermes.evals --no-context` | **8/10** — `web-build-wording` and `web-apk-wording` fail |

Those two cases are the whole reason the set means anything. Without context they plan
`['code','build']` and `['code','build','test']` against a project with no Android markers,
the second reproducing the live failure of task `20260715-104754-5b44a5` exactly. The other
eight score identically with and without context, so on their own they could not tell a
planner that reads the project from one that guesses.

The first version of this golden set had only those eight, scored 8/8, and was worth nothing.

It drives the real `build_nim_planner` and the real context assembly — a local copy of either
would score itself instead of what production runs. It needs your NVIDIA key, and each case
costs one planner call.

Scoring is restricted to rules the system prompt already mandates: no `build` or emulator test
for a project that cannot produce an APK, no emulator test without a build before it, known
step types, and one code step for a fix task. Nothing scores taste — engine choice and prompt
wording vary between correct answers, so scoring them would measure noise.

Results are `PASS` / `FAIL` / **`ERROR`**. A model outage is an `ERROR` and never counts as a
quality regression. Exit codes: 0 clean, 1 a rule was violated, 2 nothing could be measured.

Deliberately not part of `pytest`: the result is a measurement, not a verdict, and a stochastic
signal wired into the suite either goes flaky or teaches everyone to ignore red. The scoring
rules themselves are pure functions and *are* unit-tested, in `tests/test_eval_rules.py`.

`Settings.planner_temperature` defaults to `0.0`. Planning emits JSON that must obey fixed
rules, so sampling randomness buys nothing and makes the same task plan differently run to run.

## Develop / test

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pytest -q
```

Tests are hermetic — no real network, NIM, emulator, or `claude`/`agy` binaries. Engines, build,
test, MCP transport, and the NIM planner are all injected as fakes.

## Known follow-ups

- **Resume-after-crash** — the startup sweep retires interrupted tasks and notifies the chat,
  but nothing re-drives them yet; resubmitting is manual.
- **Stale confirm buttons** — after a restart, taps on old ✅/❌ buttons do nothing (pending
  confirmations are in-memory); the restart digest tells the user to resubmit.
- **End-to-end smoke run** — whether a live `claude` honours the completion contract, and
  whether `--resume` restores a session's context, are both still unproven against fakes only;
  see [`docs/SMOKE.md`](docs/SMOKE.md).

See [`docs/TODO.md`](docs/TODO.md) for the full backlog history.

## Docs

- [`docs/design-spec.md`](docs/design-spec.md) — architecture and decisions
- [`docs/SMOKE.md`](docs/SMOKE.md) — smoke-test checklist
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — feature design specs
  (project registry, startup recovery)

## Security notes

- Secrets live in `config/.env`, are masked in the UI, and are never sent to Telegram or logs.
- The web UI binds `127.0.0.1` only.
- Coding engines run inside an isolated per-task project directory.
