from hermes.project_detect import detect, detect_app_id

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

def test_app_id_gradle_groovy(tmp_path):
    d = tmp_path / "android" / "app"
    d.mkdir(parents=True)
    (d / "build.gradle").write_text(
        'android {\n  defaultConfig {\n    applicationId "com.example.counter"\n  }\n}\n')
    assert detect_app_id(tmp_path) == "com.example.counter"

def test_app_id_gradle_kts(tmp_path):
    d = tmp_path / "app"
    d.mkdir()
    (d / "build.gradle.kts").write_text(
        'android {\n  defaultConfig {\n    applicationId = "com.example.kts"\n  }\n}\n')
    assert detect_app_id(tmp_path) == "com.example.kts"

def test_app_id_manifest_fallback(tmp_path):
    d = tmp_path / "android" / "app" / "src" / "main"
    d.mkdir(parents=True)
    (d / "AndroidManifest.xml").write_text(
        '<manifest package="com.example.manifest"/>')
    assert detect_app_id(tmp_path) == "com.example.manifest"

def test_app_id_missing(tmp_path):
    assert detect_app_id(tmp_path) is None
