from pathlib import Path

from hermes import cleanup, main, paths
from hermes.session_store import Store


def _dir_with_file(base: Path, name: str, content=b"x") -> Path:
    d = base / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "file.bin").write_bytes(content)
    return d


def test_purge_removes_the_directory_and_its_contents(tmp_path):
    d = _dir_with_file(tmp_path, "conv-1")
    assert cleanup.purge(tmp_path, "conv-1") is True
    assert not d.exists()


def test_purge_refuses_to_escape_its_base(tmp_path):
    """`session_id` arrives as a URL path segment. Without the containment
    check, deleting a conversation could delete the config directory."""
    outside = _dir_with_file(tmp_path, "secrets")
    base = tmp_path / "uploads"
    base.mkdir()
    for name in ("../secrets", "..", ".", "", "..\\secrets"):
        assert cleanup.purge(base, name) is False
    assert outside.exists()


def test_purge_of_something_absent_is_not_an_error(tmp_path):
    assert cleanup.purge(tmp_path, "never-existed") is False


def test_purge_orphans_keeps_what_is_still_referenced(tmp_path):
    for name in ("live", "web", "dead"):
        _dir_with_file(tmp_path, name)
    removed = cleanup.purge_orphans(tmp_path, {"live", "web"})
    assert removed == ["dead"]
    assert (tmp_path / "live").exists() and (tmp_path / "web").exists()
    assert not (tmp_path / "dead").exists()


def test_purge_orphans_on_a_missing_base_is_empty(tmp_path):
    assert cleanup.purge_orphans(tmp_path / "nope", set()) == []


def test_startup_sweep_spares_the_default_conversation(hermes_home):
    """"web" holds real messages but has no `sessions` row. Keying the sweep on
    the sessions table alone deleted the main thread's files every restart."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.add_message("web", "user", "halo")
    store.create_session("sess-live", "Percakapan")
    store.add_message("sess-live", "user", "hai")
    store.create_task("task-live", 0, "kerja", session_id="sess-live")

    for name in ("web", "sess-live", "sess-gone"):
        _dir_with_file(paths.uploads_dir(), name)
    for name in ("task-live", "task-gone"):
        _dir_with_file(paths.artifacts_dir(), name)

    uploads, artifacts = main.sweep_orphan_files(store)

    assert uploads == ["sess-gone"]
    assert artifacts == ["task-gone"]
    assert (paths.uploads_dir() / "web").exists()
    assert (paths.uploads_dir() / "sess-live").exists()
    assert (paths.artifacts_dir() / "task-live").exists()


def test_startup_sweep_survives_a_broken_store(hermes_home, capsys):
    """A sweep is tidiness. It must never stop Hermes from booting."""
    class Broken:
        def conversation_ids(self): raise OSError("db is on fire")
    assert main.sweep_orphan_files(Broken()) == ([], [])
    assert "Could not sweep orphan files" in capsys.readouterr().out
