import pytest
from pydantic import ValidationError
from hermes import config, paths

def test_defaults_when_missing(hermes_home):
    paths.ensure_dirs()
    s = config.load_settings()
    assert s.nvidia_base_url == "https://integrate.api.nvidia.com/v1"
    assert s.default_engine == "auto"

def test_fresh_install_ships_the_default_mcp_servers(hermes_home):
    paths.ensure_dirs()
    s = config.load_settings()
    assert [m.name for m in s.mcp_servers] == [
        "pc", "browser", "win", "obsidian", "mail", "web", "spotify", "figma"]
    # Credential-hungry servers ship off, so a first boot never fails on an
    # empty API key; the rest work with nothing but Node (and uv for `win`).
    assert {m.name for m in s.mcp_servers if not m.enabled} == {
        "mail", "web", "spotify", "figma"}
    # The obsidian vault is the memory store; the old server-memory graph is no
    # longer a default, so nothing overlaps it out of the box.
    assert "memory" not in {m.name for m in s.mcp_servers}
    # Obsidian ships enabled (no credentials) and points at this install's vault,
    # not wherever npx unpacks the package.
    obsidian = next(m for m in s.mcp_servers if m.name == "obsidian")
    assert obsidian.enabled
    assert obsidian.args[-1] == str(paths.vault_dir())

def test_existing_config_is_not_overwritten_by_the_defaults(hermes_home):
    """A pull must never re-add servers someone deliberately removed."""
    paths.ensure_dirs()
    config.save_settings(config.Settings(mcp_servers=[
        config.McpServer(name="only-mine", type="stdio", command="npx")]))
    assert [m.name for m in config.load_settings().mcp_servers] == ["only-mine"]

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
    assert s2.mcp_servers[-1].name == "fs"

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


def test_stt_defaults():
    s = config.Settings()
    assert s.stt_enabled is True
    assert s.stt_language == "id"


def test_stt_language_accepts_empty_for_autodetect():
    assert config.Settings(stt_language="").stt_language == ""


def test_stt_language_normalises_case():
    assert config.Settings(stt_language="ID").stt_language == "id"


def test_stt_language_rejects_non_language_tokens():
    import pytest
    # Whisper takes ISO-639-1 codes. A full name or a locale would be
    # forwarded verbatim and rejected deep inside the model, far from here.
    for bad in ["indonesian", "id-ID", "i d", "id1"]:
        with pytest.raises(ValidationError):
            config.Settings(stt_language=bad)


def test_tts_defaults():
    s = config.Settings()
    assert s.tts_enabled is False
    assert s.tts_voice == "en-US-AndrewMultilingualNeural"
    assert s.tts_mode == "smart"
    assert s.tts_max_words == 40
    assert s.tts_greeting is True
    assert s.tts_task_notify is False
    assert s.tts_personality == "professional"

def test_tts_voice_validation():
    s = config.Settings(tts_voice="en-US-JennyNeural")
    assert s.tts_voice == "en-US-JennyNeural"

    with pytest.raises(ValidationError):
        config.Settings(tts_voice="invalid; voice")


def test_wakeword_defaults():
    s = config.Settings()
    assert s.wakeword_enabled is False
    assert s.wakeword_model == "auto"
    assert s.wakeword_threshold == 0.5
    assert s.wakeword_cooldown_ms == 2000


def test_wakeword_model_accepts_name_and_path():
    assert config.Settings(wakeword_model="hey_jarvis").wakeword_model == "hey_jarvis"
    assert config.Settings(
        wakeword_model="C:/models/hey_ev.onnx").wakeword_model == "C:/models/hey_ev.onnx"
    with pytest.raises(ValidationError):
        config.Settings(wakeword_model="bad\nname")


def test_wakeword_threshold_range():
    assert config.Settings(wakeword_threshold=0.0).wakeword_threshold == 0.0
    assert config.Settings(wakeword_threshold=1.0).wakeword_threshold == 1.0
    with pytest.raises(ValidationError):
        config.Settings(wakeword_threshold=1.5)
    with pytest.raises(ValidationError):
        config.Settings(wakeword_threshold=-0.1)


def test_wakeword_cooldown_range():
    assert config.Settings(wakeword_cooldown_ms=0).wakeword_cooldown_ms == 0
    with pytest.raises(ValidationError):
        config.Settings(wakeword_cooldown_ms=-1)
    with pytest.raises(ValidationError):
        config.Settings(wakeword_cooldown_ms=10001)

def test_conversation_defaults(hermes_home):
    s = config.Settings()
    # barge-in is free when TTS is off, so it defaults on; hands-free is not —
    # a mic that transcribes unprompted has to be opted into
    assert s.voice_barge_in is True
    assert s.voice_handsfree is False
    assert s.voice_silence_ms == 800
    assert s.voice_sensitivity == "medium"

def test_voice_silence_ms_is_bounded(hermes_home):
    import pytest
    # under ~300ms a normal pause ends the turn mid-sentence; over 3s the
    # operator thinks the mic died
    for bad in (100, 10_000):
        with pytest.raises(Exception):
            config.Settings(voice_silence_ms=bad)
    assert config.Settings(voice_silence_ms=1500).voice_silence_ms == 1500

def test_voice_sensitivity_rejects_unknown_levels(hermes_home):
    import pytest
    with pytest.raises(Exception):
        config.Settings(voice_sensitivity="paranoid")


def test_mcp_server_defaults_keep_old_configs_parsing():
    """Every new field is defaulted, so a config written before this change
    still loads — there is no migration step."""
    s = config.Settings.model_validate_json(
        '{"mcp_servers": [{"name": "pc", "type": "stdio", "command": "npx"}]}')
    srv = s.mcp_servers[0]
    assert srv.transport == ""
    assert srv.headers == {}
    assert srv.oauth is False


def test_mcp_server_accepts_new_fields():
    srv = config.McpServer(name="notion", type="http",
                           url="https://mcp.notion.com/mcp",
                           transport="streamable-http",
                           headers={"X-Api-Key": "k"}, oauth=True)
    assert srv.transport == "streamable-http"
    assert srv.headers["X-Api-Key"] == "k"
    assert srv.oauth is True


def test_mcp_server_rejects_unknown_transport():
    import pytest
    with pytest.raises(Exception):
        config.McpServer(name="x", type="http", transport="carrier-pigeon")
