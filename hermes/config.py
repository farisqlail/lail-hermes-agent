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
    # "" means the transport has not been probed yet, which is how every
    # config written before the one-link flow reads — those keep today's
    # behaviour (legacy SSE) instead of silently changing protocol.
    transport: Literal["", "streamable-http", "sse"] = ""
    # HTTP headers for a server that wants a manual API key. Deliberately not
    # `env`: env is a stdio process environment, a header is HTTP. Merging the
    # two would send the key to the wrong place for half the servers.
    headers: dict[str, str] = Field(default_factory=dict)
    # This server's session must attach an OAuthClientProvider. The tokens
    # themselves live outside the settings file — see hermes/mcp_oauth.py.
    oauth: bool = False

def _default_mcp_servers() -> list[McpServer]:
    """The server list a fresh install starts with.

    Only reached when there is no settings file yet — an existing config.yaml
    already carries its own `mcp_servers`, so nobody's edits are overwritten by
    a pull. The three credential-hungry servers ship disabled with empty env
    keys: they are templates to fill in from the MCP panel, not defaults that
    fail on first boot. See docs/INTEGRATIONS.md for what each one needs.
    """
    return [
        # Whole-machine files plus a terminal. No folder scope — see the
        # security note in docs/INTEGRATIONS.md.
        McpServer(name="pc", type="stdio", command="npx",
                  args=["-y", "@wonderwhy-er/desktop-commander"]),
        # A real browser: also how web search is done here, since no keyless
        # search server survives an Indonesian ISP (docs/INTEGRATIONS.md).
        McpServer(name="browser", type="stdio", command="npx",
                  args=["-y", "@playwright/mcp@latest"]),
        # Native Windows GUI: read the screen, click and type into apps the
        # terminal cannot reach. Python, so it runs through `uvx` — install.ps1
        # puts uv in the venv whose Scripts dir start.bat activates.
        McpServer(name="win", type="stdio", command="uvx",
                  args=["windows-mcp", "serve"]),
        # Knowledge graph that survives a restart. The file path is explicit
        # because the default writes inside the npx package directory, which a
        # cache clear deletes.
        McpServer(name="memory", type="stdio", command="npx",
                  args=["-y", "@modelcontextprotocol/server-memory"],
                  env={"MEMORY_FILE_PATH": str(paths.config_dir() / "memory.jsonl")}),
        # Markdown knowledge vault: the operator facts and per-task archive
        # Hermes writes, plus any notes the operator keeps. Needs no credentials,
        # only Node, so it ships enabled. The vault is this install's
        # HERMES_HOME/vault, which paths.ensure_vault seeds with a valid
        # .obsidian config at startup so the server starts on first boot rather
        # than refusing an un-initialised folder.
        McpServer(name="obsidian", type="stdio", command="npx",
                  args=["-y", "obsidian-mcp", str(paths.vault_dir())]),
        McpServer(name="mail", type="stdio", command="npx",
                  args=["-y", "mcp-mail-server"], enabled=False,
                  env={"IMAP_HOST": "imap.gmail.com", "IMAP_PORT": "993",
                       "IMAP_SECURE": "true", "SMTP_HOST": "smtp.gmail.com",
                       "SMTP_PORT": "465", "SMTP_SECURE": "true",
                       "EMAIL_USER": "", "EMAIL_PASS": ""}),
        McpServer(name="web", type="stdio", command="npx",
                  args=["-y", "tavily-mcp@latest"], enabled=False,
                  env={"TAVILY_API_KEY": ""}),
        McpServer(name="spotify", type="stdio", command="npx",
                  args=["-y", "spotify-mcp@latest"], enabled=False,
                  env={"SPOTIFY_CLIENT_ID": ""}),
    ]

class Settings(BaseModel):
    ai_provider: Literal["nvidia", "deepseek", "custom"] = "nvidia"
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    model: str = "deepseek-ai/deepseek-v3"
    # Planning emits JSON that must obey fixed rules; sampling randomness buys
    # nothing there and makes the same task plan differently run to run. A
    # setting rather than a literal because a model that rejects the parameter
    # would otherwise break every plan until a code change shipped.
    planner_temperature: float = 0.0
    # The conversational chat agent (web UI chat pane) is a different job from
    # the planner: prose, not rule-bound JSON, so a little sampling reads more
    # naturally. chat_model "" reuses `model` — one endpoint, one key, until a
    # reason to split them appears.
    chat_model: str = ""
    chat_temperature: float = 0.3
    agent_name: str = "Lail Agent"
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
    # What one task may spend on engine sessions before Hermes stops it. Real
    # numbers from this machine's history: a successful single round has cost
    # $0.97 to $4.58, so a three-round step is already in double digits and a
    # repair loop on top of that has no natural ceiling. 0 disables the cap —
    # for a run you are watching, not for one you started and walked away from.
    max_task_cost_usd: float = 10.0
    timeout_build_s: int = 1200
    timeout_test_s: int = 600
    mcp_servers: list[McpServer] = Field(default_factory=_default_mcp_servers)
    # Google Calendar's "secret address in iCal format" (Settings -> a calendar
    # -> Integrate calendar). Read-only by construction and needs no OAuth
    # client, which is the whole reason it is here rather than a calendar MCP
    # server. Treat the URL itself as the credential: anyone holding it reads
    # the calendar.
    calendar_ics_url: str = ""
    stt_enabled: bool = True
    stt_language: str = "id"
    # Whisper model size: the biggest lever on how long after you stop talking
    # the assistant can start replying. "base" is fast; "small"/"medium" are more
    # accurate but multiply CPU transcribe time. See hermes/stt.py.
    stt_model: Literal["tiny", "base", "small", "medium", "large"] = "base"
    tts_enabled: bool = False
    # Multilingual by default: replies mix Bahasa with English technical terms,
    # and a multilingual voice pronounces both natively. See TTS_VOICES in
    # voice.py. Existing configs keep whatever voice they saved.
    tts_voice: str = "en-US-AndrewMultilingualNeural"
    tts_mode: Literal["smart", "verbatim"] = "smart"
    tts_max_words: int = 40
    tts_greeting: bool = True
    tts_task_notify: bool = False
    # Running commentary: one spoken line as each orchestration step starts,
    # instead of only the result at the end. Off by default — it is the
    # chattiest thing Hermes does, and a long plan makes it talk a lot.
    tts_narrate: bool = False
    tts_personality: Literal["professional", "friendly", "jarvis"] = "professional"

    # Conversation behaviour. Barge-in is free when TTS is off, so it defaults
    # on. Hands-free is not: a microphone that transcribes without the operator
    # asking is a surprise, and on a shared desk a rude one.
    voice_barge_in: bool = True
    voice_handsfree: bool = False
    voice_silence_ms: int = 800
    voice_sensitivity: Literal["low", "medium", "high"] = "medium"

    # Wake word, run by the native tray helper so the mic stays live with the
    # browser closed. Off by default: an always-listening microphone is opt-in.
    # "auto" derives the phrase from `agent_name` ("Jarvis" -> "Hey Jarvis",
    # using the bundled hey_jarvis model; another name needs a trained
    # hey_<name>.onnx in the wakewords dir). An explicit value overrides: a
    # bundled openWakeWord name or a path to a .onnx/.tflite model.
    wakeword_enabled: bool = False
    wakeword_model: str = "auto"
    wakeword_threshold: float = 0.5      # openWakeWord score in [0, 1]
    wakeword_cooldown_ms: int = 2000     # ignore repeats within this window

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

    @field_validator("stt_language")
    @classmethod
    def _stt_language_shape(cls, v: str) -> str:
        # whisper wants an ISO-639-1 code ("id", "en", "ja"). Anything else
        # only fails once it reaches the model, several layers from the
        # setting that caused it.
        if v and not re.fullmatch(r"[A-Za-z]{2}", v):
            raise ValueError(
                "stt language must be a two-letter ISO-639-1 code, e.g. 'id' "
                "or 'en', or empty to auto-detect")
        return v.lower()

    @field_validator("tts_voice")
    @classmethod
    def _tts_voice_shape(cls, v: str) -> str:
        # edge-tts voice id, e.g. "id-ID-ArdiNeural". Must contain letters,
        # digits, and hyphens only — no shell characters or path components.
        if v and not re.fullmatch(r"[A-Za-z0-9-]+", v):
            raise ValueError(
                "tts voice must contain letters, digits, and hyphens only, "
                "e.g. 'id-ID-ArdiNeural'")
        return v

    @field_validator("voice_silence_ms")
    @classmethod
    def _voice_silence_range(cls, v: int) -> int:
        # below ~300ms a normal mid-sentence pause ends the turn; above 3s the
        # operator assumes the microphone died
        if not 300 <= v <= 3000:
            raise ValueError("voice silence must be between 300 and 3000 ms")
        return v

    @field_validator("wakeword_model")
    @classmethod
    def _wakeword_model_shape(cls, v: str) -> str:
        # Either a bundled openWakeWord name or a filesystem path to a model.
        # Printable ASCII only, no control chars: this string is passed to
        # openWakeWord, never to a shell. Existence is not checked here — a
        # missing model must not crash load_settings() into a restart loop; the
        # listener reports it at load time, the way stt does for its model.
        if v and (not v.isascii() or not v.isprintable()):
            raise ValueError(
                "wake word model must be printable ASCII — a bundled name like "
                "'hey_jarvis' or a path to a .onnx/.tflite model")
        return v

    @field_validator("wakeword_threshold")
    @classmethod
    def _wakeword_threshold_range(cls, v: float) -> float:
        # openWakeWord emits a probability. Below ~0.3 the room triggers it;
        # at 1.0 nothing ever clears the bar.
        if not 0.0 <= v <= 1.0:
            raise ValueError("wake word threshold must be between 0.0 and 1.0")
        return v

    @field_validator("wakeword_cooldown_ms")
    @classmethod
    def _wakeword_cooldown_range(cls, v: int) -> int:
        # Long enough that one spoken "Hey Ev" fires once, not per frame; short
        # enough that a second genuine call a couple seconds later still lands.
        if not 0 <= v <= 10000:
            raise ValueError("wake word cooldown must be between 0 and 10000 ms")
        return v

    @field_validator("calendar_ics_url")
    @classmethod
    def _calendar_ics_url_shape(cls, v: str) -> str:
        # A pasted webcal:// address (what Google's "copy" button sometimes
        # yields) is the same URL over https; httpx cannot fetch the webcal
        # scheme, so normalise rather than reject.
        v = v.strip()
        if v.startswith("webcal://"):
            v = "https://" + v[len("webcal://"):]
        if v and not v.startswith(("http://", "https://")):
            raise ValueError(
                "calendar ICS url must start with https:// (the 'secret address "
                "in iCal format' from Google Calendar settings)")
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
