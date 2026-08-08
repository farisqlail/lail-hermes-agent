"""Version the vault with git, so the agent's knowledge has a history.

The vault holds facts, the task archive and project notes — durable knowledge
that until now had no backup and no way to see what changed or recover a note an
edit clobbered. A git repo gives all three for free, and it is the workflow
Obsidian users already expect for a vault.

Everything here is best-effort: git may not be installed on a fresh machine, and
a versioning failure must never take down a fact write or a finished task. Every
call swallows its errors and reports success/failure as a bool the caller is
free to ignore. Identity is passed inline (`-c user.*`) so a commit never
depends on — or writes — the machine's global git config.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

_NAME = "Hermes"
_EMAIL = "hermes@localhost"
# Obsidian rewrites these constantly and they carry no knowledge; tracking them
# would make every commit noisy and conflict across machines.
_GITIGNORE = ".obsidian/workspace*\n.obsidian/cache\n.trash/\n"


def _git(vault: Path, *args: str) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(
            ["git", "-C", str(vault),
             "-c", f"user.name={_NAME}", "-c", f"user.email={_EMAIL}",
             *args],
            capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None  # git absent or wedged — versioning is optional


def is_repo(vault: Path) -> bool:
    return (Path(vault) / ".git").exists()


def ensure_repo(vault: Path) -> bool:
    """Make the vault a git repo if it is not one already. Idempotent."""
    vault = Path(vault)
    if not vault.is_dir() or is_repo(vault):
        return is_repo(vault)
    if _git(vault, "init") is None:
        return False
    gi = vault / ".gitignore"
    if not gi.exists():
        gi.write_text(_GITIGNORE, encoding="utf-8")
    autocommit(vault, "vault: initial snapshot")
    return is_repo(vault)


def autocommit(vault: Path, message: str) -> bool:
    """Stage everything and commit, if there is anything to commit.

    Returns True when a commit was made, False otherwise (nothing changed, git
    missing, or an error) — never raises.
    """
    vault = Path(vault)
    if not is_repo(vault):
        return False
    if _git(vault, "add", "-A") is None:
        return False
    # `diff --cached --quiet` exits 1 when staged changes exist; anything else
    # (0 = nothing staged, or git error) means there is nothing to commit.
    staged = _git(vault, "diff", "--cached", "--quiet")
    if staged is None or staged.returncode != 1:
        return False
    done = _git(vault, "commit", "-m", message)
    return bool(done and done.returncode == 0)
