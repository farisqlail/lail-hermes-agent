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


async def fake_run_rn(argv, cwd, timeout):
    # a bare "gradlew.bat" would fail to launch on Windows (WinError 2) since
    # CreateProcess never searches the child's cwd; build_apk must resolve it
    # to an absolute path before calling run, so assert that here.
    assert Path(argv[0]).is_absolute()
    apk = Path(cwd) / "app/build/outputs/apk/release/app-release.apk"
    apk.parent.mkdir(parents=True, exist_ok=True)
    apk.write_bytes(b"APK")
    return (0, "built", "")


def _make_wrapper(cwd: Path):
    cwd.mkdir(parents=True, exist_ok=True)
    (cwd / "gradlew.bat").write_text("@echo off\n")


async def test_react_native_build_ok(tmp_path):
    _make_wrapper(tmp_path / "android")
    res = await build_runner.build_apk(tmp_path, "react_native", 60, run=fake_run_rn)
    assert res.ok
    assert res.apk_path.endswith("app-release.apk")
    assert "android" in res.apk_path.replace("\\", "/")
    assert Path(res.apk_path).exists()


async def test_android_build_ok(tmp_path):
    _make_wrapper(tmp_path)
    res = await build_runner.build_apk(tmp_path, "android", 60, run=fake_run_rn)
    assert res.ok and Path(res.apk_path).exists()


async def test_react_native_build_no_wrapper(tmp_path):
    res = await build_runner.build_apk(tmp_path, "react_native", 60, run=fake_run_rn)
    assert not res.ok
    assert "gradlew.bat not found" in res.stderr


async def fake_run_no_apk(argv, cwd, timeout):
    return (0, "built but no artifact", "")


async def test_build_rc0_but_apk_missing(tmp_path):
    res = await build_runner.build_apk(tmp_path, "flutter", 60, run=fake_run_no_apk)
    assert not res.ok and res.apk_path is None
    assert "not found" in res.stderr


async def test_unsupported_ptype(tmp_path):
    res = await build_runner.build_apk(tmp_path, "cordova", 60, run=fake_run_no_apk)
    assert not res.ok and res.apk_path is None


async def test_default_run_file_not_found(tmp_path):
    rc, out, err = await build_runner._default_run(["non_existent_tool_xyz_123"], tmp_path, 5)
    assert rc == 1
    assert "WinError 2" in err

