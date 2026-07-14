from pathlib import Path
from hermes import test_runner

class FakeAdb:
    def __init__(self): self.calls = []
    async def is_running(self): return True
    async def start(self, avd): self.calls.append(("start", avd)); return (True, "")
    async def install(self, apk): self.calls.append(("install", apk)); return (True, "")
    async def launch(self): self.calls.append(("launch",)); return (True, "")
    async def screencap(self, dest):
        Path(dest).write_bytes(b"PNG"); return (True, "")

async def test_emulator_flow(tmp_path):
    adb = FakeAdb()
    res = await test_runner.test_emulator("app.apk", "Pixel", tmp_path, 60, adb=adb)
    assert res.ok and Path(res.screenshot_path).exists()
    assert ("install", "app.apk") in adb.calls

async def test_browser_flow(tmp_path):
    async def fake_capture(url, dest):
        Path(dest).write_bytes(b"PNG"); return (True, "")
    res = await test_runner.test_browser("http://localhost:3000", tmp_path, 30, capture=fake_capture)
    assert res.ok and Path(res.screenshot_path).exists()
