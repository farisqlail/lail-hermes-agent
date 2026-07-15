import asyncio
from hermes.git_status import git_dirty


async def _git(cwd, *args):
    p = await asyncio.create_subprocess_exec(
        "git", *args, cwd=str(cwd),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    await p.wait()
    assert p.returncode == 0, f"git {' '.join(args)} failed"


async def _repo(path):
    path.mkdir(parents=True, exist_ok=True)
    await _git(path, "init", "-q")
    await _git(path, "config", "user.email", "t@example.com")
    await _git(path, "config", "user.name", "Test")
    (path / "a.txt").write_text("one")
    await _git(path, "add", "a.txt")
    await _git(path, "commit", "-q", "-m", "init")
    return path


async def test_clean_repo_is_false(tmp_path):
    repo = await _repo(tmp_path / "clean")
    assert await git_dirty(repo) is False


async def test_modified_file_is_dirty(tmp_path):
    repo = await _repo(tmp_path / "modified")
    (repo / "a.txt").write_text("changed")
    assert await git_dirty(repo) is True


async def test_untracked_file_is_dirty(tmp_path):
    repo = await _repo(tmp_path / "untracked")
    (repo / "new.txt").write_text("new")
    assert await git_dirty(repo) is True


async def test_not_a_repo_is_none(tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()
    assert await git_dirty(plain) is None


async def test_missing_dir_is_none(tmp_path):
    assert await git_dirty(tmp_path / "does-not-exist") is None


async def test_ignored_subdir_in_ancestor_repo_is_none(tmp_path):
    # The repo itself is clean, but `path` is a directory the repo
    # deliberately does not track. Git offers no undo for it, so this must
    # be None -- not False, which would falsely claim git can restore it.
    repo = await _repo(tmp_path / "outer")
    (repo / ".gitignore").write_text("ignored/\n")
    await _git(repo, "add", ".gitignore")
    await _git(repo, "commit", "-q", "-m", "add gitignore")
    ignored_dir = repo / "ignored"
    ignored_dir.mkdir()
    (ignored_dir / "file.txt").write_text("stuff git will never see")
    assert await git_dirty(ignored_dir) is None


async def test_tracked_subdir_of_clean_repo_is_false(tmp_path):
    repo = await _repo(tmp_path / "clean_subdir")
    subdir = repo / "sub"
    subdir.mkdir()
    (subdir / "b.txt").write_text("two")
    await _git(repo, "add", "sub/b.txt")
    await _git(repo, "commit", "-q", "-m", "add sub")
    assert await git_dirty(subdir) is False


async def test_tracked_subdir_of_dirty_repo_is_true(tmp_path):
    repo = await _repo(tmp_path / "dirty_subdir")
    subdir = repo / "sub"
    subdir.mkdir()
    (subdir / "b.txt").write_text("two")
    await _git(repo, "add", "sub/b.txt")
    await _git(repo, "commit", "-q", "-m", "add sub")
    (repo / "a.txt").write_text("modified elsewhere in the same repo")
    assert await git_dirty(subdir) is True
