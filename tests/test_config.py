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
