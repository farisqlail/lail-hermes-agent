from __future__ import annotations
import asyncio
from dataclasses import dataclass
from pathlib import Path

@dataclass
class TestResult:
    ok: bool
    screenshot_path: str | None
    detail: str

# One emulator, one adb target. Two tasks running concurrently would otherwise
# interleave install/launch/screencap on the same device and each would report
# the other's screen. The lock is taken BEFORE the timeout starts on purpose: a
# queued task must not burn its own budget waiting for the device, or one slow
# emulator run would time out every task behind it before it ever got a turn.
# ponytail: one global lock; key it per-AVD if a second device ever appears.
_emulator_lock = asyncio.Lock()


async def test_emulator(apk_path: str, avd: str, out_dir: Path,
                        timeout_s: int, adb, pkg: str) -> TestResult:
    async with _emulator_lock:
        try:
            return await asyncio.wait_for(
                _emulator_flow(apk_path, avd, out_dir, adb, pkg), timeout=timeout_s)
        except asyncio.TimeoutError:
            return TestResult(False, None, f"emulator test timed out after {timeout_s}s")

async def _emulator_flow(apk_path: str, avd: str, out_dir: Path,
                         adb, pkg: str) -> TestResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    if not pkg:
        return TestResult(False, None, "no application id — cannot launch app")
    if not await adb.is_running():
        ok, d = await adb.start(avd)
        if not ok:
            return TestResult(False, None, f"emulator start failed: {d}")
    ok, d = await adb.install(apk_path)
    if not ok:
        return TestResult(False, None, f"install failed: {d}")
    ok, d = await adb.launch(pkg)
    if not ok:
        return TestResult(False, None, f"launch failed: {d}")
    shot = out_dir / "emulator.png"
    ok, d = await adb.screencap(str(shot))
    if not ok:
        return TestResult(False, None, f"screencap failed: {d}")
    return TestResult(True, str(shot), "ok")

async def test_browser(url: str, out_dir: Path, timeout_s: int,
                       capture=None) -> TestResult:
    try:
        return await asyncio.wait_for(
            _browser_flow(url, out_dir, capture), timeout=timeout_s)
    except asyncio.TimeoutError:
        return TestResult(False, None, f"browser test timed out after {timeout_s}s")

async def _browser_flow(url: str, out_dir: Path, capture) -> TestResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    shot = out_dir / "browser.png"
    if capture is None:
        capture = _playwright_capture
    ok, d = await capture(url, str(shot))
    if not ok:
        return TestResult(False, None, d)
    return TestResult(True, str(shot), "ok")

async def _playwright_capture(url: str, dest: str):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        # Headless on purpose: this is automated screenshot capture, not a
        # browser opened for the user. It must never pop a visible Chromium
        # window — the user's default browser is Arc, and Playwright cannot
        # drive Arc, so the only safe behaviour is to stay invisible.
        b = await p.chromium.launch(headless=True)
        page = await b.new_page()
        await page.goto(url)
        await page.screenshot(path=dest)
        await b.close()
    return (True, "")


async def test_unit(project_dir: Path, timeout_s: int, run=None) -> TestResult:
    """Run unit/integration test suite (Jest / npm test / pytest) for a project."""
    try:
        if run is None:
            run = _default_unit_run
        return await asyncio.wait_for(run(project_dir, timeout_s), timeout=timeout_s)
    except asyncio.TimeoutError:
        return TestResult(False, None, f"unit test timed out after {timeout_s}s")
    except Exception as e:
        return TestResult(False, None, f"unit test failed: {e}")


async def _default_unit_run(project_dir: Path, timeout_s: int) -> TestResult:
    import sys
    is_win = sys.platform == "win32"
    if (project_dir / "package.json").exists():
        npm_cmd = "npm.cmd" if is_win else "npm"
        argv = [npm_cmd, "test", "--", "--ci"]
    elif (project_dir / "pyproject.toml").exists() or (project_dir / "pytest.ini").exists():
        pytest_cmd = "pytest.exe" if is_win else "pytest"
        argv = [pytest_cmd]
    elif (project_dir / "pubspec.yaml").exists():
        flutter_cmd = "flutter.bat" if is_win else "flutter"
        argv = [flutter_cmd, "test"]
    else:
        return TestResult(False, None, "no recognized unit test configuration found")

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=str(project_dir),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        stdout_str = out.decode(errors="replace")
        stderr_str = err.decode(errors="replace")
        if proc.returncode == 0:
            return TestResult(True, None, stdout_str[:1000] or "unit tests passed")
        else:
            detail = stderr_str[:500] or stdout_str[:500] or "unit tests failed"
            return TestResult(False, None, detail)
    except FileNotFoundError:
        return TestResult(False, None, f"[WinError 2] The system cannot find the file specified: '{argv[0]}'")

