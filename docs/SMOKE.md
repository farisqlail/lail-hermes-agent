# Hermes — Smoke Test

## Automated (done, no credentials needed)

- Full unit suite: `E:\Hermes\app\.venv\Scripts\python -m pytest -q` → all green.
  (Deliberately not a count: a hardcoded number rots on the next commit.)
- Web UI serves on `127.0.0.1:8799`: `GET /`, `/api/tasks`, `/api/settings`, `/api/secrets/status` all 200; secrets returned as booleans only (masked). ✅
- `hermes.main` imports; `main.run` is a coroutine; `Adb` exposes async `is_running/start/install/launch/screencap`; `build_nim_planner` callable. ✅

## Manual end-to-end (needs your credentials — pending)

Prereqs on PATH: `python` 3.11+, `claude` (Claude Code CLI), `agy` (Antigravity CLI),
`adb`/`emulator` (Android SDK). For browser tests: `pip install -e ".[browser]"` +
`python -m playwright install chromium`.

1. Run installer: `powershell -ExecutionPolicy Bypass -File E:\Hermes\install.ps1`
2. Start: `E:\Hermes\start.bat`
3. Open `http://127.0.0.1:8799`, fill settings:
   - NVIDIA API key (build.nvidia.com), model (e.g. `deepseek-ai/deepseek-v3`)
   - Telegram bot token (BotFather)
   - **Allowed Telegram user ID** (your numeric id — required; others are rejected)
   - Android SDK path, emulator AVD name (from `emulator -list-avds`)
4. From Telegram, send: *"buat app counter Flutter, build APK, test di emulator"*
5. Confirm:
   - Task appears on the dashboard, engine (`claude`/`agy`) runs in `E:\Hermes\projects\<task-id>`
   - APK artifact produced under `E:\Hermes\artifacts\<task-id>\`
   - Emulator screenshot returned to Telegram
6. Verify the structured-output path against the live `claude` — the two things fakes
   cannot settle. Open `E:\Hermes\artifacts\<task-id>\step-0-engine.log`:
   - **Does the envelope arrive?** The attempt header should carry `session: <uuid>` and
     `cost: $…`. If it does not, every claude run silently fell back to text mode.
   - **Does the engine honour the completion contract?** A step reported as
     `coded (confirmed done, 1 round(s))` means the model ended on the sentinel. If every
     step instead reports `completion not confirmed`, the contract is being ignored and each
     step is burning all three rounds — settle this before trusting the loop.
   - **Does `--resume` restore context?** Force a second round (a step the engine cannot
     finish in one session). Round two's prompt should be the short continuation only; check
     from its output that the engine still knew the task.
7. Record results below.

## Known follow-ups before full MCP works

- `hermes/main.py: real_mcp_session_factory` is a stub (`NotImplementedError`).
  MCP-for-orchestrator (option B) is inert until this is wired to real
  `mcp.client.stdio` / SSE sessions. With zero MCP servers configured, startup is
  unaffected; adding an enabled MCP server will fail at `hub.connect()` until filled.

## Results

_(fill after the manual run)_
