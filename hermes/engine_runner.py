from __future__ import annotations
import asyncio, os, shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

# each entry maps a prompt to an argv list; overridable in tests
# claude runs non-interactively (-p): it cannot prompt for tool permissions, so
# without --dangerously-skip-permissions every file edit is denied and the model
# churns until timeout. Safe here: engines run inside an isolated project dir
# and risky tasks are gated behind Telegram confirmation.
COMMANDS: dict[str, Callable[[str], list[str]]] = {
    "claude": lambda p: ["claude", "-p", "--dangerously-skip-permissions"],
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

def _argv(engine: str, prompt: str, model: str = "", effort: str = "") -> list[str]:
    argv = list(COMMANDS[engine](prompt))
    if model and engine in MODEL_FLAG:
        argv += ["--model", model]
    if effort and engine in EFFORT_FLAG:
        argv += ["--effort", effort]
    return argv

@dataclass
class RunResult:
    ok: bool
    stdout: str
    stderr: str
    timed_out: bool
    returncode: int | None

def _resolve(argv: list[str]) -> list[str]:
    """Resolve argv[0] to something CreateProcess can actually run.

    npm installs CLIs as .cmd/.ps1 shims; create_subprocess_exec does not apply
    PATHEXT, so bare names like "claude" raise WinError 2. Prefer a real .exe,
    then wrap script shims in their interpreter.
    """
    name = argv[0]
    exe = None
    for ext in (".exe", ".cmd", ".bat", ".ps1"):
        exe = shutil.which(name + ext)
        if exe:
            break
    exe = exe or shutil.which(name)
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
                     model: str = "", effort: str = "") -> RunResult:
    argv = _resolve(_argv(engine, prompt, model, effort))
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
    return RunResult(proc.returncode == 0,
                     out.decode(errors="replace"),
                     err.decode(errors="replace"),
                     False, proc.returncode)
