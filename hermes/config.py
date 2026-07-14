from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field
from dotenv import dotenv_values
from . import paths

class McpServer(BaseModel):
    name: str
    type: Literal["stdio", "http"]
    command: str = ""
    args: list[str] = Field(default_factory=list)
    url: str = ""
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True

class Settings(BaseModel):
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    model: str = "deepseek-ai/deepseek-v3"
    allowed_user_ids: list[int] = Field(default_factory=list)
    default_engine: Literal["claude", "antigravity", "auto"] = "auto"
    projects_path: str = ""
    android_sdk_path: str = ""
    emulator_avd: str = ""
    default_test_mode: Literal["browser", "emulator", "none"] = "none"
    confirm_risky: bool = True  # gate risky tasks (git push / delete / outside paths) behind Telegram confirmation
    timeout_code_s: int = 900
    timeout_build_s: int = 1200
    timeout_test_s: int = 600
    mcp_servers: list[McpServer] = Field(default_factory=list)

class Secrets(BaseModel):
    nvidia_api_key: str = ""
    telegram_bot_token: str = ""

def _settings_file():
    return paths.config_dir() / "config.yaml"  # stored as JSON for zero-dep parsing

def load_settings() -> Settings:
    f = _settings_file()
    if not f.exists():
        return Settings()
    return Settings.model_validate_json(f.read_text(encoding="utf-8"))

def save_settings(s: Settings) -> None:
    paths.config_dir().mkdir(parents=True, exist_ok=True)
    _settings_file().write_text(s.model_dump_json(indent=2), encoding="utf-8")

def _env_file():
    return paths.config_dir() / ".env"

def load_secrets() -> Secrets:
    vals = dotenv_values(_env_file())
    return Secrets(
        nvidia_api_key=vals.get("NVIDIA_API_KEY", "") or "",
        telegram_bot_token=vals.get("TELEGRAM_BOT_TOKEN", "") or "",
    )

def save_secrets(s: Secrets) -> None:
    paths.config_dir().mkdir(parents=True, exist_ok=True)
    lines = [
        f"NVIDIA_API_KEY={s.nvidia_api_key}",
        f"TELEGRAM_BOT_TOKEN={s.telegram_bot_token}",
    ]
    _env_file().write_text("\n".join(lines) + "\n", encoding="utf-8")
