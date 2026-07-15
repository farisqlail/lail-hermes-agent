# Project Registry — resolve `@name` to an existing project

Date: 2026-07-15
Status: approved, not yet implemented

## Problem

Every task gets a fresh workspace. `orchestrator.run_task` builds it
unconditionally:

```python
projects_path = self.settings.projects_path or str(paths.projects_dir())
proj = Path(projects_path) / task_id
proj.mkdir(parents=True, exist_ok=True)
```

The task text is never inspected for a project name, so `/task project myprofit
fix login` plans and codes inside an empty `projects/20260715-104500-a1b2c3/`.
There is no way to point Hermes at work that already exists.

## Solution

Add an explicit sigil, `@name`, that resolves to a registered project directory.
Without the sigil, behaviour is unchanged.

```
/task @myprofit fix login bug     -> C:\Users\USER\myprofit          (existing)
/task buat app counter Flutter    -> <projects_path>/<task-id>       (new)
/task project myprofit fix login  -> <projects_path>/<task-id>       (new; no sigil)
```

The third line is deliberate. Natural-language matching was considered and
rejected: a folder named `app` or `test` would match ordinary task prose and
silently aim the agent at a real project. Only `@` resolves.

### Registry, not directory scan

`@name` is a key in `Settings.projects`, a name-to-absolute-path map. It is not
a subdirectory of `projects_path`.

This was forced by where the projects actually live. `myprofit`, `myprofit-v3`,
and `archive-myprofit-dashboard` sit directly in `C:\Users\USER\`, alongside
`AppData`, `Documents`, `OneDrive`, and `Desktop`. Scanning a directory would
mean setting `projects_path = C:\Users\USER`, which makes `@AppData` — browser
profiles, session tokens, stored credentials — a valid target for an autonomous
coding agent. Windows junctions do not rescue the scan approach either: a
containment check that follows links (`resolve()` + `is_relative_to()`) rejects
by definition any junction pointing outside the base.

The registry sidesteps all of it. Projects stay where they are, and a name that
was never registered cannot resolve to anything.

**The registry is also what eliminates path traversal.** The name is used as a
dict key and never concatenated into a path, so `@../../etc` is not a traversal
attempt — it is a lookup miss. There is no containment check in this design
because there is no path construction to contain. The parsing regex is not a
security boundary; it only decides what characters form a sigil.

## Components

### `hermes/config.py`

```python
class Settings(BaseModel):
    projects: dict[str, str] = {}   # name -> absolute path
    projects_path: str = ""         # unchanged: parent for new workspaces
```

A `field_validator` on `projects` rejects, at save time:

- relative paths — the registry is unambiguous or it is not a registry
- paths that do not exist or are not directories
- names not matching `^[A-Za-z0-9][A-Za-z0-9._-]*$`

Validating on save rather than at task time follows the `SecretsUpdate` pattern
from `a772a34`: a bad value is rejected while the user is looking at the form,
not hours later inside a task.

### `hermes/project_resolve.py` (new)

Pure except for one `is_dir()` call. No LLM, no network, no subprocess.

```python
_REF = re.compile(r"(?:^|\s)@([A-Za-z0-9][A-Za-z0-9._-]*)(?=\s|$)")

class ProjectNotFound(Exception): ...
class ProjectPathMissing(Exception): ...

def parse_project_ref(text: str) -> tuple[str | None, str]
def resolve_project(name: str, settings: Settings) -> Path
```

`parse_project_ref` returns the name and the text with the sigil removed. The
cleaned text is what reaches the planner: `@myprofit` is routing metadata, not
part of the task description. The planner sees `"fix login bug"`.

Only the first sigil is treated as the project reference; any later `@word` is
left in the text untouched. A task cannot target two projects, and silently
dropping the second sigil would corrupt prose that legitimately contains one
(`/task @myprofit reply to @budi in the changelog`). The first match is removed,
the rest survives verbatim.

`resolve_project` has two distinct failure modes, and they must stay distinct:

| Condition | Exception | Message |
|---|---|---|
| Name not a key in `settings.projects` | `ProjectNotFound` | typo; list registered names |
| Key present, path gone from disk | `ProjectPathMissing` | project moved or deleted since registration |

Collapsing these into one error sends the user hunting for a typo that is not
there.

### Git dirty check

A new injected callable so tests can supply a fake instead of building a real
repository. It is injected as a `Bridge.__init__` keyword, following the
existing `ask_confirm=None` convention — *not* through the orchestrator's `deps`
dict, which the bridge has no access to:

```python
class Bridge:
    def __init__(self, settings, store, orchestrator, sender,
                 ask_confirm=None, git_dirty=None):
        ...
        self.git_dirty = git_dirty

async def git_dirty(path: Path) -> bool | None   # the real impl, wired in main.py
```

A `None` `git_dirty` (as in the existing bridge tests that do not pass one)
skips the dirty check entirely, exactly as a `None` `ask_confirm` skips the
gate today.

`git status --porcelain` in `path`. Non-empty output means dirty. A non-zero
exit or a missing `.git` returns `None`, meaning "not a git repo" — treated as
*no undo available*, which confirms.

### `hermes/telegram_bridge.py`

Resolution moves here, ahead of the gate. This is the one structural departure
from the original request, which put it in `run_task`. The dependency chain
forces it: the gate needs to know whether the tree is dirty, that needs the
project path, and that needs resolution — and the gate runs in
`handle_task`, before the orchestrator is ever called.

The move pays for itself. A rejected sigil now costs zero tokens, because the
planner never runs.

```python
async def handle_task(self, user_id, chat_id, text):
    settings = self.get_settings()
    # ... auth check unchanged ...
    name, text = parse_project_ref(text)
    proj = None
    if name is not None:
        try:
            proj = resolve_project(name, settings)
        except (ProjectNotFound, ProjectPathMissing) as e:
            await self.sender(chat_id, str(e))
            return None                       # no task row, no planner
    task_id = new_task_id()
    self.store.create_task(task_id, chat_id, text)

    reasons = detect_risky(text)
    if proj is not None and self.git_dirty is not None:
        dirty = await self.git_dirty(proj)
        if dirty is None:
            reasons.append(f"@{name} is not a git repo — no undo if this goes wrong")
        elif dirty:
            reasons.append(f"@{name} has uncommitted changes that could be lost")
    # ... existing gate, unchanged in shape ...
```

Text-derived and tree-derived reasons merge into the single `reasons` list the
gate already consumes, so `ask_confirm` and `resolve_confirm` keep their current
shape.

`self.pending` must carry `proj` alongside `(user, chat, text)`, because
`resolve_confirm` is what calls `_run` after approval.

### `hermes/orchestrator.py`

```python
async def run_task(self, task_id, chat_id, text, report, proj: Path | None = None):
    if proj is None:
        projects_path = self.settings.projects_path or str(paths.projects_dir())
        proj = Path(projects_path) / task_id
        proj.mkdir(parents=True, exist_ok=True)
    # ... unchanged from here ...
```

An existing project is never `mkdir`-ed; it is already there. Defaulting `proj`
to `None` preserves the current behaviour exactly, which keeps the four existing
`test_orchestrator.py` callers green untouched.

### `hermes/web_ui.py`

No new endpoint. `POST /api/settings` already accepts a whole `config.Settings`,
so the `projects` dict rides along and inherits the field validator.

## Flow

```
/task @myprofit refactor auth
  parse    -> name="myprofit", text="refactor auth"
  resolve  -> settings.projects["myprofit"] -> C:\Users\USER\myprofit
              not registered  -> reject + list names, STOP
              registered, gone -> reject, distinct message, STOP
  risk     -> detect_risky("refactor auth") -> []
              git_dirty(...) -> True -> ["@myprofit has uncommitted changes..."]
  gate     -> confirm_risky on, reasons non-empty -> [Run] [Cancel]
  run      -> run_task(..., proj=C:\Users\USER\myprofit)
```

## Confirmation gate rationale

The gate currently scans task text only. That was sufficient when every
workspace was a throwaway empty directory — a confused agent had nothing to
destroy. Pointing tasks at real projects changes the stakes, and the text scan
does not cover it: `/task @myprofit refactor auth` matches none of
`_RISKY_PATTERNS` (`git push`, `rm -rf`, `delete|remove|hapus`, paths outside
the project dir) and would run unconfirmed against real code.

Gating on a dirty tree rather than on every existing-project task is a
deliberate trade. Prompting on all of them trains the reflex tap, and a gate
that is always tapped through is decoration. A clean git tree already has an
undo button — `git checkout .` — so the confirmation earns its interruption only
when there is uncommitted work that would actually be lost.

## Testing

| Unit | Approach |
|---|---|
| `parse_project_ref` | table-driven; sigil at start/middle/end, absent, bare `@`, multiple sigils (first wins), text cleaning |
| `resolve_project` | registry fixture; hit, unregistered miss, registered-but-missing path |
| `Settings.projects` validator | relative path, nonexistent path, bad name -> `ValidationError` |
| `git_dirty` reasons | fake dep returning `True` / `False` / `None`; assert gate reasons |
| `handle_task` rejection | assert planner never invoked, no task row created |
| `run_task(proj=...)` | asserts supplied dir used verbatim, not `mkdir`-ed |
| `run_task(proj=None)` | existing four tests, unmodified |

Existing fakes in `test_telegram_bridge.py` and the `hermes_home` fixture cover
the setup.

## Out of scope

- Natural-language project matching — rejected above.
- Auto-registering projects by scanning a directory — defeats the registry.
- Web UI form for the registry; the JSON API is the interface, consistent with
  the rest of settings (see `docs/TODO.md`, "HTML forms for the settings pages").
- Per-project settings (engine, timeouts).

## Prerequisite

`Settings.projects` is empty, so `@myprofit` rejects until the registry is
populated. This is config, not code, and is the first thing to do after the
change lands.
