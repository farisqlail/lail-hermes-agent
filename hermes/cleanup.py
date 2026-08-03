"""Removing what a deleted conversation leaves on disk.

`Store.delete_session` empties the tables, but every byte a conversation
produced lives in the filesystem: engine transcripts and APKs under
`artifacts/<task-id>/`, and (next) uploaded images under `uploads/<conv-id>/`.
Those were never deleted — a Flutter build alone is 50-100 MB of APK that
outlived the task, the chat and the session row.

Kept apart from `session_store` on purpose: that module owns SQLite and nothing
else, and these functions are pure filesystem work that has to be testable
against a tmp_path with no database in sight.

Every function here is best-effort by design. Losing a directory must never
abort the database delete it accompanies — a file held open by Explorer or an
antivirus scanner would otherwise make a conversation impossible to delete.
"""
from __future__ import annotations
import shutil
from pathlib import Path


def purge(base: Path, name: str) -> bool:
    """Delete `base/name` and everything under it. True if something went.

    `name` reaches this from a URL path segment (`DELETE /api/sessions/{id}`),
    so it is never joined blindly: the resolved path must still sit under
    `base`, or nothing is deleted. Without that check a name like `..\\..\\config`
    would delete a directory the caller never meant to expose — the same guard,
    and the same reason, as the artifact download endpoint.
    """
    if not name or name in (".", ".."):
        return False
    try:
        resolved = (base / name).resolve()
        resolved.relative_to(base.resolve())
    except (OSError, ValueError):
        return False          # traversal, or a path the OS cannot resolve
    try:
        if not resolved.is_dir():
            return False
        # ignore_errors covers the common case (one locked file inside);
        # the except covers rmtree failing outright, e.g. no permission on
        # the directory itself. Both must leave the caller's delete standing.
        shutil.rmtree(resolved, ignore_errors=True)
    except OSError as e:
        print(f"Could not remove {resolved}: {e}")
        return False
    return True


def purge_orphans(base: Path, keep: set[str]) -> list[str]:
    """Delete every directory under `base` whose name is not in `keep`.

    The startup sweep for conversations that were deleted before this module
    existed, and for uploads whose request died mid-flight. `keep` must include
    the default conversation id even though it has no `sessions` row — it holds
    real messages, and keying the sweep on the sessions table alone would
    delete the main thread's images on the next restart.

    Returns what it removed, so the caller can say so rather than working
    silently.
    """
    if not base.is_dir():
        return []
    removed = []
    for child in base.iterdir():
        if child.is_dir() and child.name not in keep and purge(base, child.name):
            removed.append(child.name)
    return removed
