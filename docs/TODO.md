# Hermes — Unfinished Tasks / Backlog

Status: all 14 build-plan tasks done, plus the P1–P4 backlog below (**63 tests pass**,
warning-free output). Remaining work is the "not started" section at the bottom.

## P1 — Correctness (do before trusting results)

- [x] **I2 — Emulator launch uses a placeholder package.** `project_detect.detect_app_id`
  reads the real application id from gradle (`applicationId`, groovy + kts, Flutter/RN/plain
  layouts) with an AndroidManifest fallback; the orchestrator threads it into
  `test_emulator` → `Adb.launch(pkg)`. Missing app id now fails the test step explicitly.
- [x] **I3 — `test_runner` ignores `timeout_s`.** Both `test_emulator` and `test_browser`
  bodies are wrapped in `asyncio.wait_for(..., timeout=timeout_s)` and return a timed-out
  `TestResult` instead of hanging.

## P2 — Requested feature not yet functional

- [x] **MCP option-B: wire real transport.** `mcp_hub.RealMcpSession` implements stdio
  (`mcp.client.stdio`) and HTTP/SSE (`mcp.client.sse`) sessions, opened lazily on first use
  so `McpHub.connect` stays non-blocking and never crashes startup. `main.real_mcp_session_factory`
  and the hub's default factory both use it; `/api/mcp/test` and orchestrator tool-calls are live.
  `McpHub.list_tools` also skips (and logs) servers that fail at discovery time.
- [x] **Cap the NIM tool-call loop.** `build_nim_planner` bounds tool round-trips at
  `MAX_TOOL_ROUNDS = 8` and raises a clear error instead of looping forever.

## P3 — Robustness / quality

- [x] **web_ui POST validation** — request bodies typed as pydantic models
  (`config.Settings`, `list[config.McpServer]`, `SecretsUpdate`, `config.McpServer`);
  malformed input returns HTTP 422.
- [x] **Fire-and-forget crash reporting** — `main` attaches a `crash_reporter` done-callback
  to every `asyncio.create_task` bridge invocation; crashes are logged and reported to the
  Telegram chat.
- [x] **Confirmation gate** (design spec §8) — `telegram_bridge.detect_risky` flags tasks
  that `git push`, delete files, or reference paths outside the project dir; such tasks are
  held in `awaiting_confirm` and run/cancel via an inline keyboard (`confirm:<task_id>:yes|no`).
  Toggle with `Settings.confirm_risky` (default on).
- [x] **Cosmetic** — unused `import json` removed from `config.py`; `import json` hoisted to
  module level in `main.py`.

## P4 — Test coverage gaps

- [x] Orchestrator failure-path tests (planning error, code-step failure halts task).
- [x] `test_runner` emulator failure branches (start/install/launch/screencap, timeout, no pkg).
- [x] Orchestrator `test`-step real branch (emulator with app id threading, browser via injected deps).
- [x] Starlette `TestClient` deprecation warning silenced via pytest `filterwarnings`.

## Not started at all (potential future scope)

- [ ] Real end-to-end smoke run (needs your NVIDIA key, Telegram token, an AVD) — see `docs/SMOKE.md`.
- [ ] HTML forms for the settings / MCP pages (currently JSON API only; dashboard is minimal HTML).
- [ ] Resume-after-crash logic actually re-driving an interrupted task (state persists, but nothing
  re-runs it on restart yet).
