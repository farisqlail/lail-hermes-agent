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


async def test_web_chat_endpoints(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    # Create mock bridge and ask registry
    class FakeBridge:
        def __init__(self):
            self.confirm_reasons = {}
            self.pending = {}
            self.tasks_handled = []
            self.confirms_resolved = []
            
        async def handle_task(self, user_id, chat_id, text, task_id=None, trusted=False):
            self.tasks_handled.append((user_id, chat_id, text, task_id))
            store.create_task(task_id, chat_id, text)

        async def resolve_confirm(self, user_id, task_id, approved, trusted=False):
            self.confirms_resolved.append((user_id, task_id, approved))

    from hermes.ask import AskRegistry
    ask_registry = AskRegistry()
    bridge = FakeBridge()

    app = create_app(store, bridge=bridge, ask_registry=ask_registry)
    client = TestClient(app)

    # 1. Test POST /api/tasks
    r = client.post("/api/tasks", json={"text": "/task hello from web"})
    assert r.status_code == 200
    task_id = r.json()["task_id"]
    assert task_id is not None
    assert len(bridge.tasks_handled) == 1
    assert bridge.tasks_handled[0][2] == "hello from web"
    assert bridge.tasks_handled[0][3] == task_id

    # 2. Test GET /api/tasks/{task_id} with pending confirm
    bridge.confirm_reasons[task_id] = ["test risky action"]
    r = client.get(f"/api/tasks/{task_id}")
    assert r.status_code == 200
    assert r.json()["pending_confirm"] == ["test risky action"]

    # 3. Test POST /api/tasks/{task_id}/confirm
    r = client.post(f"/api/tasks/{task_id}/confirm", json={"approved": True})
    assert r.status_code == 200
    assert len(bridge.confirms_resolved) == 1
    assert bridge.confirms_resolved[0] == (0, task_id, True)

    # 4. Test GET /api/tasks/{task_id} with pending ask
    from hermes.ask import Deadline
    import asyncio
    run_token = ask_registry.open_run(task_id, 0, Deadline(10))
    run = ask_registry.run_for_token(run_token)
    
    # We must mock on_ask to not raise
    async def dummy_on_ask(a): pass
    ask_registry.on_ask = dummy_on_ask
    
    # Create the ask task
    ask_fut = asyncio.create_task(ask_registry.ask(run, "Which model?", [{"label": "Model A"}]))
    await asyncio.sleep(0)
    
    r = client.get(f"/api/tasks/{task_id}")
    assert r.status_code == 200
    assert r.json()["pending_ask"]["question"] == "Which model?"
    assert r.json()["pending_ask"]["options"] == [{"label": "Model A"}]
    
    # 5. Test POST /api/tasks/{task_id}/answer (option selection)
    ask_id = r.json()["pending_ask"]["ask_id"]
    r = client.post(f"/api/tasks/{task_id}/answer", json={"ask_id": ask_id, "options": [0]})
    assert r.status_code == 200
    
    # Wait for the future to finish to prevent warnings
    await ask_fut

    # 6. Test casual conversation
    r = client.post("/api/tasks", json={"text": "halo"})
    assert r.status_code == 200
    chat_task_id = r.json()["task_id"]
    assert r.json()["status"] == "done"
    
    r = client.get(f"/api/tasks/{chat_task_id}")
    assert r.status_code == 200
    assert any("Chat Conversation" in line for line in r.json()["logs"])

    # 7. Test task list filtering (casual conversation should be excluded, /task included)
    r = client.get("/api/tasks")
    assert r.status_code == 200
    task_ids_list = [t["task_id"] for t in r.json()]
    assert task_id in task_ids_list
    assert chat_task_id not in task_ids_list


async def test_web_task_crash_marks_failed(hermes_home):
    """A raising handle_task must not be swallowed at GC: the done-callback
    marks the task failed and records why, the way crash_reporter does on the
    Telegram side."""
    import asyncio
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class BoomBridge:
        confirm_reasons: dict = {}
        async def handle_task(self, user_id, chat_id, text, task_id=None, trusted=False):
            store.create_task(task_id, chat_id, text)
            raise RuntimeError("boom")

    app = create_app(store, bridge=BoomBridge())
    client = TestClient(app)

    r = client.post("/api/tasks", json={"text": "/task will explode"})
    assert r.status_code == 200
    task_id = r.json()["task_id"]

    # The background task and its done-callback run inside the endpoint's loop;
    # give it ticks to complete, then assert the crash surfaced.
    for _ in range(10):
        await asyncio.sleep(0)
        if (store.get_task(task_id) or {}).get("status") == "failed":
            break
    assert (store.get_task(task_id) or {}).get("status") == "failed"
    assert any("background task crashed" in line for line in store.get_logs(task_id))


def test_chat_conversation_uses_llm_with_memory(hermes_home):
    """The non-command branch calls the chat agent with the running history
    (T1) and remembers prior turns (T2), and its reply is persisted."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    seen_histories = []
    async def fake_chat(history, tools=None, dispatch=None):
        seen_histories.append([m["content"] for m in history])
        return f"echo:{history[-1]['content']}"

    client = TestClient(create_app(store, chat=fake_chat))

    # Turn 1
    r = client.post("/api/tasks", json={"text": "halo hermes"})
    assert r.status_code == 200 and r.json()["status"] == "done"
    # The history handed to the model includes the message it replies to.
    assert seen_histories[0] == ["halo hermes"]
    # Reply persisted to the task and the conversation thread.
    assert any("echo:halo hermes" in line for line in store.get_logs(r.json()["task_id"]))

    # Turn 2 — memory: turn 1 (both roles) precedes the new user message.
    r = client.post("/api/tasks", json={"text": "lanjut"})
    assert seen_histories[1] == ["halo hermes", "echo:halo hermes", "lanjut"]

    # GET history mirrors the thread; reset clears it.
    got = client.get("/api/chat").json()["messages"]
    assert [m["content"] for m in got] == ["halo hermes", "echo:halo hermes",
                                           "lanjut", "echo:lanjut"]
    assert client.post("/api/chat/reset").status_code == 200
    assert client.get("/api/chat").json()["messages"] == []


def test_chat_llm_failure_becomes_assistant_turn(hermes_home):
    """A raising chat agent must not 500 the pane; the error is recorded as the
    assistant's reply so the thread stays coherent."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def boom_chat(history, tools=None, dispatch=None):
        raise RuntimeError("nim down")

    client = TestClient(create_app(store, chat=boom_chat))
    r = client.post("/api/tasks", json={"text": "halo"})
    assert r.status_code == 200 and r.json()["status"] == "done"
    logs = store.get_logs(r.json()["task_id"])
    assert any("chat gagal" in line and "nim down" in line for line in logs)


def test_chat_without_agent_falls_back_to_canned_reply(hermes_home):
    """chat=None (no NIM wired) still answers, so the pane is never dead."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))  # no chat
    r = client.post("/api/tasks", json={"text": "halo"})
    assert r.status_code == 200
    assert any("/task" in line for line in store.get_logs(r.json()["task_id"]))


async def test_chat_tools_query_state_and_propose_task(hermes_home):
    """T4: the agent's tools read real state (projects, tasks) and start_task
    only QUEUES a task held for the operator's confirm — never runs it."""
    import json as _json, asyncio
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    proj_dir = hermes_home / "myprofit"; proj_dir.mkdir()
    config.save_settings(config.Settings(projects={"myprofit": str(proj_dir)}))

    store.create_task("seed1", 0, "build seed")
    store.set_task_status("seed1", "done")
    store.append_log("seed1", "step 0 [code]: ok")

    class FakeBridge:
        def __init__(self):
            self.confirm_reasons = {}
            self.calls = []
        async def handle_task(self, user_id, chat_id, text, task_id=None,
                              trusted=False, force_confirm=False):
            self.calls.append((text, trusted, force_confirm))
            store.create_task(task_id, chat_id, text)
            if force_confirm:
                self.confirm_reasons[task_id] = ["chat"]
                store.set_task_status(task_id, "awaiting_confirm")
    bridge = FakeBridge()

    out = {}
    async def tool_chat(history, tools=None, dispatch=None):
        out["tool_names"] = [t["function"]["name"] for t in tools]
        out["projects"] = _json.loads(await dispatch("list_projects", {}))
        out["recent"] = _json.loads(await dispatch("recent_tasks", {"limit": 5}))
        out["detail"] = _json.loads(await dispatch("get_task_detail", {"task_id": "seed1"}))
        out["missing"] = _json.loads(await dispatch("get_task_detail", {"task_id": "nope"}))
        out["start"] = _json.loads(await dispatch("start_task", {"description": "@myprofit test"}))
        return "Task diusulkan, menunggu konfirmasi."

    client = TestClient(create_app(store, bridge=bridge, chat=tool_chat))
    r = client.post("/api/tasks", json={"text": "cek proyek lalu jalankan test"})
    assert r.status_code == 200

    assert out["tool_names"] == ["list_projects", "recent_tasks",
                                 "get_task_detail", "start_task"]
    assert out["projects"] == [{"name": "myprofit", "path": str(proj_dir), "exists": True}]
    assert any(t["task_id"] == "seed1" for t in out["recent"])
    assert out["detail"]["status"] == "done"
    assert "step 0 [code]: ok" in out["detail"]["logs"]
    assert "error" in out["missing"]

    # start_task queues, held for confirm; bridge saw trusted + force_confirm
    assert out["start"]["status"] == "awaiting_confirm"
    assert bridge.calls and bridge.calls[0][1] is True and bridge.calls[0][2] is True

    # the fire-and-forget handle_task settles the task to awaiting_confirm
    new_id = out["start"]["task_id"]
    for _ in range(10):
        await asyncio.sleep(0)
        if (store.get_task(new_id) or {}).get("status") == "awaiting_confirm":
            break
    assert (store.get_task(new_id) or {}).get("status") == "awaiting_confirm"
