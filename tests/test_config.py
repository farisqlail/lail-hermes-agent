import pytest
from pydantic import ValidationError
from hermes import config, paths

def test_defaults_when_missing(hermes_home):
    paths.ensure_dirs()
    s = config.load_settings()
    assert s.nvidia_base_url == "https://integrate.api.nvidia.com/v1"
    assert s.default_engine == "auto"
    assert s.mcp_servers == []

def test_settings_roundtrip(hermes_home):
    paths.ensure_dirs()
    s = config.load_settings()
    s.model = "deepseek-ai/deepseek-v3"
    s.allowed_user_ids = [123, 456]
    s.mcp_servers.append(config.McpServer(name="fs", type="stdio", command="npx"))
    config.save_settings(s)
    s2 = config.load_settings()
    assert s2.model == "deepseek-ai/deepseek-v3"
    assert s2.allowed_user_ids == [123, 456]
    assert s2.mcp_servers[0].name == "fs"

def test_secrets_roundtrip(hermes_home):
    paths.ensure_dirs()
    config.save_secrets(config.Secrets(nvidia_api_key="nv-k", telegram_bot_token="tg-t"))
    sec = config.load_secrets()
    assert sec.nvidia_api_key == "nv-k"
    assert sec.telegram_bot_token == "tg-t"

def test_projects_defaults_empty():
    assert config.Settings().projects == {}


def test_projects_accepts_absolute_paths(tmp_path):
    s = config.Settings(projects={"myprofit": str(tmp_path)})
    assert s.projects["myprofit"] == str(tmp_path)


def test_projects_rejects_relative_path():
    with pytest.raises(ValidationError, match="absolute"):
        config.Settings(projects={"myprofit": "relative/path"})


@pytest.mark.parametrize("name", ["..", ".ssh", "-flag", "has space", "a/b", ""])
def test_projects_rejects_bad_names(name, tmp_path):
    with pytest.raises(ValidationError, match="project name"):
        config.Settings(projects={name: str(tmp_path)})


def test_projects_missing_path_still_loads(tmp_path):
    """A registered folder that no longer exists must NOT break Settings
    construction — load_settings() runs this validator at startup, and a
    dead path must fail one task, not the whole daemon."""
    gone = tmp_path / "was-here"
    s = config.Settings(projects={"gone": str(gone)})
    assert s.projects["gone"] == str(gone)


def test_projects_roundtrip(hermes_home, tmp_path):
    paths.ensure_dirs()
    s = config.load_settings()
    s.projects = {"myprofit": str(tmp_path)}
    config.save_settings(s)
    assert config.load_settings().projects == {"myprofit": str(tmp_path)}
