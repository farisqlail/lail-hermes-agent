# Engine Coding 9Router — Rencana Implementasi Fase 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan engine `api` — loop agentik in-process yang bicara ke gateway 9Router — sebagai pilihan ketiga di samping `claude` dan `antigravity`, tanpa mengubah perilaku engine lama.

**Architecture:** Dua modul baru. `hermes/agent_tools.py` menyediakan tool file/exec yang ter-scope ke direktori proyek lewat satu choke point. `hermes/engine_api.py` menjalankan loop tool-calling terhadap `AsyncOpenAI` dan **memancarkan baris stream-json berbentuk claude**, sehingga `engine_stream.py` dan `engine_result.py` dipakai apa adanya dan seluruh jalur hilir — timeline, hitung token, deteksi selesai, retry, budget — tidak disentuh. Sambungannya satu cabang di `engine_runner.run_engine`.

**Tech Stack:** Python 3.11+, `openai>=1.40` (`AsyncOpenAI`), `pytest` + `pytest-asyncio` (`asyncio_mode = "auto"`), FastAPI/pydantic untuk settings. Tanpa dependensi baru.

**Spec:** `docs/superpowers/specs/2026-09-08-9router-coding-engine-design.md`

## Global Constraints

- **Fase 1 aditif.** Tidak ada perilaku engine `claude`/`antigravity` yang boleh berubah. Gerbangnya: 985 test yang ada tetap hijau.
- **Nama tool wajib persis punya claude:** `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`. `engine_stream._EDIT_TOOLS` mencocokkan literal `{"Edit","Write","MultiEdit","NotebookEdit"}`; nama lain membuat daftar berkas-yang-diedit **kosong tanpa error**.
- **Usage wajib diterjemahkan.** 9Router menjawab `prompt_tokens`/`completion_tokens`; `engine_stream._total_input_tokens` membaca `input_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`. Meneruskan apa adanya membuat token jadi `None` tanpa error.
- **Envelope penutup berisi teks asisten terakhir**, bukan output tool. `_confirmed_done` membaca field itu; kalau tertukar, sentinel `DONE` tak pernah terbaca dan setiap step menghabiskan tiga ronde.
- **Setiap `tool_call_id` wajib dijawab** sebelum permintaan berikutnya, kalau tidak API menolak.
- **`"api"` tidak masuk `RESUMABLE`** di fase 1.
- **`"api"` tidak masuk `MCP_CONFIG_FLAG`** — itu mengendalikan argv `--mcp-config`. Hak bertanya dipindah ke set baru `ASK_CAPABLE`.
- **Menjalankan test di mesin ini:** `.venv\Scripts\python.exe` diblokir Windows Defender ("file contains a virus or potentially unwanted software"). Pakai python sistem dengan PYTHONPATH:
  ```powershell
  $env:PYTHONPATH="E:\lail-hermes-agent"; & python -m pytest tests/test_agent_tools.py -v
  ```
  Perintah `pytest ...` di bawah selalu berarti bentuk itu. Jangan tambahkan `--timeout`; plugin itu tidak terpasang.
- **Commit** memakai format repo (imperative, prefix `feat:`/`test:`/`refactor:`), diakhiri:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01YZCLhAAFet7mUCtUszBEKS
  ```

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `hermes/agent_tools.py` (baru) | Tool file/exec ter-scope. Tanpa state, tanpa pengetahuan LLM. Ekspor `TOOLS`, `call()`. |
| `hermes/engine_api.py` (baru) | Loop agentik + penerjemah bentuk stream-json. Ekspor `run()`. |
| `hermes/engine_runner.py` | Satu cabang dispatch + keanggotaan set. |
| `hermes/engine_stream.py` | Satu entri `DISTILLERS`. |
| `hermes/config.py` | `default_engine` Literal, `api_model`. |
| `hermes/orchestrator.py` | `choose_engine`, blok `tuning`, `ask_here`. |
| `hermes/project_resolve.py` | Regex sigil `!api`. |
| `web/src/...` | Opsi dropdown + tipe. |
| `tests/test_agent_tools.py` (baru) | Scoping = batas keamanan, diuji paling dalam. |
| `tests/test_engine_api.py` (baru) | Bentuk stream, loop, kegagalan. |

Dipisah begitu karena `agent_tools` tidak boleh tahu apa pun tentang LLM — itu yang membuat pengujian scoping tidak butuh klien palsu sama sekali.

---

### Task 1: Choke point path + `Read` + `Write`

Batas keamanan seluruh engine. Dikerjakan pertama karena tool lain menumpang di atasnya.

**Files:**
- Create: `hermes/agent_tools.py`
- Test: `tests/test_agent_tools.py`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `_resolve_in(cwd: Path, path: str) -> Path` (raise `ValueError` bila keluar scope); `async def _read(cwd: Path, file_path: str) -> str`; `async def _write(cwd: Path, file_path: str, content: str) -> str`. Task 2-5 memanggil `_resolve_in`.

- [ ] **Step 1: Tulis test yang gagal**

```python
"""Tool file/exec untuk engine `api`.

Scoping adalah alasan modul ini ada. `claude -p` dan MCP `pc` sama-sama
berjalan tanpa batas folder; step code tidak punya alasan bisa menyentuh
berkas di luar proyek yang sedang dikerjakan.
"""
import pytest
from pathlib import Path

from hermes import agent_tools


def test_relative_path_inside_project_resolves(tmp_path):
    (tmp_path / "src").mkdir()
    got = agent_tools._resolve_in(tmp_path, "src/main.py")
    assert got == (tmp_path / "src" / "main.py").resolve()


def test_dotdot_escape_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="escapes project directory"):
        agent_tools._resolve_in(tmp_path, "../../secrets.txt")


def test_absolute_path_outside_project_is_rejected(tmp_path):
    outside = tmp_path.parent / "elsewhere.txt"
    with pytest.raises(ValueError, match="escapes project directory"):
        agent_tools._resolve_in(tmp_path, str(outside))


def test_symlink_pointing_out_of_the_project_is_rejected(tmp_path):
    """A prefix check on the raw path would pass this: the link itself lives
    inside the project. Only resolving first catches it."""
    outside = tmp_path.parent / "outside_target"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "escape"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("creating a symlink needs privileges on this machine")
    with pytest.raises(ValueError, match="escapes project directory"):
        agent_tools._resolve_in(tmp_path, "escape/secrets.txt")


def test_absolute_path_inside_project_is_allowed(tmp_path):
    inside = tmp_path / "ok.txt"
    assert agent_tools._resolve_in(tmp_path, str(inside)) == inside.resolve()


async def test_read_returns_file_contents(tmp_path):
    (tmp_path / "a.txt").write_text("halo\ndunia\n", encoding="utf-8")
    assert await agent_tools._read(tmp_path, "a.txt") == "halo\ndunia\n"


async def test_read_missing_file_says_so(tmp_path):
    with pytest.raises(ValueError, match="no such file"):
        await agent_tools._read(tmp_path, "nope.txt")


async def test_write_creates_parent_directories(tmp_path):
    out = await agent_tools._write(tmp_path, "deep/nested/a.txt", "isi")
    assert (tmp_path / "deep" / "nested" / "a.txt").read_text(encoding="utf-8") == "isi"
    assert "deep/nested/a.txt" in out or "deep\\nested\\a.txt" in out


async def test_write_outside_project_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="escapes project directory"):
        await agent_tools._write(tmp_path, "../evil.txt", "x")
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_agent_tools.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'hermes.agent_tools'`

- [ ] **Step 3: Implementasi minimal**

```python
"""File and shell tools for the `api` engine, scoped to one project directory.

Scoping is the whole reason this module exists. `claude -p` runs with
--dangerously-skip-permissions and the `pc` MCP server has no folder scope at
all, so today a code step can touch anything on the machine. Every tool here
turns its path argument through `_resolve_in` and nothing else, which is what
makes that boundary one function rather than six repeated checks.

No LLM knowledge lives here on purpose: the security boundary is testable
without a model, a client, or a network.
"""
from __future__ import annotations

from pathlib import Path

# Read/Write refuse anything larger. A file this big is not something the model
# can act on in one turn anyway, and the whole thing would land in a SQLite
# trace row on the way past.
MAX_FILE_BYTES = 2_000_000


def _resolve_in(cwd: Path, path: str) -> Path:
    """The only way a tool turns an argument into a real path.

    Resolves symlinks before comparing: a link inside the project pointing at
    C:\\Windows would otherwise pass a plain prefix check. Both sides are
    resolved, because `cwd` itself is routinely a symlinked temp dir on macOS
    and a short-name path on Windows — comparing a resolved child against an
    unresolved root rejects perfectly legal paths.
    """
    root = Path(cwd).resolve()
    raw = Path(path)
    target = (raw if raw.is_absolute() else root / raw).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"path escapes project directory: {path}")
    return target


async def _read(cwd: Path, file_path: str) -> str:
    target = _resolve_in(cwd, file_path)
    if not target.is_file():
        raise ValueError(f"no such file: {file_path}")
    if target.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"file too large to read ({target.stat().st_size} bytes): {file_path}")
    return target.read_text(encoding="utf-8", errors="replace")


async def _write(cwd: Path, file_path: str, content: str) -> str:
    target = _resolve_in(cwd, file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"wrote {len(content)} chars to {file_path}"
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_agent_tools.py -v`
Expected: PASS, 9 test.

- [ ] **Step 5: Commit**

```bash
git add hermes/agent_tools.py tests/test_agent_tools.py
git commit -m "feat: scoped path resolution plus Read and Write for the api engine"
```

---

### Task 2: `Edit`

**Files:**
- Modify: `hermes/agent_tools.py`
- Test: `tests/test_agent_tools.py`

**Interfaces:**
- Consumes: `_resolve_in` (Task 1).
- Produces: `async def _edit(cwd: Path, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> str`.

- [ ] **Step 1: Tulis test yang gagal**

```python
async def test_edit_replaces_a_unique_string(tmp_path):
    f = tmp_path / "a.py"
    f.write_text("x = 1\ny = 2\n", encoding="utf-8")
    await agent_tools._edit(tmp_path, "a.py", "x = 1", "x = 99")
    assert f.read_text(encoding="utf-8") == "x = 99\ny = 2\n"


async def test_edit_refuses_a_non_unique_string(tmp_path):
    """Replacing the first of several matches is how an edit tool silently
    corrupts a file: the model asked for one change and got a different one."""
    f = tmp_path / "a.py"
    f.write_text("v = 1\nv = 1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="appears 2 times"):
        await agent_tools._edit(tmp_path, "a.py", "v = 1", "v = 2")
    assert f.read_text(encoding="utf-8") == "v = 1\nv = 1\n"


async def test_edit_replace_all_is_opt_in(tmp_path):
    f = tmp_path / "a.py"
    f.write_text("v = 1\nv = 1\n", encoding="utf-8")
    await agent_tools._edit(tmp_path, "a.py", "v = 1", "v = 2", replace_all=True)
    assert f.read_text(encoding="utf-8") == "v = 2\nv = 2\n"


async def test_edit_missing_string_says_so(tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="not found"):
        await agent_tools._edit(tmp_path, "a.py", "nope", "y")


async def test_edit_outside_project_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="escapes project directory"):
        await agent_tools._edit(tmp_path, "../a.py", "a", "b")
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_agent_tools.py -k edit -v`
Expected: FAIL — `AttributeError: module 'hermes.agent_tools' has no attribute '_edit'`

- [ ] **Step 3: Implementasi minimal**

```python
async def _edit(cwd: Path, file_path: str, old_string: str,
                new_string: str, replace_all: bool = False) -> str:
    """Replace an exact string in a file.

    Uniqueness is enforced rather than assumed. Replacing the first of several
    matches is the classic way an edit tool corrupts a file quietly: the model
    asked for one change and a different one happened, and nothing errored.
    """
    target = _resolve_in(cwd, file_path)
    if not target.is_file():
        raise ValueError(f"no such file: {file_path}")
    text = target.read_text(encoding="utf-8", errors="replace")
    count = text.count(old_string)
    if count == 0:
        raise ValueError(f"old_string not found in {file_path}")
    if count > 1 and not replace_all:
        raise ValueError(
            f"old_string appears {count} times in {file_path} — pass "
            "replace_all=true, or include more surrounding context to make it unique")
    target.write_text(text.replace(old_string, new_string), encoding="utf-8")
    return f"replaced {count if replace_all else 1} occurrence(s) in {file_path}"
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_agent_tools.py -v`
Expected: PASS, 14 test.

- [ ] **Step 5: Commit**

```bash
git add hermes/agent_tools.py tests/test_agent_tools.py
git commit -m "feat: add the Edit tool with enforced match uniqueness"
```

---

### Task 3: `Grep` + `Glob`

**Files:**
- Modify: `hermes/agent_tools.py`
- Test: `tests/test_agent_tools.py`

**Interfaces:**
- Consumes: `_resolve_in` (Task 1).
- Produces: `async def _grep(cwd: Path, pattern: str, path: str = "", glob: str = "") -> str`; `async def _glob(cwd: Path, pattern: str) -> str`.

- [ ] **Step 1: Tulis test yang gagal**

```python
async def test_grep_reports_file_and_line(tmp_path):
    (tmp_path / "a.py").write_text("import os\nvalue = 42\n", encoding="utf-8")
    out = await agent_tools._grep(tmp_path, r"value\s*=")
    assert "a.py:2" in out and "value = 42" in out


async def test_grep_filters_by_glob(tmp_path):
    (tmp_path / "a.py").write_text("needle\n", encoding="utf-8")
    (tmp_path / "a.txt").write_text("needle\n", encoding="utf-8")
    out = await agent_tools._grep(tmp_path, "needle", glob="*.py")
    assert "a.py" in out and "a.txt" not in out


async def test_grep_no_match_says_so_rather_than_returning_empty(tmp_path):
    """hub-style callers treat empty output as failure; a search that
    legitimately found nothing must not read as a broken tool."""
    (tmp_path / "a.py").write_text("x\n", encoding="utf-8")
    assert "no matches" in (await agent_tools._grep(tmp_path, "zzz")).lower()


async def test_grep_path_outside_project_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="escapes project directory"):
        await agent_tools._grep(tmp_path, "x", path="..")


async def test_glob_lists_matching_files_relative_to_project(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.py").write_text("", encoding="utf-8")
    out = await agent_tools._glob(tmp_path, "**/*.py")
    assert "src/a.py" in out.replace("\\", "/")


async def test_glob_no_match_says_so(tmp_path):
    assert "no matches" in (await agent_tools._glob(tmp_path, "**/*.rs")).lower()
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_agent_tools.py -k "grep or glob" -v`
Expected: FAIL — `AttributeError: ... has no attribute '_grep'`

- [ ] **Step 3: Implementasi minimal**

```python
import fnmatch
import re

# Matches beyond this are cut. A search that hits thousands of lines is a
# search the model should narrow, and the full list would blow the turn's
# context long before it helped.
MAX_GREP_MATCHES = 200

NO_MATCHES = "no matches"

# Never walked. These are large, machine-generated, and never what a code step
# is looking for.
_SKIP_DIRS = frozenset({".git", "node_modules", ".venv", "venv", "__pycache__",
                        ".next", "dist", "build", ".pytest_cache"})


def _walk(root: Path):
    """Every file under `root`, skipping the directories nobody greps."""
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in _SKIP_DIRS for part in path.relative_to(root).parts[:-1]):
            continue
        yield path


def _rel(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


async def _grep(cwd: Path, pattern: str, path: str = "", glob: str = "") -> str:
    root = _resolve_in(cwd, path) if path else Path(cwd).resolve()
    rx = re.compile(pattern)
    hits: list[str] = []
    for f in _walk(root):
        if glob and not fnmatch.fnmatch(f.name, glob):
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue           # unreadable file is not a failed search
        for n, line in enumerate(text.splitlines(), 1):
            if rx.search(line):
                hits.append(f"{_rel(root, f)}:{n}: {line.strip()[:200]}")
                if len(hits) >= MAX_GREP_MATCHES:
                    hits.append(f"... stopped at {MAX_GREP_MATCHES} matches")
                    return "\n".join(hits)
    return "\n".join(hits) if hits else NO_MATCHES


async def _glob(cwd: Path, pattern: str) -> str:
    root = Path(cwd).resolve()
    out = [_rel(root, p) for p in sorted(root.glob(pattern))
           if p.is_file()
           and not any(part in _SKIP_DIRS for part in p.relative_to(root).parts[:-1])]
    return "\n".join(out) if out else NO_MATCHES
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_agent_tools.py -v`
Expected: PASS, 20 test.

- [ ] **Step 5: Commit**

```bash
git add hermes/agent_tools.py tests/test_agent_tools.py
git commit -m "feat: add the Grep and Glob tools"
```

---

### Task 4: `Bash`

**Files:**
- Modify: `hermes/agent_tools.py`
- Test: `tests/test_agent_tools.py`

**Interfaces:**
- Consumes: tidak ada (tidak menerima path).
- Produces: `async def _bash(cwd: Path, command: str, timeout_s: int = BASH_TIMEOUT_S) -> str`; konstanta `BASH_TIMEOUT_S`, `MAX_OUTPUT_CHARS`.

- [ ] **Step 1: Tulis test yang gagal**

```python
import sys


async def test_bash_runs_in_the_project_directory(tmp_path):
    (tmp_path / "marker.txt").write_text("", encoding="utf-8")
    out = await agent_tools._bash(tmp_path, f'"{sys.executable}" -c "import os;print(os.listdir())"')
    assert "marker.txt" in out


async def test_bash_reports_a_non_zero_exit_without_raising(tmp_path):
    out = await agent_tools._bash(tmp_path, f'"{sys.executable}" -c "raise SystemExit(3)"')
    assert "exit code 3" in out


async def test_bash_merges_stderr_into_the_output(tmp_path):
    out = await agent_tools._bash(
        tmp_path, f'"{sys.executable}" -c "import sys;sys.stderr.write(\'boom\')"')
    assert "boom" in out


async def test_bash_times_out_and_says_so(tmp_path):
    out = await agent_tools._bash(
        tmp_path, f'"{sys.executable}" -c "import time;time.sleep(10)"', timeout_s=1)
    assert "timed out" in out


async def test_bash_truncates_large_output_with_a_visible_marker(tmp_path):
    """Silent truncation would let the model reason about output it never
    saw the end of."""
    out = await agent_tools._bash(
        tmp_path, f'"{sys.executable}" -c "print(\'x\' * 50000)"')
    assert len(out) < 50000
    assert "truncated" in out
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_agent_tools.py -k bash -v`
Expected: FAIL — `AttributeError: ... has no attribute '_bash'`

- [ ] **Step 3: Implementasi minimal**

```python
import asyncio

# Shorter than the step's own timeout on purpose: one wedged command must not
# consume the whole code step's clock.
BASH_TIMEOUT_S = 180
# Per call. Large enough for a real test run's tail, small enough that a
# runaway build log cannot fill the turn or the trace row.
MAX_OUTPUT_CHARS = 8000


def _truncate_output(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    keep = MAX_OUTPUT_CHARS // 2
    dropped = len(text) - 2 * keep
    # Head and tail, because a command's first lines say what ran and its last
    # lines say how it ended; the middle is the expendable part.
    return (f"{text[:keep]}\n"
            f"... [truncated {dropped} chars] ...\n"
            f"{text[-keep:]}")


async def _bash(cwd: Path, command: str, timeout_s: int = BASH_TIMEOUT_S) -> str:
    """Run one shell command inside the project directory.

    Never raises for a failing command: a non-zero exit is information the
    model must read and react to, not a tool malfunction. Only the tool being
    unable to run at all is an error.
    """
    proc = await asyncio.create_subprocess_shell(
        command, cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return f"command timed out after {timeout_s}s: {command}"
    text = _truncate_output(out.decode(errors="replace"))
    if proc.returncode:
        return f"{text}\n[exit code {proc.returncode}]"
    return text or "[no output]"
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_agent_tools.py -v`
Expected: PASS, 25 test.

- [ ] **Step 5: Commit**

```bash
git add hermes/agent_tools.py tests/test_agent_tools.py
git commit -m "feat: add the Bash tool with its own timeout and output cap"
```

---

### Task 5: Schema `TOOLS` + dispatch `call()`

**Files:**
- Modify: `hermes/agent_tools.py`
- Test: `tests/test_agent_tools.py`

**Interfaces:**
- Consumes: `_read`, `_write`, `_edit`, `_grep`, `_glob`, `_bash`.
- Produces: `TOOLS: list[dict]` (schema OpenAI); `async def call(name: str, args: dict, cwd: Path) -> tuple[str, bool]` — mengembalikan `(teks, ok)`. Task 8 dan 9 memakainya.

- [ ] **Step 1: Tulis test yang gagal**

```python
def test_tool_names_match_claudes_exactly():
    """engine_stream._EDIT_TOOLS matches literal names. Renaming Edit or
    Write here empties the edited-files list with no error at all."""
    from hermes.engine_stream import _EDIT_TOOLS
    names = {t["function"]["name"] for t in agent_tools.TOOLS}
    assert names == {"Read", "Edit", "Write", "Bash", "Grep", "Glob"}
    assert {"Edit", "Write"} <= _EDIT_TOOLS


def test_every_tool_declares_an_object_schema():
    for t in agent_tools.TOOLS:
        fn = t["function"]
        assert t["type"] == "function"
        assert fn["description"].strip()
        assert fn["parameters"]["type"] == "object"


async def test_call_dispatches_and_reports_ok(tmp_path):
    (tmp_path / "a.txt").write_text("isi", encoding="utf-8")
    text, ok = await agent_tools.call("Read", {"file_path": "a.txt"}, tmp_path)
    assert ok and text == "isi"


async def test_call_turns_a_scope_violation_into_a_failed_result(tmp_path):
    """The model must be told and allowed to correct itself; an exception
    escaping here would kill the whole engine run instead."""
    text, ok = await agent_tools.call("Read", {"file_path": "../x"}, tmp_path)
    assert not ok and "escapes project directory" in text


async def test_call_unknown_tool_is_a_failed_result(tmp_path):
    text, ok = await agent_tools.call("Nope", {}, tmp_path)
    assert not ok and "unknown tool" in text.lower()


async def test_call_missing_required_argument_is_a_failed_result(tmp_path):
    text, ok = await agent_tools.call("Read", {}, tmp_path)
    assert not ok and "file_path" in text
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_agent_tools.py -k "tool_names or call_" -v`
Expected: FAIL — `AttributeError: ... has no attribute 'TOOLS'`

- [ ] **Step 3: Implementasi minimal**

```python
def _fn(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties,
                       "required": required}}}


_STR = {"type": "string"}
_BOOL = {"type": "boolean"}

# Names are claude's, deliberately. Two reasons, and the first is not cosmetic:
# engine_stream._EDIT_TOOLS matches these literals to decide which tool calls
# changed a file, so a rename empties the edited-files list silently. The
# second is that these are the names the model was trained to call.
TOOLS = [
    _fn("Read", "Read a UTF-8 text file from the project. Always read a file "
                "before editing it.",
        {"file_path": {**_STR, "description": "Path relative to the project root"}},
        ["file_path"]),
    _fn("Write", "Create or overwrite a file with the given content. Parent "
                 "directories are created.",
        {"file_path": _STR, "content": _STR}, ["file_path", "content"]),
    _fn("Edit", "Replace an exact string in a file. old_string must appear "
                "exactly once unless replace_all is true — include surrounding "
                "context to make it unique.",
        {"file_path": _STR, "old_string": _STR, "new_string": _STR,
         "replace_all": _BOOL}, ["file_path", "old_string", "new_string"]),
    _fn("Bash", "Run one shell command in the project directory. A non-zero "
                "exit is reported, not raised.",
        {"command": _STR}, ["command"]),
    _fn("Grep", "Search file contents with a regular expression.",
        {"pattern": _STR,
         "path": {**_STR, "description": "Subdirectory to search; defaults to the project root"},
         "glob": {**_STR, "description": "Filename filter, e.g. *.py"}},
        ["pattern"]),
    _fn("Glob", "List files matching a glob pattern, e.g. **/*.py.",
        {"pattern": _STR}, ["pattern"]),
]


async def call(name: str, args: dict, cwd: Path) -> tuple[str, bool]:
    """Run one tool call. Returns `(text, ok)` and never raises.

    A bad argument, a missing file, a path outside the project: every one of
    these is something the model can see and correct on the next turn. Letting
    the exception escape would instead end the whole engine run over a mistake
    that costs one turn to fix.
    """
    args = args if isinstance(args, dict) else {}
    try:
        if name == "Read":
            return await _read(cwd, args["file_path"]), True
        if name == "Write":
            return await _write(cwd, args["file_path"], args["content"]), True
        if name == "Edit":
            return await _edit(cwd, args["file_path"], args["old_string"],
                               args["new_string"], bool(args.get("replace_all"))), True
        if name == "Bash":
            return await _bash(cwd, args["command"]), True
        if name == "Grep":
            return await _grep(cwd, args["pattern"], args.get("path", ""),
                               args.get("glob", "")), True
        if name == "Glob":
            return await _glob(cwd, args["pattern"]), True
        return f"unknown tool: {name}", False
    except KeyError as e:
        return f"missing required argument: {e.args[0]}", False
    except (ValueError, OSError) as e:
        return str(e), False
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_agent_tools.py -v`
Expected: PASS, 31 test.

- [ ] **Step 5: Commit**

```bash
git add hermes/agent_tools.py tests/test_agent_tools.py
git commit -m "feat: expose the agent tools as OpenAI schemas with a total dispatch"
```

---

### Task 6: Pemancar stream-json + penerjemah usage

Bagian murni dari `engine_api`. Tanpa klien, tanpa jaringan.

**Files:**
- Create: `hermes/engine_api.py`
- Test: `tests/test_engine_api.py`

**Interfaces:**
- Consumes: `hermes.engine_stream.distill_claude_line`, `hermes.engine_result.parse_claude_json` (dibaca oleh test, bukan diimpor modul).
- Produces: `_usage_anthropic(usage) -> dict`; `emit_init(model) -> dict`; `emit_assistant(text, tool_calls, usage) -> dict`; `emit_tool_result(tool_use_id, content, is_error) -> dict`; `emit_result(final_text, usage, session_id, num_turns, api_error) -> dict`. `tool_calls` di sini adalah list `ToolCall` (Task 7).

- [ ] **Step 1: Tulis test yang gagal**

```python
"""Loop agentik engine `api`, dan bentuk stream yang dipancarkannya.

Bentuk itulah yang diuji paling keras: seluruh jalur hilir — timeline, token,
deteksi selesai — membacanya lewat modul yang tidak boleh diubah, dan setiap
ketidakcocokan di sini gagal secara SENYAP, bukan dengan error.
"""
import json

from hermes import engine_api
from hermes.engine_result import parse_claude_json
from hermes.engine_stream import distill_claude_line


def test_usage_is_translated_to_anthropic_key_names():
    """9Router answers OpenAI-style. engine_stream reads Anthropic keys, so an
    untranslated dict makes every token count None without erroring."""
    got = engine_api._usage_anthropic(
        {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120})
    assert got == {"input_tokens": 100, "output_tokens": 20}


def test_usage_of_none_is_empty_not_a_crash():
    assert engine_api._usage_anthropic(None) == {}


def test_translated_usage_is_readable_by_the_distiller():
    usage = engine_api._usage_anthropic({"prompt_tokens": 7, "completion_tokens": 3})
    line = json.dumps(engine_api.emit_assistant("hi", [], usage))
    ev = distill_claude_line(line)[0]
    assert (ev.tokens_in, ev.tokens_out) == (7, 3)


def test_init_line_names_the_model():
    ev = distill_claude_line(json.dumps(engine_api.emit_init("cc/claude-opus-5")))[0]
    assert ev.kind == "init" and ev.text == "cc/claude-opus-5"


def test_tool_call_line_carries_the_edited_path():
    call = engine_api.ToolCall("call_1", "Edit",
                               {"file_path": "src/a.py", "old_string": "a",
                                "new_string": "b"})
    ev = distill_claude_line(json.dumps(engine_api.emit_assistant("", [call], {})))[0]
    assert ev.kind == "tool_use" and ev.tool_name == "Edit"
    assert ev.file_path == "src/a.py"


def test_a_read_call_reports_no_edited_path():
    call = engine_api.ToolCall("call_1", "Read", {"file_path": "src/a.py"})
    ev = distill_claude_line(json.dumps(engine_api.emit_assistant("", [call], {})))[0]
    assert ev.file_path == ""


def test_failed_tool_result_is_marked_not_ok():
    line = json.dumps(engine_api.emit_tool_result("call_1", "boom", is_error=True))
    ev = distill_claude_line(line)[0]
    assert ev.kind == "tool_result" and ev.ok is False


def test_result_envelope_is_parsed_as_the_final_text():
    env = engine_api.emit_result("all done", {"input_tokens": 1, "output_tokens": 2},
                                 session_id="s1", num_turns=3)
    outcome = parse_claude_json(json.dumps(env))
    assert outcome.final_text == "all done"
    assert outcome.session_id == "s1"
    assert outcome.api_error is None


def test_result_envelope_can_report_a_failed_session():
    env = engine_api.emit_result("", {}, api_error="429 rate limited")
    outcome = parse_claude_json(json.dumps(env))
    assert outcome.api_error
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_engine_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'hermes.engine_api'`

- [ ] **Step 3: Implementasi minimal**

```python
"""The `api` engine: an agentic loop over the 9Router gateway.

Where `engine_runner` spawns a CLI and reads its stdout, this runs the loop in
this process and speaks to the same OpenAI-compatible gateway the planner and
chat already use — so there is no second credential, no second install, and no
CLI to find on PATH.

The load-bearing decision is that it emits **claude-shaped stream-json** rather
than a format of its own. `engine_stream.distill_claude_line` and
`engine_result.parse_claude_json` then read this engine with no changes, and
with them the whole downstream path: the task timeline, token totals,
completion detection, the retry classifier and the budget.

That makes the shapes below a contract with two modules that do not import this
one. Both mismatches found while designing this failed SILENTLY rather than
loudly — a renamed tool empties the edited-files list, an untranslated usage
dict zeroes the token counts — which is why they are pinned by tests.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


@dataclass
class ToolCall:
    """One tool call, after its arguments have been parsed off the wire.

    OpenAI streams `arguments` as a JSON *string* assembled from fragments;
    Anthropic's `tool_use.input` is an object. This holds the parsed form, so
    the translation happens once, at the edge.
    """
    id: str
    name: str
    args: dict = field(default_factory=dict)


def _usage_anthropic(usage) -> dict:
    """Translate the gateway's OpenAI-style usage into Anthropic key names.

    Verified against the live gateway 2026-09-08: it answers `prompt_tokens` /
    `completion_tokens`, and `prompt_tokens_details` is None — so there is no
    cache breakdown to carry, and `input_tokens` is the whole prompt with no
    risk of double counting. `engine_stream._total_input_tokens` reads the
    Anthropic names, and a dict it does not recognise yields None rather than
    an error, so an untranslated usage would blank the timeline's token totals
    without anything failing.
    """
    if not isinstance(usage, dict):
        return {}
    out = {}
    if isinstance(usage.get("prompt_tokens"), int):
        out["input_tokens"] = usage["prompt_tokens"]
    if isinstance(usage.get("completion_tokens"), int):
        out["output_tokens"] = usage["completion_tokens"]
    return out


def emit_init(model: str) -> dict:
    return {"type": "system", "subtype": "init", "model": model}


def emit_assistant(text: str, tool_calls: list[ToolCall], usage: dict) -> dict:
    """One assistant turn as an Anthropic-style message."""
    content = []
    if text:
        content.append({"type": "text", "text": text})
    for c in tool_calls:
        content.append({"type": "tool_use", "id": c.id, "name": c.name,
                        "input": c.args})
    message = {"role": "assistant", "content": content}
    if usage:
        message["usage"] = usage
    return {"type": "assistant", "message": message}


def emit_tool_result(tool_use_id: str, content: str, is_error: bool = False) -> dict:
    return {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": tool_use_id,
         "content": content, "is_error": bool(is_error)}]}}


def emit_result(final_text: str, usage: dict, session_id: str = "",
                num_turns: int = 0, api_error: str = "") -> dict:
    """The closing envelope.

    `result` MUST hold the model's own last message, never tool output:
    `orchestrator._confirmed_done` reads exactly this field to decide whether
    the step finished, and a mismatch costs three full engine rounds per step.

    No `total_cost_usd`: the gateway reports none, so the timeline shows tokens
    without a price rather than an invented one. `Budget` therefore does not
    move for this engine — recorded and accepted in the design spec.
    """
    env = {"type": "result", "subtype": "success", "is_error": False,
           "result": final_text, "session_id": session_id,
           "num_turns": num_turns, "usage": usage}
    if api_error:
        env.update(subtype="error_during_execution", is_error=True,
                   result=api_error)
    return env
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_engine_api.py -v`
Expected: PASS, 9 test.

- [ ] **Step 5: Commit**

```bash
git add hermes/engine_api.py tests/test_engine_api.py
git commit -m "feat: emit claude-shaped stream-json for the api engine"
```

---

### Task 7: Satu giliran, dengan akumulasi streaming

**Files:**
- Modify: `hermes/engine_api.py`
- Test: `tests/test_engine_api.py`

**Interfaces:**
- Consumes: `ToolCall`, `_usage_anthropic` (Task 6).
- Produces: `@dataclass Turn(text: str, tool_calls: list[ToolCall], usage: dict)`; `async def _one_turn(client, model: str, messages: list[dict], tools: list[dict]) -> Turn`.

Klien palsu memakai bentuk yang sama dengan yang dipakai `conftest.py` untuk `main.AsyncOpenAI`.

- [ ] **Step 1: Tulis test yang gagal**

```python
from types import SimpleNamespace


def _delta(content=None, tool_calls=None):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(
            content=content, tool_calls=tool_calls))],
        usage=None)


def _tc(index, id=None, name=None, arguments=None):
    return SimpleNamespace(index=index, id=id, function=SimpleNamespace(
        name=name, arguments=arguments))


def _usage_chunk(prompt, completion):
    return SimpleNamespace(choices=[], usage=SimpleNamespace(
        model_dump=lambda: {"prompt_tokens": prompt, "completion_tokens": completion}))


class FakeStream:
    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        async def gen():
            for c in self._chunks:
                yield c
        return gen()


class FakeClient:
    """Scripted AsyncOpenAI double. Each entry in `scripts` is the chunk list
    for one create() call, so a multi-turn loop is scripted turn by turn."""

    def __init__(self, scripts):
        self.scripts = list(scripts)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return FakeStream(self.scripts.pop(0))


async def test_one_turn_collects_streamed_text():
    client = FakeClient([[_delta(content="Hel"), _delta(content="lo"),
                          _usage_chunk(10, 2)]])
    turn = await engine_api._one_turn(client, "m", [], [])
    assert turn.text == "Hello"
    assert turn.tool_calls == []
    assert turn.usage == {"input_tokens": 10, "output_tokens": 2}


async def test_one_turn_reassembles_tool_call_argument_fragments():
    """The gateway streams `arguments` in pieces; a turn that parses a
    fragment would call the tool with half an argument."""
    client = FakeClient([[
        _delta(tool_calls=[_tc(0, id="call_1", name="Read", arguments='{"file')]),
        _delta(tool_calls=[_tc(0, arguments='_path": "a.py"}')]),
    ]])
    turn = await engine_api._one_turn(client, "m", [], [])
    assert turn.tool_calls == [engine_api.ToolCall("call_1", "Read",
                                                   {"file_path": "a.py"})]


async def test_one_turn_keeps_parallel_tool_calls_apart_by_index():
    client = FakeClient([[
        _delta(tool_calls=[_tc(0, id="c1", name="Read", arguments='{"file_path":"a"}'),
                           _tc(1, id="c2", name="Read", arguments='{"file_path":"b"}')]),
    ]])
    turn = await engine_api._one_turn(client, "m", [], [])
    assert [c.id for c in turn.tool_calls] == ["c1", "c2"]
    assert [c.args["file_path"] for c in turn.tool_calls] == ["a", "b"]


async def test_one_turn_survives_unparseable_tool_arguments():
    """A truncated arguments string must reach the tool layer as an empty
    dict and be reported as a missing argument, not crash the run."""
    client = FakeClient([[
        _delta(tool_calls=[_tc(0, id="c1", name="Read", arguments='{"file_pa')]),
    ]])
    turn = await engine_api._one_turn(client, "m", [], [])
    assert turn.tool_calls[0].args == {}


async def test_one_turn_requests_streaming_usage():
    client = FakeClient([[_delta(content="x")]])
    await engine_api._one_turn(client, "m", [], [])
    assert client.calls[0]["stream"] is True
    assert client.calls[0]["stream_options"] == {"include_usage": True}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_engine_api.py -k one_turn -v`
Expected: FAIL — `AttributeError: module 'hermes.engine_api' has no attribute '_one_turn'`

- [ ] **Step 3: Implementasi minimal**

```python
@dataclass
class Turn:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: dict = field(default_factory=dict)


def _parse_args(raw: str) -> dict:
    """Parsed tool arguments, or {} for anything unusable.

    A truncated or malformed arguments string is a bad turn, not a dead run:
    the tool layer reports the missing argument and the model gets to correct
    itself on the next turn.
    """
    try:
        data = json.loads(raw or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


async def _one_turn(client, model: str, messages: list[dict],
                    tools: list[dict]) -> Turn:
    """One assistant turn, assembled from its stream.

    Streamed rather than blocking because the turn's text and tool calls are
    what the live timeline renders. They are still emitted as ONE assistant
    line per turn, not per delta: `distill_claude_line` reads whole content
    blocks, and the CLIs emit per turn too.

    Tool call fragments are keyed by `index`, not by position: a turn making
    two calls at once interleaves their argument fragments in the stream.
    """
    kwargs = {"model": model, "messages": messages, "stream": True,
              "stream_options": {"include_usage": True}}
    if tools:
        kwargs["tools"] = tools
    stream = await client.chat.completions.create(**kwargs)

    text_parts: list[str] = []
    partial: dict[int, dict] = {}
    usage = {}
    async for chunk in stream:
        if getattr(chunk, "usage", None):
            usage = _usage_anthropic(chunk.usage.model_dump())
        for choice in (chunk.choices or []):
            delta = choice.delta
            if getattr(delta, "content", None):
                text_parts.append(delta.content)
            for tc in (getattr(delta, "tool_calls", None) or []):
                slot = partial.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                if tc.id:
                    slot["id"] = tc.id
                fn = getattr(tc, "function", None)
                if fn is not None:
                    if fn.name:
                        slot["name"] = fn.name
                    if fn.arguments:
                        slot["args"] += fn.arguments

    calls = [ToolCall(slot["id"], slot["name"], _parse_args(slot["args"]))
             for _, slot in sorted(partial.items())]
    return Turn("".join(text_parts), calls, usage)
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_engine_api.py -v`
Expected: PASS, 14 test.

- [ ] **Step 5: Commit**

```bash
git add hermes/engine_api.py tests/test_engine_api.py
git commit -m "feat: assemble one streamed assistant turn for the api engine"
```

---

### Task 8: Loop `run()`, timeout, dan pemetaan kegagalan

Inti task ini. Menghasilkan `RunResult` yang bentuknya identik dengan cabang subprocess.

**Files:**
- Modify: `hermes/engine_api.py`
- Test: `tests/test_engine_api.py`

**Interfaces:**
- Consumes: `Turn`, `_one_turn`, semua `emit_*` (Task 6-7); `agent_tools.TOOLS`, `agent_tools.call` (Task 5); `engine_runner.RunResult`, `engine_runner._await_within`.
- Produces: `MAX_TURNS`; `_system(cwd) -> str`; `async def run(prompt, cwd, timeout_s, model="", on_event=None, deadline=None, client=None, **_) -> RunResult`. Task 10 memanggilnya.

- [ ] **Step 1: Tulis test yang gagal**

```python
import asyncio

import pytest

from hermes import agent_tools, failure
from hermes.orchestrator import _confirmed_done


def _text_turn(text):
    return [_delta(content=text), _usage_chunk(5, 1)]


def _call_turn(id, name, args_json):
    return [_delta(tool_calls=[_tc(0, id=id, name=name, arguments=args_json)])]


async def test_run_executes_a_tool_then_finishes(tmp_path):
    (tmp_path / "a.txt").write_text("isi", encoding="utf-8")
    client = FakeClient([
        _call_turn("c1", "Read", '{"file_path": "a.txt"}'),
        _text_turn("file says isi\nDONE"),
    ])
    res = await engine_api.run("baca a.txt", tmp_path, 30, client=client)
    assert res.ok
    assert res.outcome.final_text.endswith("DONE")
    assert _confirmed_done(res.final_text)


async def test_run_answers_every_tool_call_before_the_next_request(tmp_path):
    """The API rejects a request whose previous assistant turn has an
    unanswered tool_call_id."""
    (tmp_path / "a.txt").write_text("isi", encoding="utf-8")
    client = FakeClient([
        _call_turn("c1", "Read", '{"file_path": "a.txt"}'),
        _text_turn("DONE"),
    ])
    await engine_api.run("x", tmp_path, 30, client=client)
    second = client.calls[1]["messages"]
    assert second[-1]["role"] == "tool"
    assert second[-1]["tool_call_id"] == "c1"


async def test_run_emits_a_trace_the_distiller_understands(tmp_path):
    (tmp_path / "a.txt").write_text("isi", encoding="utf-8")
    lines = []
    client = FakeClient([
        _call_turn("c1", "Read", '{"file_path": "a.txt"}'),
        _text_turn("DONE"),
    ])
    await engine_api.run("x", tmp_path, 30, client=client, on_event=lines.append)
    kinds = [e.kind for ln in lines for e in distill_claude_line(ln)]
    assert kinds[0] == "init"
    assert "tool_use" in kinds and "tool_result" in kinds
    assert kinds[-1] == "result"


async def test_run_marks_a_failed_tool_result_not_ok(tmp_path):
    lines = []
    client = FakeClient([
        _call_turn("c1", "Read", '{"file_path": "../escape"}'),
        _text_turn("cannot do that"),
    ])
    await engine_api.run("x", tmp_path, 30, client=client, on_event=lines.append)
    results = [e for ln in lines for e in distill_claude_line(ln)
               if e.kind == "tool_result"]
    assert results[0].ok is False


async def test_run_stops_at_max_turns(tmp_path, monkeypatch):
    monkeypatch.setattr(engine_api, "MAX_TURNS", 3)
    (tmp_path / "a.txt").write_text("isi", encoding="utf-8")
    client = FakeClient([_call_turn(f"c{i}", "Read", '{"file_path": "a.txt"}')
                         for i in range(3)])
    res = await engine_api.run("x", tmp_path, 30, client=client)
    assert len(client.calls) == 3
    assert not _confirmed_done(res.final_text)


async def test_run_puts_an_api_error_where_the_classifier_reads_it(tmp_path):
    class Boom:
        def __init__(self):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._c))

        async def _c(self, **kwargs):
            raise RuntimeError("429 rate limit exceeded")

    res = await engine_api.run("x", tmp_path, 30, client=Boom())
    assert not res.ok
    assert "429" in res.stderr
    assert failure.classify(res.stderr) == failure.TRANSIENT


async def test_run_reports_an_auth_error_as_environment(tmp_path):
    class Boom:
        def __init__(self):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._c))

        async def _c(self, **kwargs):
            raise RuntimeError("401 unauthorized")

    res = await engine_api.run("x", tmp_path, 30, client=Boom())
    assert failure.classify(res.stderr) == failure.ENVIRONMENT


async def test_run_times_out_with_the_same_shape_as_a_killed_subprocess(tmp_path):
    class Slow:
        def __init__(self):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._c))

        async def _c(self, **kwargs):
            await asyncio.sleep(10)

    res = await engine_api.run("x", tmp_path, 1, client=Slow())
    assert res.timed_out and not res.ok
    assert res.stdout == "" and res.returncode is None
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_engine_api.py -k "run_" -v`
Expected: FAIL — `AttributeError: module 'hermes.engine_api' has no attribute 'run'`

- [ ] **Step 3: Implementasi minimal**

```python
import asyncio
from pathlib import Path

from . import agent_tools
from .engine_runner import RunResult, _await_within

# Tool turns inside ONE session, distinct from orchestrator's MAX_ENGINE_ROUNDS
# (repair rounds, outer). A model stuck in a tool loop would otherwise spend the
# whole timeout_code_s budget, and unlike the CLI engines there is no per-call
# cost figure to stop it — see the budget note in the design spec.
MAX_TURNS = 40

# Sent to the model as the tool result when the loop is cut short. Better than
# silence: the closing turn should say why it stopped.
_TURNS_EXHAUSTED = ("Turn budget exhausted. Stop calling tools and state "
                    "plainly what is done and what remains.")


def _system(cwd: Path) -> str:
    """The engine's own preamble. Deliberately thin.

    The task, the project context and the completion contract all arrive in the
    user prompt, composed by `orchestrator._compose_engine_prompt` — restating
    them here would let the two drift apart.
    """
    return ("You are a coding agent working inside a single project directory. "
            f"The project root is {cwd}, and every path you pass to a tool is "
            "resolved inside it — paths outside are refused. "
            "Inspect files with the tools before changing them; never guess a "
            "file's contents. Make the change, verify it, then report. "
            "Do not ask for permission to run a command: run it.")


def _final_text(turns: list[Turn]) -> str:
    """The model's own last words.

    Scans backwards for the last turn that actually said something: a run
    frequently ends with a tool-call-only turn, and reporting that turn's empty
    text as the result would blank `final_text` — which `_confirmed_done` reads
    to decide the step is finished.
    """
    for turn in reversed(turns):
        if turn.text.strip():
            return turn.text
    return ""


def _sum_usage(turns: list[Turn]) -> dict:
    total = {"input_tokens": 0, "output_tokens": 0}
    for turn in turns:
        for key in total:
            total[key] += turn.usage.get(key, 0)
    return total


async def _loop(client, model: str, prompt: str, cwd: Path, emit) -> list[Turn]:
    messages = [{"role": "system", "content": _system(cwd)},
                {"role": "user", "content": prompt}]
    turns: list[Turn] = []
    for n in range(MAX_TURNS):
        turn = await _one_turn(client, model, messages, agent_tools.TOOLS)
        turns.append(turn)
        emit(emit_assistant(turn.text, turn.tool_calls, turn.usage))
        if not turn.tool_calls:
            break
        messages.append({
            "role": "assistant", "content": turn.text or None,
            "tool_calls": [{"id": c.id, "type": "function",
                            "function": {"name": c.name,
                                         "arguments": json.dumps(c.args)}}
                           for c in turn.tool_calls]})
        last = n == MAX_TURNS - 1
        for call in turn.tool_calls:
            # Every id must be answered before the next request, including on
            # the final turn — an unanswered tool_call_id is rejected outright.
            if last:
                text, ok = _TURNS_EXHAUSTED, False
            else:
                text, ok = await agent_tools.call(call.name, call.args, cwd)
            emit(emit_tool_result(call.id, text, is_error=not ok))
            messages.append({"role": "tool", "tool_call_id": call.id,
                             "content": text})
    return turns


async def run(prompt: str, cwd: Path, timeout_s: int, model: str = "",
              on_event=None, deadline=None, client=None, **_) -> RunResult:
    """One engine session against the 9Router gateway.

    Returns `engine_runner.RunResult` unchanged, so every caller — the retry
    loop, the budget, the failure classifier, the step report — reads this
    engine exactly as it reads a CLI. `**_` swallows the CLI-only kwargs
    (`ask_url`, `session_id`, `effort`) that `run_engine` may pass through.
    """
    if client is None:
        from openai import AsyncOpenAI
        from . import config
        settings, secrets = config.load_settings(), config.load_secrets()
        model = model or settings.model
        client = AsyncOpenAI(base_url=settings.nvidia_base_url,
                             api_key=secrets.nvidia_api_key)

    lines: list[str] = []

    def emit(obj: dict) -> None:
        line = json.dumps(obj, ensure_ascii=False)
        lines.append(line)
        if on_event is not None:
            try:
                on_event(line)
            except Exception:
                # A broken trace consumer must never take down a run whose real
                # work is fine — same posture as engine_runner._pump.
                pass

    emit(emit_init(model))
    work = _loop(client, model, prompt, Path(cwd), emit)
    try:
        if deadline is None:
            turns = await asyncio.wait_for(work, timeout=timeout_s)
        else:
            turns = await _await_within(work, deadline)
    except asyncio.TimeoutError:
        # Same shape the subprocess branch returns for a killed engine.
        return RunResult(False, "", "", True, None)
    except Exception as e:
        # The message, not the type: `failure.classify` matches on text like
        # "429" or "401", and the retry loop's whole decision hangs off it.
        why = f"{type(e).__name__}: {e}"
        emit(emit_result("", {}, api_error=why))
        stdout = "\n".join(lines)
        from .engine_result import parse_claude_json
        return RunResult(False, stdout, why, False, 1, parse_claude_json(stdout))

    emit(emit_result(_final_text(turns), _sum_usage(turns), num_turns=len(turns)))
    stdout = "\n".join(lines)
    from .engine_result import parse_claude_json
    return RunResult(True, stdout, "", False, 0, parse_claude_json(stdout))
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_engine_api.py -v`
Expected: PASS, 22 test.

- [ ] **Step 5: Commit**

```bash
git add hermes/engine_api.py tests/test_engine_api.py
git commit -m "feat: run the api engine's agentic loop as a RunResult"
```

---

### Task 9: Tool `ask_user` native

**Files:**
- Modify: `hermes/engine_api.py`
- Test: `tests/test_engine_api.py`

**Interfaces:**
- Consumes: `ask_server.resolve_ask`, `ask_server.TOOL_DESCRIPTION`, `ask.AskRegistry` (sudah ada); `_loop` (Task 8).
- Produces: `_tools_for(ask_registry) -> list[dict]`; `run(...)` menerima `ask_registry=None, ask_token=""`.

`resolve_ask` sudah murni dan tidak butuh transport: `can_stream=True` karena panggilan in-process tidak punya timer idle, dan `heartbeat=None` karena tidak ada koneksi untuk dijaga hangat.

- [ ] **Step 1: Tulis test yang gagal**

```python
from hermes.ask import AskRegistry


async def test_ask_user_tool_is_absent_without_a_registry(tmp_path):
    names = {t["function"]["name"] for t in engine_api._tools_for(None)}
    assert "ask_user" not in names
    assert "Read" in names


async def test_ask_user_tool_appears_with_a_registry(tmp_path):
    names = {t["function"]["name"] for t in engine_api._tools_for(AskRegistry())}
    assert "ask_user" in names


async def test_ask_user_reaches_the_registry_and_returns_the_answer(tmp_path):
    registry = AskRegistry()
    asked = {}

    async def on_ask(a):
        asked["question"] = a.question
        registry.answer(a.ask_id, "pakai yang kedua")

    registry.on_ask = on_ask
    token = registry.open_run("t1", 42)

    client = FakeClient([
        _call_turn("c1", "ask_user", '{"question": "yang mana?"}'),
        _text_turn("DONE"),
    ])
    res = await engine_api.run("x", tmp_path, 30, client=client,
                               ask_registry=registry, ask_token=token)
    assert asked["question"] == "yang mana?"
    assert res.ok
    second = client.calls[1]["messages"]
    assert "pakai yang kedua" in second[-1]["content"]


async def test_ask_user_without_a_bound_channel_degrades_not_errors(tmp_path):
    """An unbound registry means no Telegram is wired. The engine must be told
    to proceed on its own, never handed an error."""
    from hermes.ask import NO_CHANNEL
    registry = AskRegistry()
    token = registry.open_run("t1", 42)
    client = FakeClient([
        _call_turn("c1", "ask_user", '{"question": "yang mana?"}'),
        _text_turn("DONE"),
    ])
    await engine_api.run("x", tmp_path, 30, client=client,
                         ask_registry=registry, ask_token=token)
    assert NO_CHANNEL in client.calls[1]["messages"][-1]["content"]
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_engine_api.py -k ask_user -v`
Expected: FAIL — `AttributeError: module 'hermes.engine_api' has no attribute '_tools_for'`

- [ ] **Step 3: Implementasi minimal**

Ganti pemanggilan `agent_tools.TOOLS` dan `agent_tools.call` di `_loop` agar melewati `ask_user` lebih dulu, lalu tambahkan:

```python
ASK_TOOL_NAME = "ask_user"


def _tools_for(ask_registry) -> list[dict]:
    """The tool list for this run.

    `ask_user` is offered only when a registry is injected: a tool the model
    can call but nothing can answer is worse than no tool at all. The CLI
    engines get this same tool over MCP (`engine_runner.mcp_config_dict`);
    in-process there is no config file, token header or port to arrange.
    """
    if ask_registry is None:
        return agent_tools.TOOLS
    from .ask_server import TOOL_DESCRIPTION
    return agent_tools.TOOLS + [{
        "type": "function",
        "function": {
            "name": ASK_TOOL_NAME,
            "description": TOOL_DESCRIPTION,
            "parameters": {"type": "object", "properties": {
                "question": {"type": "string"},
                "options": {"type": "array", "items": {"type": "object"}},
                "multi": {"type": "boolean"}},
                "required": ["question"]}}}]


async def _dispatch(call: ToolCall, cwd: Path, ask_registry, ask_token: str):
    if call.name != ASK_TOOL_NAME:
        return await agent_tools.call(call.name, call.args, cwd)
    if ask_registry is None:
        return f"unknown tool: {call.name}", False
    from .ask_server import resolve_ask
    # can_stream=True: that flag exists to detect an MCP client that cannot be
    # held open long enough to reach a human. In-process there is no such
    # timer, and no heartbeat to keep a connection warm either.
    answer = await resolve_ask(ask_registry, ask_token, call.args.get("question"),
                               call.args.get("options"), call.args.get("multi"),
                               can_stream=True)
    return answer, True
```

Lalu di `_loop`, ganti signature dan dua barisnya:

```python
async def _loop(client, model: str, prompt: str, cwd: Path, emit,
                ask_registry=None, ask_token: str = "") -> list[Turn]:
    ...
        turn = await _one_turn(client, model, messages, _tools_for(ask_registry))
    ...
                text, ok = await _dispatch(call, cwd, ask_registry, ask_token)
```

Dan di `run`, teruskan keduanya:

```python
async def run(prompt: str, cwd: Path, timeout_s: int, model: str = "",
              on_event=None, deadline=None, client=None,
              ask_registry=None, ask_token: str = "", **_) -> RunResult:
    ...
    work = _loop(client, model, prompt, Path(cwd), emit, ask_registry, ask_token)
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_engine_api.py -v`
Expected: PASS, 26 test.

- [ ] **Step 5: Commit**

```bash
git add hermes/engine_api.py tests/test_engine_api.py
git commit -m "feat: give the api engine a native ask_user tool"
```

---

### Task 10: Dispatch di `engine_runner`

**Files:**
- Modify: `hermes/engine_runner.py`
- Modify: `hermes/engine_stream.py:349`
- Test: `tests/test_engine_runner.py`, `tests/test_engine_stream.py`

**Interfaces:**
- Consumes: `engine_api.run` (Task 8-9).
- Produces: `ASK_CAPABLE: set[str]`; `run_engine` menerima `engine="api"`. Task 11 memakai `ASK_CAPABLE`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `tests/test_engine_runner.py`:

```python
async def test_api_engine_never_spawns_a_subprocess(tmp_path, monkeypatch):
    """The whole point of the api engine is that there is no binary to find;
    reaching _resolve would mean the dispatch branch was missed."""
    def boom(argv):
        raise AssertionError("api engine must not resolve a binary")

    monkeypatch.setattr(engine_runner, "_resolve", boom)

    async def fake_run(prompt, cwd, timeout_s, **kwargs):
        return engine_runner.RunResult(True, "ok", "", False, 0)

    from hermes import engine_api
    monkeypatch.setattr(engine_api, "run", fake_run)
    res = await engine_runner.run_engine("api", "x", tmp_path, timeout_s=5)
    assert res.ok and res.stdout == "ok"


async def test_api_engine_forwards_model_and_trace_hook(tmp_path, monkeypatch):
    seen = {}

    async def fake_run(prompt, cwd, timeout_s, **kwargs):
        seen.update(kwargs)
        return engine_runner.RunResult(True, "", "", False, 0)

    from hermes import engine_api
    monkeypatch.setattr(engine_api, "run", fake_run)
    sink = lambda line: None
    await engine_runner.run_engine("api", "x", tmp_path, timeout_s=5,
                                   model="cc/claude-opus-5", on_event=sink)
    assert seen["model"] == "cc/claude-opus-5"
    assert seen["on_event"] is sink


def test_api_engine_is_streaming_and_parsed():
    from hermes.engine_result import parse_claude_json
    assert "api" in engine_runner.STREAMING
    assert engine_runner.PARSERS["api"] is parse_claude_json


def test_api_engine_is_ask_capable_but_takes_no_mcp_config():
    """--mcp-config is an argv flag for a CLI; the api engine has no argv.
    Its ask_user is injected in-process, so the two sets must differ."""
    assert "api" in engine_runner.ASK_CAPABLE
    assert "api" not in engine_runner.MCP_CONFIG_FLAG


def test_api_engine_is_not_resumable_in_phase_one():
    assert "api" not in engine_runner.RESUMABLE
```

Tambahkan ke `tests/test_engine_stream.py`:

```python
def test_api_engine_is_distilled_as_claude():
    from hermes.engine_stream import DISTILLERS, distill_claude_line
    assert DISTILLERS["api"] is distill_claude_line
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_engine_runner.py -k api tests/test_engine_stream.py -k api -v`
Expected: FAIL — `AttributeError: module 'hermes.engine_runner' has no attribute 'ASK_CAPABLE'`

- [ ] **Step 3: Implementasi minimal**

Di `hermes/engine_stream.py`, ubah `DISTILLERS`:

```python
# Which distiller reads which engine. Absent means the engine emits no stream
# worth rendering, and its tasks simply have no trace. `api` is deliberately
# the same reader as claude: engine_api emits claude-shaped stream-json so that
# nothing in this module has to know it exists.
DISTILLERS = {"claude": distill_claude_line, "antigravity": distill_agy_line,
              "api": distill_claude_line}
```

Di `hermes/engine_runner.py`, tambah keanggotaan set:

```python
STREAMING = {"claude", "antigravity", "api"}
MODEL_FLAG = {"claude", "antigravity", "api"}
PARSERS = {"claude": parse_claude_json, "antigravity": parse_agy_stream,
           "api": parse_claude_json}
# Which engines can reach the operator through ask_user. Distinct from
# MCP_CONFIG_FLAG, which is narrower: that one says whose *argv* carries
# --mcp-config. The api engine asks in-process — same registry, no config file,
# no token header, no port — so it belongs to one set and not the other.
ASK_CAPABLE = {"claude", "api"}
```

Cabang dispatch, di awal `run_engine`, sebelum `mcp_config_path` disiapkan:

```python
async def run_engine(engine: Literal["claude", "antigravity", "api"], prompt: str,
                     ...):
    # The api engine has no binary, no argv and no stdout to pump: it runs the
    # loop in this process. Everything below this line is subprocess plumbing.
    if engine == "api":
        from . import engine_api
        return await engine_api.run(prompt, cwd, timeout_s, model=model,
                                    on_event=on_event, deadline=deadline,
                                    ask_registry=ask_registry, ask_token=ask_token)
```

Dan tambahkan parameter baru ke signature `run_engine`:

```python
                     ask_url: str = "", ask_token: str = "",
                     ask_registry=None,
                     deadline=None, on_event=None) -> RunResult:
```

`ask_registry` diabaikan cabang subprocess — CLI mendapatkan haknya lewat `ask_url` + `--mcp-config` seperti sebelumnya.

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `pytest tests/test_engine_runner.py tests/test_engine_stream.py -v`
Expected: PASS. Tidak ada test lama yang berubah.

- [ ] **Step 5: Commit**

```bash
git add hermes/engine_runner.py hermes/engine_stream.py tests/test_engine_runner.py tests/test_engine_stream.py
git commit -m "feat: dispatch the api engine in run_engine"
```

---

### Task 11: Config, orchestrator, sigil proyek

**Files:**
- Modify: `hermes/config.py:174` (+ validator baru di sekitar `:297`)
- Modify: `hermes/orchestrator.py:396` (`choose_engine`), `:812` (blok `tuning`), `:838` (`ask_here`), `:851` (`ask_kw`)
- Modify: `hermes/project_resolve.py:38`
- Test: `tests/test_config.py`, `tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `engine_runner.ASK_CAPABLE` (Task 10).
- Produces: `Settings.api_model`; `choose_engine` mengembalikan `"api"`; `parse_engine_ref` mengenali `!api` dan `!9router`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `tests/test_config.py`:

```python
def test_api_engine_is_a_valid_default_engine():
    from hermes.config import Settings
    assert Settings(default_engine="api").default_engine == "api"


def test_api_model_defaults_to_empty_meaning_the_chat_model():
    from hermes.config import Settings
    assert Settings().api_model == ""


def test_api_model_rejects_a_value_with_whitespace():
    import pytest
    from pydantic import ValidationError
    from hermes.config import Settings
    with pytest.raises(ValidationError):
        Settings(api_model="cc/claude opus 5")
```

Tambahkan ke `tests/test_orchestrator.py`:

```python
def test_choose_engine_honours_an_explicit_api_task_engine():
    from hermes.config import Settings
    from hermes.orchestrator import choose_engine
    assert choose_engine({}, Settings(), task_engine="api") == "api"


def test_choose_engine_honours_api_as_the_configured_default():
    from hermes.config import Settings
    from hermes.orchestrator import choose_engine
    assert choose_engine({}, Settings(default_engine="api")) == "api"


def test_auto_still_picks_a_cli_engine_in_phase_one():
    """Phase 1 is additive: `auto` must behave exactly as it did before."""
    from hermes.config import Settings
    from hermes.orchestrator import choose_engine
    assert choose_engine({"scope": "large"}, Settings()) == "antigravity"
    assert choose_engine({}, Settings()) == "claude"


def test_engine_sigil_accepts_api_and_9router():
    from hermes.project_resolve import parse_engine_ref
    assert parse_engine_ref("!api perbaiki login")[0] == "api"
    assert parse_engine_ref("!9router perbaiki login")[0] == "api"
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pytest tests/test_config.py -k api tests/test_orchestrator.py -k "api or sigil" -v`
Expected: FAIL — `ValidationError: default_engine ... Input should be 'claude', 'antigravity' or 'auto'`

- [ ] **Step 3: Implementasi minimal**

`hermes/config.py:174`:

```python
    default_engine: Literal["claude", "antigravity", "api", "auto"] = "auto"
```

Tepat di bawah `agy_model`:

```python
    # The 9Router model the in-process `api` engine drives. Empty falls back to
    # `model` — the same id the planner and chat already use, which is the
    # right default given they share one gateway and one key.
    api_model: str = ""
```

Di dekat validator lain (`config.py:297`):

```python
    @field_validator("api_model")
    @classmethod
    def _api_model_shape(cls, v: str) -> str:
        # Gateway model ids ('cc/claude-opus-5') carry no spaces; ASCII-only
        # catches smart quotes from copy-paste, same as the claude field.
        if v and (not v.isascii() or any(c.isspace() for c in v)):
            raise ValueError(
                "api model must be a single ASCII token, e.g. 'cc/claude-opus-5' "
                "— check for spaces or smart quotes")
        return v
```

`hermes/orchestrator.py:396`:

```python
def choose_engine(step: dict, settings: Settings, task_engine: str | None = None) -> str:
    if task_engine in ("claude", "antigravity", "api"):
        return task_engine
    if step.get("engine") in ("claude", "antigravity", "api"):
        return step["engine"]
    if settings.default_engine in ("claude", "antigravity", "api"):
        return settings.default_engine
    # Phase 1 leaves `auto` on the CLIs. Flipping this to "api" is phase 2, and
    # is gated on the manual comparison run recorded in the design spec.
    return "antigravity" if step.get("scope") == "large" else "claude"
```

Blok `tuning` (`orchestrator.py:812`), tambahkan cabang:

```python
            elif engine == "api" and self.settings.api_model:
                tuning["model"] = self.settings.api_model
```

`ask_here` (`orchestrator.py:838`) dan `ask_kw` (`:851`):

```python
            from .engine_runner import ASK_CAPABLE, STREAMING
            ...
            ask_here = ask is not None and engine in ASK_CAPABLE
            ...
                    ask_kw = {"deadline": deadline,
                              "ask_url": self.deps.get("ask_url", ""),
                              "ask_token": token,
                              "ask_registry": ask}
```

> Kenapa `ASK_CAPABLE` dan bukan `MCP_CONFIG_FLAG`: `ask_kw` juga membawa `deadline`. Membiarkan gerbangnya di `MCP_CONFIG_FLAG` berarti engine `api` kehilangan jam yang bisa dijeda **sekaligus** `ask_user`, dan hilangnya senyap.

`hermes/project_resolve.py:38`:

```python
_ENGINE_REF = re.compile(r"(?:^|(?<=\s))!(claude|agy|antigravity|api|9router|auto)\b", re.I)
```

Dan di `parse_engine_ref`, tepat setelah normalisasi `agy`:

```python
    if eng == "9router":
        eng = "api"
```

- [ ] **Step 4: Jalankan seluruh suite**

Run: `pytest -q`
Expected: PASS. 985 test lama tetap hijau, ditambah yang baru.

- [ ] **Step 5: Commit**

```bash
git add hermes/config.py hermes/orchestrator.py hermes/project_resolve.py tests/test_config.py tests/test_orchestrator.py
git commit -m "feat: let tasks and settings select the api engine"
```

---

### Task 12: Pilihan engine di web UI

**Files:**
- Modify: `web/src/api/types.ts:60`
- Modify: `web/src/views/ConfigEngines.tsx:121-122`
- Modify: `web/src/components/OfficeSessionChat.tsx:180-181`
- Modify: `web/src/views/Dashboard.tsx:1513`

**Interfaces:**
- Consumes: nilai `default_engine` dari backend (Task 11).
- Produces: tidak ada; ini daun.

- [ ] **Step 1: Lebarkan tipe**

`web/src/api/types.ts:60`:

```ts
  default_engine: 'claude' | 'antigravity' | 'api' | 'auto';
```

- [ ] **Step 2: Tambah opsi di panel setelan**

`web/src/views/ConfigEngines.tsx`, tepat setelah opsi antigravity:

```tsx
          <option value="api">9Router API (in-process, tanpa CLI)</option>
```

- [ ] **Step 3: Tambah opsi di pemilih engine office**

`web/src/components/OfficeSessionChat.tsx`, setelah opsi antigravity:

```tsx
                <option value="api">9Router</option>
```

- [ ] **Step 4: Masukkan `api` ke siklus toggle dashboard**

`web/src/views/Dashboard.tsx:1513` — siklus saat ini `auto → claude → antigravity → auto`. Jadikan empat langkah:

```tsx
                const nextEng = selectedEngine === 'auto' ? 'claude'
                  : selectedEngine === 'claude' ? 'antigravity'
                  : selectedEngine === 'antigravity' ? 'api' : 'auto';
```

- [ ] **Step 5: Jalankan test web dan build**

Run:
```powershell
cd web; npm test; npm run build
```
Expected: lulus. Tidak ada test web yang menyebut `api` — perubahan ini murni penambahan opsi.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/types.ts web/src/views/ConfigEngines.tsx web/src/components/OfficeSessionChat.tsx web/src/views/Dashboard.tsx
git commit -m "feat: offer the 9Router api engine in the web UI"
```

---

## Setelah Fase 1

Fase 1 selesai ketika seluruh suite hijau dan engine `api` bisa dipilih. Yang **belum** dilakukan, sesuai spec:

- **Fase 2** (jadikan default) menunggu gerbang manual: satu task nyata end-to-end di repo scratch, dibandingkan `!api` lawan `!claude`. Di sana juga diselesaikan dua soal akuntansi angka gateway — ketidakcocokan `prompt_tokens` streaming vs non-streaming (2097 vs 4771 pada probe), dan apakah cost cap dihidupkan lagi dengan tabel harga.
- **Fase 3** (hapus CLI) menunggu bukti dari fase 2. Catatan untuk perencananya: `ask_server.resolve_ask`, `_norm_options`, `NEED_QUESTION` dan `TOOL_DESCRIPTION` dipakai oleh `engine_api` (Task 9), jadi penghapusan `ask_server.py` di fase 3 adalah **memindahkan keempatnya ke `ask.py`** lalu membuang transport MCP-nya — bukan menghapus seluruh berkas seperti tertulis di spec.
