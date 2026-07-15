from __future__ import annotations
import asyncio
from pathlib import Path

# This is a local `status`/`check-ignore` call, not a network op -- a few
# seconds is generous. If git hangs (e.g. a credential or hook prompt), the
# safety check must not block the caller forever.
_GIT_TIMEOUT_S = 5.0


async def _run_git(args: list[str], cwd: Path) -> tuple[int, bytes] | None:
    """Run `git *args` with cwd=cwd. Returns (returncode, stdout) on
    completion, or None if the process could not be started/finished."""
    try:
        p = await asyncio.create_subprocess_exec(
            "git", *args, cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    except (OSError, NotImplementedError):
        # OSError (FileNotFoundError is a subclass) -> no git binary, or
        # cwd doesn't exist/isn't a directory. NotImplementedError -> the
        # running event loop has no subprocess support.
        return None
    try:
        out, _ = await asyncio.wait_for(p.communicate(), timeout=_GIT_TIMEOUT_S)
    except asyncio.TimeoutError:
        p.kill()
        await p.wait()
        return None
    return (p.returncode, out)


async def git_dirty(path: Path) -> bool | None:
    """Does `path` have uncommitted work?

    True  -> modified or untracked files; a bad run here is not recoverable.
    False -> clean tree; `git checkout .` is the undo button.
    None  -> no undo is available at all: not a git repo, git is
             unavailable, or `path` is git-ignored by an enclosing repo (so
             it sits inside a work tree without being under git's
             protection). Callers should treat this like True for gating
             purposes, while still being able to say *why* in the message.
    """
    # `git status --porcelain` walks up to the nearest .git, so it answers
    # "is there a repo above me", not "does git actually track this path".
    # A path that is itself git-ignored gets an empty, successful status
    # from the enclosing repo -- check that separately first.
    ignore_result = await _run_git(["check-ignore", "-q", "."], path)
    if ignore_result is None:
        return None
    ignore_rc, _ = ignore_result
    if ignore_rc == 0:
        return None                      # path is ignored by the enclosing repo
    if ignore_rc > 1:
        return None                      # not a work tree, or check-ignore itself failed

    # Deliberately no `-- .` pathspec: this reports the whole enclosing
    # repo's status, not just this subdirectory. Over-reporting dirtiness
    # is the safe direction; scoping down could under-report it.
    status_result = await _run_git(["status", "--porcelain"], path)
    if status_result is None:
        return None
    status_rc, out = status_result
    if status_rc != 0:
        return None                      # not a work tree
    return bool(out.strip())
