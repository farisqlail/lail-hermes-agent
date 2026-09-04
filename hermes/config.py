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


class Skill(BaseModel):
    """A reusable instruction block the chat agent can pull into context on
    demand — installed/removed/toggled exactly like an McpServer, just with
    no live connection to test. `id` is stable across a rename so the web
    catalog can tell "already installed" apart from "same name, different
    skill".

    Deliberately no `content` field: the instruction body lives on disk as a
    real SKILL.md file (skills_dir()/<id>/SKILL.md, see hermes/skills.py),
    not in config.json — that's what makes an installed skill a portable
    file rather than a blob welded to this settings object, and it means
    list_skills() (name+description only, cheap on every turn) can never
    accidentally leak the body; only use_skill(name) reads the file."""
    id: str
    name: str
    description: str
    enabled: bool = True

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
        McpServer(name="figma", type="stdio", command="npx",
                  args=["-y", "figma-developer-mcp", "--stdio"], enabled=False,
                  env={"FIGMA_API_KEY": ""}),
        # Google Stitch: AI UI generation (text prompt -> screen + screenshot).
        # Real MCP server (not a REST API) — streamable-HTTP, auth via a plain
        # header. `stitch_design_figma_frame` (chat_engine.py) is the composite
        # tool that drives this end-to-end; the raw `stitch__*` tools also show
        # up standalone once connected. See docs/INTEGRATIONS.md for the key.
        McpServer(name="stitch", type="http", url="https://stitch.googleapis.com/mcp",
                  transport="streamable-http", enabled=False,
                  headers={"X-Goog-Api-Key": ""}),
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
    # Auxiliary features (vision routing, title-gen, compression, approval
    # notes, MCP routing) each have an on/off switch plus an optional model
    # override. On by default — that was the only behavior before the
    # switch existed, so upgrading an existing install must not silently
    # turn any of them off. Off makes chat_tools()/maybe_compress()/etc.
    # skip the feature outright, checked live via config.load_settings() on
    # every call — no restart needed to flip it. The *_model field only
    # matters while its switch is on; empty means "use chat_model/model".
    vision_enabled: bool = True
    # Model swapped in for a chat turn that carries an image attachment. Empty
    # falls back to chat_model/model like the other overrides — a chat_model
    # picked for text (cheap, fast) may not accept image_url content at all.
    vision_model: str = ""
    title_gen_enabled: bool = True
    # Model for the one-shot session-title generator. Empty falls back to
    # chat_model/model — title generation is cheap enough to ride the same
    # model as chat unless the operator wants something smaller/faster.
    title_model: str = ""
    compression_enabled: bool = True
    # Model for rolling context compression (chat_engine.maybe_compress).
    # Empty falls back to chat_model/model.
    compression_model: str = ""
    approval_note_enabled: bool = True
    # Model for the pending-action risk note (main.build_nim_approval_note).
    # Purely informational — see that function's docstring for why this
    # never auto-approves anything. Empty falls back to chat_model/model.
    approval_model: str = ""
    # Off by default, unlike the other four switches: this one trades
    # latency for tool-selection accuracy, adding a full extra LLM
    # round-trip before the real completion even starts. Default-enabled
    # MCP servers alone (pc, browser, win, obsidian) commonly exceed
    # MCP_ROUTING_THRESHOLD, so default-on meant paying that extra
    # round-trip on every turn, including a plain "halo" — an operator
    # must opt in deliberately, knowing the tradeoff.
    mcp_routing_enabled: bool = False
    # Model for pre-filtering a large MCP tool catalog down to what a turn
    # actually needs (chat_engine.chat_tools). Empty falls back to
    # chat_model/model.
    mcp_routing_model: str = ""
    # Image generation runs through the same OpenAI-compatible gateway, but a
    # different model: one that returns a picture inline in the chat reply (a
    # `data:image/...;base64` link), e.g. 9Router's `ag/gemini-3.1-flash-image`.
    # Empty disables the generate_image chat tool — no model, no tool offered.
    image_model: str = "ag/gemini-3.1-flash-image"
    image_retention_days: int = 7
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
    # No default catalog here on purpose — the presets a fresh install offers
    # live in the web Skills catalog (ConfigSkills.tsx) only, same split as
    # the MCP 1-click catalog: backend stores whatever got installed,
    # frontend owns what's offered.
    skills: list[Skill] = Field(default_factory=list)
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

    # Proactive / self-initiated work (hermes/proactive.py). Master switch off
    # by default: an agent that acts without an incoming message is opt-in. Each
    # of the three jobs is gated on its own, and all push to `proactive_chat_id`
    # — the operator's Telegram chat id (same value as their allowed user id for
    # a private chat). 0 means no chat: queued tasks still run and show in the
    # web UI, but the daily brief has nowhere to go and is skipped.
    proactive_enabled: bool = False
    proactive_chat_id: int = 0
    # Daily brief: today's calendar (reuses calendar_ics_url) plus the recent
    # failure summary, pushed once a day at this local HH:MM.
    proactive_daily_enabled: bool = False
    proactive_daily_time: str = "08:00"
    # Watcher: when a new settled file lands in this folder, queue a task about
    # it. proactive_watch_prompt is the task template ("" uses a default);
    # the file path is appended to whichever is used.
    proactive_watch_enabled: bool = False
    proactive_watch_dir: str = ""
    proactive_watch_prompt: str = ""
    # Auto-retry: re-submit a task that failed for a transient reason (busy
    # endpoint), once per task. proactive_retry_max caps how many fire per tick
    # so a burst of failures cannot stampede the engine.
    proactive_retry_enabled: bool = False
    proactive_retry_max: int = 3
    # Sentinel: watch registered project repositories for code changes and run tests
    proactive_sentinel_enabled: bool = False

    # Office mode's autonomous simulation loop (hermes/office.py run_office_loop):
    # energy/burnout state transitions run unconditionally (a pure state machine,
    # no LLM cost), but auto-triggered team meetings are real LLM calls with no
    # operator in the loop — off by default for the same reason proactive_enabled
    # is, plus a per-team cooldown and a daily cap so an idle install can never
    # silently spend API budget on meetings nobody asked for.
    office_meetings_enabled: bool = False
    office_meeting_cooldown_s: int = 1800
    office_max_auto_meetings_per_day: int = 5

    # Daily standup: unlike the ambient "quick sync" above (random 2-4
    # idle members, cooldown-gated, can fire several times a day), this is a
    # real recurring ritual — the WHOLE active team, once per calendar day,
    # at a fixed wall-clock time, each member reporting against their own
    # actual completed work items (see OfficeManager.run_standup) rather than
    # a freeform topic. Off by default for the same LLM-cost-with-no-operator
    # reason as office_meetings_enabled.
    office_standup_enabled: bool = False
    office_standup_time: str = "09:00"

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
        if not v:
            return ""
        # Auto-sanitize ANSI escape codes and smart quotes to printable ASCII
        v = re.sub(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])", "", v).strip()
        v = (
            v.replace("’", "'")
            .replace("‘", "'")
            .replace("“", '"')
            .replace("”", '"')
            .replace("–", "-")
            .replace("—", "-")
        )
        v = "".join(c for c in v if c.isascii() and c.isprintable()).strip()
        return v

    @field_validator("office_standup_time")
    @classmethod
    def _office_standup_time_shape(cls, v: str) -> str:
        if v and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
            raise ValueError(
                "office standup time must be 24-hour HH:MM, e.g. '09:00' or '17:30'")
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

    @field_validator("proactive_daily_time")
    @classmethod
    def _proactive_daily_time_shape(cls, v: str) -> str:
        # "HH:MM", 24-hour. proactive._parse_hhmm tolerates junk at runtime, but
        # rejecting it here tells the operator at save time, not at 8am when the
        # brief silently fires at the fallback hour instead.
        if v and not re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", v):
            raise ValueError(
                "proactive daily time must be 24-hour HH:MM, e.g. '08:00'")
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
    unsplash_access_key: str = ""
    # GitHub App auth for the PR-review chat tool (hermes/github_app.py) —
    # not a PAT: App ID + private key mint a short-lived JWT, traded for a
    # per-installation access token. The PEM's real newlines are escaped to
    # literal "\n" for the single-line KEY=value .env format below and
    # un-escaped on load — see load_secrets/save_secrets.
    github_app_id: str = ""
    github_app_private_key: str = ""
    github_app_installation_id: str = ""

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
        unsplash_access_key=vals.get("UNSPLASH_ACCESS_KEY", "") or "",
        github_app_id=vals.get("GITHUB_APP_ID", "") or "",
        github_app_private_key=(vals.get("GITHUB_APP_PRIVATE_KEY", "") or "").replace("\\n", "\n"),
        github_app_installation_id=vals.get("GITHUB_APP_INSTALLATION_ID", "") or "",
    )

def save_secrets(s: Secrets) -> None:
    paths.config_dir().mkdir(parents=True, exist_ok=True)
    # Escaped out here, not inside the f-string: a backslash in an f-string
    # expression only parses on 3.12+ (PEP 701), and pyproject supports 3.11.
    # Inlined, this file silently failed to compile in the 3.11 release build
    # and PyInstaller dropped hermes.config from the shipped engine.
    private_key = s.github_app_private_key.replace(chr(10), "\\n")
    lines = [
        f"NVIDIA_API_KEY={s.nvidia_api_key}",
        f"TELEGRAM_BOT_TOKEN={s.telegram_bot_token}",
        f"UNSPLASH_ACCESS_KEY={s.unsplash_access_key}",
        f"GITHUB_APP_ID={s.github_app_id}",
        f"GITHUB_APP_PRIVATE_KEY={private_key}",
        f"GITHUB_APP_INSTALLATION_ID={s.github_app_installation_id}",
    ]
    _env_file().write_text("\n".join(lines) + "\n", encoding="utf-8")
