from __future__ import annotations
import asyncio, os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

# each entry maps a prompt to an argv list; overridable in tests
COMMANDS: dict[str, Callable[[str], list[str]]] = {
    "claude": lambda p: ["claude", "-p", p],
    "antigravity": lambda p: ["agy", "-p", p],
}

@dataclass
class RunResult:
    ok: bool
    stdout: str
    stderr: str
    timed_out: bool
    returncode: int | None

async def run_engine(engine: Literal["claude", "antigravity"], prompt: str,
                     cwd: Path, timeout_s: int,
                     extra_env: dict | None = None) -> RunResult:
    argv = COMMANDS[engine](prompt)
    env = {**os.environ, **(extra_env or {})}
    proc = await asyncio.create_subprocess_exec(
        *argv, cwd=str(cwd), env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return RunResult(False, "", "", True, None)
    return RunResult(proc.returncode == 0,
                     out.decode(errors="replace"),
                     err.decode(errors="replace"),
                     False, proc.returncode)
