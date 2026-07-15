# Project Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/task @myprofit fix login` run against a registered existing project instead of always creating an empty `projects/<task-id>` workspace.

**Architecture:** A new `Settings.projects` map (name -> absolute path) is the registry. `hermes/project_resolve.py` parses the `@name` sigil out of task text and looks the name up in that map. Resolution happens in `telegram_bridge.handle_task`, *before* the confirmation gate, because the gate needs to know whether the target's git tree is dirty. The resolved path is then handed to `orchestrator.run_task` as a new optional `proj` argument.

**Tech Stack:** Python 3.11+, pydantic v2, pytest (`asyncio_mode = "auto"`), sqlite3, python-telegram-bot.

**Spec:** `docs/superpowers/specs/2026-07-15-project-registry-design.md`

## Global Constraints

- Test runner is the venv interpreter: `.venv/Scripts/python.exe -m pytest`. Run from `E:\Hermes\app`.
- `pyproject.toml` sets `asyncio_mode = "auto"`. Async tests are bare `async def test_x():` with **no** `@pytest.mark.asyncio` decorator.
- The `hermes_home` fixture (`tests/conftest.py`) monkeypatches `HERMES_HOME` to a `tmp_path`. Use it for anything touching `hermes.paths`. `Store` takes an explicit path, so store-only tests use `tmp_path` directly.
- Project names must match `[A-Za-z0-9][A-Za-z0-9._-]*` — must start with a letter or digit. This is what rejects `@..` and `@.ssh`.
- The registry name is **only ever a dict key**. Never concatenate it into a path. This is what removes path traversal from the design; do not reintroduce a `projects_path / name` join.
- Baseline is 68 passing tests. Every task must leave the full suite green.
- Branch: `feat/project-registry`.

---

### Task 1: `Settings.projects` registry field

**Files:**
- Modify: `hermes/config.py:1-31`
- Test: `tests/test_config.py`, `tests/test_web_ui.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Settings.projects: dict[str, str]`, mapping project name to absolute path. Consumed by Task 2's `resolve_project`.

The web UI needs no new endpoint — `POST /api/settings` already takes a whole `config.Settings`, so `projects` rides along and inherits the validator. That is a claim, and the web UI is the only way the registry ever gets populated, so it gets a test here rather than being assumed.

The validator checks **shape only** — name pattern and path absoluteness. It must not touch the filesystem. Pydantic validators run on every `Settings` construction, including `config.load_settings()` at startup, so an `is_dir()` check here would turn a missing folder into a startup crash that `start.bat` restarts into forever. Existence is Task 2's job.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_config.py`:

```python
import pytest
from pydantic import ValidationError
from hermes.config import Settings


def test_projects_defaults_empty():
    assert Settings().projects == {}


def test_projects_accepts_absolute_paths(tmp_path):
    s = Settings(projects={"myprofit": str(tmp_path)})
    assert s.projects["myprofit"] == str(tmp_path)


def test_projects_rejects_relative_path():
    with pytest.raises(ValidationError, match="absolute"):
        Settings(projects={"myprofit": "relative/path"})


@pytest.mark.parametrize("name", ["..", ".ssh", "-flag", "has space", "a/b", ""])
def test_projects_rejects_bad_names(name, tmp_path):
    with pytest.raises(ValidationError, match="project name"):
        Settings(projects={name: str(tmp_path)})


def test_projects_missing_path_still_loads(tmp_path):
    """A registered folder that no longer exists must NOT break Settings
    construction — load_settings() runs this validator at startup, and a
    dead path must fail one task, not the whole daemon."""
    gone = tmp_path / "was-here"
    s = Settings(projects={"gone": str(gone)})
    assert s.projects["gone"] == str(gone)


def test_projects_roundtrip(hermes_home, tmp_path):
    from hermes import config, paths
    paths.ensure_dirs()
    s = config.load_settings()
    s.projects = {"myprofit": str(tmp_path)}
    config.save_settings(s)
    assert config.load_settings().projects == {"myprofit": str(tmp_path)}
```

Append to `tests/test_web_ui.py` — the web UI is the only way the registry is
ever populated, so the "it rides along for free" claim gets checked:

```python
def test_settings_post_accepts_projects_registry(hermes_home, tmp_path):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    body = config.Settings(projects={"myprofit": str(tmp_path)}).model_dump()
    r = client.post("/api/settings", json=body)
    assert r.status_code == 200
    assert config.load_settings().projects == {"myprofit": str(tmp_path)}


def test_settings_post_rejects_bad_project_registry(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    r = client.post("/api/settings", json={"projects": {"myprofit": "relative/path"}})
    assert r.status_code == 422
    r = client.post("/api/settings", json={"projects": {"..": "C:\\Windows"}})
    assert r.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_config.py tests/test_web_ui.py -v`
Expected: FAIL. `test_projects_defaults_empty` fails with `AttributeError: 'Settings' object has no attribute 'projects'`; the rejection tests fail because no validator exists yet.

- [ ] **Step 3: Write the implementation**

In `hermes/config.py`, add `re` and `Path` to the imports and `field_validator` to the pydantic import:

```python
from __future__ import annotations
import re
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, Field, field_validator
from dotenv import dotenv_values
from . import paths
```

Add the module-level pattern just above `class McpServer`:

```python
# Registry keys are dict keys, never path components — this pattern is about
# keeping names readable and unambiguous, not about containment. Requiring a
# leading alphanumeric is what rejects ".." and ".ssh".
_PROJECT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
```

Add the field to `Settings`, directly below `projects_path`:

```python
    projects_path: str = ""
    projects: dict[str, str] = Field(default_factory=dict)  # name -> absolute path
```

Add the validator as the last member of `Settings`, after `mcp_servers`:

```python
    @field_validator("projects")
    @classmethod
    def _projects_shape(cls, v: dict[str, str]) -> dict[str, str]:
        # Shape only. Never touch the filesystem here: this runs on
        # load_settings() too, so an existence check would turn a missing
        # folder into a startup crash. resolve_project() checks existence.
        for name, path in v.items():
            if not _PROJECT_NAME.fullmatch(name):
                raise ValueError(
                    f"bad project name {name!r} — must start with a letter or "
                    "digit, then letters, digits, dot, dash, underscore")
            if not Path(path).is_absolute():
                raise ValueError(
                    f"project {name!r}: path must be absolute, got {path!r}")
        return v
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_config.py tests/test_web_ui.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS, all green — 68 baseline tests plus the new ones, nothing regressed.

- [ ] **Step 6: Commit**

```bash
git add hermes/config.py tests/test_config.py tests/test_web_ui.py
git commit -m "feat(config): add projects registry field

Settings.projects maps a project name to an absolute path. The validator
checks shape only — name pattern and absoluteness — and deliberately does
not stat the path: it also runs on load_settings(), so an existence check
would turn a missing folder into a startup crash loop under start.bat's
auto-restart. resolve_project() reports a missing path per-task instead."
```

---

### Task 2: `project_resolve` — parse the sigil, resolve the name

**Files:**
- Create: `hermes/project_resolve.py`
- Test: `tests/test_project_resolve.py`

**Interfaces:**
- Consumes: `Settings.projects` from Task 1.
- Produces:
  - `parse_project_ref(text: str) -> tuple[str | None, str]` — returns `(name, cleaned_text)`.
  - `resolve_project(name: str, settings: Settings) -> Path`
  - `ProjectNotFound(Exception)`, `ProjectPathMissing(Exception)` — both carry a user-facing message in `str(e)`.

  Task 5 calls all of these.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_project_resolve.py`:

```python
import pytest
from pathlib import Path
from hermes.config import Settings
from hermes.project_resolve import (
    parse_project_ref, resolve_project, ProjectNotFound, ProjectPathMissing)


@pytest.mark.parametrize("text,name,cleaned", [
    ("@myprofit fix login",       "myprofit", "fix login"),
    ("fix login @myprofit",       "myprofit", "fix login"),
    ("fix @myprofit login",       "myprofit", "fix login"),
    ("@myprofit",                 "myprofit", ""),
    ("fix login bug",             None,       "fix login bug"),
    ("email budi@example.com",    None,       "email budi@example.com"),
    ("@my-proj.v2_x fix",         "my-proj.v2_x", "fix"),
    ("bare @ sign",               None,       "bare @ sign"),
])
def test_parse_project_ref(text, name, cleaned):
    assert parse_project_ref(text) == (name, cleaned)


def test_parse_only_first_sigil_is_the_ref():
    """A task targets one project. A later @word is prose and must survive."""
    name, cleaned = parse_project_ref("@myprofit reply to @budi in changelog")
    assert name == "myprofit"
    assert cleaned == "reply to @budi in changelog"


def test_resolve_hit(tmp_path):
    s = Settings(projects={"myprofit": str(tmp_path)})
    assert resolve_project("myprofit", s) == Path(tmp_path)


def test_resolve_unregistered_lists_names(tmp_path):
    s = Settings(projects={"myprofit": str(tmp_path), "hermes": str(tmp_path)})
    with pytest.raises(ProjectNotFound) as e:
        resolve_project("myprofits", s)
    msg = str(e.value)
    assert "myprofits" in msg
    assert "myprofit" in msg and "hermes" in msg   # lists what IS registered


def test_resolve_unregistered_with_empty_registry():
    with pytest.raises(ProjectNotFound) as e:
        resolve_project("myprofit", Settings())
    assert "no projects are registered" in str(e.value).lower()


def test_resolve_registered_but_gone(tmp_path):
    gone = tmp_path / "moved-away"
    s = Settings(projects={"myprofit": str(gone)})
    with pytest.raises(ProjectPathMissing) as e:
        resolve_project("myprofit", s)
    assert str(gone) in str(e.value)


def test_resolve_registered_path_is_a_file(tmp_path):
    f = tmp_path / "not-a-dir.txt"
    f.write_text("x")
    s = Settings(projects={"myprofit": str(f)})
    with pytest.raises(ProjectPathMissing):
        resolve_project("myprofit", s)


def test_traversal_name_is_just_a_miss():
    """@../../etc is not a traversal attempt — the name is a dict key and is
    never joined to a path. It is an ordinary lookup miss."""
    with pytest.raises(ProjectNotFound):
        resolve_project("../../etc", Settings(projects={}))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_project_resolve.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'hermes.project_resolve'`.

- [ ] **Step 3: Write the implementation**

Create `hermes/project_resolve.py`:

```python
from __future__ import annotations
import re
from pathlib import Path
from .config import Settings

# The first @name in the text is the project reference. Anchored to a word
# boundary on the left so "budi@example.com" is not a reference, and to
# whitespace/end on the right so trailing punctuation is not swallowed.
_REF = re.compile(r"(?:^|(?<=\s))@([A-Za-z0-9][A-Za-z0-9._-]*)(?=\s|$)")


class ProjectNotFound(Exception):
    """The @name is not a key in Settings.projects — probably a typo."""


class ProjectPathMissing(Exception):
    """The @name is registered, but its path is gone from disk."""


def parse_project_ref(text: str) -> tuple[str | None, str]:
    """Split a task text into (project name, text without the sigil).

    Only the first sigil is the reference; any later @word is left alone, so
    "@myprofit reply to @budi" keeps "@budi" as prose.
    """
    m = _REF.search(text)
    if m is None:
        return None, text
    cleaned = (text[:m.start()] + text[m.end():]).strip()
    return m.group(1), re.sub(r"\s{2,}", " ", cleaned)


def resolve_project(name: str, settings: Settings) -> Path:
    """Map a registry name to its directory.

    `name` is used only as a dict key — it is never joined onto a path — so a
    name like "../../etc" is an ordinary miss, not a traversal.
    """
    path = settings.projects.get(name)
    if path is None:
        known = ", ".join(sorted(settings.projects)) or None
        if known is None:
            raise ProjectNotFound(
                f"Project '@{name}' is not registered, and no projects are "
                f"registered yet. Add one in the settings UI at "
                f"http://127.0.0.1:8799, or drop the @ to start a new workspace.")
        raise ProjectNotFound(
            f"Project '@{name}' is not registered.\nRegistered: {known}\n"
            f"Drop the @ to start a new workspace instead.")
    p = Path(path)
    if not p.is_dir():
        raise ProjectPathMissing(
            f"Project '@{name}' is registered as {path}, but that directory is "
            f"gone. It was moved or deleted after being registered — fix the "
            f"path in the settings UI at http://127.0.0.1:8799.")
    return p
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_project_resolve.py -v`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add hermes/project_resolve.py tests/test_project_resolve.py
git commit -m "feat(project_resolve): parse @name sigil and resolve via registry

parse_project_ref pulls the first @name out of a task text and returns the
text without it — the sigil is routing metadata, not part of the task, so
the planner never sees it. A later @word is prose and survives untouched.

resolve_project uses the name purely as a dict key, which is what keeps
path traversal out of the design. Registered-but-missing is a distinct
exception from not-registered: collapsing them sends the user hunting for
a typo that isn't there."
```

---

### Task 3: `run_task` accepts a resolved project directory

**Files:**
- Modify: `hermes/orchestrator.py:37-43`
- Test: `tests/test_orchestrator.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Orchestrator.run_task(task_id, chat_id, text, report, proj: Path | None = None)`. Task 5 passes `proj`.

`proj` defaults to `None`, which reproduces today's behaviour exactly and keeps the four existing `run_task` callers in `tests/test_orchestrator.py` green without edits.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_orchestrator.py`:

```python
async def test_run_task_uses_supplied_proj(hermes_home):
    """A resolved existing project is used verbatim, not nested under task_id."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(default_engine="claude",
                        projects_path=str(hermes_home / "proj"))
    existing = hermes_home / "myprofit"
    existing.mkdir()
    (existing / "marker.txt").write_text("pre-existing work")

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "fix it"}]})

    seen = []
    async def fake_run_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        seen.append(Path(cwd))
        return RunResult(True, "done", "", False, 0)

    deps = dict(run_engine=fake_run_engine, build_apk=None,
                detect=lambda d: "flutter", test_emulator=None, test_browser=None)
    orch = Orchestrator(settings, store, planner, deps)

    async def report(tid, msg): pass
    store.create_task("t1", 5, "fix it")
    await orch.run_task("t1", 5, "fix it", report, proj=existing)

    assert seen == [existing]                       # exact dir, not proj/t1
    assert (existing / "marker.txt").exists()       # untouched
    assert not (existing / "t1").exists()           # nothing nested


async def test_run_task_without_proj_creates_workspace(hermes_home):
    """proj=None keeps today's behaviour: a fresh dir named for the task."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    root = hermes_home / "proj"
    settings = Settings(default_engine="claude", projects_path=str(root))

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "make it"}]})

    seen = []
    async def fake_run_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        seen.append(Path(cwd))
        return RunResult(True, "done", "", False, 0)

    deps = dict(run_engine=fake_run_engine, build_apk=None,
                detect=lambda d: "flutter", test_emulator=None, test_browser=None)
    orch = Orchestrator(settings, store, planner, deps)

    async def report(tid, msg): pass
    store.create_task("t1", 5, "make it")
    await orch.run_task("t1", 5, "make it", report)

    assert seen == [root / "t1"]
    assert (root / "t1").is_dir()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -k supplied_proj -v`
Expected: FAIL with `TypeError: run_task() got an unexpected keyword argument 'proj'`.

- [ ] **Step 3: Write the implementation**

In `hermes/orchestrator.py`, replace lines 37-43:

```python
    async def run_task(self, task_id: str, chat_id: int, text: str, report) -> None:
        from . import paths
        self.settings = self.get_settings()
        self.store.set_task_status(task_id, "running")
        projects_path = self.settings.projects_path or str(paths.projects_dir())
        proj = Path(projects_path) / task_id
        proj.mkdir(parents=True, exist_ok=True)
        await report(task_id, "planning...")
```

with:

```python
    async def run_task(self, task_id: str, chat_id: int, text: str, report,
                       proj: Path | None = None) -> None:
        from . import paths
        self.settings = self.get_settings()
        self.store.set_task_status(task_id, "running")
        if proj is None:
            # No registered project: fresh throwaway workspace, named for the task.
            projects_path = self.settings.projects_path or str(paths.projects_dir())
            proj = Path(projects_path) / task_id
            proj.mkdir(parents=True, exist_ok=True)
        await report(task_id, "planning...")
```

A resolved project is never `mkdir`-ed — it is already there, and `resolve_project` proved it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_orchestrator.py -v`
Expected: PASS. The four pre-existing `run_task` tests still pass, unmodified.

- [ ] **Step 5: Commit**

```bash
git add hermes/orchestrator.py tests/test_orchestrator.py
git commit -m "feat(orchestrator): accept a pre-resolved project dir

run_task takes an optional proj. When given, it is used verbatim and never
mkdir'd — the caller resolved it from the registry and already proved it
exists. Defaulting to None reproduces the previous behaviour exactly, so
existing callers and tests are untouched."
```

---

### Task 4: `git_dirty` — is there uncommitted work to lose?

**Files:**
- Create: `hermes/git_status.py`
- Test: `tests/test_git_status.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `async def git_dirty(path: Path) -> bool | None`. `True` = uncommitted changes; `False` = clean; `None` = not a git repo (no undo available). Task 5 injects this into `Bridge`; Task 6 wires the real one in `main.py`.

Follows the async-subprocess pattern already used in `hermes/build_runner.py:23`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_git_status.py`:

```python
import asyncio
import pytest
from hermes.git_status import git_dirty


async def _git(cwd, *args):
    p = await asyncio.create_subprocess_exec(
        "git", *args, cwd=str(cwd),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    await p.wait()
    assert p.returncode == 0, f"git {' '.join(args)} failed"


async def _repo(path):
    path.mkdir(parents=True, exist_ok=True)
    await _git(path, "init", "-q")
    await _git(path, "config", "user.email", "t@example.com")
    await _git(path, "config", "user.name", "Test")
    (path / "a.txt").write_text("one")
    await _git(path, "add", "a.txt")
    await _git(path, "commit", "-q", "-m", "init")
    return path


async def test_clean_repo_is_false(tmp_path):
    repo = await _repo(tmp_path / "clean")
    assert await git_dirty(repo) is False


async def test_modified_file_is_dirty(tmp_path):
    repo = await _repo(tmp_path / "modified")
    (repo / "a.txt").write_text("changed")
    assert await git_dirty(repo) is True


async def test_untracked_file_is_dirty(tmp_path):
    repo = await _repo(tmp_path / "untracked")
    (repo / "new.txt").write_text("new")
    assert await git_dirty(repo) is True


async def test_not_a_repo_is_none(tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()
    assert await git_dirty(plain) is None


async def test_missing_dir_is_none(tmp_path):
    assert await git_dirty(tmp_path / "does-not-exist") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_git_status.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'hermes.git_status'`.

- [ ] **Step 3: Write the implementation**

Create `hermes/git_status.py`:

```python
from __future__ import annotations
import asyncio
from pathlib import Path


async def git_dirty(path: Path) -> bool | None:
    """Does `path` have uncommitted work?

    True  -> modified or untracked files; a bad run here is not recoverable.
    False -> clean tree; `git checkout .` is the undo button.
    None  -> not a git repo (or git is unavailable). No undo either way, so
             callers should treat this like True for gating purposes, while
             still being able to say *why* in the message.
    """
    try:
        p = await asyncio.create_subprocess_exec(
            "git", "status", "--porcelain", cwd=str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await p.communicate()
    except (OSError, NotADirectoryError):
        return None                      # no git binary, or path is gone
    if p.returncode != 0:
        return None                      # not a work tree
    return bool(out.strip())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_git_status.py -v`
Expected: PASS, 5 tests. (Requires `git` on PATH, which the repo already assumes — `deploy/install.ps1` checks for it.)

- [ ] **Step 5: Commit**

```bash
git add hermes/git_status.py tests/test_git_status.py
git commit -m "feat(git_status): add git_dirty check

Three-way answer, because the gate needs to distinguish 'clean, git can
undo this' from 'dirty, work would be lost' from 'not a repo, there is no
undo at all' — the last two both gate, but for different reasons the user
should see."
```

---

### Task 5: Bridge resolves the project and gates on it

**Files:**
- Modify: `hermes/telegram_bridge.py:26-33` (constructor), `41-58` (`handle_task`), `60-74` (`resolve_confirm`), `76-79` (`_run`)
- Test: `tests/test_telegram_bridge.py`

**Interfaces:**
- Consumes: `parse_project_ref`, `resolve_project`, `ProjectNotFound`, `ProjectPathMissing` (Task 2); `run_task(..., proj=)` (Task 3); the `git_dirty` contract (Task 4).
- Produces: `Bridge(settings, store, orchestrator, sender, ask_confirm=None, git_dirty=None)`. Task 6 wires the real `git_dirty`.

`git_dirty` is injected as a constructor keyword, following the existing `ask_confirm=None` convention. It is **not** read from the orchestrator's `deps` dict — the bridge has no access to that. A `None` `git_dirty` skips the dirty check, exactly as a `None` `ask_confirm` skips the gate, which is what keeps the existing bridge tests passing untouched.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_telegram_bridge.py`:

```python
from pathlib import Path


def _store(home):
    from hermes.session_store import Store
    s = Store(home / "t.db"); s.init_schema()
    return s


async def test_unregistered_project_rejected_before_planning(hermes_home):
    store = _store(hermes_home)
    settings = Settings(allowed_user_ids=[1], projects={})
    sent = []
    async def sender(chat, text): sent.append(text)
    class FakeOrch:
        async def run_task(self, *a, **k): raise AssertionError("planner must not run")
    b = Bridge(settings, store, FakeOrch(), sender)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@nope fix login")
    assert tid is None
    assert "not registered" in sent[0]
    assert store.list_tasks() == []          # no task row created


async def test_registered_but_missing_path_rejected(hermes_home):
    store = _store(hermes_home)
    gone = hermes_home / "moved-away"
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(gone)})
    sent = []
    async def sender(chat, text): sent.append(text)
    class FakeOrch:
        async def run_task(self, *a, **k): raise AssertionError("planner must not run")
    b = Bridge(settings, store, FakeOrch(), sender)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@myprofit fix login")
    assert tid is None
    assert "gone" in sent[0]


async def test_clean_project_runs_without_gate(hermes_home):
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    got = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): raise AssertionError("clean tree must not gate")
    async def git_dirty(path): return False
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            got.append((text, proj))
    b = Bridge(settings, store, FakeOrch(), sender,
               ask_confirm=ask_confirm, git_dirty=git_dirty)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@myprofit refactor auth")
    assert tid is not None
    assert got == [("refactor auth", proj)]      # sigil stripped, proj threaded


async def test_dirty_project_gates(hermes_home):
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    ran, asked = [], []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): asked.append(reasons)
    async def git_dirty(path): return True
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(proj)
    b = Bridge(settings, store, FakeOrch(), sender,
               ask_confirm=ask_confirm, git_dirty=git_dirty)

    tid = await b.handle_task(user_id=1, chat_id=5, text="@myprofit refactor auth")
    assert store.get_task(tid)["status"] == "awaiting_confirm"
    assert ran == []
    assert any("uncommitted" in r for r in asked[0])

    # approving must still reach the resolved project, not a fresh workspace
    assert await b.resolve_confirm(user_id=1, task_id=tid, approved=True)
    assert ran == [proj]


async def test_non_git_project_gates(hermes_home):
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    asked = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): asked.append(reasons)
    async def git_dirty(path): return None
    class FakeOrch:
        async def run_task(self, *a, **k): pass
    b = Bridge(settings, store, FakeOrch(), sender,
               ask_confirm=ask_confirm, git_dirty=git_dirty)

    await b.handle_task(user_id=1, chat_id=5, text="@myprofit refactor auth")
    assert any("not a git repo" in r for r in asked[0])


async def test_risky_text_and_dirty_tree_both_reported(hermes_home):
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    asked = []
    async def sender(chat, text): pass
    async def ask_confirm(chat, task_id, reasons): asked.append(reasons)
    async def git_dirty(path): return True
    class FakeOrch:
        async def run_task(self, *a, **k): pass
    b = Bridge(settings, store, FakeOrch(), sender,
               ask_confirm=ask_confirm, git_dirty=git_dirty)

    await b.handle_task(user_id=1, chat_id=5, text="@myprofit fix then git push")
    assert any("git push" in r for r in asked[0])
    assert any("uncommitted" in r for r in asked[0])


async def test_no_sigil_still_creates_fresh_workspace(hermes_home):
    """No @ means proj=None — the orchestrator makes projects/<task-id>."""
    store = _store(hermes_home)
    settings = Settings(allowed_user_ids=[1])
    got = []
    async def sender(chat, text): pass
    async def git_dirty(path): raise AssertionError("no project, nothing to check")
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            got.append(proj)
    b = Bridge(settings, store, FakeOrch(), sender, git_dirty=git_dirty)

    await b.handle_task(user_id=1, chat_id=5, text="buat app counter Flutter")
    assert got == [None]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_telegram_bridge.py -k "project or dirty or sigil" -v`
Expected: FAIL with `TypeError: Bridge.__init__() got an unexpected keyword argument 'git_dirty'`.

- [ ] **Step 3: Write the implementation**

In `hermes/telegram_bridge.py`, add the import at the top:

```python
from __future__ import annotations
import re, secrets, time
from pathlib import Path
from .config import Settings
from .session_store import Store
from .project_resolve import (
    parse_project_ref, resolve_project, ProjectNotFound, ProjectPathMissing)
```

Replace the constructor (lines 26-33):

```python
    def __init__(self, settings: Settings, store: Store, orchestrator, sender,
                 ask_confirm=None, git_dirty=None):
        self.settings = settings
        self.store = store
        self.orchestrator = orchestrator
        self.sender = sender            # async (chat_id, text)
        self.ask_confirm = ask_confirm  # async (chat_id, task_id, reasons)
        self.git_dirty = git_dirty      # async (path) -> bool | None
        # task_id -> (user, chat, text, proj)
        self.pending: dict[str, tuple[int, int, str, Path | None]] = {}
```

Replace `handle_task` (lines 41-58):

```python
    async def handle_task(self, user_id: int, chat_id: int, text: str):
        settings = self.get_settings()
        if not is_allowed(user_id, settings):
            await self.sender(chat_id, f"You are not authorized to use this bot. Your Telegram User ID is: {user_id}\n\nPlease add this ID to the allowed user list in the settings UI at http://127.0.0.1:8799")
            return None

        # Resolve before anything else: a bad @name costs zero tokens because
        # the planner never runs, and the gate below needs the project path.
        name, text = parse_project_ref(text)
        proj = None
        if name is not None:
            try:
                proj = resolve_project(name, settings)
            except (ProjectNotFound, ProjectPathMissing) as e:
                await self.sender(chat_id, str(e))
                return None

        task_id = new_task_id()
        self.store.create_task(task_id, chat_id, text)

        reasons = detect_risky(text)
        if proj is not None and self.git_dirty is not None:
            dirty = await self.git_dirty(proj)
            if dirty is None:
                reasons.append(
                    f"@{name} is not a git repo — there is no undo if this goes wrong")
            elif dirty:
                reasons.append(
                    f"@{name} has uncommitted changes that could be lost")

        if reasons and settings.confirm_risky and self.ask_confirm:
            self.store.set_task_status(task_id, "awaiting_confirm")
            self.pending[task_id] = (user_id, chat_id, text, proj)
            await self.ask_confirm(chat_id, task_id, reasons)
            return task_id

        await self.sender(chat_id, f"Task {task_id} queued.")
        await self._run(task_id, chat_id, text, proj)
        return task_id
```

Replace `resolve_confirm` (lines 60-74) — only the unpacking and the `_run` call change:

```python
    async def resolve_confirm(self, user_id: int, task_id: str, approved: bool) -> bool:
        pend = self.pending.pop(task_id, None)
        if pend is None:
            return False
        _, chat_id, text, proj = pend
        if not is_allowed(user_id, self.get_settings()):
            self.pending[task_id] = pend  # keep waiting for an authorized user
            return False
        if not approved:
            self.store.set_task_status(task_id, "cancelled")
            await self.sender(chat_id, f"Task {task_id} cancelled.")
            return True
        await self.sender(chat_id, f"Task {task_id} confirmed, queued.")
        await self._run(task_id, chat_id, text, proj)
        return True
```

Replace `_run` (lines 76-79):

```python
    async def _run(self, task_id: str, chat_id: int, text: str,
                   proj: Path | None = None):
        async def report(tid, msg):
            await self.sender(chat_id, f"[{tid}] {msg}")
        await self.orchestrator.run_task(task_id, chat_id, text, report, proj=proj)
```

- [ ] **Step 4: Run the bridge tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_telegram_bridge.py -v`
Expected: PASS. The seven pre-existing bridge tests pass unmodified — their `FakeOrch.run_task(self, task_id, chat_id, text, report)` signatures still work because `_run` passes `proj` as a keyword and those fakes that need it declare `proj=None`.

> **If a pre-existing fake raises `TypeError: run_task() got an unexpected keyword argument 'proj'`:** add `proj=None` to that fake's `run_task` signature. Do not remove the keyword from `_run`.

- [ ] **Step 5: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add hermes/telegram_bridge.py tests/test_telegram_bridge.py
git commit -m "feat(telegram_bridge): resolve @name and gate on a dirty tree

Resolution lives here rather than in run_task because the confirmation
gate needs the dirty-tree state, which needs the project path — and the
gate runs before the orchestrator is ever called. A rejected @name now
costs zero tokens.

The gate also learns a second class of reason. The text scan was enough
when every workspace was a throwaway empty dir; pointing tasks at real
code changes the stakes, and 'refactor auth' matches no risky pattern.
Gating on a dirty tree rather than on every existing-project task is
deliberate: a clean tree already has git checkout as its undo, and a gate
that always fires gets tapped through without reading.

pending now carries proj, since resolve_confirm is what calls _run after
approval."
```

---

### Task 6: Wire the real `git_dirty` into `main.run()`

**Files:**
- Modify: `hermes/main.py:141` (the `Bridge(...)` construction)
- Test: `tests/test_main_smoke.py`

**Interfaces:**
- Consumes: `git_dirty` (Task 4), `Bridge(..., git_dirty=)` (Task 5).
- Produces: nothing downstream.

Bridge treats `git_dirty=None` as "skip the check", so a missing injection makes the dirty-tree gate fail **open and silently** — no test would go red. That failure mode is worth a real test, so the construction is pulled out of `main.run()` into a small factory that a test can actually call. Asserting on `inspect.getsource(main.run)` text would also catch it, but would break on any rename without a behaviour change.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_main_smoke.py`:

```python
def test_build_bridge_injects_git_dirty(tmp_path):
    """A missing git_dirty makes the dirty-tree gate fail open in silence —
    Bridge reads None as 'skip the check'. Assert the wiring, not the source."""
    from hermes.config import Settings
    from hermes.session_store import Store
    store = Store(tmp_path / "t.db"); store.init_schema()

    async def sender(chat, text): pass

    b = main._build_bridge(Settings(), store, orchestrator=None, sender=sender,
                           ask_confirm=None)
    assert b.git_dirty is not None
    assert inspect.iscoroutinefunction(b.git_dirty)
```

`inspect` and `main` are already imported at the top of this file; do not
re-import them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_main_smoke.py -k build_bridge -v`
Expected: FAIL with `AttributeError: module 'hermes.main' has no attribute '_build_bridge'`.

- [ ] **Step 3: Write the implementation**

In `hermes/main.py`, add to the imports near the other `hermes` imports:

```python
from .git_status import git_dirty
```

Add this factory at module level, above `async def run(`:

```python
def _build_bridge(settings, store, orchestrator, sender, ask_confirm):
    """Construct the Bridge with its real collaborators.

    Extracted from run() so the wiring is testable: Bridge treats a missing
    git_dirty as "skip the dirty-tree check", so a dropped injection would
    disable the gate with every test still green.
    """
    return Bridge(settings, store, orchestrator, sender,
                  ask_confirm=ask_confirm, git_dirty=git_dirty)
```

Replace line 141:

```python
            bridge = Bridge(settings, store, orch, sender, ask_confirm=ask_confirm)
```

with:

```python
            bridge = _build_bridge(settings, store, orch, sender, ask_confirm)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_main_smoke.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS, all green, no warnings.

- [ ] **Step 6: Commit**

```bash
git add hermes/main.py tests/test_main_smoke.py
git commit -m "feat(main): inject the real git_dirty into the bridge

Without this the dirty-tree gate is dead code: Bridge treats git_dirty=None
as 'skip the check', so it would fail open with every test still green.

Bridge construction moves into a _build_bridge factory so that exact
failure is testable by calling it, rather than by matching the text of
inspect.getsource(run) — which would catch the same bug but go red on any
rename that changed no behaviour."
```

---

### Task 7: Document the registry in the README

**Files:**
- Modify: `README.md`
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add a Features bullet**

`README.md` has no `/task` section — `/task` only appears inside the `## How it
works` diagram. Add a bullet to the `## Features` list (line 82), directly above
the existing **Confirmation gate** bullet:

```markdown
- **Existing projects** — register a name-to-path map in settings, then aim a task at it with
  `/task @myprofit fix login`. Without `@`, a fresh workspace is created as before.
```

And extend the **Confirmation gate** bullet to mention its second trigger:

```markdown
- **Confirmation gate** — tasks that `git push`, delete files, touch paths outside the project
  dir, or target a registered project with an unclean git tree wait for an inline-keyboard
  ✅/❌ in Telegram before running.
```

- [ ] **Step 2: Add a usage section**

Insert a new section immediately after the `## Features` list and before
`## Layout`:

```markdown
## Working on an existing project

Register the project once, in the settings UI at http://127.0.0.1:8799
(`projects` is a name-to-absolute-path map):

```json
"projects": {
  "myprofit": "C:\\Users\\USER\\myprofit",
  "hermes":   "E:\\Hermes\\app"
}
```

Then aim a task at it with the `@name` sigil:

```
/task @myprofit fix the login bug
```

Without `@`, Hermes creates a fresh workspace under `projects_path` as before.
`@name` is deliberately the *only* trigger — a bare "project myprofit" in prose
starts a new workspace, so that a folder named `app` or `test` can never be
matched out of ordinary task text.

An unregistered `@name` is rejected with the list of registered names; it does
not silently fall back to a new workspace.

If the target has uncommitted git changes — or is not a git repo at all —
Hermes asks for confirmation first, since there is no clean undo.
```

- [ ] **Step 3: Update the backlog**

In `docs/TODO.md`, under "Not started at all (potential future scope)", the
registry is now shipped. Add to the top of that section:

```markdown
- [x] **Run tasks against an existing project** — `Settings.projects` maps a name to
  an absolute path; `/task @myprofit ...` resolves through it (`project_resolve`),
  and the confirmation gate additionally fires when the target's git tree is dirty
  or the target is not a repo.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/TODO.md
git commit -m "docs: document the @name project registry"
```

---

## Verification

- [ ] Full suite green: `.venv/Scripts/python.exe -m pytest -q`
- [ ] Register a real project and drive it end to end:
  1. Open http://127.0.0.1:8799, set `projects` to `{"hermes": "E:\\Hermes\\app"}`.
  2. `/task @nope fix login` -> rejected, lists `hermes`, no task row appears on the dashboard.
  3. `/task @hermes what is in pyproject.toml` -> with a dirty tree, the gate fires and names the uncommitted changes; approving runs against `E:\Hermes\app` itself.
  4. `/task buat app counter Flutter` -> still creates a fresh `projects/<task-id>` workspace.
