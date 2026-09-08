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

import asyncio
import fnmatch
import re
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
    out = []
    for p in sorted(root.glob(pattern)):
        if not p.is_file():
            continue

        try:
            rel_path = p.relative_to(root)
            rel_str = rel_path.as_posix()
            # Path.relative_to succeeds on .. paths, so we must validate through
            # _resolve_in to ensure the path doesn't escape the project directory.
            _resolve_in(root, rel_str)
        except ValueError:
            # Path escapes the project directory; skip it
            continue

        if any(part in _SKIP_DIRS for part in rel_path.parts[:-1]):
            continue
        out.append(_rel(root, p))
    return "\n".join(out) if out else NO_MATCHES


# Shorter than the step's own timeout on purpose: one wedged command must not
# consume the whole code step's clock.
BASH_TIMEOUT_S = 180
# Per call. Large enough for a real test run's tail, small enough that a
# runaway build log cannot fill the turn or the trace row.
MAX_OUTPUT_CHARS = 8000


def _truncate_output(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    # The marker occupies part of the cap, and its width varies with the digit
    # count, so the budget is computed from a worst-case rendering rather than
    # guessed. Without this, an input a few chars over the cap comes back
    # LONGER than it went in — a truncator that lengthens its input.
    budget = MAX_OUTPUT_CHARS - len(f"\n... [truncated {len(text)} chars] ...\n")
    keep = max(0, budget // 2)
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
