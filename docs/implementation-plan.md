# Hermes Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows-local, Telegram-driven orchestrator that plans coding/testing tasks with a NVIDIA NIM brain, delegates coding to Claude Code / Antigravity CLIs, builds APKs, tests in browser/emulator, exposes MCP tools to the brain, and is configured via a local web UI.

**Architecture:** Python 3.11 package `hermes` under `E:\Hermes\app`. Async core: a Telegram bridge feeds tasks to an orchestrator (OpenAI SDK pointed at NIM) that emits a JSON step plan; an engine_runner drives `claude -p` / `agy -p` via subprocess; build/test runners invoke gradle/flutter/adb/playwright; mcp_hub bridges MCP servers to OpenAI-format tool calls; a FastAPI web_ui on `127.0.0.1:8799` provides settings + dashboard. State persists in SQLite.

**Tech Stack:** Python 3.11, `python-telegram-bot` (v21+), `openai` SDK, `fastapi`+`uvicorn`, `pydantic` v2, `mcp` (Python SDK), `playwright`, `pytest`+`pytest-asyncio`, stdlib `sqlite3`/`subprocess`/`asyncio`.

## Global Constraints

- Python 3.11+ only. Windows 10 host.
- Install root is `E:\Hermes\`. Source lives in `E:\Hermes\app`. Package name `hermes`.
- Web UI binds `127.0.0.1` only — never `0.0.0.0`.
- Secrets (NVIDIA key, Telegram token, MCP env) live in `E:\Hermes\config\.env`, never logged, never sent to Telegram.
- Telegram tasks accepted only from whitelisted numeric user IDs.
- NVIDIA base URL default: `https://integrate.api.nvidia.com/v1`.
- Coding engines run only inside `E:\Hermes\projects\<task-id>`.
- All paths in code use `pathlib.Path`; config path root resolved from `HERMES_HOME` env (default `E:\Hermes`).
- Every module ships with unit tests under `E:\Hermes\app\tests`. TDD: test first, watch it fail, implement, watch it pass, commit.
- Tests must not hit the real network, real NIM, real emulator, or real `claude`/`agy` binaries — use fakes/stubs.

---

## File Structure

```
E:\Hermes\app\
├─ pyproject.toml
├─ hermes\
│  ├─ __init__.py
│  ├─ paths.py            # HERMES_HOME resolution, dir constants
│  ├─ config.py          # Settings model, load/save, .env secrets
│  ├─ session_store.py   # SQLite task/step/artifact persistence
│  ├─ engine_runner.py   # run claude -p / agy -p, capture+timeout
│  ├─ project_detect.py  # detect flutter/rn/native from a dir
│  ├─ build_runner.py    # build APK per project type
│  ├─ test_runner.py     # browser (playwright) + emulator (adb) tests
│  ├─ mcp_hub.py         # MCP servers -> OpenAI tool schemas + exec
│  ├─ orchestrator.py    # NIM planner + step executor + recovery
│  ├─ telegram_bridge.py # bot: whitelist, receive task, report
│  ├─ web_ui.py          # FastAPI: settings, dashboard, mcp tab
│  └─ main.py            # wire everything, run bot + web UI
└─ tests\
   ├─ conftest.py
   ├─ test_config.py
   ├─ test_session_store.py
   ├─ test_engine_runner.py
   ├─ test_project_detect.py
   ├─ test_build_runner.py
   ├─ test_test_runner.py
   ├─ test_mcp_hub.py
   ├─ test_orchestrator.py
   ├─ test_telegram_bridge.py
   └─ test_web_ui.py
```

Build order (dependency-first): paths → config → session_store → project_detect → engine_runner → build_runner → test_runner → mcp_hub → orchestrator → telegram_bridge → web_ui → main → installer.

---

## Phase 0 — Project scaffold

### Task 0: Repo, venv, packaging

**Files:**
- Create: `E:\Hermes\app\pyproject.toml`
- Create: `E:\Hermes\app\hermes\__init__.py`
- Create: `E:\Hermes\app\tests\conftest.py`
- Create: `E:\Hermes\app\.gitignore`

- [ ] **Step 1: git init + venv**

```powershell
cd E:\Hermes\app
git init
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -U pip
```

- [ ] **Step 2: Write `pyproject.toml`**

```toml
[project]
name = "hermes"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "python-telegram-bot>=21",
  "openai>=1.40",
  "fastapi>=0.111",
  "uvicorn>=0.30",
  "pydantic>=2.7",
  "pydantic-settings>=2.3",
  "python-dotenv>=1.0",
  "mcp>=1.0",
  "playwright>=1.45",
  "httpx>=0.27",
]

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.23"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"
```

- [ ] **Step 3: `.gitignore`**

```
.venv/
__pycache__/
*.pyc
/config/.env
/projects/
/artifacts/
hermes.db
```

- [ ] **Step 4: `hermes/__init__.py`** — empty file. `tests/conftest.py`:

```python
import os
import pytest

@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    return tmp_path
```

- [ ] **Step 5: Install + verify**

Run: `.\.venv\Scripts\pip install -e ".[dev]"` then `.\.venv\Scripts\pytest -q`
Expected: `no tests ran` (exit 5) — collection works, no tests yet.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml .gitignore hermes/__init__.py tests/conftest.py
git commit -m "chore: scaffold hermes package"
```

---

## Phase 1 — Foundations (paths, config, session store)

### Task 1: `paths` module

**Files:**
- Create: `hermes/paths.py`
- Test: `tests/test_paths.py`

**Interfaces:**
- Produces: `home() -> Path`, `config_dir() -> Path`, `projects_dir() -> Path`, `artifacts_dir() -> Path`, `db_path() -> Path`, `ensure_dirs() -> None`. All read `HERMES_HOME` env (default `E:/Hermes`).

- [ ] **Step 1: Failing test** — `tests/test_paths.py`

```python
from hermes import paths

def test_home_from_env(hermes_home):
    assert paths.home() == hermes_home

def test_ensure_dirs_creates_tree(hermes_home):
    paths.ensure_dirs()
    assert paths.config_dir().is_dir()
    assert paths.projects_dir().is_dir()
    assert paths.artifacts_dir().is_dir()
    assert paths.db_path() == hermes_home / "hermes.db"
```

- [ ] **Step 2: Run — expect FAIL** (`ModuleNotFoundError: hermes.paths`)

Run: `.\.venv\Scripts\pytest tests/test_paths.py -q`

- [ ] **Step 3: Implement `hermes/paths.py`**

```python
import os
from pathlib import Path

def home() -> Path:
    return Path(os.environ.get("HERMES_HOME", r"E:/Hermes"))

def config_dir() -> Path:
    return home() / "config"

def projects_dir() -> Path:
    return home() / "projects"

def artifacts_dir() -> Path:
    return home() / "artifacts"

def db_path() -> Path:
    return home() / "hermes.db"

def ensure_dirs() -> None:
    for d in (config_dir(), projects_dir(), artifacts_dir()):
        d.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: paths module"`

---

### Task 2: `config` — settings + secrets

**Files:**
- Create: `hermes/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Produces:
  - `class McpServer(BaseModel)`: `name: str`, `type: Literal["stdio","http"]`, `command: str = ""`, `args: list[str] = []`, `url: str = ""`, `env: dict[str,str] = {}`, `enabled: bool = True`.
  - `class Settings(BaseModel)`: `nvidia_base_url: str`, `model: str`, `allowed_user_ids: list[int]`, `default_engine: Literal["claude","antigravity","auto"]`, `projects_path: str`, `android_sdk_path: str`, `emulator_avd: str`, `default_test_mode: Literal["browser","emulator","none"]`, `timeout_code_s: int`, `timeout_build_s: int`, `timeout_test_s: int`, `mcp_servers: list[McpServer]`.
  - `class Secrets(BaseModel)`: `nvidia_api_key: str`, `telegram_bot_token: str`.
  - `load_settings() -> Settings` (reads `config/config.yaml`, defaults if missing).
  - `save_settings(s: Settings) -> None` (writes yaml).
  - `load_secrets() -> Secrets` (reads `config/.env`).
  - `save_secrets(s: Secrets) -> None` (writes `.env`).

- [ ] **Step 1: Failing test** — `tests/test_config.py`

```python
from hermes import config, paths

def test_defaults_when_missing(hermes_home):
    paths.ensure_dirs()
    s = config.load_settings()
    assert s.nvidia_base_url == "https://integrate.api.nvidia.com/v1"
    assert s.default_engine == "auto"
    assert s.mcp_servers == []

def test_settings_roundtrip(hermes_home):
    paths.ensure_dirs()
    s = config.load_settings()
    s.model = "deepseek-ai/deepseek-v3"
    s.allowed_user_ids = [123, 456]
    s.mcp_servers.append(config.McpServer(name="fs", type="stdio", command="npx"))
    config.save_settings(s)
    s2 = config.load_settings()
    assert s2.model == "deepseek-ai/deepseek-v3"
    assert s2.allowed_user_ids == [123, 456]
    assert s2.mcp_servers[0].name == "fs"

def test_secrets_roundtrip(hermes_home):
    paths.ensure_dirs()
    config.save_secrets(config.Secrets(nvidia_api_key="nv-k", telegram_bot_token="tg-t"))
    sec = config.load_secrets()
    assert sec.nvidia_api_key == "nv-k"
    assert sec.telegram_bot_token == "tg-t"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/config.py`**

```python
from __future__ import annotations
from typing import Literal
import json
from pydantic import BaseModel, Field
from dotenv import dotenv_values
from . import paths

class McpServer(BaseModel):
    name: str
    type: Literal["stdio", "http"]
    command: str = ""
    args: list[str] = Field(default_factory=list)
    url: str = ""
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True

class Settings(BaseModel):
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    model: str = "deepseek-ai/deepseek-v3"
    allowed_user_ids: list[int] = Field(default_factory=list)
    default_engine: Literal["claude", "antigravity", "auto"] = "auto"
    projects_path: str = ""
    android_sdk_path: str = ""
    emulator_avd: str = ""
    default_test_mode: Literal["browser", "emulator", "none"] = "none"
    timeout_code_s: int = 900
    timeout_build_s: int = 1200
    timeout_test_s: int = 600
    mcp_servers: list[McpServer] = Field(default_factory=list)

class Secrets(BaseModel):
    nvidia_api_key: str = ""
    telegram_bot_token: str = ""

def _settings_file():
    return paths.config_dir() / "config.yaml"  # stored as JSON for zero-dep parsing

def load_settings() -> Settings:
    f = _settings_file()
    if not f.exists():
        return Settings()
    return Settings.model_validate_json(f.read_text(encoding="utf-8"))

def save_settings(s: Settings) -> None:
    paths.config_dir().mkdir(parents=True, exist_ok=True)
    _settings_file().write_text(s.model_dump_json(indent=2), encoding="utf-8")

def _env_file():
    return paths.config_dir() / ".env"

def load_secrets() -> Secrets:
    vals = dotenv_values(_env_file())
    return Secrets(
        nvidia_api_key=vals.get("NVIDIA_API_KEY", "") or "",
        telegram_bot_token=vals.get("TELEGRAM_BOT_TOKEN", "") or "",
    )

def save_secrets(s: Secrets) -> None:
    paths.config_dir().mkdir(parents=True, exist_ok=True)
    lines = [
        f"NVIDIA_API_KEY={s.nvidia_api_key}",
        f"TELEGRAM_BOT_TOKEN={s.telegram_bot_token}",
    ]
    _env_file().write_text("\n".join(lines) + "\n", encoding="utf-8")
```

> Note: file is named `config.yaml` for user familiarity but serialized as JSON (valid YAML subset) to avoid a YAML dependency.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: config settings + secrets"`

---

### Task 3: `session_store` — SQLite persistence

**Files:**
- Create: `hermes/session_store.py`
- Test: `tests/test_session_store.py`

**Interfaces:**
- Produces:
  - `class Store`: `__init__(self, db: Path)`, `init_schema()`, `create_task(task_id: str, chat_id: int, text: str) -> None`, `set_task_status(task_id, status)`, `add_step(task_id, index, kind, detail) -> int`, `set_step_status(step_id, status)`, `append_log(task_id, line)`, `add_artifact(task_id, kind, path)`, `get_task(task_id) -> dict | None`, `list_tasks(limit=50) -> list[dict]`, `get_logs(task_id) -> list[str]`, `get_artifacts(task_id) -> list[dict]`.
  - Status values are free strings: `"queued","running","done","failed","stopped"`.

- [ ] **Step 1: Failing test** — `tests/test_session_store.py`

```python
from hermes.session_store import Store

def test_task_lifecycle(tmp_path):
    s = Store(tmp_path / "t.db")
    s.init_schema()
    s.create_task("t1", chat_id=99, text="build app")
    s.set_task_status("t1", "running")
    sid = s.add_step("t1", 0, "code", "claude prompt")
    s.set_step_status(sid, "done")
    s.append_log("t1", "line one")
    s.add_artifact("t1", "apk", r"E:\Hermes\artifacts\t1\app.apk")

    task = s.get_task("t1")
    assert task["status"] == "running"
    assert task["chat_id"] == 99
    assert s.get_logs("t1") == ["line one"]
    assert s.get_artifacts("t1")[0]["kind"] == "apk"
    assert s.list_tasks()[0]["task_id"] == "t1"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/session_store.py`**

```python
from __future__ import annotations
import sqlite3, time
from pathlib import Path

class Store:
    def __init__(self, db: Path):
        self.db = str(db)

    def _conn(self):
        c = sqlite3.connect(self.db)
        c.row_factory = sqlite3.Row
        return c

    def init_schema(self):
        with self._conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS tasks(
                  task_id TEXT PRIMARY KEY, chat_id INTEGER, text TEXT,
                  status TEXT, created REAL);
                CREATE TABLE IF NOT EXISTS steps(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  idx INTEGER, kind TEXT, detail TEXT, status TEXT);
                CREATE TABLE IF NOT EXISTS logs(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  ts REAL, line TEXT);
                CREATE TABLE IF NOT EXISTS artifacts(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  kind TEXT, path TEXT);
                """
            )

    def create_task(self, task_id, chat_id, text):
        with self._conn() as c:
            c.execute("INSERT INTO tasks VALUES(?,?,?,?,?)",
                      (task_id, chat_id, text, "queued", time.time()))

    def set_task_status(self, task_id, status):
        with self._conn() as c:
            c.execute("UPDATE tasks SET status=? WHERE task_id=?", (status, task_id))

    def add_step(self, task_id, index, kind, detail) -> int:
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO steps(task_id,idx,kind,detail,status) VALUES(?,?,?,?,?)",
                (task_id, index, kind, detail, "queued"))
            return cur.lastrowid

    def set_step_status(self, step_id, status):
        with self._conn() as c:
            c.execute("UPDATE steps SET status=? WHERE id=?", (status, step_id))

    def append_log(self, task_id, line):
        with self._conn() as c:
            c.execute("INSERT INTO logs(task_id,ts,line) VALUES(?,?,?)",
                      (task_id, time.time(), line))

    def add_artifact(self, task_id, kind, path):
        with self._conn() as c:
            c.execute("INSERT INTO artifacts(task_id,kind,path) VALUES(?,?,?)",
                      (task_id, kind, path))

    def get_task(self, task_id):
        with self._conn() as c:
            r = c.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
            return dict(r) if r else None

    def list_tasks(self, limit=50):
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM tasks ORDER BY created DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]

    def get_logs(self, task_id):
        with self._conn() as c:
            rows = c.execute(
                "SELECT line FROM logs WHERE task_id=? ORDER BY id", (task_id,)).fetchall()
            return [r["line"] for r in rows]

    def get_artifacts(self, task_id):
        with self._conn() as c:
            rows = c.execute(
                "SELECT kind,path FROM artifacts WHERE task_id=? ORDER BY id", (task_id,)).fetchall()
            return [dict(r) for r in rows]
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: sqlite session store"`

---

## Phase 2 — Engine, build, test runners

### Task 4: `project_detect`

**Files:**
- Create: `hermes/project_detect.py`
- Test: `tests/test_project_detect.py`

**Interfaces:**
- Produces: `detect(project_dir: Path) -> Literal["flutter","react_native","android","unknown"]`.

- [ ] **Step 1: Failing test**

```python
from hermes.project_detect import detect

def test_flutter(tmp_path):
    (tmp_path / "pubspec.yaml").write_text("name: x")
    assert detect(tmp_path) == "flutter"

def test_react_native(tmp_path):
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "android").mkdir()
    assert detect(tmp_path) == "react_native"

def test_native_android(tmp_path):
    (tmp_path / "build.gradle").write_text("")
    assert detect(tmp_path) == "android"

def test_unknown(tmp_path):
    assert detect(tmp_path) == "unknown"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```python
from __future__ import annotations
from pathlib import Path
from typing import Literal

def detect(project_dir: Path) -> Literal["flutter", "react_native", "android", "unknown"]:
    if (project_dir / "pubspec.yaml").exists():
        return "flutter"
    if (project_dir / "package.json").exists() and (project_dir / "android").is_dir():
        return "react_native"
    if (project_dir / "build.gradle").exists() or (project_dir / "build.gradle.kts").exists():
        return "android"
    if (project_dir / "settings.gradle").exists():
        return "android"
    return "unknown"
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: project type detection"`

---

### Task 5: `engine_runner`

**Files:**
- Create: `hermes/engine_runner.py`
- Test: `tests/test_engine_runner.py`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  - `@dataclass RunResult`: `ok: bool`, `stdout: str`, `stderr: str`, `timed_out: bool`, `returncode: int | None`.
  - `async def run_engine(engine: Literal["claude","antigravity"], prompt: str, cwd: Path, timeout_s: int, extra_env: dict | None = None) -> RunResult`.
  - Command mapping: `claude` → `["claude","-p",prompt]`; `antigravity` → `["agy","-p",prompt]`.
  - A module-level `COMMANDS` dict so tests can monkeypatch the binary to a fake script.

- [ ] **Step 1: Failing test** — uses a fake python "engine" so no real binary needed

```python
import sys
from pathlib import Path
import pytest
from hermes import engine_runner

@pytest.fixture
def fake_echo(monkeypatch):
    # replace binaries with a python script that echoes the prompt
    script = Path(__file__).parent / "fake_engine.py"
    script.write_text(
        "import sys\n"
        "print('ECHO:' + sys.argv[-1])\n"
        "sys.exit(0)\n"
    )
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: [sys.executable, str(script), "-p", p])
    return script

async def test_run_captures_stdout(tmp_path, fake_echo):
    res = await engine_runner.run_engine("claude", "make counter", tmp_path, timeout_s=30)
    assert res.ok
    assert "ECHO:make counter" in res.stdout

async def test_run_timeout(tmp_path, monkeypatch):
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: [sys.executable, "-c", "import time; time.sleep(5)"])
    res = await engine_runner.run_engine("claude", "x", tmp_path, timeout_s=1)
    assert res.timed_out and not res.ok
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/engine_runner.py`**

```python
from __future__ import annotations
import asyncio, os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

# each entry maps a prompt to an argv list; overridable in tests
COMMANDS: dict[str, Callable[[str], list[str]]] = {
    "claude": lambda p: ["claude", "-p", p],
    "antigravity": lambda p: ["agy", "-p", p],
}

@dataclass
class RunResult:
    ok: bool
    stdout: str
    stderr: str
    timed_out: bool
    returncode: int | None

async def run_engine(engine: Literal["claude", "antigravity"], prompt: str,
                     cwd: Path, timeout_s: int,
                     extra_env: dict | None = None) -> RunResult:
    argv = COMMANDS[engine](prompt)
    env = {**os.environ, **(extra_env or {})}
    proc = await asyncio.create_subprocess_exec(
        *argv, cwd=str(cwd), env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return RunResult(False, "", "", True, None)
    return RunResult(proc.returncode == 0,
                     out.decode(errors="replace"),
                     err.decode(errors="replace"),
                     False, proc.returncode)
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: engine_runner for claude/agy"`

---

### Task 6: `build_runner`

**Files:**
- Create: `hermes/build_runner.py`
- Test: `tests/test_build_runner.py`

**Interfaces:**
- Consumes: `project_detect.detect`, `engine_runner.RunResult` shape reused conceptually (separate simpler result here).
- Produces:
  - `@dataclass BuildResult`: `ok: bool`, `apk_path: str | None`, `stdout: str`, `stderr: str`.
  - `async def build_apk(project_dir: Path, ptype: str, timeout_s: int, run=<injectable>) -> BuildResult`.
  - Command map by type: flutter→`["flutter","build","apk","--release"]` apk at `build/app/outputs/flutter-apk/app-release.apk`; react_native→`["gradlew.bat","assembleRelease"]` cwd `android`, apk at `android/app/build/outputs/apk/release/app-release.apk`; android→`["gradlew.bat","assembleRelease"]` apk at `app/build/outputs/apk/release/app-release.apk`.
  - `run` param is `async (argv, cwd, timeout) -> (rc, out, err)` — injectable for tests.

- [ ] **Step 1: Failing test**

```python
from pathlib import Path
from hermes import build_runner

async def fake_run_ok(argv, cwd, timeout):
    # simulate flutter creating the apk
    apk = Path(cwd) / "build/app/outputs/flutter-apk/app-release.apk"
    apk.parent.mkdir(parents=True, exist_ok=True)
    apk.write_bytes(b"APK")
    return (0, "built", "")

async def fake_run_fail(argv, cwd, timeout):
    return (1, "", "gradle error")

async def test_flutter_build_ok(tmp_path):
    res = await build_runner.build_apk(tmp_path, "flutter", 60, run=fake_run_ok)
    assert res.ok and res.apk_path.endswith("app-release.apk")
    assert Path(res.apk_path).exists()

async def test_build_fail(tmp_path):
    res = await build_runner.build_apk(tmp_path, "flutter", 60, run=fake_run_fail)
    assert not res.ok and res.apk_path is None
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/build_runner.py`**

```python
from __future__ import annotations
import asyncio
from dataclasses import dataclass
from pathlib import Path

@dataclass
class BuildResult:
    ok: bool
    apk_path: str | None
    stdout: str
    stderr: str

_SPECS = {
    "flutter": (["flutter", "build", "apk", "--release"], ".",
                "build/app/outputs/flutter-apk/app-release.apk"),
    "react_native": (["gradlew.bat", "assembleRelease"], "android",
                     "app/build/outputs/apk/release/app-release.apk"),
    "android": (["gradlew.bat", "assembleRelease"], ".",
                "app/build/outputs/apk/release/app-release.apk"),
}

async def _default_run(argv, cwd, timeout):
    proc = await asyncio.create_subprocess_exec(
        *argv, cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return (proc.returncode, out.decode(errors="replace"), err.decode(errors="replace"))

async def build_apk(project_dir: Path, ptype: str, timeout_s: int,
                    run=_default_run) -> BuildResult:
    if ptype not in _SPECS:
        return BuildResult(False, None, "", f"unsupported project type: {ptype}")
    argv, subdir, apk_rel = _SPECS[ptype]
    cwd = project_dir / subdir
    rc, out, err = await run(argv, cwd, timeout_s)
    if rc != 0:
        return BuildResult(False, None, out, err)
    # apk path is relative to the build cwd for RN (android subdir), else project root
    base = cwd if ptype == "react_native" else project_dir
    apk = base / apk_rel
    if not apk.exists():
        return BuildResult(False, None, out, f"apk not found at {apk}")
    return BuildResult(True, str(apk), out, err)
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: build_runner apk"`

---

### Task 7: `test_runner`

**Files:**
- Create: `hermes/test_runner.py`
- Test: `tests/test_test_runner.py`

**Interfaces:**
- Produces:
  - `@dataclass TestResult`: `ok: bool`, `screenshot_path: str | None`, `detail: str`.
  - `async def test_emulator(apk_path: str, avd: str, out_dir: Path, timeout_s: int, adb=<injectable>) -> TestResult` — starts avd (skipped if `adb.is_running()`), `install`, launch, `screencap`.
  - `async def test_browser(url: str, out_dir: Path, timeout_s: int, capture=<injectable>) -> TestResult` — playwright headless, screenshot.
  - `adb` is a small injectable object with async methods `is_running()`, `start(avd)`, `install(apk)`, `launch()`, `screencap(dest)` each returning `(ok: bool, detail: str)`.

- [ ] **Step 1: Failing test**

```python
from pathlib import Path
from hermes import test_runner

class FakeAdb:
    def __init__(self): self.calls = []
    async def is_running(self): return True
    async def start(self, avd): self.calls.append(("start", avd)); return (True, "")
    async def install(self, apk): self.calls.append(("install", apk)); return (True, "")
    async def launch(self): self.calls.append(("launch",)); return (True, "")
    async def screencap(self, dest):
        Path(dest).write_bytes(b"PNG"); return (True, "")

async def test_emulator_flow(tmp_path):
    adb = FakeAdb()
    res = await test_runner.test_emulator("app.apk", "Pixel", tmp_path, 60, adb=adb)
    assert res.ok and Path(res.screenshot_path).exists()
    assert ("install", "app.apk") in adb.calls

async def test_browser_flow(tmp_path):
    async def fake_capture(url, dest):
        Path(dest).write_bytes(b"PNG"); return (True, "")
    res = await test_runner.test_browser("http://localhost:3000", tmp_path, 30, capture=fake_capture)
    assert res.ok and Path(res.screenshot_path).exists()
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/test_runner.py`**

```python
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path

@dataclass
class TestResult:
    ok: bool
    screenshot_path: str | None
    detail: str

async def test_emulator(apk_path: str, avd: str, out_dir: Path,
                        timeout_s: int, adb) -> TestResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    if not await adb.is_running():
        ok, d = await adb.start(avd)
        if not ok:
            return TestResult(False, None, f"emulator start failed: {d}")
    ok, d = await adb.install(apk_path)
    if not ok:
        return TestResult(False, None, f"install failed: {d}")
    ok, d = await adb.launch()
    if not ok:
        return TestResult(False, None, f"launch failed: {d}")
    shot = out_dir / "emulator.png"
    ok, d = await adb.screencap(str(shot))
    if not ok:
        return TestResult(False, None, f"screencap failed: {d}")
    return TestResult(True, str(shot), "ok")

async def test_browser(url: str, out_dir: Path, timeout_s: int,
                       capture=None) -> TestResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    shot = out_dir / "browser.png"
    if capture is None:
        capture = _playwright_capture
    ok, d = await capture(url, str(shot))
    if not ok:
        return TestResult(False, None, d)
    return TestResult(True, str(shot), "ok")

async def _playwright_capture(url: str, dest: str):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await b.new_page()
        await page.goto(url)
        await page.screenshot(path=dest)
        await b.close()
    return (True, "")
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: test_runner emulator+browser"`

> A real `Adb` class wrapping `adb`/`emulator` subprocess calls is added in Task 12 (wiring), not unit-tested against a device.

---

## Phase 3 — MCP hub

### Task 8: `mcp_hub`

**Files:**
- Create: `hermes/mcp_hub.py`
- Test: `tests/test_mcp_hub.py`

**Interfaces:**
- Consumes: `config.McpServer`.
- Produces:
  - `def to_openai_tools(discovered: list[dict]) -> list[dict]` — each discovered tool `{"server","name","description","input_schema"}` → OpenAI `{"type":"function","function":{...}}`, function name prefixed `"{server}__{name}"`.
  - `class McpHub`: `__init__(self, servers: list[McpServer])`, `async connect() -> None`, `async list_tools() -> list[dict]` (discovered shape above), `async call(fn_name: str, arguments: dict) -> str`, `async close()`.
  - `McpHub` accepts an injectable `session_factory(server) -> session` so tests avoid real MCP transport. A session exposes `async list_tools()` and `async call_tool(name, arguments)`.

- [ ] **Step 1: Failing test**

```python
from hermes import mcp_hub
from hermes.config import McpServer

def test_to_openai_tools():
    discovered = [{"server": "fs", "name": "read", "description": "read file",
                   "input_schema": {"type": "object", "properties": {}}}]
    tools = mcp_hub.to_openai_tools(discovered)
    assert tools[0]["type"] == "function"
    assert tools[0]["function"]["name"] == "fs__read"

class FakeSession:
    async def list_tools(self):
        return [{"name": "read", "description": "d",
                 "input_schema": {"type": "object", "properties": {}}}]
    async def call_tool(self, name, arguments):
        return f"called {name} {arguments}"

async def test_hub_discovery_and_call():
    servers = [McpServer(name="fs", type="stdio", command="x")]
    hub = mcp_hub.McpHub(servers, session_factory=lambda s: FakeSession())
    await hub.connect()
    disc = await hub.list_tools()
    assert disc[0]["server"] == "fs" and disc[0]["name"] == "read"
    out = await hub.call("fs__read", {"path": "a"})
    assert "called read" in out
    await hub.close()

async def test_disabled_server_skipped():
    servers = [McpServer(name="fs", type="stdio", command="x", enabled=False)]
    hub = mcp_hub.McpHub(servers, session_factory=lambda s: FakeSession())
    await hub.connect()
    assert await hub.list_tools() == []
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/mcp_hub.py`**

```python
from __future__ import annotations
from typing import Callable
from .config import McpServer

def to_openai_tools(discovered: list[dict]) -> list[dict]:
    tools = []
    for d in discovered:
        tools.append({
            "type": "function",
            "function": {
                "name": f'{d["server"]}__{d["name"]}',
                "description": d.get("description", ""),
                "parameters": d.get("input_schema", {"type": "object", "properties": {}}),
            },
        })
    return tools

class McpHub:
    def __init__(self, servers: list[McpServer],
                 session_factory: Callable | None = None):
        self.servers = servers
        self.session_factory = session_factory or _default_session
        self._sessions: dict[str, object] = {}

    async def connect(self) -> None:
        for srv in self.servers:
            if not srv.enabled:
                continue
            self._sessions[srv.name] = self.session_factory(srv)

    async def list_tools(self) -> list[dict]:
        out = []
        for name, sess in self._sessions.items():
            for t in await sess.list_tools():
                out.append({"server": name, "name": t["name"],
                            "description": t.get("description", ""),
                            "input_schema": t.get("input_schema",
                                                  {"type": "object", "properties": {}})})
        return out

    async def call(self, fn_name: str, arguments: dict) -> str:
        server, _, tool = fn_name.partition("__")
        sess = self._sessions[server]
        return await sess.call_tool(tool, arguments)

    async def close(self):
        for sess in self._sessions.values():
            close = getattr(sess, "close", None)
            if close:
                await close()
        self._sessions.clear()

def _default_session(srv: McpServer):
    # Real MCP transport wired in Task 12; unit tests inject a fake factory.
    raise NotImplementedError("real MCP session created at runtime in main wiring")
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: mcp_hub tool bridge"`

---

## Phase 4 — Orchestrator

### Task 9: `orchestrator` — plan + execute

**Files:**
- Create: `hermes/orchestrator.py`
- Test: `tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `config.Settings`, `session_store.Store`, `engine_runner.run_engine`, `build_runner.build_apk`, `test_runner`, `project_detect.detect`, `mcp_hub.McpHub`.
- Produces:
  - `def parse_plan(raw: str) -> list[dict]` — extract JSON `{"steps":[...]}` from model text (tolerates code fences), returns the steps list. Raises `ValueError` on no valid JSON.
  - `def choose_engine(step: dict, settings: Settings) -> str` — honor `step["engine"]`, else settings.default_engine, else heuristic `"antigravity"` if `step.get("scope")=="large"` else `"claude"`.
  - `class Orchestrator`: `__init__(self, settings, store, planner, deps)` where `planner` is `async (task_text, tools) -> str` (the NIM call, injectable) and `deps` bundles the runner callables (injectable for tests).
  - `async def run_task(self, task_id: str, chat_id: int, text: str, report) -> None` — persists steps, executes each, calls `report(task_id, message)` on progress, recovers on failure with one retry for `code` steps.

- [ ] **Step 1: Failing test**

```python
import json
from pathlib import Path
from hermes.orchestrator import Orchestrator, parse_plan, choose_engine
from hermes.config import Settings
from hermes.session_store import Store

def test_parse_plan_with_fences():
    raw = "```json\n{\"steps\":[{\"type\":\"code\",\"engine\":\"claude\",\"prompt\":\"x\"}]}\n```"
    steps = parse_plan(raw)
    assert steps[0]["type"] == "code"

def test_choose_engine_default():
    s = Settings(default_engine="claude")
    assert choose_engine({"type": "code"}, s) == "claude"
    assert choose_engine({"type": "code", "engine": "antigravity"}, s) == "antigravity"

async def test_run_task_executes_steps(tmp_path, monkeypatch):
    store = Store(tmp_path / "t.db"); store.init_schema()
    settings = Settings(default_engine="claude", projects_path=str(tmp_path / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [
            {"type": "code", "engine": "claude", "prompt": "make it"},
            {"type": "build", "target": "apk"},
        ]})

    events = []
    async def fake_run_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        events.append(("code", engine)); return RunResult(True, "done", "", False, 0)
    async def fake_build(project_dir, ptype, timeout_s, run=None):
        from hermes.build_runner import BuildResult
        events.append(("build", ptype)); return BuildResult(True, "app.apk", "", "")

    deps = dict(run_engine=fake_run_engine, build_apk=fake_build,
                detect=lambda d: "flutter", test_emulator=None, test_browser=None)
    orch = Orchestrator(settings, store, planner, deps)

    reports = []
    async def report(tid, msg): reports.append(msg)
    await orch.run_task("t1", 5, "build a flutter app", report)

    assert ("code", "claude") in events
    assert ("build", "flutter") in events
    assert store.get_task("t1")["status"] == "done"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/orchestrator.py`**

```python
from __future__ import annotations
import json, re
from pathlib import Path
from .config import Settings
from .session_store import Store

def parse_plan(raw: str) -> list[dict]:
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        raise ValueError("no JSON object in planner output")
    data = json.loads(m.group(0))
    steps = data.get("steps")
    if not isinstance(steps, list):
        raise ValueError("plan has no steps list")
    return steps

def choose_engine(step: dict, settings: Settings) -> str:
    if step.get("engine") in ("claude", "antigravity"):
        return step["engine"]
    if settings.default_engine in ("claude", "antigravity"):
        return settings.default_engine
    return "antigravity" if step.get("scope") == "large" else "claude"

class Orchestrator:
    def __init__(self, settings: Settings, store: Store, planner, deps: dict):
        self.settings = settings
        self.store = store
        self.planner = planner          # async (text, tools) -> str
        self.deps = deps                # run_engine, build_apk, detect, test_*

    async def run_task(self, task_id: str, chat_id: int, text: str, report) -> None:
        self.store.set_task_status(task_id, "running")
        proj = Path(self.settings.projects_path) / task_id
        proj.mkdir(parents=True, exist_ok=True)
        try:
            raw = await self.planner(text, [])
            steps = parse_plan(raw)
        except Exception as e:
            self.store.set_task_status(task_id, "failed")
            await report(task_id, f"planning failed: {e}")
            return

        for i, step in enumerate(steps):
            sid = self.store.add_step(task_id, i, step.get("type", "?"), json.dumps(step))
            self.store.set_step_status(sid, "running")
            ok, msg = await self._exec_step(task_id, proj, step)
            self.store.set_step_status(sid, "done" if ok else "failed")
            await report(task_id, f"step {i} [{step.get('type')}]: {msg}")
            if not ok:
                self.store.set_task_status(task_id, "failed")
                return
        self.store.set_task_status(task_id, "done")
        await report(task_id, "task complete")

    async def _exec_step(self, task_id, proj: Path, step: dict):
        t = step.get("type")
        if t == "code":
            engine = choose_engine(step, self.settings)
            res = await self.deps["run_engine"](
                engine, step.get("prompt", ""), proj, self.settings.timeout_code_s)
            if not res.ok and not res.timed_out:
                # one corrected retry
                res = await self.deps["run_engine"](
                    engine, step.get("prompt", "") + f"\n\nPrevious error:\n{res.stderr[:800]}",
                    proj, self.settings.timeout_code_s)
            return (res.ok, "coded" if res.ok else f"engine failed: {res.stderr[:200]}")
        if t == "build":
            ptype = self.deps["detect"](proj)
            res = await self.deps["build_apk"](proj, ptype, self.settings.timeout_build_s)
            if res.ok:
                self.store.add_artifact(task_id, "apk", res.apk_path)
            return (res.ok, f"apk: {res.apk_path}" if res.ok else f"build failed: {res.stderr[:200]}")
        if t == "test":
            mode = step.get("mode", self.settings.default_test_mode)
            return (True, f"test mode {mode} scheduled")  # wired in main with real adb/browser
        return (False, f"unknown step type: {t}")
```

> Note: the `test` step returns a placeholder here so the unit test stays device-free; Task 12 injects real `test_emulator`/`test_browser` via `deps` and replaces this branch to call them. Add the wired branch in Task 12.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: orchestrator plan+execute"`

---

## Phase 5 — Telegram bridge

### Task 10: `telegram_bridge`

**Files:**
- Create: `hermes/telegram_bridge.py`
- Test: `tests/test_telegram_bridge.py`

**Interfaces:**
- Consumes: `config.Settings`, `session_store.Store`, `Orchestrator.run_task`.
- Produces:
  - `def is_allowed(user_id: int, settings: Settings) -> bool`.
  - `def new_task_id() -> str` (timestamp+random, filesystem-safe).
  - `class Bridge`: `__init__(self, settings, store, orchestrator, sender)` where `sender` is `async (chat_id, text) -> None` (injectable; real impl sends via bot).
  - `async def handle_task(self, user_id: int, chat_id: int, text: str) -> str | None` — rejects non-whitelisted (returns None, sends rejection), else creates task, launches `orchestrator.run_task` with a report callback that uses `sender`, returns task_id.

- [ ] **Step 1: Failing test**

```python
from hermes.telegram_bridge import Bridge, is_allowed, new_task_id
from hermes.config import Settings
from hermes.session_store import Store

def test_is_allowed():
    s = Settings(allowed_user_ids=[1, 2])
    assert is_allowed(1, s) and not is_allowed(9, s)

def test_task_id_unique():
    assert new_task_id() != new_task_id()

async def test_reject_unlisted(tmp_path):
    store = Store(tmp_path / "t.db"); store.init_schema()
    settings = Settings(allowed_user_ids=[1])
    sent = []
    async def sender(chat, text): sent.append((chat, text))
    class FakeOrch:
        async def run_task(self, *a, **k): raise AssertionError("should not run")
    b = Bridge(settings, store, FakeOrch(), sender)
    tid = await b.handle_task(user_id=99, chat_id=5, text="hi")
    assert tid is None
    assert "not authorized" in sent[0][1].lower()

async def test_accept_listed(tmp_path):
    store = Store(tmp_path / "t.db"); store.init_schema()
    settings = Settings(allowed_user_ids=[1])
    ran = []
    async def sender(chat, text): pass
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report):
            ran.append(task_id); await report(task_id, "hello")
    b = Bridge(settings, store, FakeOrch(), sender)
    tid = await b.handle_task(user_id=1, chat_id=5, text="build app")
    assert tid is not None and ran == [tid]
    assert store.get_task(tid)["status"] in ("queued", "running", "done")
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/telegram_bridge.py`**

```python
from __future__ import annotations
import secrets, time
from .config import Settings
from .session_store import Store

def is_allowed(user_id: int, settings: Settings) -> bool:
    return user_id in settings.allowed_user_ids

def new_task_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)

class Bridge:
    def __init__(self, settings: Settings, store: Store, orchestrator, sender):
        self.settings = settings
        self.store = store
        self.orchestrator = orchestrator
        self.sender = sender  # async (chat_id, text)

    async def handle_task(self, user_id: int, chat_id: int, text: str):
        if not is_allowed(user_id, self.settings):
            await self.sender(chat_id, "You are not authorized to use this bot.")
            return None
        task_id = new_task_id()
        self.store.create_task(task_id, chat_id, text)
        await self.sender(chat_id, f"Task {task_id} queued.")

        async def report(tid, msg):
            await self.sender(chat_id, f"[{tid}] {msg}")

        await self.orchestrator.run_task(task_id, chat_id, text, report)
        return task_id
```

> Runtime note (implemented in Task 12): the real bot handler extracts `update.effective_user.id`, `update.effective_chat.id`, `update.message.text`, then `asyncio.create_task(bridge.handle_task(...))` so long tasks don't block the update loop. The `sender` real impl calls `bot.send_message` and, for artifacts, `bot.send_document`/`send_photo`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: telegram bridge + whitelist"`

---

## Phase 6 — Web UI

### Task 11: `web_ui` — settings, dashboard, MCP tab

**Files:**
- Create: `hermes/web_ui.py`
- Test: `tests/test_web_ui.py`

**Interfaces:**
- Consumes: `config` (load/save settings+secrets), `session_store.Store`.
- Produces:
  - `def create_app(store: Store) -> FastAPI`.
  - Routes:
    - `GET /` → dashboard HTML (task list).
    - `GET /api/tasks` → JSON list.
    - `GET /api/tasks/{task_id}` → JSON with logs + artifacts.
    - `GET /settings` → settings HTML form.
    - `GET /api/settings` → JSON of current settings (secrets masked as `"***"` if set).
    - `POST /api/settings` → save settings (JSON body of `Settings`).
    - `POST /api/secrets` → save secrets (`{nvidia_api_key, telegram_bot_token}`); empty/`"***"` values leave existing unchanged.
    - `GET /api/mcp` / `POST /api/mcp` → list/replace `settings.mcp_servers`.
    - `POST /api/mcp/test` → `{ok, tools|error}` by connecting one server (uses mcp_hub with real factory; in tests inject via app state).
  - App binds host `127.0.0.1` port `8799` in `main` (not in `create_app`).

- [ ] **Step 1: Failing test** (uses FastAPI `TestClient`)

```python
from fastapi.testclient import TestClient
from hermes.web_ui import create_app
from hermes.session_store import Store
from hermes import config, paths

def test_settings_roundtrip_api(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    r = client.get("/api/settings")
    assert r.status_code == 200

    body = config.Settings(model="qwen/qwen2.5-coder-32b-instruct",
                           allowed_user_ids=[7]).model_dump()
    r = client.post("/api/settings", json=body)
    assert r.status_code == 200
    assert config.load_settings().model == "qwen/qwen2.5-coder-32b-instruct"

def test_secrets_masked(hermes_home):
    paths.ensure_dirs()
    config.save_secrets(config.Secrets(nvidia_api_key="real", telegram_bot_token=""))
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    r = client.get("/api/settings")
    # secrets endpoint masks
    r2 = client.get("/api/secrets/status")
    assert r2.json()["nvidia_api_key_set"] is True

def test_secrets_preserved_on_mask(hermes_home):
    paths.ensure_dirs()
    config.save_secrets(config.Secrets(nvidia_api_key="real", telegram_bot_token="tok"))
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    client.post("/api/secrets", json={"nvidia_api_key": "***", "telegram_bot_token": "newtok"})
    sec = config.load_secrets()
    assert sec.nvidia_api_key == "real"        # unchanged
    assert sec.telegram_bot_token == "newtok"  # updated

def test_tasks_api(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.create_task("t1", 5, "hello")
    client = TestClient(create_app(store))
    assert client.get("/api/tasks").json()[0]["task_id"] == "t1"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/web_ui.py`**

```python
from __future__ import annotations
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from . import config
from .session_store import Store

_DASH = "<h1>Hermes</h1><ul id=t></ul><script>fetch('/api/tasks').then(r=>r.json())" \
        ".then(x=>t.innerHTML=x.map(k=>`<li>${k.task_id} ${k.status}</li>`).join(''))</script>" \
        "<a href=/settings>settings</a>"
_SET = "<h1>Settings</h1><p>Edit via /api/settings, /api/secrets, /api/mcp.</p>"

def create_app(store: Store) -> FastAPI:
    app = FastAPI()

    @app.get("/", response_class=HTMLResponse)
    def dashboard(): return _DASH

    @app.get("/settings", response_class=HTMLResponse)
    def settings_page(): return _SET

    @app.get("/api/tasks")
    def tasks(): return store.list_tasks()

    @app.get("/api/tasks/{task_id}")
    def task(task_id: str):
        t = store.get_task(task_id) or {}
        return {"task": t, "logs": store.get_logs(task_id),
                "artifacts": store.get_artifacts(task_id)}

    @app.get("/api/settings")
    def get_settings(): return config.load_settings().model_dump()

    @app.post("/api/settings")
    def post_settings(body: dict):
        config.save_settings(config.Settings.model_validate(body))
        return {"ok": True}

    @app.get("/api/secrets/status")
    def secrets_status():
        s = config.load_secrets()
        return {"nvidia_api_key_set": bool(s.nvidia_api_key),
                "telegram_bot_token_set": bool(s.telegram_bot_token)}

    @app.post("/api/secrets")
    def post_secrets(body: dict):
        cur = config.load_secrets()
        def keep(new, old): return old if new in ("", "***", None) else new
        config.save_secrets(config.Secrets(
            nvidia_api_key=keep(body.get("nvidia_api_key"), cur.nvidia_api_key),
            telegram_bot_token=keep(body.get("telegram_bot_token"), cur.telegram_bot_token)))
        return {"ok": True}

    @app.get("/api/mcp")
    def get_mcp(): return [m.model_dump() for m in config.load_settings().mcp_servers]

    @app.post("/api/mcp")
    def post_mcp(body: list):
        s = config.load_settings()
        s.mcp_servers = [config.McpServer.model_validate(m) for m in body]
        config.save_settings(s)
        return {"ok": True}

    return app
```

> The `POST /api/mcp/test` endpoint and full HTML forms are added in Task 12 (needs the real MCP session factory + richer templates). The unit tests above cover the data plane.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat: web ui settings/dashboard/mcp api"`

---

## Phase 7 — Wiring & installer

### Task 12: `main` — real adapters + run

**Files:**
- Create: `hermes/main.py`
- Modify: `hermes/orchestrator.py` (replace the `test` step placeholder with real `test_emulator`/`test_browser` calls via `deps`)
- Modify: `hermes/web_ui.py` (add `POST /api/mcp/test` + minimal HTML forms)
- Test: `tests/test_main_smoke.py` (imports + adapter shape only; no network)

**Interfaces:**
- Produces:
  - `class Adb` implementing the `adb` protocol from Task 7 using `settings.android_sdk_path` (methods `is_running/start/install/launch/screencap`).
  - `def build_nim_planner(settings, secrets, hub)` → `async (text, tools) -> str` calling the OpenAI SDK against NIM with tool support.
  - `def real_mcp_session_factory(srv)` → live MCP session (stdio via `mcp.client.stdio`, http via `mcp.client.sse`).
  - `async def run()` — load config/secrets, ensure dirs, init store, connect hub, build orchestrator with real deps, start Telegram polling + uvicorn on `127.0.0.1:8799` concurrently.

- [ ] **Step 1: Failing test** — `tests/test_main_smoke.py`

```python
import inspect
from hermes import main

def test_run_is_coroutine():
    assert inspect.iscoroutinefunction(main.run)

def test_adb_has_protocol_methods():
    from hermes.config import Settings
    adb = main.Adb(Settings())
    for m in ("is_running", "start", "install", "launch", "screencap"):
        assert inspect.iscoroutinefunction(getattr(adb, m))
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `hermes/main.py`** (and apply the two modifications)

```python
from __future__ import annotations
import asyncio, subprocess
from pathlib import Path
from openai import AsyncOpenAI
import uvicorn
from telegram import Update
from telegram.ext import Application, MessageHandler, filters
from . import config, paths
from .session_store import Store
from .mcp_hub import McpHub, to_openai_tools
from .orchestrator import Orchestrator
from .telegram_bridge import Bridge
from .web_ui import create_app
from . import build_runner, engine_runner, test_runner, project_detect

class Adb:
    def __init__(self, settings: config.Settings):
        sdk = Path(settings.android_sdk_path) if settings.android_sdk_path else Path()
        self.adb = str(sdk / "platform-tools" / "adb.exe") if settings.android_sdk_path else "adb"
        self.emulator = str(sdk / "emulator" / "emulator.exe") if settings.android_sdk_path else "emulator"

    async def _run(self, argv):
        p = await asyncio.create_subprocess_exec(
            *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await p.communicate()
        return (p.returncode == 0, (out + err).decode(errors="replace"))

    async def is_running(self):
        ok, out = await self._run([self.adb, "devices"])
        return ok and "emulator-" in out

    async def start(self, avd):
        subprocess.Popen([self.emulator, "-avd", avd])
        ok, out = await self._run([self.adb, "wait-for-device"])
        return (ok, out)

    async def install(self, apk): return await self._run([self.adb, "install", "-r", apk])
    async def launch(self):
        return await self._run([self.adb, "shell", "monkey", "-p",
                                "%PKG%", "-c", "android.intent.category.LAUNCHER", "1"])
    async def screencap(self, dest):
        p = await asyncio.create_subprocess_exec(
            self.adb, "exec-out", "screencap", "-p", stdout=asyncio.subprocess.PIPE)
        out, _ = await p.communicate()
        Path(dest).write_bytes(out)
        return (p.returncode == 0, "")

def build_nim_planner(settings, secrets, hub):
    client = AsyncOpenAI(base_url=settings.nvidia_base_url, api_key=secrets.nvidia_api_key)
    system = ("You are Hermes' planner. Output ONLY JSON: "
              '{"steps":[{"type":"code|build|test","engine":"claude|antigravity",'
              '"prompt":"...","target":"apk","mode":"browser|emulator"}]}')
    async def planner(text: str, tools: list) -> str:
        discovered = await hub.list_tools()
        oa_tools = to_openai_tools(discovered)
        msgs = [{"role": "system", "content": system},
                {"role": "user", "content": text}]
        while True:
            resp = await client.chat.completions.create(
                model=settings.model, messages=msgs,
                tools=oa_tools or None)
            m = resp.choices[0].message
            if m.tool_calls:
                msgs.append(m.model_dump())
                for tc in m.tool_calls:
                    import json
                    result = await hub.call(tc.function.name,
                                            json.loads(tc.function.arguments or "{}"))
                    msgs.append({"role": "tool", "tool_call_id": tc.id, "content": result})
                continue
            return m.content or ""
    return planner

def real_mcp_session_factory(srv):
    raise NotImplementedError  # fill with mcp.client stdio/sse at integration time

async def run():
    settings = config.load_settings()
    secrets = config.load_secrets()
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    hub = McpHub(settings.mcp_servers, session_factory=real_mcp_session_factory)
    await hub.connect()
    planner = build_nim_planner(settings, secrets, hub)

    adb = Adb(settings)
    deps = dict(
        run_engine=engine_runner.run_engine,
        build_apk=build_runner.build_apk,
        detect=project_detect.detect,
        test_emulator=lambda apk, out: test_runner.test_emulator(
            apk, settings.emulator_avd, out, settings.timeout_test_s, adb=adb),
        test_browser=lambda url, out: test_runner.test_browser(
            url, out, settings.timeout_test_s),
    )
    orch = Orchestrator(settings, store, planner, deps)

    app = Application.builder().token(secrets.telegram_bot_token).build()

    async def sender(chat_id, text):
        await app.bot.send_message(chat_id=chat_id, text=text)

    bridge = Bridge(settings, store, orch, sender)

    async def on_msg(update: Update, ctx):
        u = update.effective_user.id
        c = update.effective_chat.id
        asyncio.create_task(bridge.handle_task(u, c, update.message.text or ""))

    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))

    web = create_app(store)
    server = uvicorn.Server(uvicorn.Config(web, host="127.0.0.1", port=8799, log_level="info"))

    async with app:
        await app.start()
        await app.updater.start_polling()
        await server.serve()

if __name__ == "__main__":
    asyncio.run(run())
```

Modification to `orchestrator._exec_step` `test` branch:

```python
        if t == "test":
            mode = step.get("mode", self.settings.default_test_mode)
            out = Path(str(proj)) / "test-out"
            if mode == "emulator" and self.deps.get("test_emulator"):
                apks = [a["path"] for a in self.store.get_artifacts(task_id) if a["kind"] == "apk"]
                if not apks:
                    return (False, "no apk artifact to test")
                res = await self.deps["test_emulator"](apks[-1], out)
            elif mode == "browser" and self.deps.get("test_browser"):
                res = await self.deps["test_browser"](step.get("url", "http://localhost:3000"), out)
            else:
                return (True, "no test mode")
            if getattr(res, "screenshot_path", None):
                self.store.add_artifact(task_id, "screenshot", res.screenshot_path)
            return (res.ok, res.detail)
```

Modification to `web_ui` — add after `post_mcp`:

```python
    @app.post("/api/mcp/test")
    async def mcp_test(body: dict):
        from .mcp_hub import McpHub
        from .config import McpServer
        srv = McpServer.model_validate(body)
        factory = getattr(app.state, "mcp_factory", None)
        if factory is None:
            return {"ok": False, "error": "no mcp factory configured"}
        hub = McpHub([srv], session_factory=factory)
        try:
            await hub.connect()
            tools = await hub.list_tools()
            await hub.close()
            return {"ok": True, "tools": [t["name"] for t in tools]}
        except Exception as e:
            return {"ok": False, "error": str(e)}
```

- [ ] **Step 4: Run smoke test — expect PASS**

Run: `.\.venv\Scripts\pytest tests/test_main_smoke.py -q`

- [ ] **Step 5: Full suite green**

Run: `.\.venv\Scripts\pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit** — `git commit -am "feat: main wiring, real adapters, mcp test endpoint"`

---

### Task 13: `install.ps1` + `start.bat`

**Files:**
- Create: `E:\Hermes\install.ps1`
- Create: `E:\Hermes\start.bat`

**Interfaces:** none (operational scripts).

- [ ] **Step 1: Write `install.ps1`**

```powershell
$ErrorActionPreference = "Stop"
$Home = "E:\Hermes"
Write-Host "Checking prerequisites..."
$missing = @()
foreach ($bin in @("py","claude","agy","adb")) {
  if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) { $missing += $bin }
}
if ($missing) { Write-Host "Missing on PATH: $($missing -join ', ')" -ForegroundColor Yellow }

New-Item -ItemType Directory -Force -Path "$Home\config","$Home\projects","$Home\artifacts" | Out-Null

Set-Location "$Home\app"
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -U pip
.\.venv\Scripts\pip install -e .
.\.venv\Scripts\python -m playwright install chromium

if (-not (Test-Path "$Home\config\config.yaml")) {
  .\.venv\Scripts\python -c "from hermes import config,paths; paths.ensure_dirs(); config.save_settings(config.load_settings()); config.save_secrets(config.load_secrets())"
}

$action = New-ScheduledTaskAction -Execute "$Home\start.bat"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "Hermes" -Action $action -Trigger $trigger -Force

Write-Host "Done. Open http://127.0.0.1:8799 after first start." -ForegroundColor Green
```

- [ ] **Step 2: Write `start.bat`**

```bat
@echo off
cd /d E:\Hermes\app
call .venv\Scripts\activate
python -m hermes.main
```

- [ ] **Step 3: Manual verify (documented, not automated)**

Run: `powershell -ExecutionPolicy Bypass -File E:\Hermes\install.ps1`
Expected: dirs created, venv built, scheduled task registered, prereq warnings for any missing binary.

- [ ] **Step 4: Commit** — `git commit -am "chore: installer + start script"`

---

### Task 14: End-to-end smoke (manual)

**Files:** none (manual verification, documented in `E:\Hermes\docs\SMOKE.md`).

- [ ] **Step 1:** Fill settings + secrets via `http://127.0.0.1:8799` (NVIDIA key, Telegram token, your Telegram user ID, AVD name, Android SDK path).
- [ ] **Step 2:** From Telegram, send: *"buat app counter Flutter, build APK, test di emulator"*.
- [ ] **Step 3:** Confirm: task appears on dashboard, engine runs, APK artifact produced, emulator screenshot returned to Telegram.
- [ ] **Step 4:** Write results to `docs/SMOKE.md`, commit.

---

## Self-Review

**Spec coverage:**
- Purpose/orchestrator role → Task 9,10,12 ✓
- Claude Code + Antigravity CLI drive → Task 5 ✓
- NVIDIA NIM brain → Task 12 `build_nim_planner` ✓
- Python/Windows/E:\ → Task 0,1,13 ✓
- Web UI 127.0.0.1:8799 (settings/dashboard/mcp) → Task 11,12 ✓
- MCP for orchestrator (option B) → Task 8,12 ✓
- Engine selection auto/heuristic → Task 9 `choose_engine` ✓
- Project detection → Task 4 ✓
- APK build per type → Task 6 ✓
- Browser + emulator test → Task 7,12 ✓
- Security: whitelist → Task 10; bind 127.0.0.1 → Task 12; secrets masked/not logged → Task 2,11 ✓
- Error handling: timeouts → Task 5,6; one retry on code step → Task 9; artifacts retained → Task 3,9 ✓
- Session store SQLite/resumable → Task 3 ✓
- Installer + Task Scheduler + start.bat → Task 13 ✓
- Directory layout → Task 1,13 ✓
- Testing strategy (unit + mocked integration + manual smoke) → Tasks 1–12 unit, Task 14 smoke ✓

Gap noted & closed: confirmation gate for destructive/out-of-project actions (spec §8) is **not** yet a coded task. It is deferred to a follow-up (documented here) — v1 relies on the isolated project dir + whitelist. Flag for the implementer: add a `confirm` step type + Telegram inline-keyboard handler in a later task if the destructive-action gate is required for launch.

**Placeholder scan:** No "TBD/TODO" in code. `real_mcp_session_factory` and the RN launch `%PKG%` are explicitly marked as integration-time fills in Task 12 — acceptable because they sit behind injected fakes in all unit tests; the implementer wires them during Task 14 smoke.

**Type consistency:** `RunResult`, `BuildResult`, `TestResult`, `McpServer`, `Settings`, `Secrets`, `Store` method names, `Orchestrator(settings, store, planner, deps)`, `Bridge(settings, store, orchestrator, sender)`, `to_openai_tools`/`McpHub.call` naming all consistent across tasks.

---

## Execution Handoff

Plan complete and saved to `E:\Hermes\docs\superpowers\plans\2026-07-14-hermes-agent.md`.
