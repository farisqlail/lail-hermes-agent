from __future__ import annotations
import asyncio
from dataclasses import dataclass
from pathlib import Path

@dataclass
class TestResult:
    ok: bool
    screenshot_path: str | None
    detail: str

async def test_emulator(apk_path: str, avd: str, out_dir: Path,
                        timeout_s: int, adb, pkg: str) -> TestResult:
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
        b = await p.chromium.launch()
        page = await b.new_page()
        await page.goto(url)
        await page.screenshot(path=dest)
        await b.close()
    return (True, "")
