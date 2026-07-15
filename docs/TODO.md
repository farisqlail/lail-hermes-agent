# Hermes — Unfinished Tasks / Backlog

Status: **full test suite passes (135), warning-free.** Branch `feat/project-registry`,
HEAD `193e532`, working tree clean.

Two features were built from specs in `docs/superpowers/specs/` via the plans in
`docs/superpowers/plans/`. **The @name registry is complete. Startup recovery is 3/5 done
and is NOT usable yet** — the sweep runs, but the dashboard cannot style the status it writes.

Per-task detail, review findings, and rationale live in `.superpowers/sdd/progress.md`.
Read it before resuming — it is the recovery map, and it names commits that exist in git
even where nothing else records them.

---

## STOP HERE FIRST — resume points, in order

### 1. Review the last commit — NOT DONE
`193e532` (`fix(main): make _notify_restart's recovery print itself crash-proof`) was
committed but **never reviewed**. Every other commit on this branch passed a task review;
this one is the exception only because the session ended.

What it fixes: `print(f"...{e}")` inside `_notify_restart`'s except handler could itself
raise `UnicodeEncodeError` on this project's cp1252 Windows console (`start.bat` sets no
`PYTHONUTF8` / `chcp 65001`). That escaped the per-chat `try`, was caught by `run()`'s outer
handler, and **skipped `start_polling()`** — one bad chat silently disabling Telegram for the
whole process lifetime. Same class of bug as commit `f3499e0`.

The fix report is appended to `.superpowers/sdd/recovery-task-3-report.md`.

### 2. Startup recovery Task 4 — NOT STARTED (this is what blocks the feature)
`hermes/spa.html` renders `<span class="badge ${t.status}">`. `sweep_interrupted()` now
writes `interrupted`, and **no `.badge.interrupted` rule exists** — it renders unstyled.
Full task text: `docs/superpowers/plans/2026-07-15-startup-recovery.md`, Task 4.

In the same five-line CSS block: `.badge.stopped` is dead (no code writes a `stopped` status)
and its muted grey is exactly what `interrupted` wants; `.badge.cancelled` and
`.badge.awaiting_confirm` are unstyled today.

### 3. Startup recovery Task 5 — superseded by this file
That task was "update the backlog". This rewrite does it. Skip it; do not re-dispatch.

### 4. Final whole-branch review — NOT DONE
12 commits (`24a5137..193e532`) have never been reviewed as a whole. The per-task reviews were
clean, but cross-task drift is the failure mode this branch actually hit, twice (see below) —
and by construction no single-task review can catch it. Use the carried Minor findings below
as its triage list.

### 5. Branch not merged
`feat/project-registry` carries both features, so its name is now wrong. Rename or split
before merging.

---

## Config that must be set before any of this is usable

- [ ] **`Settings.projects` is empty, so every `@name` rejects.** Set it in the settings UI at
  http://127.0.0.1:8799. It is a name-to-absolute-path map — projects stay where they are,
  there is no directory scan:
  ```json
  "projects": {
    "myprofit": "C:\\Users\\USER\\myprofit",
    "hermes":   "E:\\Hermes\\app"
  }
  ```
  Do **not** point `projects_path` at `C:\Users\USER` as a shortcut. The real projects sit
  there beside `AppData`, `Documents`, and `OneDrive`, and the registry exists precisely so
  those can never become agent-writable targets.

- [ ] **`HERMES_HOME` is unset**, so `hermes/paths.py` falls back to its hardcoded `E:/Hermes`.
  That works today, but `deploy/install.ps1` now defaults to **`C:\Hermes`** when the variable
  is missing (commit `8fc062f`). Re-running the installer as-is would create an empty
  `C:\Hermes`, set `HERMES_HOME` to it permanently for the user, and leave Hermes reading a
  config/projects/db root that is not yours. Set it first:
  ```powershell
  [Environment]::SetEnvironmentVariable("HERMES_HOME", "E:\Hermes", "User")
  ```

- [ ] **`E:\Hermes\start.bat` is the old hardcoded version** — no banner, no auto-restart loop,
  `cd /d E:\Hermes\app` baked in. `deploy/start.bat` is now the single source of truth, and the
  installer writes a stub that calls it. Regen via the installer (after setting `HERMES_HOME`),
  or write the stub by hand:
  ```bat
  @echo off
  set HERMES_HOME=E:\Hermes
  call "E:\Hermes\app\deploy\start.bat"
  ```

- [ ] **Unexplained, never diagnosed:** a config change reported as "just added" never reached
  disk. `config/config.yaml`, `config/.env`, and `hermes.db` were all last written
  2026-07-14 ~17:00; the running process started 10:36 the next day — *after* them — and
  `/api/settings` matched disk exactly. The save failed silently. If it recurs, watch
  `POST /api/settings` in the browser's DevTools Network tab; the current code returns 422 with
  a specific message.

---

## What went wrong twice — read this before extending the branch

**Planning-time text goes stale during implementation.** It bit this branch twice, and both
times a *later* reviewer caught what the *earlier* task's own review had passed:

1. Registry Task 4 widened `git_dirty`'s `None` from "not a git repo" to also cover
   git-ignored and git-unavailable. Task 5's user-facing gate message — written before that —
   still said "is not a git repo". True in one case of three, and false in the worst possible
   direction: a user who *knows* the path is a repo reads a confident lie, concludes the gate
   is broken, and taps through the one message built to stop them.
2. Task 7's docs then repeated that stale claim *and* left `README.md`'s `## Known follow-ups`
   asserting the feature did not exist — in the same file that announced it shipped.

Generalised: when a contract widens mid-implementation, grep for every place that restates it
— messages, docs, tests, comments — not just its definition.

---

## Carried Minor findings — triage list for the final review

None are known bugs. Each was rated Minor by a task reviewer and deliberately deferred.

**Correctness-adjacent**
- [ ] `project_resolve._REF`'s right anchor `(?=\s|$)` makes `/task @myprofit, fix login` match
  **nothing** — it silently falls back to a fresh workspace with the sigil left in the planner
  text. Yet `@myprofit. fix` *does* match (the dot is in the name charset) and rejects loudly.
  Inconsistent, and the silent fallback contradicts this design's own principle that an
  explicit sigil is an explicit intent whose typo must be loud. Candidate: `(?![A-Za-z0-9._-])`.
- [ ] Two pre-existing `print(f"...{e}")` sites in `run()` (the `Application.builder()` handler
  and the outer `async with app:` handler) carry the exact cp1252 hazard `193e532` just fixed
  in `_notify_restart`. Deliberately out of that task's scope.
- [ ] `confirm_risky=False` now silently means "run against my real dirty repo, no warning" —
  the reason is computed, then discarded without ever reaching `sender()`. Consistent with the
  pre-existing semantics for risky *text*, but the stakes changed once tasks could target real
  projects. Product call, not a bug.

**Test quality**
- [ ] `test_recovery.py::test_caps_listing_at_five_per_group` asserts `msg.count("  t") == 5` —
  an incidental substring, not a structural property. It only equals 5 because the fixture's
  task ids happen to start with `t`.
- [ ] `test_config.py::test_projects_accepts_absolute_paths` and `::test_projects_roundtrip`
  would both still pass if the validator were deleted. The other four do pin it.
- [ ] `run_task`'s "a supplied `proj` is never `mkdir`-ed" is not test-enforced —
  `mkdir(exist_ok=True)` on an existing dir is a no-op, so a buggy implementation still passes.
  The guarantee is structural, via the `if proj is None:` guard.
- [ ] `group_digests`: no test pins singular "1 task was" vs plural "N tasks were"; none
  combines a capped (>5) section with a second non-empty section (the grand-total case); none
  covers `text=None`, though the column has no `NOT NULL`; within-section ordering of
  same-status rows is untested, so a sort regression would slip through.
- [ ] No test asserts the git probe is **skipped** when `gate_live=False` but `git_dirty` IS
  configured.

**Cosmetic / duplication**
- [ ] The name-shape regex is duplicated: `config._PROJECT_NAME` and `project_resolve._REF`'s
  capture group must be hand-synced.
- [ ] `session_store.sweep_interrupted` hardcodes `(?,?,?)` in three places rather than
  deriving it from `len(INTERRUPTIBLE)`. Fail-loud if it drifts, not silent.
- [ ] `README.md`'s rejection text is silent on the zero-projects-registered branch, which has
  a different message and no name list.
- [ ] `http://127.0.0.1:8799` is hardcoded in four modules. Pre-existing convention.

---

## Not started at all (potential future scope)

- [ ] **Startup recovery, remaining** — resume points 1, 2 and 4 above. Spec:
  `docs/superpowers/specs/2026-07-15-startup-recovery-design.md`. Shipped so far:
  `Store.sweep_interrupted()` retires `running` / `awaiting_confirm` / `queued` tasks and their
  live steps to `interrupted` on startup (`f051b26`); `recovery.group_digests` builds one
  digest per chat (`1036594`); `main` sweeps unconditionally before the bot exists and notifies
  after `app.start()` (`2e8d8cc`, `193e532`).
- [ ] **Resume an interrupted task.** `interrupted` is terminal; nothing re-runs it. The sweep
  is only the foundation.
- [ ] **Make a stale confirm-button tap respond.** `bridge.pending` is in-memory, so after a
  restart the inline buttons are dead: `resolve_confirm` returns `False` into a caller that
  discards it, and the tap does nothing at all, with no feedback. The startup digest tells the
  user to resubmit, but the button itself is still silent.
- [ ] Real end-to-end smoke run (needs your NVIDIA key, Telegram token, an AVD) — see
  `docs/SMOKE.md`.
- [ ] HTML forms for the settings / MCP pages (currently JSON API only; dashboard is minimal).

---

## Older backlog — all shipped

<details>
<summary>P1–P5 (complete)</summary>

**P1 — Correctness**
- [x] **I2** — `project_detect.detect_app_id` reads the real application id from gradle
  (`applicationId`, groovy + kts, Flutter/RN/plain layouts) with an AndroidManifest fallback;
  the orchestrator threads it into `test_emulator` → `Adb.launch(pkg)`. Missing app id now
  fails the test step explicitly.
- [x] **I3** — `test_emulator` and `test_browser` are wrapped in
  `asyncio.wait_for(..., timeout=timeout_s)` and return a timed-out `TestResult` instead of
  hanging.

**P2 — MCP**
- [x] **MCP option-B real transport** — `mcp_hub.RealMcpSession` implements stdio and HTTP/SSE
  sessions, opened lazily so `McpHub.connect` stays non-blocking. `list_tools` skips and logs
  servers that fail at discovery.
- [x] **NIM tool-call loop capped** at `MAX_TOOL_ROUNDS = 8`.

**P3 — Robustness**
- [x] **web_ui POST validation** — bodies typed as pydantic models; malformed input is 422.
- [x] **Fire-and-forget crash reporting** — `crash_reporter` done-callback on every
  `asyncio.create_task` bridge invocation.
- [x] **Confirmation gate** — `detect_risky` flags `git push`, deletes, and outside paths; held
  in `awaiting_confirm`, resolved via inline keyboard. Toggle: `Settings.confirm_risky`.
- [x] **Cosmetic** — unused imports cleaned.

**P4 — Test coverage**
- [x] Orchestrator failure paths; `test_runner` emulator failure branches; orchestrator
  `test`-step real branch; Starlette `TestClient` warning silenced.

**P5 — Existing-project targeting** (spec: `2026-07-15-project-registry-design.md`)
- [x] `Settings.projects` name→path registry, shape-validated only — it never stats paths, so a
  missing folder cannot crash `load_settings()` at startup into a `start.bat` restart loop.
- [x] `project_resolve` parses the `@name` sigil and resolves via the registry. The name is only
  ever a dict key, never joined onto a path, which is what removes traversal from the design.
  Unregistered and registered-but-gone are distinct errors.
- [x] `run_task(..., proj=None)` — a supplied project is used verbatim, never `mkdir`-ed.
- [x] `git_status.git_dirty` — three-way: `True` dirty, `False` clean (git can undo), `None` no
  usable undo. Uses `check-ignore` so a git-ignored path inside an enclosing repo cannot return
  a wrong `False`.
- [x] Bridge resolves before `create_task` (a bad `@name` costs zero tokens) and gates on the
  tree; `pending` carries `proj` so an approved task reaches the named project.
- [x] `_build_bridge` injects the real `git_dirty` — without it the gate fails open, silently.

</details>
