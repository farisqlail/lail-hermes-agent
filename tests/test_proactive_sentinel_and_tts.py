import pytest, asyncio, tempfile
from pathlib import Path
from hermes.session_store import Store
from hermes import tts, proactive, config


def test_tts_available_and_synthesize(tmp_path):
    assert tts.available() is True


@pytest.mark.asyncio
async def test_tts_synthesize_file(tmp_path):
    out_file = tmp_path / "test.mp3"
    # Small fast synthesis test
    res = await tts.synthesize("Halo ini pengujian suara Hermes.", out_file)
    assert Path(res).is_file()
    assert Path(res).stat().st_size > 0


def test_recall_facts_and_tasks_semantic_ranking(tmp_path):
    store = Store(tmp_path / "test.db")
    store.init_schema()

    # Add facts
    store.set_fact("backend_db", "Database yang digunakan adalah PostgreSQL dengan schema public.")
    store.set_fact("ui_color", "Warna primer brand adalah hijau emerald #10B981.")
    store.set_fact("auth_system", "Autentikasi menggunakan JWT Bearer token pada header Authorization.")

    # Query facts
    res_db = store.recall_facts("postgresql database")
    assert len(res_db) >= 1
    assert res_db[0]["key"] == "backend_db"

    res_auth = store.recall_facts("jwt token")
    assert len(res_auth) >= 1
    assert res_auth[0]["key"] == "auth_system"


@pytest.mark.asyncio
async def test_web_ui_scheduled_jobs_endpoints(tmp_path):
    from fastapi.testclient import TestClient
    from hermes.web_ui import create_app

    store = Store(tmp_path / "test.db")
    store.init_schema()
    app = create_app(store)
    client = TestClient(app)

    # Post new scheduled job
    r = client.post("/api/scheduled-jobs", json={
        "description": "run health check",
        "interval_s": 3600,
        "delay_s": 10,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    job_id = data["job_id"]

    # List scheduled jobs
    r = client.get("/api/scheduled-jobs")
    assert r.status_code == 200
    jobs = r.json()
    assert len(jobs) == 1
    assert jobs[0]["job_id"] == job_id

    # Gallery endpoint
    r = client.get("/api/stitch/gallery")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    # Delete scheduled job
    r = client.delete(f"/api/scheduled-jobs/{job_id}")
    assert r.status_code == 200
    assert r.json()["ok"] is True
