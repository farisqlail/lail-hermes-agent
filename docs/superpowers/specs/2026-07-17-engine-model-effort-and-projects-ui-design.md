# Engine model/effort settings + a projects registry UI

Date: 2026-07-17
Status: design

Two features, both reachable from the web settings page at http://127.0.0.1:8799:

1. Choose which model and effort level the **coding engine** runs at.
2. Register a project folder, so Telegram only ever needs `@name`.

---

## Problem

### 1. The engine's model and effort are not configurable

`engine_runner.COMMANDS` hardcodes the argv:

```python
COMMANDS: dict[str, Callable[[str], list[str]]] = {
    "claude": lambda p: ["claude", "-p", "--dangerously-skip-permissions"],
    "antigravity": lambda p: ["agy", "-p", p],
}
```

Both CLIs accept a model, and `claude` accepts an effort level:

```
claude --model <model>    alias (fable, opus, sonnet) or a full model name
claude --effort <level>   low, medium, high, xhigh, max
agy    --model <model>    agy's own namespace; agy has NO effort flag
```

Neither flag is passed, so every code step runs at each CLI's default. There is
no way to spend more effort on a hard task or less on a trivial one.

**This is not the same as the existing model select.** `Settings.model`
(default `deepseek-ai/deepseek-v3`; `deepseek-ai/deepseek-v4-flash` in the live
config) is the **planner** model: the NIM/OpenAI-compatible LLM that decomposes
a task into steps. It is already selectable in the settings form and is out of
scope here. The gap is the **engine** — the `claude`/`agy` CLI that writes the
code.

### 2. The projects registry has no UI

The `@name` registry is complete and reviewed: `Settings.projects` (name →
absolute path), `project_resolve` parsing the sigil, the dirty-tree
confirmation gate, and `run_task(..., proj=...)` using the folder verbatim.

The only missing piece is a form. `Settings.projects` can be set today only by
`POST /api/settings` with a hand-written JSON body, so in practice it stays
empty — and an empty registry means **every `@name` rejects**. The feature is
shipped but unreachable.

The settings page already renders a form (engine, planner model, base URL,
allowed user ids, SDK path, AVD, test mode, timeouts) plus a secrets form and
an MCP server card list. `projects` is the one settings field with no control.
(`docs/TODO.md`'s "settings pages are JSON API only" is stale.)

---

## Solution

### Settings: three new fields

```python
claude_model: str = ""
claude_effort: Literal["", "low", "medium", "high", "xhigh", "max"] = ""
antigravity_model: str = ""
```

**Empty string means "do not pass the flag".** This is the load-bearing
default: on upgrade, argv is byte-identical to today's and behaviour cannot
change until the user opts in. It also gives "use the CLI's own default" a
representation, which a fixed enum could not.

**Why per-engine and not one shared pair.** `default_engine` defaults to
`"auto"` (and is `"auto"` in the live config), and `choose_engine` routes:

```python
def choose_engine(step: dict, settings: Settings) -> str:
    if step.get("engine") in ("claude", "antigravity"):
        return step["engine"]
    if settings.default_engine in ("claude", "antigravity"):
        return settings.default_engine
    return "antigravity" if step.get("scope") == "large" else "claude"
```

So **both engines can run inside a single task**. `claude` and `agy` have
disjoint model namespaces: `"sonnet"` is meaningless to `agy`, and `agy` has no
`--effort` flag at all. One shared `engine_model` would send a claude alias to
`agy` the moment `auto` picked it. Per-engine fields are a correctness
requirement, not ergonomics.

### Validation: effort strict, model free

`claude_effort` is a `Literal` over the five documented levels plus `""`, so a
bad value is rejected at `POST /api/settings` with a 422 — the existing
web_ui pydantic-body convention (P3).

Model fields are plain `str`. Model names are an open, moving set: aliases
(`fable`, `opus`, `sonnet`) plus full names, and they change with every
release. The existing 5-entry hardcoded planner model list is already evidence
of how that rots. The form offers a `<datalist>` of suggestions without
constraining input. A bad model surfaces as an engine failure whose stderr
reaches the step transcript.

### Wiring model/effort through to argv

`COMMANDS` becomes model/effort-aware:

```python
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

`agy` never receives `--effort`: its CLI has no such flag, so passing one
turns a working run into an argument error. The asymmetry is deliberate and
must be test-pinned.

`run_engine` grows two keyword arguments, defaulting to `""`:

```python
async def run_engine(engine, prompt, cwd, timeout_s,
                     extra_env=None, model="", effort="") -> RunResult:
    argv = _resolve(COMMANDS[engine](prompt, model, effort))
```

The orchestrator selects the pair once per step, next to the `choose_engine`
call that already runs there, and passes it on **every round of the engine
loop** — `run_engine` is called up to `MAX_ENGINE_ROUNDS` times per code step
(`orchestrator.py:236`), so the options must be hoisted above the loop, not
threaded into a single call:

```python
engine = choose_engine(step, self.settings)
model, effort = _engine_options(engine, self.settings)
base = _compose_engine_prompt(...) + _COMPLETION_CONTRACT
...
for _ in range(MAX_ENGINE_ROUNDS):
    res = await self.deps["run_engine"](
        engine, prompt, proj, self.settings.timeout_code_s,
        model=model, effort=effort)
    ...
```

`_engine_options(engine, settings) -> tuple[str, str]` is a module-level pure
function returning `(claude_model, claude_effort)` for `"claude"` and
`(antigravity_model, "")` for `"antigravity"`. Pure and separately testable;
it is the one place that knows effort is claude-only.

### The 19 test fakes must be updated in the same task

`run_engine` is injected via `deps["run_engine"]`, and **19 fakes across the
test suite** implement it with the current signature:

```python
async def fake_run_engine(engine, prompt, cwd, timeout_s, extra_env=None)
```

None accept `model=` / `effort=`. The moment the orchestrator passes those
keywords, every one raises `TypeError: unexpected keyword argument 'model'`.
Defaulting the real function's parameters does **not** protect the fakes — the
caller, not the callee, is what changed.

The fakes are therefore updated to `(..., extra_env=None, model="", effort="")`
in the same task as the orchestrator change, never a follow-up: between the two
the suite is red. Tests that assert on the flags capture the kwargs; the rest
just accept and ignore them.

Rejected alternative: passing the keywords conditionally
(`if model: kw["model"] = model`) so untouched fakes keep working. That makes
the production call shape depend on configuration, hides the signature change
from exactly the tests meant to pin it, and leaves the fakes lying about the
interface they stand in for.

### Projects UI

Follows the **existing MCP server card pattern** (`mcp-card`, `mcp-form`,
add/edit/remove) rather than a new shape — same list-of-records problem, and
the convention is already established in `spa.html`.

- A `Projects` section on the settings page lists registered `name → path`
  entries, each with edit and remove.
- Add/edit opens the form: `name` (text) and `path` (text, absolute).
- Save posts the whole `Settings` body, as `saveSettings()` already does.
  It currently spreads `...state.settings`, so `projects` already round-trips
  untouched; this replaces that passthrough with real values.

### Path existence: checked at save, never at load

`POST /api/settings` stats each project path and returns 422 naming the entry
if the directory is missing.

`Settings._projects_shape` **keeps never touching the filesystem.** That
invariant is deliberate and documented: the validator also runs inside
`load_settings()` at startup, so an existence check there would turn a
deleted folder into a startup crash — and `deploy/start.bat` restarts on exit,
so that is an infinite restart loop, not a single failure.

The check therefore lives in the **route**, not the model:

- `POST /api/settings` → stats → 422 on a missing path. Typos caught while typing.
- `load_settings()` → shape only → a folder deleted later still boots.
- Task time → `resolve_project` → `ProjectPathMissing`, the existing error.

This is additive: it closes the typo gap without weakening the boot guarantee.

---

## Components

### `hermes/config.py`
Three new `Settings` fields. `claude_effort` is a `Literal`. No new validator:
the model fields are free text, and path existence is the route's job.

### `hermes/engine_runner.py`
`COMMANDS` signature becomes `(prompt, model, effort) -> argv`. `run_engine`
grows `model=""`, `effort=""`. Flags are omitted entirely when empty.

### `hermes/orchestrator.py`
New `_engine_options(engine, settings)`. `_exec_step`'s `code` branch resolves
the pair once, above the `MAX_ENGINE_ROUNDS` loop, and passes it on every round.

### `tests/` — 19 existing `run_engine` fakes
Signatures gain `model=""`, `effort=""`. Same task as the orchestrator change;
the suite is red in between.

### `hermes/web_ui.py`
`post_settings` gains the project-path existence check → 422.

### `hermes/spa.html`
Engine model/effort controls in the settings form (with a `<datalist>` for
model suggestions and a `<select>` for effort). A Projects card list + form,
mirroring the MCP section. `saveSettings()` sends the three new fields and the
`projects` map.

---

## Testing

Argv construction is a pure function, so the engine surface tests without
spawning a process:

- Empty `claude_model`/`claude_effort` produce **exactly today's argv** — pins
  the no-behaviour-change-on-upgrade guarantee.
- Set values produce `--model X --effort Y`; only one set produces only that flag.
- `antigravity` **never** receives `--effort`, even when `claude_effort` is set.
- `_engine_options` returns the claude pair for `"claude"` and
  `(antigravity_model, "")` for `"antigravity"`.
- Under `default_engine="auto"`, a large-scope step routes agy's model and a
  normal step routes claude's — the case a single shared field would break.
- **Every round of the engine loop receives the options**, not just the first:
  an unconfirmed step runs `MAX_ENGINE_ROUNDS` times, and a fix-up round
  silently dropping back to the default model is the regression this pins.

Web UI:

- `POST /api/settings` with `claude_effort="turbo"` → 422.
- `POST /api/settings` with a project path that does not exist → 422 naming it.
- `POST /api/settings` with an existing path → 200, round-trips.
- `load_settings()` with a registered-but-deleted folder → **still loads**.
  Non-vacuity: this test must fail if the existence check is moved into the
  validator. It is the regression guard for the restart-loop bug.

---

## Out of scope

- **Per-task and per-project model/effort.** Global defaults only. A per-task
  override (`/task @proj --model opus ...`) needs its own flag parser,
  validation, and interaction with the `@name` sigil; per-project needs
  `projects` to become `name → {path, model, effort}`, a settings migration.
  Neither is needed to answer "which model, how much effort".
- **The planner model select.** Already works; its hardcoded 5-model list is a
  known rot risk, tracked separately.
- **`agy` effort.** The CLI has no such flag.
- **Folder browsing.** A browser cannot enumerate the server's filesystem
  without an endpoint that lists directories — which is exactly the
  agent-writable-target exposure the registry was designed to prevent.
  Absolute path, typed.

---

## Noted, not fixed

`choose_engine`'s `"auto"` routes on `step["scope"] == "large"` — a field the
**planner LLM invents**. Which engine runs, and therefore now which model and
effort, is decided by model output rather than by the user. This predates the
feature and is not changed here, but it is why per-engine fields are required:
the routing cannot be predicted at settings time. Worth revisiting on its own.
