import pytest
from pathlib import Path
from hermes.config import Settings
from hermes.project_resolve import (
    parse_project_ref, resolve_project, ProjectNotFound, ProjectPathMissing)


@pytest.mark.parametrize("text,name,cleaned", [
    ("@myprofit fix login",       "myprofit", "fix login"),
    ("fix login @myprofit",       "myprofit", "fix login"),
    ("fix @myprofit login",       "myprofit", "fix login"),
    ("@myprofit",                 "myprofit", ""),
    ("fix login bug",             None,       "fix login bug"),
    ("email budi@example.com",    None,       "email budi@example.com"),
    ("@my-proj.v2_x fix",         "my-proj.v2_x", "fix"),
    ("bare @ sign",               None,       "bare @ sign"),
])
def test_parse_project_ref(text, name, cleaned):
    assert parse_project_ref(text) == (name, cleaned)


def test_parse_only_first_sigil_is_the_ref():
    """A task targets one project. A later @word is prose and must survive."""
    name, cleaned = parse_project_ref("@myprofit reply to @budi in changelog")
    assert name == "myprofit"
    assert cleaned == "reply to @budi in changelog"


def test_resolve_hit(tmp_path):
    s = Settings(projects={"myprofit": str(tmp_path)})
    assert resolve_project("myprofit", s) == Path(tmp_path)


def test_resolve_unregistered_lists_names(tmp_path):
    s = Settings(projects={"myprofit": str(tmp_path), "hermes": str(tmp_path)})
    with pytest.raises(ProjectNotFound) as e:
        resolve_project("myprofits", s)
    msg = str(e.value)
    assert "myprofits" in msg
    assert "myprofit" in msg and "hermes" in msg   # lists what IS registered


def test_resolve_unregistered_with_empty_registry():
    with pytest.raises(ProjectNotFound) as e:
        resolve_project("myprofit", Settings())
    assert "no projects are registered" in str(e.value).lower()


def test_resolve_registered_but_gone(tmp_path):
    gone = tmp_path / "moved-away"
    s = Settings(projects={"myprofit": str(gone)})
    with pytest.raises(ProjectPathMissing) as e:
        resolve_project("myprofit", s)
    assert str(gone) in str(e.value)


def test_resolve_registered_path_is_a_file(tmp_path):
    f = tmp_path / "not-a-dir.txt"
    f.write_text("x")
    s = Settings(projects={"myprofit": str(f)})
    with pytest.raises(ProjectPathMissing):
        resolve_project("myprofit", s)


def test_traversal_name_is_just_a_miss():
    """@../../etc is not a traversal attempt — the name is a dict key and is
    never joined to a path. It is an ordinary lookup miss."""
    with pytest.raises(ProjectNotFound):
        resolve_project("../../etc", Settings(projects={}))
