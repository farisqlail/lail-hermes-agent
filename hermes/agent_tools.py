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
