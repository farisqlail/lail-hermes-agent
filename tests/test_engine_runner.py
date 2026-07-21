import asyncio
import sys
from pathlib import Path
import pytest
from hermes import engine_runner

@pytest.fixture
def fake_echo(monkeypatch):
    # replace binaries with a python script that echoes the prompt
    # (claude receives the prompt on stdin, so the fake reads stdin first)
    script = Path(__file__).parent / "fake_engine.py"
    script.write_text(
        "import sys\n"
        "data = sys.stdin.read()\n"
        "print('ECHO:' + (data or sys.argv[-1]))\n"
        "sys.exit(0)\n"
    )
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: [sys.executable, str(script), "-p"])
    return script

async def test_run_captures_stdout(tmp_path, fake_echo):
    res = await engine_runner.run_engine("claude", "make counter", tmp_path, timeout_s=30)
    assert res.ok
    assert "ECHO:make counter" in res.stdout

async def test_run_timeout(tmp_path, monkeypatch):
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: [sys.executable, "-c", "import time; time.sleep(5)"])
    res = await engine_runner.run_engine("claude", "x", tmp_path, timeout_s=1)
    assert res.timed_out and not res.ok

async def test_missing_binary_raises(tmp_path, monkeypatch):
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: ["definitely-not-a-real-engine-binary", "-p"])
    with pytest.raises(FileNotFoundError):
        await engine_runner.run_engine("claude", "x", tmp_path, timeout_s=5)

def test_argv_appends_model_and_effort_for_claude():
    argv = engine_runner._argv("claude", "x", model="claude-fable-5", effort="high")
    assert argv[-4:] == ["--model", "claude-fable-5", "--effort", "high"]

def test_argv_empty_tuning_adds_nothing():
    assert engine_runner._argv("claude", "x") == engine_runner.COMMANDS["claude"]("x")

def test_argv_antigravity_gets_model_but_never_effort():
    """agy takes --model but has no --effort flag; an unknown flag would
    crash the engine on every step, so effort is dropped for agy. agy model
    values are display names — spaces stay inside one argv token."""
    argv = engine_runner._argv("antigravity", "x",
                               model="Gemini 3.5 Flash (High)", effort="max")
    assert argv[-2:] == ["--model", "Gemini 3.5 Flash (High)"]
    assert "--effort" not in argv

async def test_run_engine_passes_tuning_flags(tmp_path, monkeypatch):
    script = tmp_path / "argv_echo.py"
    script.write_text(
        "import sys\n"
        "sys.stdin.read()\n"
        "print(' '.join(sys.argv[1:]))\n"
    )
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: [sys.executable, str(script), "-p"])
    res = await engine_runner.run_engine("claude", "x", tmp_path, timeout_s=30,
                                         model="opus", effort="low")
    assert "--model opus" in res.stdout
    assert "--effort low" in res.stdout

def test_argv_claude_opens_a_named_session():
    """Hermes names the session itself so a continuation round can resume it
    even when the first round's output never arrived to be parsed."""
    argv = engine_runner._argv("claude", "x", session_id="abc-123")
    assert argv[-2:] == ["--session-id", "abc-123"]
    assert "--resume" not in argv


def test_argv_claude_resumes_and_never_also_opens():
    argv = engine_runner._argv("claude", "x", resume_id="abc-123")
    assert argv[-2:] == ["--resume", "abc-123"]
    assert "--session-id" not in argv


def test_argv_resume_wins_when_both_are_supplied():
    """Belt and braces: passing both would make claude open and resume in one
    invocation. Resuming is the caller's intent whenever a resume id exists."""
    argv = engine_runner._argv("claude", "x", session_id="new", resume_id="old")
    assert "--resume" in argv and "old" in argv
    assert "--session-id" not in argv


def test_argv_antigravity_never_gets_session_flags():
    """agy has --conversation, not --session-id/--resume, and cannot be handed
    an id it never issued. It stays on the fresh-session path."""
    argv = engine_runner._argv("antigravity", "x", session_id="a", resume_id="b")
    assert "--session-id" not in argv and "--resume" not in argv


def test_argv_antigravity_gets_print_timeout_from_the_step_budget():
    """agy's own --print-timeout defaults to 5m, so a 15m code step was being
    killed by the engine at minute five and reported as an engine failure —
    asyncio's wait_for never got to fire."""
    argv = engine_runner._argv("antigravity", "x", timeout_s=900)
    assert argv[-2:] == ["--print-timeout", "900s"]


def test_argv_claude_has_no_print_timeout_flag():
    argv = engine_runner._argv("claude", "x", timeout_s=900)
    assert "--print-timeout" not in argv


async def test_run_engine_parses_structured_output(tmp_path, monkeypatch):
    envelope = ('{"type":"result","subtype":"success","is_error":false,'
                '"result":"all done","session_id":"sess-9",'
                '"total_cost_usd":0.5,"num_turns":3}')
    script = tmp_path / "emit.py"
    script.write_text("import sys\nsys.stdin.read()\n"
                      f"print({envelope!r})\n")
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: [sys.executable, str(script), "-p"])
    res = await engine_runner.run_engine("claude", "x", tmp_path, timeout_s=30)
    assert res.ok
    assert res.outcome.session_id == "sess-9"
    assert res.outcome.cost_usd == 0.5
    assert res.final_text == "all done"


async def test_api_error_fails_the_run_despite_exit_zero(tmp_path, monkeypatch):
    """The bug this whole change exists to see: a session killed by an API
    error still exits 0, so returncode alone called it a success."""
    envelope = ('{"type":"result","subtype":"success","is_error":true,'
                '"api_error_status":"overloaded_error","result":""}')
    script = tmp_path / "emit_err.py"
    script.write_text("import sys\nsys.stdin.read()\n"
                      f"print({envelope!r})\n")
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: [sys.executable, str(script), "-p"])
    res = await engine_runner.run_engine("claude", "x", tmp_path, timeout_s=30)
    assert res.returncode == 0
    assert not res.ok
    assert res.outcome.api_error == "overloaded_error"


async def test_unparseable_stdout_degrades_to_text(tmp_path, fake_echo):
    """An older CLI, or one whose stdout got polluted, must keep working the
    way it did before this change existed."""
    res = await engine_runner.run_engine("claude", "make counter", tmp_path,
                                         timeout_s=30)
    assert res.ok
    assert res.outcome is None
    assert res.final_text == res.stdout


def test_final_text_falls_back_to_stdout_without_an_outcome():
    r = engine_runner.RunResult(True, "line one\nHERMES_STEP_DONE", "", False, 0)
    assert r.final_text == "line one\nHERMES_STEP_DONE"


def test_final_text_prefers_the_outcome_when_there_is_one():
    """stdout carries tool output and echoed prompt; the outcome carries only
    what the model itself said last. That gap is the anti-spoof property."""
    from hermes.engine_result import EngineOutcome
    r = engine_runner.RunResult(True, "noisy stdout with HERMES_STEP_DONE in it",
                                "", False, 0,
                                outcome=EngineOutcome(final_text="I gave up"))
    assert r.final_text == "I gave up"


def test_resolve_passes_through_real_path():
    argv = engine_runner._resolve([sys.executable, "-c", "pass"])
    assert argv[0].lower().endswith(".exe")
    assert argv[1:] == ["-c", "pass"]


def test_mcp_config_dict_carries_the_token_as_a_header():
    from hermes.ask_server import SERVER_NAME, TOKEN_HEADER
    cfg = engine_runner.mcp_config_dict("http://127.0.0.1:8799/ask-mcp/mcp", "tok-9")
    srv = cfg["mcpServers"][SERVER_NAME]
    assert srv["type"] == "http"
    assert srv["url"].endswith("/ask-mcp/mcp")
    assert srv["headers"][TOKEN_HEADER] == "tok-9"


def test_argv_claude_appends_mcp_config_when_a_path_is_given():
    argv = engine_runner._argv("claude", "x", mcp_config_path="C:/tmp/cfg.json")
    assert argv[-2:] == ["--mcp-config", "C:/tmp/cfg.json"]


def test_argv_antigravity_never_gets_mcp_config():
    """agy's MCP config shape differs and its ask path is unwired; passing the
    flag would crash the engine on every step."""
    argv = engine_runner._argv("antigravity", "x", mcp_config_path="C:/tmp/cfg.json")
    assert "--mcp-config" not in argv


def test_argv_no_mcp_config_flag_without_a_path():
    assert "--mcp-config" not in engine_runner._argv("claude", "x")


async def test_run_engine_writes_and_removes_the_mcp_config(tmp_path, monkeypatch):
    """The temp config carries the run token: it must reach the engine and never
    outlive the run, or a later engine could reach a closed run through it."""
    script = tmp_path / "read_cfg.py"
    script.write_text(
        "import sys\n"
        "sys.stdin.read()\n"
        "argv = sys.argv[1:]\n"
        "i = argv.index('--mcp-config')\n"
        "path = argv[i + 1]\n"
        "print('CFGPATH:' + path)\n"
        "print('CFGBODY:' + open(path, encoding='utf-8').read())\n"
    )
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: [sys.executable, str(script), "-p"])
    res = await engine_runner.run_engine(
        "claude", "x", tmp_path, timeout_s=30,
        ask_url="http://127.0.0.1:8799/ask-mcp/mcp", ask_token="tok-42")
    assert res.ok
    path = next(l[len("CFGPATH:"):] for l in res.stdout.splitlines()
                if l.startswith("CFGPATH:"))
    assert "tok-42" in res.stdout          # body was readable during the run
    assert not Path(path).exists()          # cleaned up afterward


async def test_run_engine_skips_mcp_config_without_both_url_and_token(tmp_path, monkeypatch):
    script = tmp_path / "argv_echo.py"
    script.write_text("import sys\nsys.stdin.read()\nprint(' '.join(sys.argv[1:]))\n")
    monkeypatch.setitem(engine_runner.COMMANDS, "claude",
                        lambda p: [sys.executable, str(script), "-p"])
    res = await engine_runner.run_engine("claude", "x", tmp_path, timeout_s=30,
                                         ask_url="http://x/mcp", ask_token="")
    assert "--mcp-config" not in res.stdout

class _FakeProc:
    def __init__(self, delay, result=(b"out", b"err")):
        self._delay, self._result = delay, result
    async def communicate(self, send=None):
        await asyncio.sleep(self._delay)
        return self._result


async def test_communicate_within_returns_when_proc_beats_the_deadline():
    from hermes.ask import Deadline
    out, err = await engine_runner._communicate_within(
        _FakeProc(0.01), None, Deadline(100), poll_s=0.005)
    assert (out, err) == (b"out", b"err")


async def test_communicate_within_raises_when_the_deadline_expires():
    from hermes.ask import Deadline
    with pytest.raises(asyncio.TimeoutError):
        await engine_runner._communicate_within(
            _FakeProc(10), None, Deadline(0), poll_s=0.005)


async def test_communicate_within_survives_a_paused_deadline():
    """The whole reason Deadline exists: a paused clock (operator thinking)
    must not kill an engine that runs past its budget while blocked on ask."""
    from hermes.ask import Deadline
    d = Deadline(0.02)
    d.pause()
    out, _ = await engine_runner._communicate_within(
        _FakeProc(0.05), None, d, poll_s=0.005)
    assert out == b"out"


async def test_run_engine_honours_a_supplied_deadline(tmp_path, fake_echo):
    from hermes.ask import Deadline
    res = await engine_runner.run_engine("claude", "hi", tmp_path, timeout_s=30,
                                         deadline=Deadline(30))
    assert res.ok and "ECHO:hi" in res.stdout


def test_resolve_finds_shim_in_extra_tool_dir_when_path_lacks_it(tmp_path, monkeypatch):
    """The bot-process trap: engine installed, but its dir is not on the
    process PATH. _resolve must still find it via _extra_tool_dirs. A .cmd shim
    is wrapped in cmd /c, exactly as a real npm-global claude.cmd would be."""
    shim = tmp_path / "myengine.cmd"
    shim.write_text("@echo off\n")
    monkeypatch.setattr(engine_runner, "_extra_tool_dirs", lambda: [str(tmp_path)])
    monkeypatch.setenv("PATH", "")  # engine is NOT on PATH

    resolved = engine_runner._resolve(["myengine", "-p"])
    assert resolved[0] == "cmd" and resolved[1] == "/c"
    assert resolved[2].lower() == str(shim).lower()
    assert resolved[3:] == ["-p"]

def test_resolve_still_raises_when_nowhere_to_be_found(monkeypatch):
    monkeypatch.setattr(engine_runner, "_extra_tool_dirs", lambda: [])
    monkeypatch.setenv("PATH", "")
    with pytest.raises(FileNotFoundError):
        engine_runner._resolve(["definitely-not-a-real-engine-binary", "-p"])

def test_extra_tool_dirs_skips_missing_dirs(monkeypatch, tmp_path):
    """A missing env var or non-existent dir must never widen the search."""
    monkeypatch.setenv("APPDATA", str(tmp_path / "nope-appdata"))
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    assert engine_runner._extra_tool_dirs() == []
    real = tmp_path / "npm"; real.mkdir()
    monkeypatch.setenv("APPDATA", str(tmp_path))
    assert str(real) in engine_runner._extra_tool_dirs()
