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
