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
