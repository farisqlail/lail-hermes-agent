from hermes import paths

def test_home_from_env(hermes_home):
    assert paths.home() == hermes_home

def test_ensure_dirs_creates_tree(hermes_home):
    paths.ensure_dirs()
    assert paths.config_dir().is_dir()
    assert paths.projects_dir().is_dir()
    assert paths.artifacts_dir().is_dir()
    assert paths.skills_dir().is_dir()
    assert paths.db_path() == hermes_home / "hermes.db"

def test_ensure_vault_seeds_a_valid_obsidian_vault(hermes_home):
    paths.ensure_vault()
    # The obsidian MCP server accepts a folder only when this file exists.
    assert (paths.vault_dir() / ".obsidian" / "app.json").is_file()
    assert (paths.vault_dir() / "INDEX.md").is_file()

def test_ensure_vault_leaves_existing_files_untouched(hermes_home):
    idx = paths.vault_dir() / "INDEX.md"
    idx.parent.mkdir(parents=True, exist_ok=True)
    idx.write_text("mine", encoding="utf-8")
    paths.ensure_vault()
    assert idx.read_text(encoding="utf-8") == "mine"
