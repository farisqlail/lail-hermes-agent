from __future__ import annotations
import asyncio, os, shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal
from .engine_result import EngineOutcome, parse_claude_json

# each entry maps a prompt to an argv list; overridable in tests
# claude runs non-interactively (-p): it cannot prompt for tool permissions, so
# without --dangerously-skip-permissions every file edit is denied and the model
# churns until timeout. Safe here: engines run inside an isolated project dir
# and risky tasks are gated behind Telegram confirmation.
COMMANDS: dict[str, Callable[[str], list[str]]] = {
    "claude": lambda p: ["claude", "-p", "--dangerously-skip-permissions",
                         "--output-format", "json"],
    "antigravity": lambda p: ["agy", "-p", p],
}
# engines that read the prompt from stdin instead of argv: sidesteps cmd.exe
# quoting of newlines/quotes and the 8191-char command-line limit on Windows
STDIN_PROMPT = {"claude"}
# which tuning flags each CLI accepts (verified against --help 2026-07-17):
# both take --model; only claude has --effort. An unknown flag crashes the
# engine on every step, so unsupported tuning is dropped, not passed through.
MODEL_FLAG = {"claude", "antigravity"}
EFFORT_FLAG = {"claude"}
# Engines whose sessions Hermes can name and reopen. agy has --conversation,
# but it only accepts ids agy itself issued and prints none of them in print
# mode, so there is nothing to hand back. It stays on fresh sessions.
RESUMABLE = {"claude"}
# agy's own print-mode budget defaults to 5m. Left alone, a 15m code step is
# killed by the engine at minute five and surfaces as an engine failure rather
# than a timeout. claude has no equivalent flag; asyncio's wait_for is its only
# clock.
PRINT_TIMEOUT_FLAG = {"antigravity"}
# Whose stdout carries a machine-readable envelope. Absent here means the
# engine is read as plain text, exactly as before this module existed.
PARSERS = {"claude": parse_claude_json}

def _argv(engine: str, prompt: str, model: str = "", effort: str = "",
          session_id: str = "", resume_id: str = "",
          timeout_s: int = 0) -> list[str]:
    argv = list(COMMANDS[engine](prompt))
    if model and engine in MODEL_FLAG:
        argv += ["--model", model]
    if effort and engine in EFFORT_FLAG:
        argv += ["--effort", effort]
    if engine in RESUMABLE:
        # Resume wins: passing both would ask claude to open a new session and
        # reopen an old one in the same invocation.
        if resume_id:
            argv += ["--resume", resume_id]
        elif session_id:
            argv += ["--session-id", session_id]
    if timeout_s and engine in PRINT_TIMEOUT_FLAG:
        argv += ["--print-timeout", f"{timeout_s}s"]
    return argv

@dataclass
class RunResult:
    ok: bool
    stdout: str
    stderr: str
    timed_out: bool
    returncode: int | None
    # None means the engine was read as text: either it emits no envelope, or
    # this run's stdout could not be parsed as one.
    outcome: EngineOutcome | None = None

    @property
    def final_text(self) -> str:
        """What the engine said last, as trustworthily as this run allows.

        With an outcome this is the model's own closing message — never tool
        output, never an echo of the prompt. Without one it degrades to raw
        stdout, which is what every caller read before structured output
        existed.
        """
        return self.outcome.final_text if self.outcome else self.stdout

def _extra_tool_dirs() -> list[str]:
    """Well-known install dirs for the engine CLIs, searched when the bot's
    PATH predates their install.

    A cmd window caches PATH at launch; start.bat's auto-restart loop reuses
    that env on every restart. A CLI installed (or PATH-registered) after the
    window opened is invisible to Hermes until the window is reopened — the
    "'claude' not found on PATH" trap even though `claude` runs fine in a fresh
    shell. npm publishes global shims to %APPDATA%\\npm; the antigravity CLI
    installs to %LOCALAPPDATA%\\agy\\bin. Searching these directly defuses it.
    Only existing dirs are returned, so a missing var never widens the search.
    """
    candidates = []
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(os.path.join(appdata, "npm"))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidates.append(os.path.join(local, "agy", "bin"))
    return [d for d in candidates if os.path.isdir(d)]

def _resolve(argv: list[str]) -> list[str]:
    """Resolve argv[0] to something CreateProcess can actually run.

    npm installs CLIs as .cmd/.ps1 shims; create_subprocess_exec does not apply
    PATHEXT, so bare names like "claude" raise WinError 2. Prefer a real .exe,
    then wrap script shims in their interpreter. The search covers PATH plus the
    known CLI install dirs (_extra_tool_dirs), so a stale-PATH bot process still
    finds an installed engine.
    """
    name = argv[0]
    search = os.pathsep.join(
        d for d in [os.environ.get("PATH", ""), *_extra_tool_dirs()] if d)
    exe = None
    for ext in (".exe", ".cmd", ".bat", ".ps1"):
        exe = shutil.which(name + ext, path=search)
        if exe:
            break
    exe = exe or shutil.which(name, path=search)
    if exe is None:
        raise FileNotFoundError(
            f"engine executable {name!r} not found on PATH — is it installed?")
    low = exe.lower()
    if low.endswith(".ps1"):
        return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", exe, *argv[1:]]
    if low.endswith((".cmd", ".bat")):
        return ["cmd", "/c", exe, *argv[1:]]
    return [exe, *argv[1:]]

async def run_engine(engine: Literal["claude", "antigravity"], prompt: str,
                     cwd: Path, timeout_s: int,
                     extra_env: dict | None = None,
                     model: str = "", effort: str = "",
                     session_id: str = "", resume_id: str = "") -> RunResult:
    argv = _resolve(_argv(engine, prompt, model, effort,
                          session_id, resume_id, timeout_s))
    env = {**os.environ, **(extra_env or {})}
    send = prompt.encode() if engine in STDIN_PROMPT else None
    proc = await asyncio.create_subprocess_exec(
        *argv, cwd=str(cwd), env=env,
        stdin=asyncio.subprocess.PIPE if send is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(send), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return RunResult(False, "", "", True, None)
    stdout = out.decode(errors="replace")
    parser = PARSERS.get(engine)
    outcome = parser(stdout) if parser else None
    # An API error kills the session but still exits 0, so returncode alone
    # called that a success. The envelope is the first thing able to see it.
    ok = proc.returncode == 0 and (outcome is None or outcome.api_error is None)
    return RunResult(ok, stdout, err.decode(errors="replace"),
                     False, proc.returncode, outcome)
