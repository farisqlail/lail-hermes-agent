from hermes import paths

def test_home_from_env(hermes_home):
    assert paths.home() == hermes_home

def test_ensure_dirs_creates_tree(hermes_home):
    paths.ensure_dirs()
    assert paths.config_dir().is_dir()
    assert paths.projects_dir().is_dir()
    assert paths.artifacts_dir().is_dir()
    assert paths.db_path() == hermes_home / "hermes.db"
