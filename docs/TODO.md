# Hermes — Unfinished Tasks / Backlog

Status: **full test suite passes (135), warning-free.** Branch `feat/project-registry`,
HEAD `225549b`, working tree clean.

Two features were built from specs in `docs/superpowers/specs/` via the plans in
`docs/superpowers/plans/`. **The @name registry is complete. Startup recovery is
code-complete** (sweep + digest + notify + dashboard badge); what remains is the
whole-branch review and merge below, plus the config prerequisites.

Note: `.superpowers/sdd/progress.md` referenced by earlier revisions of this file no
longer exists on disk. This file and git history are the recovery map now.

---

## STOP HERE FIRST — resume points, in order

### 1. Review the last commit — DONE (2026-07-15)
`193e532` reviewed: fix correct (`backslashreplace` roundtrip guarantees an encodable
string), test genuinely exercises the cp1252 hazard via a monkeypatched `builtins.print`,
scope correctly excludes the two remaining `print(f"...{e}")` sites in `run()` (carried
below). No findings.

### 2. Startup recovery Task 4 — DONE (`225549b`)
`.badge.interrupted`, `.badge.cancelled`, `.badge.awaiting_confirm` now styled.
**Plan deviation:** the plan said `.badge.stopped` was dead and should be renamed away —
false. The MCP card renders its Disabled badge with `class="badge ${srv.enabled ? 'done'
: 'stopped'}"`, so the rule was kept and the new statuses share it. The plan had only
checked task statuses — a third instance of the stale-planning-text failure mode below.
Step 2's verify-by-eye against the live dashboard has not been done (needs a running
Hermes; fold into the smoke run).

### 3. Startup recovery Task 5 — superseded by this file
That task was "update the backlog". This rewrite does it. Skip it; do not re-dispatch.

### 4. Final whole-branch review — DONE (2026-07-15)
All branch commits reviewed as a whole, carried Minor findings triaged. Outcome:
- **Fixed:** `_REF` right anchor (`@myprofit,` no longer silently falls back; charset now
  shared as `config._NAME_CHAR`, killing the regex duplication) — `9bbb0b3`. The two
  remaining cp1252 `print(f"{e}")` sites in `run()` (extracted `_console_safe`, used at all
  three sites) — `7b5c6e0`. README now covers the zero-projects rejection and notes the
  git-undo confirmation depends on `confirm_risky`.
- **No new cross-task drift found** beyond the `.badge.stopped` plan error already caught
  in `225549b`.
- **Deliberately left:** the product call and test-quality items below.

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

## What went wrong three times — read this before extending the branch

**Planning-time text goes stale during implementation.** It bit this branch three times,
and each time a *later* reviewer caught what the *earlier* task's own review had passed:

1. Registry Task 4 widened `git_dirty`'s `None` from "not a git repo" to also cover
   git-ignored and git-unavailable. Task 5's user-facing gate message — written before that —
   still said "is not a git repo". True in one case of three, and false in the worst possible
   direction: a user who *knows* the path is a repo reads a confident lie, concludes the gate
   is broken, and taps through the one message built to stop them.
2. Task 7's docs then repeated that stale claim *and* left `README.md`'s `## Known follow-ups`
   asserting the feature did not exist — in the same file that announced it shipped.
3. Recovery Task 4's plan asserted `.badge.stopped` was dead ("no code writes a `stopped`
   status") after checking only task statuses; the MCP card's Disabled badge uses the class.
   Executing the plan verbatim would have unstyled it. Caught at execution time (`225549b`).

Generalised: when a contract widens mid-implementation, grep for every place that restates it
— messages, docs, tests, comments — not just its definition. And re-verify a plan's factual
claims ("X is dead", "nothing uses Y") against the tree at execution time, not plan time.

---

## Carried Minor findings — post-review disposition

None are known bugs. Triaged during the final whole-branch review (2026-07-15).

**Fixed during the review**
- [x] `project_resolve._REF` right anchor — `@myprofit,` resolved silently to a fresh
  workspace; now `(?!{_NAME_CHAR})`, and the charset is shared with `config._PROJECT_NAME`
  (also closes the regex-duplication finding below). `9bbb0b3`.
- [x] The two remaining cp1252 `print(f"...{e}")` sites in `run()` — extracted
  `main._console_safe`, used at all three report sites. `7b5c6e0`.
- [x] README rejection text now covers the zero-projects-registered branch, and the git-undo
  paragraph notes it depends on `confirm_risky`.

**Open — product call**
- [ ] `confirm_risky=False` silently means "run against my real dirty repo, no warning" —
  the reason is computed, then discarded without ever reaching `sender()`. Consistent with the
  pre-existing semantics for risky *text*, but the stakes changed once tasks could target real
  projects. Needs an owner decision, not a code fix.

**Open — test quality (accepted for merge; fix opportunistically)**
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
- [x] ~~Name-shape regex duplicated~~ — fixed in `9bbb0b3` via shared `config._NAME_CHAR`.
- [ ] `session_store.sweep_interrupted` hardcodes `(?,?,?)` in three places rather than
  deriving it from `len(INTERRUPTIBLE)`. Fail-loud if it drifts, not silent.
- [x] ~~README silent on zero-projects-registered rejection~~ — fixed with the review.
- [ ] `http://127.0.0.1:8799` is hardcoded in four modules (five with `recovery.py`).
  Pre-existing convention.

---

## Not started at all (potential future scope)

- [ ] **Startup recovery, remaining** — only resume point 4 (whole-branch review) above. Spec:
  `docs/superpowers/specs/2026-07-15-startup-recovery-design.md`. Shipped:
  `Store.sweep_interrupted()` retires `running` / `awaiting_confirm` / `queued` tasks and their
  live steps to `interrupted` on startup (`f051b26`); `recovery.group_digests` builds one
  digest per chat (`1036594`); `main` sweeps unconditionally before the bot exists and notifies
  after `app.start()` (`2e8d8cc`, `193e532`); dashboard badges the new statuses (`225549b`).
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
