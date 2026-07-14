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
    client.post("/api/secrets", json={"nvidia_api_key": "***", "telegram_bot_token": "newtok"})
    sec = config.load_secrets()
    assert sec.nvidia_api_key == "real"        # unchanged
    assert sec.telegram_bot_token == "newtok"  # updated

def test_tasks_api(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.create_task("t1", 5, "hello")
    client = TestClient(create_app(store))
    assert client.get("/api/tasks").json()[0]["task_id"] == "t1"
