# Hermes — Unfinished Tasks / Backlog

Status: all 14 build-plan tasks done, final review passed, **37 tests pass**, pushed to
`origin/master`. The items below are the remaining work, ordered by priority.

## P1 — Correctness (do before trusting results)

- [ ] **I2 — Emulator launch uses a placeholder package.** `hermes/main.py` `Adb.launch` runs
  `monkey -p "%PKG%" ...` — `%PKG%` is never replaced, so the emulator test launches nothing and
  returns green regardless (false positive). Thread the real application id from the build/manifest
  (Flutter/RN/Gradle) into `Adb.launch`, and set it on the task before `test_emulator`.
- [ ] **I3 — `test_runner` ignores `timeout_s`.** `test_emulator` / `test_browser` accept a timeout
  but never enforce it → a stuck emulator boot, install, or `page.goto` hangs the task forever. Wrap
  the bodies in `asyncio.wait_for(..., timeout=timeout_s)` and return a timed-out `TestResult`.

## P2 — Requested feature not yet functional

- [ ] **MCP option-B: wire real transport.** `hermes/main.py` `real_mcp_session_factory` is a stub
  (raises `NotImplementedError`; startup is guarded so it only skips servers, never crashes). Implement
  real sessions: stdio via `mcp.client.stdio`, HTTP/SSE via `mcp.client.sse`. Each session must expose
  `async list_tools()` and `async call_tool(name, arguments)` (see `hermes/mcp_hub.py` for the shape
  the hub expects). After this, the `/api/mcp/test` endpoint and orchestrator tool-calls go live.
- [ ] **Add a cap to the NIM tool-call loop** (`build_nim_planner` `while True`) once MCP is live —
  bound the number of tool round-trips to avoid an infinite loop on a misbehaving model/tool.

## P3 — Robustness / quality

- [ ] **web_ui POST validation** — type request bodies as the real pydantic models
  (`config.Settings`, `list[config.McpServer]`) so malformed input returns HTTP 422, not 500.
- [ ] **Fire-and-forget crash reporting** — `main.on_msg` does `asyncio.create_task(handle_task(...))`
  with no done-callback; a crash outside `run_task`'s try/except is silently dropped. Add a callback
  that reports failures to the Telegram chat.
- [ ] **Confirmation gate** (from the design spec §8, deliberately deferred in v1) — tasks that touch
  files outside the project dir, delete files, or `git push` should prompt for Telegram confirmation
  (inline keyboard) before running.
- [ ] **Cosmetic** — remove unused `import json` in `config.py`; move `import json` out of the
  `build_nim_planner` loop.

## P4 — Test coverage gaps

- [ ] Orchestrator failure-path tests (planning error, code/build step failure halts task).
- [ ] `test_runner` emulator failure branches (start/install/launch/screencap failures).
- [ ] Orchestrator `test`-step real branch (emulator/browser via injected deps).
- [ ] Silence the starlette `TestClient` deprecation warning so test output is pristine.

## Not started at all (potential future scope)

- [ ] Real end-to-end smoke run (needs your NVIDIA key, Telegram token, an AVD) — see `docs/SMOKE.md`.
- [ ] HTML forms for the settings / MCP pages (currently JSON API only; dashboard is minimal HTML).
- [ ] Resume-after-crash logic actually re-driving an interrupted task (state persists, but nothing
  re-runs it on restart yet).
