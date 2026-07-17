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

def test_resolve_passes_through_real_path():
    argv = engine_runner._resolve([sys.executable, "-c", "pass"])
    assert argv[0].lower().endswith(".exe")
    assert argv[1:] == ["-c", "pass"]
