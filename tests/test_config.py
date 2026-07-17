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

def test_engine_tuning_defaults_off():
    s = config.Settings()
    assert s.claude_model == ""
    assert s.claude_effort == ""
    assert s.agy_model == ""


def test_claude_effort_rejects_unknown_level():
    with pytest.raises(ValidationError):
        config.Settings(claude_effort="turbo")


def test_claude_model_rejects_whitespace_and_non_ascii():
    with pytest.raises(ValidationError, match="single ASCII token"):
        config.Settings(claude_model="opus 4")
    with pytest.raises(ValidationError, match="single ASCII token"):
        config.Settings(claude_model="opus’")   # smart quote from copy-paste


def test_agy_model_accepts_display_names():
    """agy models ARE display names — agy's own settings.json stores
    "Gemini 3.5 Flash (High)". Spaces must not be rejected here."""
    s = config.Settings(agy_model="Gemini 3.5 Flash (High)")
    assert s.agy_model == "Gemini 3.5 Flash (High)"


def test_agy_model_rejects_non_ascii_and_control_chars():
    with pytest.raises(ValidationError, match="printable ASCII"):
        config.Settings(agy_model="Gemini’s Best")   # smart quote
    with pytest.raises(ValidationError, match="printable ASCII"):
        config.Settings(agy_model="Gemini\nFlash")   # line break


def test_engine_tuning_roundtrip(hermes_home):
    paths.ensure_dirs()
    s = config.load_settings()
    s.claude_model = "claude-fable-5"
    s.claude_effort = "high"
    s.agy_model = "Gemini 3.5 Flash (High)"
    config.save_settings(s)
    s2 = config.load_settings()
    assert s2.claude_model == "claude-fable-5"
    assert s2.claude_effort == "high"
    assert s2.agy_model == "Gemini 3.5 Flash (High)"


def test_projects_defaults_empty():
    assert config.Settings().projects == {}


def test_projects_accepts_absolute_paths(tmp_path):
    """Positive path only: pins that the validator does NOT over-reject a
    legitimate entry (it would also pass with no validator at all — the
    rejection behaviour itself is pinned by the tests below)."""
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
    """Persistence positive path: a valid registry survives save + load
    (load_settings re-runs the validator on what came back from YAML)."""
    paths.ensure_dirs()
    s = config.load_settings()
    s.projects = {"myprofit": str(tmp_path)}
    config.save_settings(s)
    assert config.load_settings().projects == {"myprofit": str(tmp_path)}
