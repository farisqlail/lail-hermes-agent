from fastapi.testclient import TestClient
from hermes.web_ui import create_app
from hermes.session_store import Store
from hermes import config, paths

def test_settings_roundtrip_api(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    r = client.get("/api/settings")
    assert r.status_code == 200

    body = config.Settings(model="qwen/qwen2.5-coder-32b-instruct",
                           allowed_user_ids=[7]).model_dump()
    r = client.post("/api/settings", json=body)
    assert r.status_code == 200
    assert config.load_settings().model == "qwen/qwen2.5-coder-32b-instruct"

def test_settings_post_malformed_returns_422(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    r = client.post("/api/settings", json={"timeout_code_s": "not-a-number"})
    assert r.status_code == 422
    r = client.post("/api/settings", json={"default_engine": "bogus"})
    assert r.status_code == 422
    r = client.post("/api/settings", json={"claude_effort": "turbo"})
    assert r.status_code == 422
    r = client.post("/api/settings", json={"claude_model": "has space"})
    assert r.status_code == 422
    r = client.post("/api/settings", json={"agy_model": "line\nbreak"})
    assert r.status_code == 422
    # agy display names with spaces are valid, not malformed
    r = client.post("/api/settings", json={"agy_model": "Gemini 3.5 Flash (High)"})
    assert r.status_code == 200

def test_mcp_post_malformed_returns_422(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    r = client.post("/api/mcp", json=[{"name": "x", "type": "carrier-pigeon"}])
    assert r.status_code == 422
    r = client.post("/api/mcp", json={"not": "a list"})
    assert r.status_code == 422

def test_secrets_post_invalid_token_returns_422(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    r = client.post("/api/secrets", json={
        "telegram_bot_token": "This is not a token at all, just a sentence"})
    assert r.status_code == 422
    # valid-shaped token accepted
    r = client.post("/api/secrets", json={
        "telegram_bot_token": "1234567890:" + "A" * 35})
    assert r.status_code == 200

def test_secrets_post_invalid_api_key_returns_422(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    r = client.post("/api/secrets", json={"nvidia_api_key": "nvapi-abc’def"})
    assert r.status_code == 422
    r = client.post("/api/secrets", json={"nvidia_api_key": "nvapi-has space"})
    assert r.status_code == 422
    r = client.post("/api/secrets", json={"nvidia_api_key": "nvapi-validkey123"})
    assert r.status_code == 200

def test_secrets_masked(hermes_home):
    paths.ensure_dirs()
    config.save_secrets(config.Secrets(nvidia_api_key="real", telegram_bot_token=""))
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    r = client.get("/api/settings")
    # secrets endpoint masks
    r2 = client.get("/api/secrets/status")
    assert r2.json()["nvidia_api_key_set"] is True

def test_secrets_preserved_on_mask(hermes_home):
    paths.ensure_dirs()
    config.save_secrets(config.Secrets(nvidia_api_key="real", telegram_bot_token="tok"))
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    newtok = "1234567890:" + "B" * 35
    client.post("/api/secrets", json={"nvidia_api_key": "***", "telegram_bot_token": newtok})
    sec = config.load_secrets()
    assert sec.nvidia_api_key == "real"       # unchanged
    assert sec.telegram_bot_token == newtok   # updated

def test_tasks_api(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.create_task("t1", 5, "hello")
    client = TestClient(create_app(store))
    assert client.get("/api/tasks").json()[0]["task_id"] == "t1"

def test_artifacts_endpoints(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    # Create dummy artifact inside hermes home
    artifact_dir = paths.artifacts_dir() / "t1"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    art_file = artifact_dir / "test.png"
    art_file.write_bytes(b"PNG_DATA")

    # Success cases
    r = client.get(f"/api/artifacts/download?path={art_file}")
    assert r.status_code == 200
    assert r.content == b"PNG_DATA"

    r = client.get(f"/api/artifacts/view?path={art_file}")
    assert r.status_code == 200
    assert r.content == b"PNG_DATA"

    # Security check: attempt path traversal outside HERMES_HOME
    outside_file = hermes_home.parent / "outside.txt"
    outside_file.write_text("secrets")

    r = client.get(f"/api/artifacts/download?path={outside_file}")
    assert r.status_code == 403

    r = client.get(f"/api/artifacts/view?path={outside_file}")
    assert r.status_code == 403

    # Not found case
    r = client.get(f"/api/artifacts/view?path={artifact_dir}/nonexistent.png")
    assert r.status_code == 404

def test_engine_models_falls_back_when_agy_unreachable(hermes_home, monkeypatch):
    from hermes import web_ui
    monkeypatch.setattr(web_ui, "list_agy_models", lambda timeout_s=10.0: None)
    monkeypatch.setattr(web_ui, "_agy_cache", {"at": 0.0, "models": None})
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    r = client.get("/api/engine-models")
    assert r.status_code == 200
    body = r.json()
    assert "opus" in body["claude"] and "claude-fable-5" in body["claude"]
    assert body["agy"] == ["Gemini 3.5 Flash (High)"]   # static fallback
    assert body["agy_live"] is False


def test_engine_models_uses_live_agy_list_and_caches_it(hermes_home, monkeypatch):
    from hermes import web_ui
    calls = []
    def fake_list(timeout_s=10.0):
        calls.append(1)
        return ["Gemini 3.5 Flash (High)", "Gemini 3.5 Pro (High)"]
    monkeypatch.setattr(web_ui, "list_agy_models", fake_list)
    monkeypatch.setattr(web_ui, "_agy_cache", {"at": 0.0, "models": None})
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    body = client.get("/api/engine-models").json()
    assert body["agy"] == ["Gemini 3.5 Flash (High)", "Gemini 3.5 Pro (High)"]
    assert body["agy_live"] is True
    client.get("/api/engine-models")
    assert len(calls) == 1                              # second hit served from cache


def test_list_agy_models_parses_cli_output(monkeypatch):
    from hermes import web_ui
    import shutil
    class FakeResult:
        returncode = 0
        stdout = ("Available models:\n"
                  "* Gemini 3.5 Flash (High)\n"
                  "- Gemini 3.5 Pro (High)\n"
                  "\n")
    monkeypatch.setattr(shutil, "which", lambda name: "C:/fake/agy.exe")
    monkeypatch.setattr(web_ui.subprocess, "run", lambda *a, **k: FakeResult)
    assert web_ui.list_agy_models() == [
        "Gemini 3.5 Flash (High)", "Gemini 3.5 Pro (High)"]


def test_list_agy_models_none_when_missing_or_hanging(monkeypatch):
    from hermes import web_ui
    import shutil, subprocess as sp
    monkeypatch.setattr(shutil, "which", lambda name: None)
    assert web_ui.list_agy_models() is None             # agy not installed

    monkeypatch.setattr(shutil, "which", lambda name: "C:/fake/agy.exe")
    def hang(*a, **k): raise sp.TimeoutExpired(cmd="agy models", timeout=10)
    monkeypatch.setattr(web_ui.subprocess, "run", hang)
    assert web_ui.list_agy_models() is None             # auth/network hang


def test_projects_get_reports_existence(hermes_home, tmp_path):
    paths.ensure_dirs()
    here = tmp_path / "here"; here.mkdir()
    gone = tmp_path / "gone"
    s = config.load_settings()
    s.projects = {"here": str(here), "gone": str(gone)}
    config.save_settings(s)
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    r = client.get("/api/projects")
    assert r.status_code == 200
    by_name = {p["name"]: p for p in r.json()}
    assert by_name["here"] == {"name": "here", "path": str(here), "exists": True}
    assert by_name["gone"]["exists"] is False   # listed, flagged, not an error


def test_projects_post_saves_registry(hermes_home, tmp_path):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    r = client.post("/api/projects", json={"myprofit": str(tmp_path)})
    assert r.status_code == 200
    assert config.load_settings().projects == {"myprofit": str(tmp_path)}

    # Posting {} clears the registry (delete-last-project path in the UI).
    r = client.post("/api/projects", json={})
    assert r.status_code == 200
    assert config.load_settings().projects == {}


def test_projects_post_preserves_other_settings(hermes_home, tmp_path):
    paths.ensure_dirs()
    s = config.load_settings()
    s.model = "qwen/qwen2.5-coder-32b-instruct"
    config.save_settings(s)
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    client.post("/api/projects", json={"myprofit": str(tmp_path)})
    assert config.load_settings().model == "qwen/qwen2.5-coder-32b-instruct"


def test_projects_post_rejects_bad_entries_with_specific_message(hermes_home, tmp_path):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    r = client.post("/api/projects", json={"myprofit": "relative/path"})
    assert r.status_code == 422
    assert "absolute" in r.json()["detail"]

    r = client.post("/api/projects", json={"..": "C:\\Windows"})
    assert r.status_code == 422
    assert "project name" in r.json()["detail"]

    # Rejected posts must not clobber the stored registry.
    client.post("/api/projects", json={"good": str(tmp_path)})
    client.post("/api/projects", json={"bad name": str(tmp_path)})
    assert config.load_settings().projects == {"good": str(tmp_path)}


def test_settings_post_accepts_projects_registry(hermes_home, tmp_path):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    body = config.Settings(projects={"myprofit": str(tmp_path)}).model_dump()
    r = client.post("/api/settings", json=body)
    assert r.status_code == 200
    assert config.load_settings().projects == {"myprofit": str(tmp_path)}


def test_settings_post_rejects_bad_project_registry(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    r = client.post("/api/settings", json={"projects": {"myprofit": "relative/path"}})
    assert r.status_code == 422
    r = client.post("/api/settings", json={"projects": {"..": "C:\\Windows"}})
    assert r.status_code == 422
