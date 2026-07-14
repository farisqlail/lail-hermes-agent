from hermes.project_detect import detect

def test_flutter(tmp_path):
    (tmp_path / "pubspec.yaml").write_text("name: x")
    assert detect(tmp_path) == "flutter"

def test_react_native(tmp_path):
    (tmp_path / "package.json").write_text("{}")
    (tmp_path / "android").mkdir()
    assert detect(tmp_path) == "react_native"

def test_native_android(tmp_path):
    (tmp_path / "build.gradle").write_text("")
    assert detect(tmp_path) == "android"

def test_unknown(tmp_path):
    assert detect(tmp_path) == "unknown"
