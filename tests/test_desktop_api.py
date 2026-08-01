from fastapi.testclient import TestClient
from hermes.web_ui import create_app
from hermes.session_store import Store
from hermes import paths
from hermes.desktop_api import DesktopState


# ── pure state, time injected ──

def test_browser_offline_until_first_heartbeat():
    st = DesktopState()
    assert st.browser_online(0) is False


def test_browser_online_within_window_offline_after():
    st = DesktopState()
    st.heartbeat("listen", 1000)
    assert st.state == "listen"
    assert st.browser_online(1000, window_ms=5000) is True
    assert st.browser_online(5999, window_ms=5000) is True
    assert st.browser_online(6001, window_ms=5000) is False


def test_wake_is_a_latch_read_once():
    st = DesktopState()
    assert st.take_wake() is False
    st.raise_wake()
    assert st.take_wake() is True
    # Cleared on read: a second poll does not start a second capture.
    assert st.take_wake() is False


# ── endpoints ──

def _client(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    return TestClient(create_app(store))


def test_state_post_then_get_roundtrips(hermes_home):
    client = _client(hermes_home)
    r = client.post("/api/voice/state", json={"state": "think"})
    assert r.status_code == 200
    assert r.json()["state"] == "think"
    assert r.json()["browser_online"] is True

    r = client.get("/api/voice/state")
    assert r.json()["state"] == "think"


def test_state_post_rejects_unknown_state(hermes_home):
    client = _client(hermes_home)
    r = client.post("/api/voice/state", json={"state": "dancing"})
    assert r.status_code == 422


def test_wake_flows_from_post_to_get(hermes_home):
    client = _client(hermes_home)
    # Nothing pending yet.
    assert client.get("/api/voice/wake").json()["wake"] is False
    # Helper raises it.
    client.post("/api/voice/wake")
    # Browser collects it exactly once.
    assert client.get("/api/voice/wake").json()["wake"] is True
    assert client.get("/api/voice/wake").json()["wake"] is False


def test_wake_reports_browser_online_after_heartbeat(hermes_home):
    client = _client(hermes_home)
    assert client.post("/api/voice/wake").json()["browser_online"] is False
    client.post("/api/voice/state", json={"state": "idle"})
    assert client.post("/api/voice/wake").json()["browser_online"] is True
