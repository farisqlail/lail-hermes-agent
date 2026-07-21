# Hermes — Unfinished Tasks / Backlog

Status: **full test suite passes (177), warning-free.** Branch `master`.

Features built from specs in `docs/superpowers/specs/`: **the @name registry and
startup recovery are both complete and reviewed.** (Their execution plans in
`docs/superpowers/plans/` were deleted 2026-07-17 after completion; the specs
remain.) Several smaller features then landed directly on `feat/engine-loop`
without a spec or plan — see the section below.

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
before merging. (Superseded in practice: `feat/engine-loop` contains all of it plus the
work below, and is what gets merged.)

---

## Landed on `feat/engine-loop` without a spec, plan, or review

Everything before `c7abb65` shipped spec → plan → per-task review → whole-branch review.
The commits after it did not. They are code-complete and green, but no reviewer other than
their author has read them, and the engine loop — the branch's namesake — has no design doc
at all. Treat this list as the review backlog:

- `36e0452` save the full engine transcript as a task artifact
- `fbdcb5c` clip outgoing Telegram messages under the 4096-char limit
- `280b24a` send the engine the task text, a project tree summary, and the step
- `f575ec3` gate deletion verbs only when a filesystem object follows
- `013b1c6` send screenshots and APKs straight to the chat
- `7621175` retry planner calls through NIM busy spells
- `8b49969` **the engine loop itself** — committed as `"update"`, no message, no plan

### The engine loop, as built (`8b49969`)
A code step gets up to `MAX_ENGINE_ROUNDS = 3` engine sessions. Every code prompt carries
`_COMPLETION_CONTRACT`, which asks the engine to print `HERMES_STEP_DONE` as its final line
only when the step is done *and verified in that session*. A session that errors, or that
exits 0 without the sentinel, gets a continuation prompt carrying the previous session's
stdout/stderr tails. Exhausting all rounds without the sentinel still reports success, with
"completion not confirmed — check the step transcript".

Fixed before merge (`f0ed344`, `0a4574d`):
- [x] **The sentinel was spoofable.** The check was `_DONE_SENTINEL in res.stdout`, but the
  literal ships inside `_COMPLETION_CONTRACT` — i.e. inside every prompt — and
  `_continuation_prompt` feeds prior stdout back in. An engine that echoed its prompt and did
  zero work reported `coded (confirmed done, 1 round(s))`: exactly the failure the sentinel
  exists to catch. Now `_confirmed_done()` matches the last non-empty line.
- [x] **Two red tests.** `test_run_task_uses_supplied_proj` and
  `test_run_task_without_proj_creates_workspace` had fakes returning `stdout="done"`, written
  before the completion contract existed, so the loop ran all 3 rounds and their
  `seen == [dir]` assertions collected 3 entries. Fourth instance of the stale-text drift.
- [x] **`crash_reporter` print was unguarded** despite `7b5c6e0` claiming full `_console_safe`
  coverage — `repr()` does not escape non-ASCII.
- [x] **`ask_confirm` bypassed the clip chokepoint** despite `fbdcb5c` claiming it covered
  every caller.

Open on the engine loop:
- [ ] **Does the real `claude` CLI actually emit the sentinel?** Still unproven against a live
  engine. What changed 2026-07-21: the sentinel is now read from the JSON envelope's `result`
  field — the model's own closing message — instead of raw stdout, so the answer is finally
  observable rather than confounded by tool output and echoed prompts. Smoke step 6 says where
  to look.
- [x] ~~**Cost** is invisible~~ — `claude --output-format json` reports `total_cost_usd` per
  session; `_log_engine_cost` sums the rounds into one log line per code step. Worst case per
  step is still `MAX_ENGINE_ROUNDS * timeout_code_s`, but it is no longer unmeasured. A budget
  cap remains unbuilt.
- [ ] No spec or plan exists. If the loop is kept, write one retroactively.

---

## Landed 2026-07-21 — planner eval harness

`python -m hermes.evals`. Outside `testpaths`, so pytest never collects it.

- `hermes/evals/rules.py` — pure predicates, one per rule the system prompt already mandates.
  Unit-tested in `tests/test_eval_rules.py`; the model call is the only stochastic part.
- `hermes/evals/cases.py` — 8 cases over web / react-native / flutter / greenfield fixtures,
  written in Indonesian because that is the language the live task history is in and planning
  behaviour is not language-invariant.
- `hermes/evals/__main__.py` — drives the real `build_nim_planner` and the real
  `Orchestrator._plan_context`. A local reimplementation of either would score a fork.
- `Settings.planner_temperature` (default `0.0`), threaded into the NIM call. Planning is
  rule-following JSON; sampling randomness bought nothing and made evals noisy. A setting, not
  a literal, so a model that rejects the parameter can be worked around without a release.

Design notes worth keeping:
- **`ERROR` is a third outcome, not a `FAIL`.** A NIM outage must never be read as a quality
  regression.
- **Nothing scores taste.** Engine choice and prompt wording differ between correct answers.
- **Not in pytest, on purpose.** A stochastic signal in the suite either goes flaky or teaches
  everyone to ignore red.

**First baseline, 2026-07-21, `deepseek-ai/deepseek-v4-flash` @ temperature 0:**
`python -m hermes.evals` → **10/10**. `--no-context` → **8/10**.

How that number was earned matters more than the number. The set shipped with 8 cases and
scored 8/8 on the first run. Ablating the project context — the pre-#3 behaviour — **also
scored 8/8**, which meant the set could not distinguish the feature from its absence and
was measuring nothing. Two cases were then written whose task text pulls toward an APK on a
project that has none (`web-build-wording`, `web-apk-wording`). Without context they plan
`['code','build']` and `['code','build','test']`; the second is task 20260715-104754-5b44a5
reproduced. Reproduced identically on three separate runs.

That is the same failure as the vacuous test caught earlier the same day, one layer up: a
green result that could not have been red. `--no-context` was promoted from a throwaway probe
to a permanent flag so the question "can this set still fail?" stays cheap to ask.

**Output is ASCII-only, deliberately.** The first ablation run silently lost its own header
line: the mode string contained an em-dash, and `grep` in the pipeline declared the stream
binary and dropped the line. Same family as `main._console_safe`. A scorecard is made to be
piped.

Follow-ups this opens:
- [ ] Once a baseline exists, `R1-no-apk` failures are the direct argument for adding the same
  check to `validate_plan`, where it would be deterministic rather than measured.
- [ ] No case covers a task naming a project in prose without `@` — the shape that caused
  20260715-104754-5b44a5. Planning is not where that one is decided, but it is worth a case
  once resolution feeds the planner.

## Landed 2026-07-21 — a code step that leaves the project empty now fails

Root-caused from a live failure, task `20260715-104754-5b44a5`. The reported symptom was
`step 1 [build]: build failed: unsupported project type: unknown`. That was the messenger.

What actually happened: the task said *"project myprofit-v3"* in prose, with no `@` sigil
(the registry did not exist yet). `parse_project_ref` found nothing, `proj` stayed `None`,
`run_task` created `C:\Hermes\projects\20260715-104754-5b44a5` — **still on disk, still
empty** — and the engine ran there against nothing. Pre-completion-contract code reported
`step 0 [code]: coded` on exit 0. `detect()` on the real `myprofit-v3` returns
`react_native`, not `unknown`; the project was never touched.

**Had the plan carried no build step, the run would have reported success while changing no
code at all.** That is the failure, not the build error.

Fix: a code step whose project directory is empty afterwards fails, with a message naming the
likely cause and pointing at `@name` / `/projects`.

Mutation testing changed the design. The first version scoped the check to workspaces that
started empty (`started_empty and _is_empty(proj)`). Removing `started_empty` turned nothing
red — because a project with files that keeps them never reaches the check at all. The
conjunct only ever *weakened* the guard, letting an engine that deleted every file in a
registered project report success. Dropped, and that case is now pinned by
`test_engine_that_empties_a_real_project_fails_the_step`.

Ten existing tests went red on the fix. All ten had fakes reporting `coded` while touching
no disk — i.e. describing exactly this bug. They now call a `_worked(cwd)` helper. No
assertion was weakened to accommodate the change.

Still open, deliberately not bundled:
- [ ] **A task with no `@project` is still silent.** It creates a throwaway workspace with no
  warning. Forgetting one character reproduces the whole path; only the new guard catches it,
  and only after a full engine round.
- [ ] `validate_plan` still has no rule against a `build` step on a project that cannot build.
  Now that `_plan_context` computes `ptype` at planning time, that check is cheap and
  deterministic. It is rule R1 of the planner eval design.

## Landed 2026-07-21 — planner project context

Author-reviewed only; add to the review backlog above.

- `hermes/plan_context.py` — pure `build(summary, ptype, is_new, name)`, four branches.
- The planner's rules 2–4 (`main.py`) already forbade an emulator test on a non-Android
  project. **They were unobeyable**: the task text was the planner's only input, so it had to
  guess the project type from the user's wording. `validate_plan` was not covering a missing
  rule — it was catching a rule the planner could not apply. It stays, now as a safety net.
- Context rides as its own system message, after the rules and before the user's text.
- The dead `tools` parameter on the planner signature became `context`. It was never read:
  MCP discovery happens inside `build_nim_planner` via `hub.list_tools()`.

Two traps found while building it:

1. **An empty workspace and an unrecognised project both detect as `unknown`.** Deriving
   "not an Android project" from detection alone would forbid the `build` step that every
   greenfield task needs — including the smoke-test task. `is_new` is therefore taken from
   `proj is None` in `run_task`, before the workspace is created, and never inferred from disk.
2. **`ptype` falsy must claim nothing.** `detect` is an optional dep; absent, the context stays
   silent about the type instead of reporting a type nothing measured.

Mutation-checked: forcing `build()` to ignore `is_new` turns three tests red. A separate
mutation (dropping the `not is_new` guard on the `detect` call) surfaced only as a
`RuntimeWarning` from `test_invalid_plan_fails_task_before_running_any_step`'s `must_not_run`
sentinel. Worth knowing: `_plan_context` trusts `detect`'s return type, and a non-`str` return
would fall through to the "does NOT produce an APK" branch. Not reachable in production —
`main` always injects `project_detect.detect` — but the guard is thin.

## Landed 2026-07-21 — structured engine output (`feat/structured-engine-output`)

Author-reviewed only; add to the review backlog above.

- `hermes/engine_result.py` — pure `parse_claude_json` → `EngineOutcome`. Returns `None` for
  unusable stdout, which is the documented "fall back to text" signal, not an error.
- `engine_runner` — `claude` now runs `--output-format json`; `RunResult` gained an optional
  `outcome` plus a `final_text` property (property, not a field, so ~15 existing fakes that
  build `RunResult` positionally kept working untouched). `ok` now folds in `api_error`:
  **a session killed by an API error used to exit 0 and be recorded as a success.**
- Sessions: Hermes issues the UUID (`--session-id`) rather than reading one back, so a round
  that dies before printing is still resumable. Fix-up rounds use `--resume`.
  `_resumable_id` returning `""` is the entire fallback story — no separate recovery path.
- `agy` gained `--print-timeout <timeout_code_s>s`. Its default is 5m, so **every code step
  longer than five minutes was being killed by agy itself** and reported as an engine failure;
  `asyncio.wait_for` had never once fired for agy.
- Corrected a false claim in `docs/design-spec.md`: `agy` has no `--output-format`. Verified
  against `agy --help`.

Verified by mutation, not just by green: flipping `final_text` back to `stdout` and dropping
`api_error` from `ok` each turn tests red. The first mutation exposed a **vacuous test** —
`test_sentinel_only_in_stdout_...` had the sentinel mid-line, so it passed either way. Fixed to
put the sentinel on its own final stdout line, which is what makes the two sources
indistinguishable to a raw-stdout reader.

## Config that must be set before any of this is usable

- [ ] **`Settings.projects` is empty, so every `@name` rejects.** Fill it via the new
  **Projects Registry panel** on the settings tab at http://127.0.0.1:8799 (added 2026-07-17:
  card list with an OK/Missing badge per path, add/edit/delete modal, backed by
  `GET/POST /api/projects`). It is a name-to-absolute-path map — projects stay where they are,
  there is no directory scan.
  Do **not** point `projects_path` at `C:\Users\USER` as a shortcut. The real projects sit
  there beside `AppData`, `Documents`, and `OneDrive`, and the registry exists precisely so
  those can never become agent-writable targets.

- [ ] **The `HERMES_HOME` fallbacks disagree, and nothing reports it.** Three entry points, two
  different defaults, both absolute paths inherited from the machine this was first built on:

  | Entry point | Fallback when `HERMES_HOME` is unset |
  |---|---|
  | `hermes/paths.py:5` | `E:/Hermes` |
  | `deploy/install.ps1:8` | `C:\Hermes` |
  | `deploy/start.bat:6` | `C:\Hermes` |

  So `%HERMES_HOME%\start.bat` and `python -m hermes.main` read **different** config files,
  registries and task databases — silently, because both roots are valid directories. Until
  the defaults are reconciled, set the variable explicitly before installing:
  ```powershell
  [Environment]::SetEnvironmentVariable("HERMES_HOME", "<your data root>", "User")
  ```
  Fixing this properly means picking one fallback (or refusing to start without the variable)
  and migrating any data already written under the other. Do not do it in passing: the losing
  root holds live credentials and real task history.

- [ ] **A stale hand-written `start.bat` may sit in the data root** — no banner, no
  auto-restart loop, an absolute `cd /d` baked in. `deploy/start.bat` is the single source of
  truth and the installer writes a stub that calls it. Regenerate via the installer (after
  setting `HERMES_HOME`), or write the stub by hand:
  ```bat
  @echo off
  set HERMES_HOME=<your data root>
  call "<repo>\deploy\start.bat"
  ```

- [x] ~~**Unexplained, never diagnosed:** a config change reported as "just added" never
  reached disk.~~ **Diagnosed 2026-07-21: it did reach disk, in the other data root.** The
  files inspected were under one `HERMES_HOME` fallback while the running process, launched
  via `start.bat`, was writing to the other. `/api/settings` matched the disk it was actually
  serving. Not a silent save failure — two installations, per the item above.

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
  `main._console_safe`, used at all three report sites. `7b5c6e0`. (It missed a fourth site,
  `crash_reporter`'s `{exc!r}`; fixed in `0a4574d`.)
- [x] README rejection text now covers the zero-projects-registered branch, and the git-undo
  paragraph notes it depends on `confirm_risky`.

**`_console_safe` false premise — FIXED (2026-07-17)**
- [x] Docstring and call-site comments no longer claim the attached console is cp1252; they
  now name the real hazard (a *redirected* stdout gets the locale's legacy codec — PEP 528
  makes the attached console UTF-8).
- [x] Coercion switched from cp1252 to `.encode("ascii", "backslashreplace")`, which survives
  every legacy codec. `test_console_safe_output_is_pure_ascii` (renamed from
  `..._survives_cp1252`) now pins the ASCII invariant, with `'café'` added as the case that
  distinguished the two.

**Product call — RESOLVED (2026-07-17): warn, don't gate**
- [x] `confirm_risky=False` no longer runs risky tasks silently. The git probe now runs
  whenever a project is supplied and `git_dirty` is wired (no longer conditioned on
  `gate_live`), and when reasons exist but the gate is off, the queued message carries
  "Warning — running without confirmation: <reasons>". Gate-on behaviour unchanged.
  Tests: `test_gate_disabled_risky_text_still_warns`,
  `test_gate_disabled_dirty_project_still_probed_and_warned`,
  `test_gate_disabled_clean_project_gets_no_warning`.

**Test quality — FIXED (2026-07-17)**
- [x] `test_caps_listing_at_five_per_group` now asserts the listed ids are exactly the first
  five, in order — structural, not the incidental `msg.count("  t")`.
- [x] `test_projects_accepts_absolute_paths` / `::test_projects_roundtrip` — reframed with
  docstrings as positive-path tests (pinning non-rejection); the rejection behaviour is pinned
  by the neighbouring tests. Passing without the validator is by design for these two.
- [x] `run_task`'s "a supplied `proj` is never `mkdir`-ed" now test-enforced via a `Path.mkdir`
  spy: `test_run_task_never_mkdirs_a_supplied_proj`.
- [x] `group_digests` gaps closed: singular/plural wording, capped-section + second-section
  grand total, `text=None`, within-section input ordering.
- [x] ~~git probe skipped when `gate_live=False`~~ — superseded by the product call above: the
  probe now deliberately RUNS with the gate off, and that is what is tested.

**Cosmetic / duplication**
- [x] ~~Name-shape regex duplicated~~ — fixed in `9bbb0b3` via shared `config._NAME_CHAR`.
- [x] ~~`session_store.sweep_interrupted` hardcodes `(?,?,?)`~~ — placeholders now derived:
  `_IN_INTERRUPTIBLE = f"({','.join('?' * len(INTERRUPTIBLE))})"`, used in all three queries.
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
- [x] ~~HTML forms for the settings / MCP pages~~ — settings form, MCP cards, and (2026-07-17)
  the Projects Registry panel all exist in `spa.html`. Remaining UI work is polish, not forms.
- Landed 2026-07-17, author-reviewed only (add to the review backlog above):
  - **Projects Registry web panel** — `GET /api/projects` (adds an `exists` hint; existence
    stays out of the Settings validator by design), `POST /api/projects` (422 surfaces the
    validator's own message; a rejected post never clobbers the stored registry).
  - **Engine model/effort from the web** — per-engine: `Settings.claude_model` /
    `Settings.claude_effort` (`Literal["", low, medium, high, xhigh, max]`) and
    `Settings.agy_model` (model fields free-text; separate fields because the two CLIs accept
    different model names, and `auto` mixes engines). Validators differ per CLI: claude ids are
    single tokens, but agy models are *display names with spaces* — agy's own settings.json
    stores `"Gemini 3.5 Flash (High)"` — so agy allows printable ASCII, spaces included.
    Threaded orchestrator → `run_engine` as opt-in kwargs (the `send_file` pattern, so fakes
    keep narrow signatures). Flag support per CLI is in `engine_runner.MODEL_FLAG` /
    `EFFORT_FLAG`: both take `--model`, only `claude` has `--effort` — both verified against
    the live `--help` output (2026-07-17). Not yet tested against a live engine run — fold
    into the smoke run.

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
