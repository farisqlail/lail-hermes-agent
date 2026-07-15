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
