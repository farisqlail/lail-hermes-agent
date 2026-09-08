"""Tool file/exec untuk engine `api`.

Scoping adalah alasan modul ini ada. `claude -p` dan MCP `pc` sama-sama
berjalan tanpa batas folder; step code tidak punya alasan bisa menyentuh
berkas di luar proyek yang sedang dikerjakan.
"""
import sys
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


async def test_edit_replaces_a_unique_string(tmp_path):
    f = tmp_path / "a.py"
    f.write_text("x = 1\ny = 2\n", encoding="utf-8")
    await agent_tools._edit(tmp_path, "a.py", "x = 1", "x = 99")
    assert f.read_text(encoding="utf-8") == "x = 99\ny = 2\n"


async def test_edit_refuses_a_non_unique_string(tmp_path):
    """Replacing the first of several matches is how an edit tool silently
    corrupts a file: the model asked for one change and got a different one."""
    f = tmp_path / "a.py"
    f.write_text("v = 1\nv = 1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="appears 2 times"):
        await agent_tools._edit(tmp_path, "a.py", "v = 1", "v = 2")
    assert f.read_text(encoding="utf-8") == "v = 1\nv = 1\n"


async def test_edit_replace_all_is_opt_in(tmp_path):
    f = tmp_path / "a.py"
    f.write_text("v = 1\nv = 1\n", encoding="utf-8")
    await agent_tools._edit(tmp_path, "a.py", "v = 1", "v = 2", replace_all=True)
    assert f.read_text(encoding="utf-8") == "v = 2\nv = 2\n"


async def test_edit_missing_string_says_so(tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="not found"):
        await agent_tools._edit(tmp_path, "a.py", "nope", "y")


async def test_edit_outside_project_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="escapes project directory"):
        await agent_tools._edit(tmp_path, "../a.py", "a", "b")


async def test_grep_reports_file_and_line(tmp_path):
    (tmp_path / "a.py").write_text("import os\nvalue = 42\n", encoding="utf-8")
    out = await agent_tools._grep(tmp_path, r"value\s*=")
    assert "a.py:2" in out and "value = 42" in out


async def test_grep_filters_by_glob(tmp_path):
    (tmp_path / "a.py").write_text("needle\n", encoding="utf-8")
    (tmp_path / "a.txt").write_text("needle\n", encoding="utf-8")
    out = await agent_tools._grep(tmp_path, "needle", glob="*.py")
    assert "a.py" in out and "a.txt" not in out


async def test_grep_no_match_says_so_rather_than_returning_empty(tmp_path):
    """hub-style callers treat empty output as failure; a search that
    legitimately found nothing must not read as a broken tool."""
    (tmp_path / "a.py").write_text("x\n", encoding="utf-8")
    assert "no matches" in (await agent_tools._grep(tmp_path, "zzz")).lower()


async def test_grep_path_outside_project_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="escapes project directory"):
        await agent_tools._grep(tmp_path, "x", path="..")


async def test_glob_lists_matching_files_relative_to_project(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.py").write_text("", encoding="utf-8")
    out = await agent_tools._glob(tmp_path, "**/*.py")
    assert "src/a.py" in out.replace("\\", "/")


async def test_glob_no_match_says_so(tmp_path):
    assert "no matches" in (await agent_tools._glob(tmp_path, "**/*.rs")).lower()


async def test_glob_cannot_escape_the_project_root(tmp_path):
    """A glob pattern that would escape the project (e.g. "../*.py") must not
    return files outside the project directory, even though Path.glob() will
    find them and Path.relative_to() silently succeeds on .. paths."""
    outside = tmp_path.parent / "escape_target.py"
    outside.write_text("escaped", encoding="utf-8")
    try:
        out = await agent_tools._glob(tmp_path, "../*.py")
        assert "escape_target.py" not in out
    finally:
        outside.unlink()


async def test_bash_runs_in_the_project_directory(tmp_path):
    (tmp_path / "marker.txt").write_text("", encoding="utf-8")
    out = await agent_tools._bash(tmp_path, f'"{sys.executable}" -c "import os;print(os.listdir())"')
    assert "marker.txt" in out


async def test_bash_reports_a_non_zero_exit_without_raising(tmp_path):
    out = await agent_tools._bash(tmp_path, f'"{sys.executable}" -c "raise SystemExit(3)"')
    assert "exit code 3" in out


async def test_bash_merges_stderr_into_the_output(tmp_path):
    out = await agent_tools._bash(
        tmp_path, f'"{sys.executable}" -c "import sys;sys.stderr.write(\'boom\')"')
    assert "boom" in out


async def test_bash_times_out_and_says_so(tmp_path):
    out = await agent_tools._bash(
        tmp_path, f'"{sys.executable}" -c "import time;time.sleep(10)"', timeout_s=1)
    assert "timed out" in out


async def test_bash_truncates_large_output_with_a_visible_marker(tmp_path):
    """Silent truncation would let the model reason about output it never
    saw the end of."""
    out = await agent_tools._bash(
        tmp_path, f'"{sys.executable}" -c "print(\'x\' * 50000)"')
    assert len(out) < 50000
    assert "truncated" in out


async def test_bash_truncation_never_returns_more_than_it_received(tmp_path):
    """A truncator that lengthens its input violates the cap. Exercise the
    boundary band (cap+1 to cap+29 chars) where the marker's variable width
    can cause this bug."""
    # Generate output of exactly MAX_OUTPUT_CHARS + 1
    output_size = agent_tools.MAX_OUTPUT_CHARS + 1
    out = await agent_tools._bash(
        tmp_path, f'"{sys.executable}" -c "print(\'y\' * {output_size})"')
    assert len(out) <= agent_tools.MAX_OUTPUT_CHARS


def test_tool_names_match_claudes_exactly():
    """engine_stream._EDIT_TOOLS matches literal names. Renaming Edit or
    Write here empties the edited-files list with no error at all."""
    from hermes.engine_stream import _EDIT_TOOLS
    names = {t["function"]["name"] for t in agent_tools.TOOLS}
    assert names == {"Read", "Edit", "Write", "Bash", "Grep", "Glob"}
    assert {"Edit", "Write"} <= _EDIT_TOOLS


def test_every_tool_declares_an_object_schema():
    for t in agent_tools.TOOLS:
        fn = t["function"]
        assert t["type"] == "function"
        assert fn["description"].strip()
        assert fn["parameters"]["type"] == "object"


async def test_call_dispatches_and_reports_ok(tmp_path):
    (tmp_path / "a.txt").write_text("isi", encoding="utf-8")
    text, ok = await agent_tools.call("Read", {"file_path": "a.txt"}, tmp_path)
    assert ok and text == "isi"


async def test_call_turns_a_scope_violation_into_a_failed_result(tmp_path):
    """The model must be told and allowed to correct itself; an exception
    escaping here would kill the whole engine run instead."""
    text, ok = await agent_tools.call("Read", {"file_path": "../x"}, tmp_path)
    assert not ok and "escapes project directory" in text


async def test_call_unknown_tool_is_a_failed_result(tmp_path):
    text, ok = await agent_tools.call("Nope", {}, tmp_path)
    assert not ok and "unknown tool" in text.lower()


async def test_call_missing_required_argument_is_a_failed_result(tmp_path):
    text, ok = await agent_tools.call("Read", {}, tmp_path)
    assert not ok and "file_path" in text
