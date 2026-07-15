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
