"""Best-effort git versioning of the vault."""
import shutil

import pytest

from hermes import vault_git

pytestmark = pytest.mark.skipif(shutil.which("git") is None,
                                reason="git not installed")


def test_ensure_repo_inits_and_snapshots(tmp_path):
    v = tmp_path / "vault"
    v.mkdir()
    (v / "INDEX.md").write_text("hi", encoding="utf-8")
    assert vault_git.ensure_repo(v)
    assert (v / ".git").is_dir()
    assert (v / ".gitignore").is_file()
    # The initial snapshot is a real commit.
    log = vault_git._git(v, "log", "--oneline")
    assert log.returncode == 0 and log.stdout.strip()


def test_ensure_repo_is_idempotent(tmp_path):
    v = tmp_path / "vault"
    v.mkdir()
    assert vault_git.ensure_repo(v)
    assert vault_git.ensure_repo(v)  # second call must not fail


def test_autocommit_only_when_changed(tmp_path):
    v = tmp_path / "vault"
    v.mkdir()
    vault_git.ensure_repo(v)
    (v / "facts").mkdir()
    (v / "facts" / "a.md").write_text("Faris", encoding="utf-8")
    assert vault_git.autocommit(v, "add fact") is True
    assert vault_git.autocommit(v, "noop") is False  # nothing changed


def test_autocommit_on_non_repo_is_a_noop(tmp_path):
    v = tmp_path / "plain"
    v.mkdir()
    assert vault_git.autocommit(v, "x") is False
