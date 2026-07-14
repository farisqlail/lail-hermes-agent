import asyncio
from pathlib import Path
from hermes import test_runner

class FakeAdb:
    def __init__(self, running=True, start_ok=True, install_ok=True,
                 launch_ok=True, screencap_ok=True):
        self.calls = []
        self._running = running
        self._start_ok = start_ok
        self._install_ok = install_ok
        self._launch_ok = launch_ok
        self._screencap_ok = screencap_ok
    async def is_running(self): return self._running
    async def start(self, avd):
        self.calls.append(("start", avd)); return (self._start_ok, "boot err")
    async def install(self, apk):
        self.calls.append(("install", apk)); return (self._install_ok, "install err")
    async def launch(self, pkg):
        self.calls.append(("launch", pkg)); return (self._launch_ok, "launch err")
    async def screencap(self, dest):
        if self._screencap_ok:
            Path(dest).write_bytes(b"PNG")
        return (self._screencap_ok, "screencap err")

async def test_emulator_flow(tmp_path):
    adb = FakeAdb()
    res = await test_runner.test_emulator("app.apk", "Pixel", tmp_path, 60,
                                          adb=adb, pkg="com.example.app")
    assert res.ok and Path(res.screenshot_path).exists()
    assert ("install", "app.apk") in adb.calls
    assert ("launch", "com.example.app") in adb.calls

async def test_emulator_requires_pkg(tmp_path):
    res = await test_runner.test_emulator("app.apk", "Pixel", tmp_path, 60,
                                          adb=FakeAdb(), pkg="")
    assert not res.ok and "application id" in res.detail

async def test_emulator_start_failure(tmp_path):
    adb = FakeAdb(running=False, start_ok=False)
    res = await test_runner.test_emulator("app.apk", "Pixel", tmp_path, 60,
                                          adb=adb, pkg="com.x")
    assert not res.ok and "emulator start failed" in res.detail

async def test_emulator_install_failure(tmp_path):
    adb = FakeAdb(install_ok=False)
    res = await test_runner.test_emulator("app.apk", "Pixel", tmp_path, 60,
                                          adb=adb, pkg="com.x")
    assert not res.ok and "install failed" in res.detail

async def test_emulator_launch_failure(tmp_path):
    adb = FakeAdb(launch_ok=False)
    res = await test_runner.test_emulator("app.apk", "Pixel", tmp_path, 60,
                                          adb=adb, pkg="com.x")
    assert not res.ok and "launch failed" in res.detail

async def test_emulator_screencap_failure(tmp_path):
    adb = FakeAdb(screencap_ok=False)
    res = await test_runner.test_emulator("app.apk", "Pixel", tmp_path, 60,
                                          adb=adb, pkg="com.x")
    assert not res.ok and "screencap failed" in res.detail

async def test_emulator_timeout(tmp_path):
    class HangingAdb(FakeAdb):
        async def install(self, apk):
            await asyncio.sleep(30); return (True, "")
    res = await test_runner.test_emulator("app.apk", "Pixel", tmp_path, 0.05,
                                          adb=HangingAdb(), pkg="com.x")
    assert not res.ok and "timed out" in res.detail

async def test_browser_flow(tmp_path):
    async def fake_capture(url, dest):
        Path(dest).write_bytes(b"PNG"); return (True, "")
    res = await test_runner.test_browser("http://localhost:3000", tmp_path, 30, capture=fake_capture)
    assert res.ok and Path(res.screenshot_path).exists()

async def test_browser_timeout(tmp_path):
    async def hanging_capture(url, dest):
        await asyncio.sleep(30); return (True, "")
    res = await test_runner.test_browser("http://localhost:3000", tmp_path, 0.05,
                                         capture=hanging_capture)
    assert not res.ok and "timed out" in res.detail
