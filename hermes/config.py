from __future__ import annotations
import re
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, Field, field_validator
from dotenv import dotenv_values
from . import paths

# Registry keys are dict keys, never path components — this pattern is about
# keeping names readable and unambiguous, not about containment. Requiring a
# leading alphanumeric is what rejects ".." and ".ssh".
# _NAME_CHAR is shared with project_resolve._REF (capture group and right
# anchor), so the sigil parser and this validator cannot drift apart.
_NAME_CHAR = r"[A-Za-z0-9._-]"
_PROJECT_NAME = re.compile(rf"[A-Za-z0-9]{_NAME_CHAR}*")

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
    # Per-engine tuning ("" = leave that CLI's own default). Model fields are
    # free text on purpose: the valid sets (claude aliases like "opus", agy
    # model ids) change faster than this code. Per-engine because the two
    # CLIs accept different model names — a shared field would send a claude
    # id to agy whenever default_engine=auto mixed them. Effort is
    # claude-only: agy's CLI has no --effort flag (verified 2026-07-17).
    claude_model: str = ""
    claude_effort: Literal["", "low", "medium", "high", "xhigh", "max"] = ""
    agy_model: str = ""
    projects_path: str = ""
    projects: dict[str, str] = Field(default_factory=dict)  # name -> absolute path
    android_sdk_path: str = ""
    emulator_avd: str = ""
    default_test_mode: Literal["browser", "emulator", "none"] = "none"
    confirm_risky: bool = True  # gate risky tasks (git push / delete / outside paths) behind Telegram confirmation
    timeout_code_s: int = 900
    timeout_build_s: int = 1200
    timeout_test_s: int = 600
    mcp_servers: list[McpServer] = Field(default_factory=list)

    @field_validator("claude_model")
    @classmethod
    def _claude_model_shape(cls, v: str) -> str:
        # claude ids and aliases ('opus', 'claude-fable-5') never contain
        # whitespace; ASCII-only catches smart quotes from copy-paste.
        if v and (not v.isascii() or any(c.isspace() for c in v)):
            raise ValueError(
                "claude model must be a single ASCII token, e.g. 'opus' or "
                "'claude-fable-5' — check for spaces or smart quotes")
        return v

    @field_validator("agy_model")
    @classmethod
    def _agy_model_shape(cls, v: str) -> str:
        # agy models are display names with spaces — its own settings.json
        # stores e.g. "Gemini 3.5 Flash (High)" — and argv goes through
        # create_subprocess_exec (no shell), so spaces are safe. Still ASCII
        # (smart quotes) and printable (no newlines/control chars) only.
        if v and (not v.isascii() or not v.isprintable()):
            raise ValueError(
                "agy model must be printable ASCII, e.g. 'Gemini 3.5 Flash "
                "(High)' — check for smart quotes or line breaks")
        return v

    @field_validator("projects")
    @classmethod
    def _projects_shape(cls, v: dict[str, str]) -> dict[str, str]:
        # Shape only. Never touch the filesystem here: this runs on
        # load_settings() too, so an existence check would turn a missing
        # folder into a startup crash. resolve_project() checks existence.
        for name, path in v.items():
            if not _PROJECT_NAME.fullmatch(name):
                raise ValueError(
                    f"bad project name {name!r} — must start with a letter or "
                    "digit, then letters, digits, dot, dash, underscore")
            if not Path(path).is_absolute():
                raise ValueError(
                    f"project {name!r}: path must be absolute, got {path!r}")
        return v

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
