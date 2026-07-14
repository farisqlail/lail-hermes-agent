from pathlib import Path
from hermes import build_runner

async def fake_run_ok(argv, cwd, timeout):
    # simulate flutter creating the apk
    apk = Path(cwd) / "build/app/outputs/flutter-apk/app-release.apk"
    apk.parent.mkdir(parents=True, exist_ok=True)
    apk.write_bytes(b"APK")
    return (0, "built", "")

async def fake_run_fail(argv, cwd, timeout):
    return (1, "", "gradle error")

async def test_flutter_build_ok(tmp_path):
    res = await build_runner.build_apk(tmp_path, "flutter", 60, run=fake_run_ok)
    assert res.ok and res.apk_path.endswith("app-release.apk")
    assert Path(res.apk_path).exists()

async def test_build_fail(tmp_path):
    res = await build_runner.build_apk(tmp_path, "flutter", 60, run=fake_run_fail)
    assert not res.ok and res.apk_path is None
