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


_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def cleanup_old_images(dirs: list[Path], max_age_days: int) -> dict:
    """Delete image files in `dirs` whose modification time is older than `max_age_days`.

    If `max_age_days` <= 0, cleanup is disabled and returns zero count.
    Never raises; best-effort file removal.
    Returns {"deleted_count": N, "freed_bytes": total_bytes, "removed_files": [path_str, ...]}.
    """
    if max_age_days <= 0:
        return {"deleted_count": 0, "freed_bytes": 0, "removed_files": []}

    import time
    now = time.time()
    cutoff_seconds = max_age_days * 86400
    deleted_count = 0
    freed_bytes = 0
    removed_files = []

    for d in dirs:
        if not d or not d.exists():
            continue
        try:
            for p in d.rglob("*"):
                if p.is_file() and p.suffix.lower() in _IMAGE_EXTENSIONS:
                    try:
                        mtime = p.stat().st_mtime
                        if now - mtime > cutoff_seconds:
                            sz = p.stat().st_size
                            p.unlink(missing_ok=True)
                            deleted_count += 1
                            freed_bytes += sz
                            removed_files.append(str(p))
                    except OSError as e:
                        print(f"Could not check/remove image file {p}: {e}")
        except OSError as e:
            print(f"Could not scan directory {d} for old images: {e}")

    return {
        "deleted_count": deleted_count,
        "freed_bytes": freed_bytes,
        "removed_files": removed_files,
    }
