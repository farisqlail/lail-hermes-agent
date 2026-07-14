from __future__ import annotations
import asyncio
from dataclasses import dataclass
from pathlib import Path

@dataclass
class BuildResult:
    ok: bool
    apk_path: str | None
    stdout: str
    stderr: str

_SPECS = {
    "flutter": (["flutter", "build", "apk", "--release"], ".",
                "build/app/outputs/flutter-apk/app-release.apk"),
    "react_native": (["gradlew.bat", "assembleRelease"], "android",
                     "app/build/outputs/apk/release/app-release.apk"),
    "android": (["gradlew.bat", "assembleRelease"], ".",
                "app/build/outputs/apk/release/app-release.apk"),
}

async def _default_run(argv, cwd, timeout):
    proc = await asyncio.create_subprocess_exec(
        *argv, cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return (proc.returncode, out.decode(errors="replace"), err.decode(errors="replace"))

async def build_apk(project_dir: Path, ptype: str, timeout_s: int,
                    run=_default_run) -> BuildResult:
    if ptype not in _SPECS:
        return BuildResult(False, None, "", f"unsupported project type: {ptype}")
    argv, subdir, apk_rel = _SPECS[ptype]
    cwd = project_dir / subdir
    rc, out, err = await run(argv, cwd, timeout_s)
    if rc != 0:
        return BuildResult(False, None, out, err)
    # apk path is relative to the build cwd for RN (android subdir), else project root
    base = cwd if ptype == "react_native" else project_dir
    apk = base / apk_rel
    if not apk.exists():
        return BuildResult(False, None, out, f"apk not found at {apk}")
    return BuildResult(True, str(apk), out, err)
