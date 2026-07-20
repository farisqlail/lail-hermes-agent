from __future__ import annotations
import asyncio
from pathlib import Path

from . import tg_format

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


# ---------------------------------------------------------------------------
# Change summary: "apa saja yang diubah" when a task finishes.
#
# The plan: snapshot the project state the instant the task starts, then at the
# end diff against that snapshot. Diffing against a start snapshot (not bare
# HEAD) is what isolates *this task's* work: a project that was already dirty
# before the task must not have its pre-existing edits counted as task output.

async def _untracked(path: Path) -> set[str]:
    r = await _run_git(["ls-files", "--others", "--exclude-standard"], path)
    if r is None or r[0] != 0:
        return set()
    return {ln for ln in r[1].decode(errors="replace").splitlines() if ln.strip()}


async def start_snapshot(path: Path) -> tuple[str, frozenset[str]] | None:
    """Capture the project's state at task start, or None if it is not a git
    work tree (so there is nothing to diff against — caller shows no summary).

    `git stash create` writes a commit object for the current tracked+staged
    state WITHOUT touching the working tree or the stash list; on a clean tree
    it prints nothing, so fall back to HEAD. Untracked files are captured
    separately, since stash-create ignores them — the end diff subtracts this
    set so a file that was already untracked before the task is not reported as
    newly added by it.
    """
    created = await _run_git(["stash", "create"], path)
    if created is None or created[0] != 0:
        return None                      # not a repo, or git unavailable
    sha = created[1].decode(errors="replace").strip()
    if not sha:
        head = await _run_git(["rev-parse", "HEAD"], path)
        if head is None or head[0] != 0:
            return None                  # a repo with no commits yet
        sha = head[1].decode(errors="replace").strip()
        if not sha:
            return None
    return (sha, frozenset(await _untracked(path)))


_SUMMARY_MAX_FILES = 20

# Column budget: a phone renders roughly 40 monospace chars before wrapping,
# and a wrapped row destroys the alignment of the whole block.
_SUMMARY_HEADERS = ["St", "File", "+", "-"]
_SUMMARY_WIDTHS = [2, 22, 5, 5]


async def summarize_since(path: Path, snapshot: tuple[str, frozenset[str]] | None
                          ) -> str | None:
    """A short, human-readable list of files changed since `snapshot`.

    None when there is nothing to say — no snapshot, git gone, or a genuinely
    empty change set. Never raises: a summary is a courtesy at task end, never
    allowed to fail the (already successful) task.
    """
    if snapshot is None:
        return None
    base, start_untracked = snapshot
    names = await _run_git(["diff", "--name-status", base], path)
    nums = await _run_git(["diff", "--numstat", base], path)
    if names is None or names[0] != 0 or nums is None or nums[0] != 0:
        return None

    # name-status: "M\tpath", or for a rename "R100\told\tnew" -> report new.
    status: dict[str, str] = {}
    for line in names[1].decode(errors="replace").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            status[parts[-1]] = parts[0][0]

    # numstat: "added\tdeleted\tpath"; a binary file reports "-\t-".
    files: list[tuple[str, str, int, int]] = []
    total_add = total_del = 0
    for line in nums[1].decode(errors="replace").splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        a, d, p = parts[0], parts[1], parts[-1]
        add = 0 if a == "-" else int(a)
        dele = 0 if d == "-" else int(d)
        total_add += add
        total_del += dele
        files.append((status.get(p, "M"), p, add, dele))

    # New files the task created that were not already sitting untracked.
    for p in sorted(set(await _untracked(path)) - start_untracked):
        files.append(("A", p, 0, 0))

    if not files:
        return None

    files.sort(key=lambda f: f[1])
    shown = files[:_SUMMARY_MAX_FILES]
    rows = [[code, p, f"+{add}", f"-{dele}"] for code, p, add, dele in shown]
    table = tg_format.table(_SUMMARY_HEADERS, rows, _SUMMARY_WIDTHS)
    out = [f"Perubahan ({len(files)} file):", tg_format.mono_block(table)]
    if len(files) > _SUMMARY_MAX_FILES:
        out.append(f"…dan {len(files) - _SUMMARY_MAX_FILES} file lainnya")
    out.append(f"Total: +{total_add} -{total_del}")
    return "\n".join(out)
