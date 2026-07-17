# Engine Model/Effort + Projects UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the coding engine's model and effort level from the web settings page, and register project folders there so Telegram only needs `@name`.

**Architecture:** Three new `Settings` fields (`claude_model`, `claude_effort`, `antigravity_model`), threaded through a widened `COMMANDS` table into the engine argv. Empty string means "omit the flag", so behaviour is unchanged until opted into. A pure `_engine_options()` picks the right pair per engine, because `default_engine="auto"` runs both engines in one task and their model namespaces are disjoint. The projects registry gets a card list in `spa.html` mirroring the existing MCP section, and `POST /api/settings` gains a path-existence check that the pydantic validator deliberately must not have.

**Tech Stack:** Python 3.14, pydantic v2, FastAPI, pytest (`asyncio_mode=auto`), vanilla JS in a single `hermes/spa.html`.

**Spec:** `docs/superpowers/specs/2026-07-17-engine-model-effort-and-projects-ui-design.md`

**Branch:** `feat/engine-model-effort`, base `f8b1333`. Suite is green at 168 before Task 1.

**Runner:** `.venv/Scripts/python.exe -m pytest -q` from `E:\Hermes\app`.

## Global Constraints

- **Empty string means "omit the flag".** `claude_model=""` / `claude_effort=""` / `antigravity_model=""` must produce argv byte-identical to today's. This is the no-behaviour-change-on-upgrade guarantee and every task preserves it.
- **`agy` never receives `--effort`.** Its CLI has no such flag. Effort is claude-only.
- **`Settings._projects_shape` never touches the filesystem.** It runs inside `load_settings()` at startup; an existence check there turns a deleted folder into a boot crash, and `deploy/start.bat` restarts on exit, so that is an infinite restart loop. Path existence is checked in the route only.
- **Effort values are exactly** `low`, `medium`, `high`, `xhigh`, `max` (plus `""`). Copied from `claude --help`.
- **Model fields are free text.** No hardcoded model enum — aliases and full names change every release.
- Run the full suite before every commit. Never commit red.

---

### Task 1: Settings fields

**Files:**
- Modify: `hermes/config.py:26-41` (the `Settings` class body)
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Settings.claude_model: str`, `Settings.claude_effort: Literal["", "low", "medium", "high", "xhigh", "max"]`, `Settings.antigravity_model: str`. All default `""`. Tasks 2, 3 and 4 read these.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_config.py`. This file refers to the model as
`config.Settings` (it imports `from hermes import config, paths`, not the class
directly) and already imports `pytest` and `ValidationError` at module level —
match that, do not add imports:

```python
def test_engine_model_and_effort_default_to_empty():
    """Empty means 'omit the flag', so a fresh install runs exactly as before."""
    s = config.Settings()
    assert s.claude_model == ""
    assert s.claude_effort == ""
    assert s.antigravity_model == ""


def test_claude_effort_accepts_every_documented_level():
    for level in ("low", "medium", "high", "xhigh", "max"):
        assert config.Settings(claude_effort=level).claude_effort == level


def test_claude_effort_rejects_an_undocumented_level():
    with pytest.raises(ValidationError):
        config.Settings(claude_effort="turbo")


def test_engine_models_are_free_text():
    """Model names are an open, moving set (aliases plus full names), so the
    field must not constrain them to a list that rots."""
    s = config.Settings(claude_model="claude-opus-4-8",
                        antigravity_model="gemini-3-pro")
    assert s.claude_model == "claude-opus-4-8"
    assert s.antigravity_model == "gemini-3-pro"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_config.py -q -k "engine_model or claude_effort or engine_models"`

Expected: FAIL. `test_engine_model_and_effort_default_to_empty` fails with `AttributeError: 'Settings' object has no attribute 'claude_model'`, and `test_claude_effort_rejects_an_undocumented_level` fails because pydantic ignores unknown kwargs rather than raising.

- [ ] **Step 3: Add the fields**

In `hermes/config.py`, in the `Settings` class, immediately after the `default_engine` line, insert:

```python
    # Engine model/effort. "" means "do not pass the flag", i.e. use the CLI's
    # own default -- that is what keeps argv identical to pre-feature behaviour
    # until the user opts in, and it is a state no enum could express.
    # Per-engine, not shared: default_engine="auto" runs both claude and agy in
    # one task (choose_engine routes on step scope) and their model namespaces
    # are disjoint -- "sonnet" is meaningless to agy. agy has no effort flag.
    claude_model: str = ""            # alias (fable/opus/sonnet) or full name
    claude_effort: Literal["", "low", "medium", "high", "xhigh", "max"] = ""
    antigravity_model: str = ""       # agy's own namespace
```

`Literal` is already imported in this module (used by `default_engine`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_config.py -q`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: `172 passed` (168 baseline + 4 new).

- [ ] **Step 6: Commit**

```bash
git add hermes/config.py tests/test_config.py
git commit -m "feat(config): add engine model and effort settings

claude_model, claude_effort, and antigravity_model, all defaulting to the
empty string, which means 'do not pass the flag' -- argv stays byte-identical
to today until the user opts in, and 'use the CLI default' gets a
representation an enum could not express.

Per-engine rather than one shared pair because default_engine defaults to
'auto', which routes claude and agy within a single task, and their model
namespaces are disjoint. claude_effort is a Literal over the five levels the
claude CLI documents, so a bad value is a 422 at the settings route. The model
fields are free text: aliases and full names move every release, and the
existing hardcoded planner model list already shows how that rots."
```

---

### Task 2: engine_runner passes the flags

**Files:**
- Modify: `hermes/engine_runner.py:12-15` (the `COMMANDS` table), `hermes/engine_runner.py:53-56` (the `run_engine` signature and its `COMMANDS` call)
- Modify: `tests/test_engine_runner.py:18`, `:28`, `:34` (three `lambda p:` monkeypatches)
- Test: `tests/test_engine_runner.py`

**Interfaces:**
- Consumes: nothing from Task 1 — this task is about argv construction only.
- Produces: `COMMANDS[engine](prompt: str, model: str, effort: str) -> list[str]` and `run_engine(engine, prompt, cwd, timeout_s, extra_env=None, model="", effort="") -> RunResult`. Task 3 calls `run_engine` with `model=` and `effort=` keywords.

**Why the lambdas change here:** `tests/test_engine_runner.py` monkeypatches `COMMANDS` in three places with single-argument lambdas. Once `run_engine` calls `COMMANDS[engine](prompt, model, effort)`, those raise `TypeError: <lambda>() takes 1 positional argument but 3 were given`. They must move in this task or the suite is red.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_engine_runner.py`:

```python
def test_empty_model_and_effort_produce_todays_argv():
    """The no-behaviour-change-on-upgrade guarantee: with the settings unset,
    argv must be byte-identical to what shipped before the feature."""
    assert engine_runner.COMMANDS["claude"]("do it", "", "") == [
        "claude", "-p", "--dangerously-skip-permissions"]
    assert engine_runner.COMMANDS["antigravity"]("do it", "", "") == [
        "agy", "-p", "do it"]


def test_claude_argv_carries_model_and_effort():
    assert engine_runner.COMMANDS["claude"]("do it", "opus", "high") == [
        "claude", "-p", "--dangerously-skip-permissions",
        "--model", "opus", "--effort", "high"]


def test_each_flag_is_independent():
    assert engine_runner.COMMANDS["claude"]("x", "opus", "") == [
        "claude", "-p", "--dangerously-skip-permissions", "--model", "opus"]
    assert engine_runner.COMMANDS["claude"]("x", "", "max") == [
        "claude", "-p", "--dangerously-skip-permissions", "--effort", "max"]


def test_antigravity_takes_a_model_but_never_an_effort():
    """agy's CLI has no --effort flag; passing one turns a working run into an
    argument error. The asymmetry is deliberate."""
    argv = engine_runner.COMMANDS["antigravity"]("do it", "gemini-3-pro", "max")
    assert argv == ["agy", "-p", "do it", "--model", "gemini-3-pro"]
    assert "--effort" not in argv


async def test_run_engine_threads_model_and_effort_into_argv(tmp_path, monkeypatch):
    """run_engine must hand its kwargs to the COMMANDS table, not drop them."""
    seen = []
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p, model, effort: (
                            seen.append((model, effort))
                            or [sys.executable, "-c", "pass"]))
    await engine_runner.run_engine("claude", "x", tmp_path, timeout_s=10,
                                   model="sonnet", effort="low")
    assert seen == [("sonnet", "low")]


async def test_run_engine_defaults_model_and_effort_to_empty(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p, model, effort: (
                            seen.append((model, effort))
                            or [sys.executable, "-c", "pass"]))
    await engine_runner.run_engine("claude", "x", tmp_path, timeout_s=10)
    assert seen == [("", "")]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_engine_runner.py -q -k "argv or flag or model_and_effort or antigravity"`

Expected: FAIL with `TypeError: <lambda>() takes 1 positional argument but 3 were given` — the current `COMMANDS` lambdas accept only the prompt.

- [ ] **Step 3: Widen the COMMANDS table**

In `hermes/engine_runner.py`, replace lines 12-15:

```python
COMMANDS: dict[str, Callable[[str], list[str]]] = {
    "claude": lambda p: ["claude", "-p", "--dangerously-skip-permissions"],
    "antigravity": lambda p: ["agy", "-p", p],
}
```

with:

```python
# (prompt, model, effort) -> argv. An empty model/effort omits its flag
# entirely, so unset settings reproduce the pre-feature argv exactly.
# antigravity takes no effort: `agy` has no --effort flag, and passing one
# turns a working run into an argument error.
COMMANDS: dict[str, Callable[[str, str, str], list[str]]] = {
    "claude": lambda p, model, effort: [
        "claude", "-p", "--dangerously-skip-permissions",
        *(["--model", model] if model else []),
        *(["--effort", effort] if effort else []),
    ],
    "antigravity": lambda p, model, effort: [
        "agy", "-p", p,
        *(["--model", model] if model else []),
    ],
}
```

- [ ] **Step 4: Widen run_engine**

In `hermes/engine_runner.py`, replace lines 53-56:

```python
async def run_engine(engine: Literal["claude", "antigravity"], prompt: str,
                     cwd: Path, timeout_s: int,
                     extra_env: dict | None = None) -> RunResult:
    argv = _resolve(COMMANDS[engine](prompt))
```

with:

```python
async def run_engine(engine: Literal["claude", "antigravity"], prompt: str,
                     cwd: Path, timeout_s: int,
                     extra_env: dict | None = None,
                     model: str = "", effort: str = "") -> RunResult:
    argv = _resolve(COMMANDS[engine](prompt, model, effort))
```

- [ ] **Step 5: Fix the three monkeypatched lambdas**

In `tests/test_engine_runner.py`, all three take two extra parameters they ignore.

Line 18, in the `fake_echo` fixture:

```python
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p, model, effort: [sys.executable, str(script), "-p"])
```

Line 28, in `test_run_timeout`:

```python
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p, model, effort: [sys.executable, "-c", "import time; time.sleep(5)"])
```

Line 34, in `test_missing_binary_raises`:

```python
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p, model, effort: ["definitely-not-a-real-engine-binary", "-p"])
```

- [ ] **Step 6: Run the file to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_engine_runner.py -q`
Expected: PASS. The three pre-existing tests still pass — they never asserted on model or effort.

- [ ] **Step 7: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: `178 passed` (172 + 6 new). `tests/test_orchestrator.py` still passes: the orchestrator does not yet send the keywords.

- [ ] **Step 8: Commit**

```bash
git add hermes/engine_runner.py tests/test_engine_runner.py
git commit -m "feat(engine_runner): pass --model and --effort to the engines

COMMANDS becomes (prompt, model, effort) -> argv, and run_engine grows the two
keywords. An empty value omits its flag entirely, so unset settings reproduce
today's argv byte for byte -- pinned by a test rather than asserted in prose.

antigravity gets --model but never --effort: agy's CLI has no such flag, so
passing one would turn a working run into an argument error. That asymmetry is
the point of the per-engine shape and is test-pinned too.

The three COMMANDS monkeypatches in test_engine_runner.py move in this commit
because they are single-argument lambdas that raise TypeError the moment the
table is called with three -- the caller changed, so the fakes must."
```

---

### Task 3: orchestrator routes the right pair per engine

**Files:**
- Modify: `hermes/orchestrator.py` (add `_engine_options` directly below `choose_engine`, which starts at line 119), `hermes/orchestrator.py:228-237` (the `code` branch of `_exec_step`)
- Modify: `tests/test_orchestrator.py` — 13 fake signatures at lines 30, 77, 100, 235, 270, 296, 336, 358, 386, 418, 441, 532, 562
- Test: `tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `Settings.claude_model`, `Settings.claude_effort`, `Settings.antigravity_model` (Task 1); `run_engine(..., model=, effort=)` (Task 2).
- Produces: `_engine_options(engine: str, settings: Settings) -> tuple[str, str]` returning `(model, effort)`.

**Why the 13 fakes change here:** `run_engine` is injected via `deps["run_engine"]`. The moment `_exec_step` passes `model=`/`effort=`, every fake on the old signature raises `TypeError: unexpected keyword argument 'model'`. Defaults on the real function do not help — the caller changed. They move in this task or the suite is red.

**Critical:** `run_engine` is called **inside** the `MAX_ENGINE_ROUNDS` loop (line 236), so the options resolve **above** the loop and pass on every round. A fix-up round quietly falling back to the default model is exactly the regression Step 1's last test pins.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_orchestrator.py`:

```python
def test_engine_options_are_per_engine():
    """claude and agy have disjoint model namespaces, and agy has no effort."""
    from hermes.orchestrator import _engine_options
    s = Settings(default_engine="auto", claude_model="opus",
                 claude_effort="high", antigravity_model="gemini-3-pro")
    assert _engine_options("claude", s) == ("opus", "high")
    assert _engine_options("antigravity", s) == ("gemini-3-pro", "")


def test_engine_options_default_to_empty():
    from hermes.orchestrator import _engine_options
    s = Settings()
    assert _engine_options("claude", s) == ("", "")
    assert _engine_options("antigravity", s) == ("", "")


async def test_code_step_sends_claude_model_and_effort(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    seen = []
    async def engine(engine_name, prompt, cwd, timeout_s, extra_env=None,
                     model="", effort=""):
        from hermes.engine_runner import RunResult
        seen.append((engine_name, model, effort))
        return RunResult(True, f"done\n{_DONE_SENTINEL}", "", False, 0)

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "make it"}]})
    settings = Settings(default_engine="claude",
                        projects_path=str(hermes_home / "proj"),
                        claude_model="opus", claude_effort="high")
    orch = Orchestrator(settings, store, planner, dict(run_engine=engine))
    async def report(tid, msg): pass
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)

    assert seen == [("claude", "opus", "high")]


async def test_auto_routes_each_engine_its_own_model(hermes_home):
    """default_engine='auto' picks antigravity for a large-scope step and
    claude otherwise, so a single shared model field would send a claude alias
    to agy. Each engine must get its own namespace."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    seen = []
    async def engine(engine_name, prompt, cwd, timeout_s, extra_env=None,
                     model="", effort=""):
        from hermes.engine_runner import RunResult
        seen.append((engine_name, model, effort))
        return RunResult(True, f"done\n{_DONE_SENTINEL}", "", False, 0)

    async def planner(text, tools):
        return json.dumps({"steps": [
            {"type": "code", "prompt": "big", "scope": "large"},
            {"type": "code", "prompt": "small"},
        ]})
    settings = Settings(default_engine="auto",
                        projects_path=str(hermes_home / "proj"),
                        claude_model="opus", claude_effort="high",
                        antigravity_model="gemini-3-pro")
    orch = Orchestrator(settings, store, planner, dict(run_engine=engine))
    async def report(tid, msg): pass
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)

    assert seen == [("antigravity", "gemini-3-pro", ""),
                    ("claude", "opus", "high")]


async def test_every_engine_round_gets_the_options(hermes_home):
    """run_engine is called up to MAX_ENGINE_ROUNDS times per step. A fix-up
    round silently reverting to the default model is the regression here."""
    from hermes.orchestrator import MAX_ENGINE_ROUNDS
    store = Store(hermes_home / "t.db"); store.init_schema()
    seen = []
    async def never_confirms(engine_name, prompt, cwd, timeout_s, extra_env=None,
                            model="", effort=""):
        from hermes.engine_runner import RunResult
        seen.append((model, effort))
        return RunResult(True, "still working on it", "", False, 0)

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "make it"}]})
    settings = Settings(default_engine="claude",
                        projects_path=str(hermes_home / "proj"),
                        claude_model="opus", claude_effort="high")
    orch = Orchestrator(settings, store, planner, dict(run_engine=never_confirms))
    async def report(tid, msg): pass
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)

    assert seen == [("opus", "high")] * MAX_ENGINE_ROUNDS
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -q -k "engine_options or claude_model_and_effort or auto_routes or every_engine_round"`

Expected: FAIL. The `_engine_options` tests fail with `ImportError: cannot import name '_engine_options'`; the async ones fail with `assert [] == [(...)]` because the orchestrator does not pass the keywords yet.

- [ ] **Step 3: Add `_engine_options`**

In `hermes/orchestrator.py`, directly below the `choose_engine` function, add:

```python
def _engine_options(engine: str, settings: Settings) -> tuple[str, str]:
    """(model, effort) for the engine that choose_engine just picked.

    Per-engine because their model namespaces are disjoint -- a claude alias
    means nothing to agy -- and because only claude has an effort flag. This is
    the single place that knows effort is claude-only.
    """
    if engine == "claude":
        return settings.claude_model, settings.claude_effort
    return settings.antigravity_model, ""
```

- [ ] **Step 4: Pass the options on every round**

In `hermes/orchestrator.py`, in `_exec_step`'s `code` branch, replace lines 228-237:

```python
        if t == "code":
            engine = choose_engine(step, self.settings)
            base = (_compose_engine_prompt(text, proj, step.get("prompt", ""))
                    + _COMPLETION_CONTRACT)
            prompt = base
            attempts = []
            res = None
            for _ in range(MAX_ENGINE_ROUNDS):
                res = await self.deps["run_engine"](
                    engine, prompt, proj, self.settings.timeout_code_s)
```

with:

```python
        if t == "code":
            engine = choose_engine(step, self.settings)
            # Resolved once, above the loop: every fix-up round must run on the
            # same model and effort as the first.
            model, effort = _engine_options(engine, self.settings)
            base = (_compose_engine_prompt(text, proj, step.get("prompt", ""))
                    + _COMPLETION_CONTRACT)
            prompt = base
            attempts = []
            res = None
            for _ in range(MAX_ENGINE_ROUNDS):
                res = await self.deps["run_engine"](
                    engine, prompt, proj, self.settings.timeout_code_s,
                    model=model, effort=effort)
```

Leave the rest of the loop body unchanged.

- [ ] **Step 5: Update all 13 fake signatures**

In `tests/test_orchestrator.py`, every fake standing in for `run_engine` gains the two keywords. They are at lines 30, 77, 100, 235, 270, 296, 336, 358, 386, 418, 441, 532, 562. Each currently ends with `extra_env=None):` and becomes `extra_env=None, model="", effort=""):`. The parameter names differ between fakes (`engine` vs `engine_name`) — keep each fake's existing first parameter name.

For example, line 30:

```python
    async def fake_run_engine(engine, prompt, cwd, timeout_s, extra_env=None,
                              model="", effort=""):
```

and line 270:

```python
    async def engine(engine_name, prompt, cwd, timeout_s, extra_env=None,
                     model="", effort=""):
```

Verify none were missed:

```bash
grep -c "extra_env=None, *$\|extra_env=None):" tests/test_orchestrator.py
```

Expected: `0`. Every fake now declares the keywords.

- [ ] **Step 6: Run the file to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -q`
Expected: PASS, including the 5 new tests. A `TypeError: unexpected keyword argument 'model'` means a fake at Step 5 was missed.

- [ ] **Step 7: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: `183 passed` (178 + 5 new).

- [ ] **Step 8: Commit**

```bash
git add hermes/orchestrator.py tests/test_orchestrator.py
git commit -m "feat(orchestrator): route each engine its own model and effort

_engine_options() returns the claude pair for claude and (antigravity_model,
'') for agy -- the one place that knows effort is claude-only. _exec_step
resolves it once, above the MAX_ENGINE_ROUNDS loop, and passes it on every
round: a fix-up round quietly reverting to the default model is the regression
the round test pins.

Under default_engine='auto' a large-scope step goes to agy and a normal step to
claude, so a single shared model field would hand a claude alias to agy. That
case is now a test.

The 13 run_engine fakes in this file move in this commit: run_engine is
injected, so the new keywords reach the fakes, not the real function, and
every one of them would raise TypeError. Defaults on the callee cannot help
when the caller is what changed."
```

---

### Task 4: settings form — engine model and effort

**Files:**
- Modify: `hermes/spa.html:1174-1192` (the settings form, after the `default_engine` select), `hermes/spa.html` `saveSettings()` (~line 1400) and the settings-load function that populates the form
- Test: none automated — `spa.html` has no JS test harness in this project. Verified by eye in Step 4.

**Interfaces:**
- Consumes: `Settings.claude_model`, `Settings.claude_effort`, `Settings.antigravity_model` (Task 1); `GET`/`POST /api/settings` (unchanged).
- Produces: nothing consumed by later tasks.

**Note on labels:** the form already has a `<select id="model">` for the *planner* (NIM) model. The new controls sit in their own labelled group so the two are not confused.

- [ ] **Step 1: Add the form controls**

In `hermes/spa.html`, find the `default_engine` form group (~line 1174) and insert immediately after its closing `</div>`:

```html
                    <div class="form-group">
                        <label for="claude_model">Claude engine model</label>
                        <input type="text" id="claude_model" list="claude-model-suggestions"
                               placeholder="leave empty for the CLI default">
                        <datalist id="claude-model-suggestions">
                            <option value="fable">
                            <option value="opus">
                            <option value="sonnet">
                        </datalist>
                    </div>

                    <div class="form-group">
                        <label for="claude_effort">Claude engine effort</label>
                        <select id="claude_effort">
                            <option value="">(CLI default)</option>
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                            <option value="xhigh">xhigh</option>
                            <option value="max">max</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="antigravity_model">Antigravity engine model</label>
                        <input type="text" id="antigravity_model"
                               placeholder="leave empty for the CLI default">
                    </div>
```

The free-text input with a `datalist` is deliberate: suggestions without a closed list, because model names move every release.

- [ ] **Step 2: Send the fields on save**

In `hermes/spa.html`, in `saveSettings()`, add three entries to the `updatedSettings` object, immediately after the `model:` line:

```javascript
            claude_model: document.getElementById('claude_model').value,
            claude_effort: document.getElementById('claude_effort').value,
            antigravity_model: document.getElementById('antigravity_model').value,
```

- [ ] **Step 3: Populate the fields on load**

Find the function that fills the settings form from `state.settings` (it sets `document.getElementById('model').value = ...`). Add alongside those lines:

```javascript
        document.getElementById('claude_model').value = s.claude_model || '';
        document.getElementById('claude_effort').value = s.claude_effort || '';
        document.getElementById('antigravity_model').value = s.antigravity_model || '';
```

Use whatever the surrounding lines call the settings object (`s`, `state.settings`, …) — match the existing code rather than introducing a new name.

- [ ] **Step 4: Verify by eye**

Run: `.venv/Scripts/python.exe -m hermes.main`

Open http://127.0.0.1:8799, go to Settings.

Expected: the three new controls render. Set Claude effort to `high`, save, reload the page — `high` is still selected. Set effort to `(CLI default)`, save, reload — it stays empty. Stop with Ctrl+C.

If `TELEGRAM_BOT_TOKEN` is unset the bot is skipped and the web UI still serves; that is expected and fine for this check.

- [ ] **Step 5: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: `183 passed`. `test_web_ui.py` asserts the SPA is served, not its contents.

- [ ] **Step 6: Commit**

```bash
git add hermes/spa.html
git commit -m "feat(spa): choose the engine model and effort from settings

Free-text model inputs with a datalist of suggestions rather than a closed
select: aliases and full names move every release, and the hardcoded 5-model
planner list next to them already shows how that rots. Effort is a select --
the CLI documents exactly five levels, and config.py pins the same set, so a
bad value cannot reach the engine.

Empty renders as '(CLI default)' because empty genuinely means 'omit the flag'.
Labelled 'engine' throughout to separate them from the planner model select
directly above, which chooses the LLM that writes the plan, not the code."
```

---

### Task 5: reject a project path that does not exist

**Files:**
- Modify: `hermes/web_ui.py:89-92` (`post_settings`)
- Test: `tests/test_web_ui.py`, `tests/test_config.py`

**Interfaces:**
- Consumes: `Settings.projects` (pre-existing, `dict[str, str]`).
- Produces: `POST /api/settings` returns 422 when a registered path is missing. Task 6's UI surfaces the message.

**Critical:** the check goes in the **route**, never in `Settings._projects_shape`. The validator also runs inside `load_settings()` at startup, so an existence check there turns a deleted folder into a boot crash — and `deploy/start.bat` restarts on exit, making that an infinite restart loop. Step 1's `test_load_settings_survives_a_deleted_project_folder` is the regression guard and must fail if anyone moves the check into the model.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_web_ui.py`. There is **no `client` fixture** in this file —
every test builds its own via `paths.ensure_dirs()` + `Store` + `TestClient`.
Match that pattern exactly:

```python
def test_post_settings_rejects_a_missing_project_path(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    body = config.Settings(
        projects={"ghost": str(hermes_home / "not-there")}).model_dump()
    r = client.post("/api/settings", json=body)
    assert r.status_code == 422
    assert "ghost" in r.text          # names the offending entry


def test_post_settings_accepts_an_existing_project_path(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    real = hermes_home / "myprofit"; real.mkdir()
    body = config.Settings(projects={"myprofit": str(real)}).model_dump()
    r = client.post("/api/settings", json=body)
    assert r.status_code == 200
    assert config.load_settings().projects == {"myprofit": str(real)}


def test_post_settings_rejects_a_file_masquerading_as_a_project(hermes_home):
    """is_dir(), not exists(): an engine cannot be run inside a regular file."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    f = hermes_home / "a-file.txt"; f.write_text("x")
    body = config.Settings(projects={"nope": str(f)}).model_dump()
    r = client.post("/api/settings", json=body)
    assert r.status_code == 422
```

Append to `tests/test_config.py` (again: `config.Settings`, not bare `Settings`):

```python
def test_load_settings_survives_a_deleted_project_folder(hermes_home):
    """REGRESSION GUARD -- do not move the existence check into the validator.

    _projects_shape runs inside load_settings() at startup. If it stated the
    filesystem, a folder deleted between runs would raise here, and
    deploy/start.bat restarts on exit -- an infinite restart loop, not a single
    failure. Path existence is the settings route's job; this must keep passing.
    """
    paths.ensure_dirs()
    gone = hermes_home / "vanished"
    config.save_settings(config.Settings(projects={"gone": str(gone)}))
    assert not gone.exists()                        # never created
    s = config.load_settings()                      # must not raise
    assert s.projects == {"gone": str(gone)}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_web_ui.py -q -k project`

Expected: FAIL — `assert 200 == 422`. The route saves a nonexistent path today.

`test_load_settings_survives_a_deleted_project_folder` should **PASS** already: it pins existing correct behaviour that this task must not break.

- [ ] **Step 3: Add the check to the route**

In `hermes/web_ui.py`, replace lines 89-92:

```python
    @app.post("/api/settings")
    def post_settings(body: config.Settings):
        config.save_settings(body)
        return {"ok": True}
```

with:

```python
    @app.post("/api/settings")
    def post_settings(body: config.Settings):
        # Existence is checked HERE, never in Settings._projects_shape: that
        # validator also runs inside load_settings() at startup, so a folder
        # deleted between runs would crash the boot -- and deploy/start.bat
        # restarts on exit, making it an infinite restart loop rather than one
        # failure. The route runs only when a human is saving, so failing here
        # costs a 422 and catches the typo while they are still looking at it.
        for name, path in body.projects.items():
            if not Path(path).is_dir():
                raise HTTPException(
                    status_code=422,
                    detail=f"project {name!r}: {path} is not an existing directory")
        config.save_settings(body)
        return {"ok": True}
```

`Path` and `HTTPException` are already imported in this module.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_web_ui.py tests/test_config.py -q`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: `187 passed` (183 + 4 new).

- [ ] **Step 6: Commit**

```bash
git add hermes/web_ui.py tests/test_web_ui.py tests/test_config.py
git commit -m "feat(web_ui): reject a project path that does not exist

A typo'd path used to save clean and only surface much later, from Telegram, as
ProjectPathMissing. The route now stats each registered path and 422s naming
the entry, so the mistake is caught while the person is still looking at the
form.

Deliberately in the route and not in Settings._projects_shape: that validator
also runs inside load_settings() at startup, so an existence check there would
turn a folder deleted between runs into a boot crash -- and deploy/start.bat
restarts on exit, so that is an infinite restart loop, not one failure. A test
pins that load_settings() still loads a registered-but-deleted folder; it is
the regression guard for exactly that."
```

---

### Task 6: projects card list in the settings UI

**Files:**
- Modify: `hermes/spa.html` — a Projects section in the settings tab, modelled on the existing MCP server card list (`mcp-card` / `mcp-form` / `submitMcpForm`, ~lines 1300-1340)
- Test: none automated — verified by eye in Step 5.

**Interfaces:**
- Consumes: `Settings.projects` (`dict[str, str]`); `POST /api/settings` 422 from Task 5.
- Produces: nothing.

**Why this task matters:** `Settings.projects` is empty in the live config, and an empty registry means **every `@name` rejects**. The whole `@name` feature is shipped, reviewed, and currently unreachable purely for want of this form.

**Follow the MCP section, do not invent a shape.** Read `spa.html`'s MCP card list first and mirror its structure, class names, and add/edit/remove flow. It solves the same list-of-records problem and is the established convention in this file.

- [ ] **Step 1: Read the MCP section**

Read `hermes/spa.html` around the MCP card list and its form (search for `mcp-card`, `renderMcpServers`, `submitMcpForm`, `mcp-index`). Note how it renders the list, opens the form for add vs edit, removes an entry, and writes back into `state.settings`.

Mirror that structure. Do not introduce new CSS classes if an MCP one already fits.

- [ ] **Step 2: Render the projects list**

Add a Projects section to the settings tab. Each entry shows the name and path with Edit and Remove buttons, matching the MCP card markup. Escape both values with the existing `escapeHtml` helper — the same one the MCP card title uses.

Empty state matters here, because it is the state every user starts in. Render:

```
No projects registered. Telegram @name tasks will be rejected until you add one.
```

- [ ] **Step 3: Add the add/edit form**

Two fields, mirroring `mcp-form`:

- `project_name` — text, required. Shape: starts with a letter or digit, then letters, digits, dot, dash, underscore. That is `config._PROJECT_NAME`; the server rejects a bad name with a 422, so client-side validation is a convenience, not the gate.
- `project_path` — text, required, absolute (e.g. `C:\Users\USER\myprofit`).

Editing an existing entry pre-fills both. Saving writes into `state.settings.projects` and posts via the existing `saveSettings()`.

- [ ] **Step 4: Surface the 422 from Task 5**

`saveSettings()` must show the server's message rather than failing silently. A 422 body looks like:

```json
{"detail": "project 'ghost': C:\\nope is not an existing directory"}
```

Display `detail` to the user. Check how `saveSettings()` currently reports success or failure and follow it; if it does not handle a non-200 at all, add that handling — an unreported 422 is exactly how a typo'd path becomes a mystery later.

- [ ] **Step 5: Verify by eye**

Run: `.venv/Scripts/python.exe -m hermes.main`, open http://127.0.0.1:8799, Settings.

Check each:
1. With no projects, the empty-state line appears.
2. Add `hermes` → `E:\Hermes\app`. Save. Reload. It persists.
3. Add `ghost` → `C:\definitely\not\here`. Save. The 422 message appears and names `ghost`.
4. Edit `hermes`, change the path, save, reload — the change persists.
5. Remove `hermes`, save, reload — it is gone and the empty state returns.

Stop with Ctrl+C.

- [ ] **Step 6: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: `187 passed`.

- [ ] **Step 7: Commit**

```bash
git add hermes/spa.html
git commit -m "feat(spa): register projects from the settings page

Settings.projects could only be set by hand-writing JSON to POST
/api/settings, so in practice it stayed empty -- and an empty registry means
every @name rejects. The whole @name feature was shipped and reviewed but
unreachable for want of this form.

Mirrors the MCP server card list rather than inventing a shape: same
list-of-records problem, same file, established convention. The empty state
says why it matters, since it is the state every user starts in, and a 422 from
the path check now surfaces its message instead of failing silently."
```

---

### Task 7: document the feature

**Files:**
- Modify: `README.md`, `docs/TODO.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

**Read both files end to end, not just the hunks you add.** Two of this branch's three documented drift incidents were a doc asserting something the code had stopped doing — including `README.md` claiming a feature did not exist in the same file that announced it shipped. Grep for every place that restates a contract you changed.

- [ ] **Step 1: Update README.md**

Document, in the existing voice:
- Engine model/effort: where to set them, that empty means the CLI's default, and that effort is claude-only because `agy` has no such flag.
- That the *planner* model select is a different thing — it picks the LLM that writes the plan, not the code.
- Registering a project, and that `@name` from Telegram resolves through it.

- [ ] **Step 2: Update docs/TODO.md**

- The open item **"HTML forms for the settings / MCP pages (currently JSON API only; dashboard is minimal)"** is stale — the forms already existed before this work. Correct it rather than tick it.
- `Settings.projects is empty, so every @name rejects` under "Config that must be set": the UI now exists, so rewrite it as a setup step, not a blocker.
- Add the new spec and plan to the feature list.

- [ ] **Step 3: Verify no stale claims remain**

```bash
grep -rn "JSON API only\|dashboard is minimal" docs/TODO.md README.md
```

Expected: no output.

- [ ] **Step 4: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: `187 passed`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/TODO.md
git commit -m "docs: engine model/effort and project registration

Also corrects TODO's 'settings pages are JSON API only' -- the forms already
existed before this work, so the item was stale rather than done, and the kind
of stale claim that has bitten this branch three times."
```

---

## Verification

After Task 7:

- [ ] `.venv/Scripts/python.exe -m pytest -q` → `187 passed`, warning-free
- [ ] `git status --short` → clean
- [ ] `git log --oneline f8b1333..HEAD` → 7 commits, one per task
- [ ] Settings with everything empty produce today's argv exactly:
  ```bash
  .venv/Scripts/python.exe -c "from hermes.engine_runner import COMMANDS; print(COMMANDS['claude']('x','',''))"
  ```
  Expected: `['claude', '-p', '--dangerously-skip-permissions']`
- [ ] Whole-branch review before merge — the per-task reviews cannot catch cross-task drift, which is the failure mode this branch has hit three times.
