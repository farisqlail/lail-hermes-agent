import json
import asyncio

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
        # The first message is the situational context block, which is not part
        # of the conversation — the memory assertions below are about the rest.
        seen_histories.append([m["content"] for m in history[1:]])
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


def test_chat_stream_sse_streams_and_persists(hermes_home):
    """T3: /api/chat/stream emits SSE token deltas, a usage event, and a done
    event, and persists the full assembled reply once at the end."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def fake_chat(history, tools=None, dispatch=None):
        return "unused"
    async def fake_stream(history, tools=None, dispatch=None):
        for tok in ["Ha", "lo", " dunia"]:
            yield ("token", tok)
        yield ("usage", {"prompt": 3, "completion": 3, "total": 6})
    fake_chat.stream = fake_stream

    client = TestClient(create_app(store, chat=fake_chat))
    with client.stream("POST", "/api/chat/stream", json={"text": "hai"}) as r:
        assert r.status_code == 200
        body = "".join(r.iter_text())

    assert '"delta": "Ha"' in body
    assert "dunia" in body
    assert '"usage"' in body and '"total": 6' in body
    assert '"done": true' in body

    msgs = store.get_messages("web", 10)
    assert msgs[0]["content"] == "hai" and msgs[0]["role"] == "user"
    assert msgs[-1]["role"] == "assistant" and msgs[-1]["content"] == "Halo dunia"


def test_chat_stream_without_agent_streams_canned(hermes_home):
    """chat=None still streams a usable canned reply, never a dead pane."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))  # no chat
    with client.stream("POST", "/api/chat/stream", json={"text": "hai"}) as r:
        assert r.status_code == 200
        body = "".join(r.iter_text())
    assert "/task" in body and '"done": true' in body
    assert store.get_messages("web", 10)[-1]["role"] == "assistant"


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
                              trusted=False, force_confirm=False, on_decision=None):
            self.calls.append((text, trusted, force_confirm))
            store.create_task(task_id, chat_id, text)
            if force_confirm:
                self.confirm_reasons[task_id] = ["chat"]
                store.set_task_status(task_id, "awaiting_confirm")
                if on_decision:
                    on_decision("awaiting_confirm", ["chat"])
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
                                 "get_task_detail", "failure_report",
                                 "start_task", "calendar_events", "open_app",
                                 "integrate_mcp", "integrate_status",
                                 "integrate_secret"]
    assert out["projects"] == [{"name": "myprofit", "path": str(proj_dir), "exists": True}]
    assert any(t["task_id"] == "seed1" for t in out["recent"])
    assert out["detail"]["status"] == "done"
    assert "step 0 [code]: ok" in out["detail"]["logs"]
    assert "error" in out["missing"]

    # start_task reports the decision the bridge made, not a constant
    assert out["start"]["status"] == "awaiting_confirm"
    assert out["start"]["reasons"] == ["chat"]
    assert bridge.calls and bridge.calls[0][1] is True and bridge.calls[0][2] is True

    # the fire-and-forget handle_task settles the task to awaiting_confirm
    new_id = out["start"]["task_id"]
    for _ in range(10):
        await asyncio.sleep(0)
        if (store.get_task(new_id) or {}).get("status") == "awaiting_confirm":
            break
    assert (store.get_task(new_id) or {}).get("status") == "awaiting_confirm"


async def test_start_task_reports_a_run_that_started_on_its_own(hermes_home):
    """The tool result is what the chat model tells the operator. When the gate
    let the task run, saying 'menunggu Run' would be a lie — and that lie is
    the bug this whole change exists to fix."""
    import json as _json
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    proj_dir = hermes_home / "myprofit"; proj_dir.mkdir()
    config.save_settings(config.Settings(projects={"myprofit": str(proj_dir)}))

    class RunningBridge:
        def __init__(self):
            self.confirm_reasons = {}
        async def handle_task(self, user_id, chat_id, text, task_id=None,
                              trusted=False, force_confirm=False, on_decision=None):
            store.create_task(task_id, chat_id, text)
            store.set_task_status(task_id, "running")
            if on_decision:
                on_decision("running", [])

    out = {}
    async def tool_chat(history, tools=None, dispatch=None):
        out["start"] = _json.loads(
            await dispatch("start_task", {"description": "@myprofit tambah endpoint"}))
        return "Sudah saya kerjakan."

    client = TestClient(create_app(store, bridge=RunningBridge(), chat=tool_chat))
    r = client.post("/api/tasks", json={"text": "@myprofit tambah endpoint"})
    assert r.status_code == 200
    assert out["start"]["status"] == "running"
    assert out["start"]["reasons"] == []


async def test_start_task_says_so_when_the_gate_never_decides(hermes_home):
    """A bridge that never calls back must not be reported as anything. Guessing
    here would reintroduce the hardcoded status this task removes."""
    import json as _json
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class SilentBridge:
        def __init__(self):
            self.confirm_reasons = {}
        async def handle_task(self, user_id, chat_id, text, task_id=None,
                              trusted=False, force_confirm=False, on_decision=None):
            store.create_task(task_id, chat_id, text)

    out = {}
    async def tool_chat(history, tools=None, dispatch=None):
        out["start"] = _json.loads(await dispatch("start_task", {"description": "apa saja"}))
        return "ok"

    from hermes import web_ui as _web_ui
    original = _web_ui.START_TASK_DECISION_TIMEOUT_S
    _web_ui.START_TASK_DECISION_TIMEOUT_S = 0.01
    try:
        client = TestClient(create_app(store, bridge=SilentBridge(), chat=tool_chat))
        r = client.post("/api/tasks", json={"text": "apa saja"})
        assert r.status_code == 200
    finally:
        _web_ui.START_TASK_DECISION_TIMEOUT_S = original

    assert out["start"]["status"] == "queued"
    assert "note" in out["start"]


async def test_tasks_events_sse_streams_live_updates(hermes_home):
    """Test that /api/tasks/events correctly streams events as they occur in the store."""
    import json, asyncio
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    app = create_app(store)
    route = next(r for r in app.routes if getattr(r, "path", None) == "/api/tasks/events")
    handler = route.endpoint

    class FakeRequest:
        async def is_disconnected(self):
            return False

    request = FakeRequest()
    response = await handler(request)
    assert response.media_type == "text/event-stream"

    async def trigger_events():
        await asyncio.sleep(0.05)
        store.create_task("event_task", 0, "test task")
        await asyncio.sleep(0.05)
        store.set_task_status("event_task", "running")

    bg_task = asyncio.create_task(trigger_events())

    events = []
    async for chunk in response.body_iterator:
        if chunk.startswith("data: "):
            data = json.loads(chunk[6:])
            events.append(data)
            if data.get("type") == "task_status" and data.get("status") == "running":
                break

    await bg_task

    assert any(ev.get("type") == "task_created" and ev.get("task_id") == "event_task" for ev in events)
    assert any(ev.get("type") == "task_status" and ev.get("task_id") == "event_task" and ev.get("status") == "running" for ev in events)

def test_static_serving_root_and_settings(hermes_home, monkeypatch):
    import shutil
    from pathlib import Path
    from hermes import web_ui
    
    # Reset cache
    web_ui.INDEX_HTML_CACHE = None

    # Setup fake static folder inside hermes folder to mock bundle existence
    static_dir = Path(hermes_home) / "app" / "hermes" / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    
    monkeypatch.setattr(web_ui, "STATIC_DIR", static_dir)

    # Write fake index.html and assets directly in static_dir
    index_html = static_dir / "index.html"
    index_html.write_text("<html>React App</html>", encoding="utf-8")
    
    app_js = static_dir / "app.js"
    app_js.write_text("console.log('test');", encoding="utf-8")
    app_css = static_dir / "app.css"
    app_css.write_text("body {}", encoding="utf-8")
    
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    
    # Test Root /
    r = client.get("/")
    assert r.status_code == 200
    assert "React App" in r.text
    assert "text/html" in r.headers.get("content-type", "")
    
    # Test /settings
    r = client.get("/settings")
    assert r.status_code == 200
    assert "React App" in r.text
    assert "text/html" in r.headers.get("content-type", "")
    
    # Test /assets/app.js
    r = client.get("/assets/app.js")
    assert r.status_code == 200
    assert r.text == "console.log('test');"
    
    # Test /assets/app.css
    r = client.get("/assets/app.css")
    assert r.status_code == 200
    assert r.text == "body {}"

    # Cleanup fake static directory
    shutil.rmtree(static_dir)

def test_static_serving_bundle_missing(hermes_home, monkeypatch):
    from pathlib import Path
    from hermes import web_ui
    
    # Reset cache
    web_ui.INDEX_HTML_CACHE = None

    # Ensure static directory does not exist or has no index.html
    static_dir = Path(hermes_home) / "app" / "hermes" / "static"
    if static_dir.exists():
        import shutil
        shutil.rmtree(static_dir)
        
    monkeypatch.setattr(web_ui, "STATIC_DIR", static_dir)

    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    
    # Test Root / when bundle is missing
    r = client.get("/")
    assert r.status_code == 200
    assert "Bundle Missing" in r.text
    assert "text/html" in r.headers.get("content-type", "")




def test_session_rename_reads_json_body(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))

    session_id = client.post("/api/sessions").json()["session_id"]
    r = client.post(f"/api/sessions/{session_id}/rename", json={"title": "Rencana rilis"})
    assert r.status_code == 200, r.text
    titles = [s["title"] for s in client.get("/api/sessions").json()]
    assert "Rencana rilis" in titles



async def test_web_task_awaiting_confirm_is_listed_and_runnable(hermes_home):
    """The chat pane draws its Run button from a task in GET /api/tasks whose
    status is awaiting_confirm, and posts to /confirm. A web task carries
    chat_id=0, so it has to survive the >=0 list filter and reach the bridge —
    otherwise the assistant says "press Run" and no button exists to press."""
    import asyncio
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    store.create_task("20260730-141410-9b2e4f", 0, "@v3 jalankan test")
    store.set_task_status("20260730-141410-9b2e4f", "awaiting_confirm")

    resolved = []
    class FakeBridge:
        async def resolve_confirm(self, user_id, task_id, approved, trusted=False):
            resolved.append((task_id, approved, trusted))

    app = create_app(store)
    app.state.bridge = FakeBridge()
    client = TestClient(app)

    listed = client.get("/api/tasks").json()
    entry = next(t for t in listed if t["task_id"] == "20260730-141410-9b2e4f")
    assert entry["status"] == "awaiting_confirm", "no awaiting_confirm, no Run button"

    r = client.post("/api/tasks/20260730-141410-9b2e4f/confirm", json={"approved": True})
    assert r.status_code == 200
    await asyncio.sleep(0)   # let the fire-and-forget confirm task run
    assert resolved == [("20260730-141410-9b2e4f", True, True)]

def test_task_detail_is_fetchable_by_id(hermes_home):
    """The card's 'Lihat Log & Langkah Lengkap' link opens #/task/<id>, which
    reads this endpoint. A web task (chat_id=0) must be reachable there."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.create_task("20260730-140639-8a36d8", 0, "@v3 investigasi")
    store.append_log("20260730-140639-8a36d8", r"project: C:\Users\USER\myprofit-v3")
    client = TestClient(create_app(store))

    r = client.get("/api/tasks/20260730-140639-8a36d8")
    assert r.status_code == 200
    body = r.json()
    assert body["task"]["task_id"] == "20260730-140639-8a36d8"
    assert any("myprofit-v3" in line for line in body["logs"])


def test_stt_status_reports_model_and_settings(hermes_home, monkeypatch):
    from hermes import stt
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    monkeypatch.setattr(stt, "available", lambda: True)
    monkeypatch.setattr(stt, "is_loaded", lambda: False)
    client = TestClient(create_app(store))

    r = client.get("/api/stt/status")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["loaded"] is False
    assert body["model"] == stt.MODEL_SIZE
    assert body["enabled"] is True
    assert body["language"] == "id"


def test_stt_transcribes_posted_audio(hermes_home, monkeypatch):
    from hermes import stt
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    seen = {}

    def fake_transcribe(audio, language="id", model_size=None):
        seen["audio"] = audio
        seen["language"] = language
        return "jalankan test project v3"

    monkeypatch.setattr(stt, "available", lambda: True)
    monkeypatch.setattr(stt, "transcribe", fake_transcribe)
    client = TestClient(create_app(store))

    r = client.post("/api/stt", content=b"fake-webm",
                    headers={"Content-Type": "audio/webm"})
    assert r.status_code == 200
    assert r.json() == {"text": "jalankan test project v3"}
    assert seen["audio"] == b"fake-webm"
    assert seen["language"] == "id"


def test_stt_uses_configured_language(hermes_home, monkeypatch):
    from hermes import stt
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    config.save_settings(config.Settings(stt_language="en"))
    seen = {}

    def fake_transcribe(audio, language="id", model_size=None):
        seen["language"] = language
        return "run the tests"

    monkeypatch.setattr(stt, "available", lambda: True)
    monkeypatch.setattr(stt, "transcribe", fake_transcribe)
    client = TestClient(create_app(store))

    client.post("/api/stt", content=b"fake-webm")
    assert seen["language"] == "en"


def test_stt_returns_503_when_faster_whisper_missing(hermes_home, monkeypatch):
    from hermes import stt
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    monkeypatch.setattr(stt, "available", lambda: False)
    client = TestClient(create_app(store))

    r = client.post("/api/stt", content=b"fake-webm")
    assert r.status_code == 503
    # The operator has to be told the install command, not just "unavailable".
    assert "[voice]" in r.json()["detail"]


def test_stt_returns_403_when_disabled(hermes_home, monkeypatch):
    from hermes import stt
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    config.save_settings(config.Settings(stt_enabled=False))
    monkeypatch.setattr(stt, "available", lambda: True)
    client = TestClient(create_app(store))

    r = client.post("/api/stt", content=b"fake-webm")
    assert r.status_code == 403


def test_stt_returns_413_for_oversized_audio(hermes_home, monkeypatch):
    from hermes import stt
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    def explode(audio, language="id", model_size=None):
        raise AssertionError("must reject before reaching the model")

    monkeypatch.setattr(stt, "available", lambda: True)
    monkeypatch.setattr(stt, "transcribe", explode)
    client = TestClient(create_app(store))

    r = client.post("/api/stt", content=b"x" * (stt.MAX_AUDIO_BYTES + 1))
    assert r.status_code == 413


def test_stt_returns_204_for_empty_transcript(hermes_home, monkeypatch):
    from hermes import stt
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    monkeypatch.setattr(stt, "available", lambda: True)
    monkeypatch.setattr(stt, "transcribe", lambda audio, language="id", model_size=None: "  ")
    client = TestClient(create_app(store))

    # Silence transcribes to nothing. 204 lets the browser stay quiet instead
    # of pasting an empty string over what the operator already typed.
    r = client.post("/api/stt", content=b"fake-webm")
    assert r.status_code == 204


def test_stt_returns_500_when_the_model_fails(hermes_home, monkeypatch):
    from hermes import stt
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    def explode(audio, language="id", model_size=None):
        raise RuntimeError("ctranslate2 blew up")

    monkeypatch.setattr(stt, "available", lambda: True)
    monkeypatch.setattr(stt, "transcribe", explode)
    client = TestClient(create_app(store))

    r = client.post("/api/stt", content=b"fake-webm")
    assert r.status_code == 500
    assert "ctranslate2 blew up" in r.json()["detail"]


def test_tts_smart_route_registered_once(hermes_home):
    """A duplicate route definition is dead code: Starlette matches in
    registration order, so the second copy never runs and silently rots."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    app = create_app(store)
    smart = []
    for r in app.routes:
        if getattr(r, "path", None) == "/api/tts/smart":
            smart.append(r)
        elif type(r).__name__ == "_IncludedRouter":
            for ir in r.original_router.routes:
                if getattr(ir, "path", None) == "/api/tts/smart":
                    smart.append(ir)
    assert len(smart) == 1

def test_stream_persists_the_reply_without_the_voice_tag(hermes_home):
    """A stored tag re-enters the model's context on the next turn and teaches
    it that the tag is ordinary prose."""
    from hermes import voice
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class FakeChat:
        async def stream(self, history, tools=None, dispatch=None):
            yield ("token", "<voice>Semua lulus.</voice>")
            yield ("token", "\n\n## Hasil\nRinci.")
            yield ("usage", {"prompt": 1, "completion": 2, "total": 3})

    fake = FakeChat()
    async def chat(history, tools=None, dispatch=None): return ""
    chat.stream = fake.stream

    client = TestClient(create_app(store, chat=chat))
    body = client.post("/api/chat/stream", json={"text": "halo"}).text
    # the raw stream still carries the tag — the client extracts from it
    assert voice.VOICE_TAG_OPEN in body

    stored = store.get_messages("web", limit=10)
    assistant = [m for m in stored if m["role"] == "assistant"][-1]
    assert voice.VOICE_TAG_OPEN not in assistant["content"]
    assert "Semua lulus." not in assistant["content"]
    assert "## Hasil" in assistant["content"]

def test_non_streaming_chat_persists_without_the_voice_tag(hermes_home):
    from hermes import voice
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def chat(history, tools=None, dispatch=None):
        return "<voice>Beres.</voice>Jawaban lengkap."

    client = TestClient(create_app(store, chat=chat))
    r = client.post("/api/tasks", json={"text": "halo"})
    assert r.status_code == 200

    stored = store.get_messages("web", limit=10)
    assistant = [m for m in stored if m["role"] == "assistant"][-1]
    assert voice.VOICE_TAG_OPEN not in assistant["content"]
    assert assistant["content"] == "Jawaban lengkap."
    # the task log the dashboard renders must be clean too
    logs = "\n".join(store.get_logs(r.json()["task_id"]))
    assert voice.VOICE_TAG_OPEN not in logs


def test_chat_turn_is_given_the_situational_context(hermes_home):
    """Every chat turn opens with the context block: the clock, the project in
    play, what is running, and the facts learned about the operator. Without it
    the agent answers "apa yang lagi jalan?" by guessing."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.set_fact("hari_deploy", "biasanya deploy hari Jumat")
    store.create_task("live-1", 0, "@myprofit jalankan pengujian")
    store.set_task_status("live-1", "running")

    seen = []
    async def fake_chat(history, tools=None, dispatch=None):
        seen.append(history)
        return "oke"

    client = TestClient(create_app(store, chat=fake_chat))
    client.post("/api/tasks", json={"text": "apa yang lagi jalan?"})

    head = seen[0][0]
    assert head["role"] == "system"
    assert "# Konteks saat ini" in head["content"]
    assert "hari_deploy: biasanya deploy hari Jumat" in head["content"]
    assert "live-1 [running]" in head["content"]
    assert "@myprofit" in head["content"]


def test_chat_turn_learns_facts_and_they_are_readable_and_deletable(hermes_home):
    """Extraction runs on the turn's own text, and what it stores must be
    inspectable — a wrongly learned fact would otherwise ride in every prompt
    forever with no way to remove it."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    seen = []
    async def fake_chat(history, tools=None, dispatch=None):
        return "Dicatat."
    async def fake_facts(user_text, reply):
        seen.append((user_text, reply))
        return [{"key": "hari_deploy", "value": "Jumat"}]

    client = TestClient(create_app(store, chat=fake_chat, facts=fake_facts))
    client.post("/api/tasks", json={"text": "aku biasanya deploy hari Jumat"})

    assert seen == [("aku biasanya deploy hari Jumat", "Dicatat.")]
    facts = client.get("/api/facts").json()
    assert [(f["key"], f["value"]) for f in facts] == [("hari_deploy", "Jumat")]

    assert client.delete("/api/facts/hari_deploy").status_code == 200
    assert client.get("/api/facts").json() == []


def test_a_failing_extractor_never_breaks_the_turn(hermes_home):
    """Learning is a bonus. A dead extractor must leave the reply intact."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def fake_chat(history, tools=None, dispatch=None):
        return "jawaban"
    async def broken_facts(user_text, reply):
        raise RuntimeError("model down")

    client = TestClient(create_app(store, chat=fake_chat, facts=broken_facts))
    r = client.post("/api/tasks", json={"text": "halo"})
    assert r.status_code == 200 and r.json()["status"] == "done"
    assert store.get_messages("web")[-1]["content"] == "jawaban"
    assert store.list_facts() == []


async def test_sse_announces_a_finished_task_without_the_browser_deciding(hermes_home):
    """The notify decision moved server-side: the frame arrives on the same
    feed every page listens to, so a task finishing while the operator is on
    Configure is still announced."""
    import json, asyncio
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    s = config.load_settings()
    s.tts_enabled = True
    s.tts_task_notify = True
    config.save_settings(s)

    app = create_app(store)
    handler = next(r for r in app.routes
                   if getattr(r, "path", None) == "/api/tasks/events").endpoint

    class FakeRequest:
        async def is_disconnected(self):
            return False

    response = await handler(FakeRequest())

    async def trigger():
        await asyncio.sleep(0.05)
        store.create_task("spoken", 0, "perbaiki checkout")
        store.set_task_status("spoken", "done")

    bg = asyncio.create_task(trigger())
    events = []
    async for chunk in response.body_iterator:
        if chunk.startswith("data: "):
            data = json.loads(chunk[6:])
            events.append(data)
            if data.get("type") == "speak":
                break
    await bg

    spoken = [e for e in events if e.get("type") == "speak"]
    assert spoken == [{"type": "speak", "intent": "notify", "task_id": "spoken",
                       "task_text": "perbaiki checkout", "task_status": "done"}]


async def test_saving_mcp_servers_reconnects_the_live_hub(hermes_home):
    """Saving used to write the file and stop there, so the running agent kept
    the startup server list and the settings page looked broken."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class FakeHub:
        def __init__(self):
            self.servers = []
            self.connected = 0
            self.closed = 0
        async def connect(self): self.connected += 1
        async def close(self): self.closed += 1
        async def list_tools(self): return []

    hub = FakeHub()
    app = create_app(store, hub=hub)
    app.state._mcp_tools_cache = [{"server": "old", "name": "stale_tool"}]
    client = TestClient(app)

    body = [{"name": "pc", "type": "stdio", "command": "npx",
             "args": ["-y", "@wonderwhy-er/desktop-commander"], "enabled": True}]
    assert client.post("/api/mcp", json=body).json() == {"ok": True}

    assert [s.name for s in hub.servers] == ["pc"]
    assert (hub.closed, hub.connected) == (1, 1)
    assert app.state._mcp_tools_cache is None
    assert [s["name"] for s in client.get("/api/mcp").json()] == ["pc"]


async def test_a_hub_that_fails_to_reconnect_still_saves_the_settings(hermes_home):
    """A dead MCP server must not cost the operator the configuration they
    just typed — the file is the source of truth a restart reads back."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class BrokenHub:
        servers = []
        async def connect(self): raise RuntimeError("npx not found")
        async def close(self): pass

    client = TestClient(create_app(store, hub=BrokenHub()))
    body = [{"name": "pc", "type": "stdio", "command": "npx", "args": [], "enabled": True}]
    out = client.post("/api/mcp", json=body).json()
    assert out["ok"] is True and "npx not found" in out["reconnect_error"]
    assert [s.name for s in config.load_settings().mcp_servers] == ["pc"]


async def test_a_failed_discovery_is_not_cached_forever(hermes_home):
    """One slow first turn used to disable every integration for the life of
    the process: the empty result was cached, so the agent kept answering
    "akses disk tidak ada" with the servers sitting in the settings."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class FlakyHub:
        def __init__(self): self.calls = 0
        async def list_tools(self):
            self.calls += 1
            if self.calls == 1:
                raise TimeoutError("npx still fetching")
            return [{"server": "pc", "name": "read_file", "description": "",
                     "input_schema": {"type": "object", "properties": {}}}]

    hub = FlakyHub()
    client = TestClient(create_app(store, hub=hub))

    first = client.get("/api/mcp/tools").json()
    assert first["mcp"] == []                      # discovery failed
    second = client.get("/api/mcp/tools").json()   # next turn tries again
    assert second["mcp"] == ["pc__read_file"]
    assert second["servers"] == ["pc"]
    assert second["gated"] == []                   # read_file is a read
    client.get("/api/mcp/tools")
    assert hub.calls == 2                          # a good result IS cached


async def test_a_parked_action_can_actually_be_approved(hermes_home):
    """The confirm button and the voice "konfirmasi" both POST a JSON body.
    With the request model declared inside create_app, FastAPI demoted it to a
    query parameter and every approval came back 422 — the gate was a dead end,
    so no MCP write action could ever run."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class FakeHub:
        called = None
        async def list_tools(self): return []
        async def call(self, tool, args):
            FakeHub.called = (tool, args)
            return "done"

    app = create_app(store, hub=FakeHub())
    pa = app.state.pending.add("pc__write_file", {"path": "x.txt"}, "web")
    client = TestClient(app)

    r = client.post("/api/chat/pending/resolve", json={"id": pa.id, "approved": True})
    assert r.status_code == 200, r.text
    assert r.json()["approved"] is True
    assert FakeHub.called == ("pc__write_file", {"path": "x.txt"})
    assert client.get("/api/chat/pending").json() == []


async def test_an_approved_action_asks_the_caller_to_resume_the_agent(hermes_home):
    """Approving lands in the MIDDLE of a plan: the model's turn ended when the
    action was parked, so running the tool alone left the result in the thread
    as dead text and the agent looked like it had stopped. Every approved
    outcome must carry `resume` so the client drives one more model turn."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class FakeHub:
        async def list_tools(self): return []
        async def call(self, tool, args): return "isi halaman"

    app = create_app(store, hub=FakeHub())
    pa = app.state.pending.add("browser__browser_run_code_unsafe", {}, "web")
    client = TestClient(app)

    body = client.post("/api/chat/pending/resolve",
                       json={"id": pa.id, "approved": True}).json()
    assert body["resume"] is True
    # Declining is the end of the road, not a continuation.
    pb = app.state.pending.add("browser__browser_click", {}, "web")
    declined = client.post("/api/chat/pending/resolve",
                           json={"id": pb.id, "approved": False}).json()
    assert "resume" not in declined


async def test_an_empty_or_errored_result_is_not_reported_as_done(hermes_home):
    """hub.call returns text either way, so a tool that refused or returned
    nothing used to be written into the thread as "selesai" — the operator saw
    a success for an action that never happened, and the model was told so too."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class FakeHub:
        reply = ""
        async def list_tools(self): return []
        async def call(self, tool, args): return FakeHub.reply

    app = create_app(store, hub=FakeHub())
    client = TestClient(app)

    for reply in ("", '{"error": "target frame detached"}'):
        FakeHub.reply = reply
        pa = app.state.pending.add("browser__browser_run_code_unsafe", {}, "web")
        out = client.post("/api/chat/pending/resolve",
                          json={"id": pa.id, "approved": True}).json()
        assert out["error"], f"{reply!r} should not count as success"
        assert out["resume"] is True          # so the model can try again
        last = store.get_messages("web", limit=1)[-1]["content"]
        assert "✅" not in last and "tidak berhasil" in last


async def test_a_resume_turn_records_no_user_message(hermes_home):
    """The continuation is fired by the confirm button, not by the operator, so
    it must not leave a phantom user turn in the thread."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    app = create_app(store)                     # no chat wired: canned reply
    client = TestClient(app)

    with client.stream("POST", "/api/chat/stream",
                       json={"text": "", "session_id": "web", "resume": True}) as r:
        assert r.status_code == 200
        for _ in r.iter_lines():
            pass
    assert [m["role"] for m in store.get_messages("web", limit=10)] == ["assistant"]


async def test_a_voice_confirm_without_an_id_resolves_the_oldest(hermes_home):
    """Speech carries no id, so the voice path posts only `approved`."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class FakeHub:
        async def list_tools(self): return []
        async def call(self, tool, args): return "ok"

    app = create_app(store, hub=FakeHub())
    first = app.state.pending.add("pc__write_file", {}, "web")
    app.state.pending.add("pc__move_file", {}, "web")
    client = TestClient(app)

    r = client.post("/api/chat/pending/resolve", json={"approved": False})
    assert r.status_code == 200 and r.json()["id"] == first.id
    assert [a["tool"] for a in client.get("/api/chat/pending").json()] == ["pc__move_file"]


def test_deleting_a_session_deletes_its_files_too(hermes_home):
    """The rows always went; the bytes never did. Every artifact directory ever
    produced was still on disk — a Flutter build is 50-100 MB of APK that
    outlived the task, the chat and the session row."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.create_session("sess-1", "Percakapan")
    store.add_message("sess-1", "user", "halo")
    store.create_task("task-1", 0, "kerja", session_id="sess-1")

    up = paths.uploads_dir() / "sess-1"; up.mkdir(parents=True)
    (up / "struk.png").write_bytes(b"PNG")
    art = paths.artifacts_dir() / "task-1"; art.mkdir(parents=True)
    (art / "app.apk").write_bytes(b"APK")

    client = TestClient(create_app(store))
    assert client.delete("/api/sessions/sess-1").status_code == 200

    assert not up.exists()
    assert not art.exists()
    assert store.list_sessions() == []


def test_deleting_a_session_survives_an_undeletable_file(hermes_home, monkeypatch):
    """A file held open by Explorer or an antivirus scanner must not leave the
    operator with a conversation they cannot delete."""
    from hermes import cleanup
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.create_session("sess-1", "Percakapan")
    up = paths.uploads_dir() / "sess-1"; up.mkdir(parents=True)
    (up / "foto.png").write_bytes(b"PNG")

    def boom(*a, **kw):
        raise OSError("[WinError 5] Access is denied")
    monkeypatch.setattr(cleanup.shutil, "rmtree", boom)

    client = TestClient(create_app(store))
    assert client.delete("/api/sessions/sess-1").status_code == 200
    assert store.list_sessions() == []       # the conversation still goes
    assert up.exists()                       # the bytes stay, and say so in the log


def test_resetting_a_chat_drops_the_files_it_was_handed(hermes_home):
    """With the thread gone, nothing references those uploads any more."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.add_message("web", "user", "halo")
    up = paths.uploads_dir() / "web"; up.mkdir(parents=True)
    (up / "foto.png").write_bytes(b"PNG")

    client = TestClient(create_app(store))
    assert client.post("/api/chat/reset").status_code == 200
    assert not up.exists()
    assert store.get_messages("web") == []


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"pixels"


def test_an_uploaded_image_reaches_the_model_and_is_then_deleted(hermes_home):
    """One look, one answer, gone: the image rides the turn it was sent with,
    and the file is removed once the reply exists — so a later turn never pays
    for the same picture again."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    seen = []
    async def fake_chat(history, tools=None, dispatch=None):
        seen.append(history[-1])
        return "Itu struk belanja."

    client = TestClient(create_app(store, chat=fake_chat))
    up = client.post("/api/uploads", content=PNG_BYTES).json()
    stored = paths.uploads_dir() / "web" / up["id"]
    assert stored.is_file()

    client.post("/api/tasks", json={"text": "gambar apa ini?", "images": [up["id"]]})

    last = seen[0]
    assert last["role"] == "user"
    assert last["content"][0] == {"type": "text", "text": "gambar apa ini?"}
    assert last["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert not stored.exists()

    # The thread keeps a marker, not the picture, so the next turn is cheap.
    stored_msgs = [m["content"] for m in store.get_messages("web")]
    assert "[gambar dilampirkan]" in stored_msgs[0]


def test_a_turn_without_images_is_unchanged(hermes_home):
    """The multimodal shape must not leak into ordinary turns — plenty of
    models accept only a plain string."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    seen = []
    async def fake_chat(history, tools=None, dispatch=None):
        seen.append(history[-1])
        return "oke"
    client = TestClient(create_app(store, chat=fake_chat))
    client.post("/api/tasks", json={"text": "halo"})
    assert seen[0] == {"role": "user", "content": "halo"}


def test_upload_rejects_what_is_not_a_raster_image(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    assert client.post("/api/uploads", content=svg).status_code == 415
    assert client.post("/api/uploads", content=b"").status_code == 400
    big = PNG_BYTES + b"x" * (10 * 1024 * 1024)
    assert client.post("/api/uploads", content=big).status_code == 413


def test_an_unknown_image_name_costs_a_plain_answer_not_a_failed_turn(hermes_home):
    """A re-sent or already-discarded name is dropped, not an error."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    seen = []
    async def fake_chat(history, tools=None, dispatch=None):
        seen.append(history[-1])
        return "oke"
    client = TestClient(create_app(store, chat=fake_chat))
    r = client.post("/api/tasks", json={"text": "halo", "images": ["../../etc/passwd", "gone.png"]})
    assert r.status_code == 200
    assert seen[0] == {"role": "user", "content": "halo"}


def test_images_ride_the_streaming_path_too(hermes_home):
    """The chat pane streams; if only the non-streaming branch understood
    images, the feature would work in tests and nowhere else."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    seen = []
    async def fake_chat(history, tools=None, dispatch=None):
        return ""
    async def fake_stream(history, tools=None, dispatch=None):
        seen.append(history[-1])
        yield ("token", "Itu struk.")
    fake_chat.stream = fake_stream

    client = TestClient(create_app(store, chat=fake_chat))
    up = client.post("/api/uploads", content=PNG_BYTES).json()
    stored = paths.uploads_dir() / "web" / up["id"]

    with client.stream("POST", "/api/chat/stream",
                       json={"text": "ini apa?", "images": [up["id"]]}) as r:
        body = "".join(chunk for chunk in r.iter_text())
    assert "Itu struk." in body
    assert seen[0]["content"][1]["image_url"]["url"].startswith("data:image/png")
    assert not stored.exists()


def test_postmortem_endpoint_groups_real_failures(hermes_home):
    """Same reading of the same data the agent's `failure_report` tool gets —
    one implementation, so the dashboard and the chat cannot disagree about
    what went wrong."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    for tid, line in (("t1", "step 0 [code]: engine failed after 3 round(s): 429"),
                      ("t2", "step 0 [code]: engine failed after 3 round(s): 429"),
                      ("t3", "step 0 [build]: step crashed: [WinError 2] not found")):
        store.create_task(tid, 0, "kerja")
        store.set_task_status(tid, "failed")
        store.append_log(tid, line)
    store.create_task("ok", 0, "kerja"); store.set_task_status("ok", "done")

    body = TestClient(create_app(store)).get("/api/postmortem").json()

    assert body["failed"] == 3 and body["tasks_seen"] == 4
    assert body["by_kind"]["transient"] == 2
    assert body["by_kind"]["environment"] == 1
    assert body["repeats"][0]["count"] == 2
    assert "2 dari" not in body["report"] and "3 dari 4" in body["report"]


async def test_the_agent_can_read_its_own_failure_history(hermes_home):
    """Asked why tasks keep failing, the agent should answer from the data
    rather than from the conversation."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    store.create_task("t1", 0, "kerja"); store.set_task_status("t1", "failed")
    store.append_log("t1", "step 0 [build]: step crashed: [WinError 2] not found")

    seen = {}
    async def fake_chat(history, tools=None, dispatch=None):
        seen["tools"] = [t["function"]["name"] for t in tools]
        seen["result"] = await dispatch("failure_report", {})
        return "ada satu kegagalan lingkungan"

    client = TestClient(create_app(store, chat=fake_chat))
    client.post("/api/tasks", json={"text": "kenapa task sering gagal?"})

    assert "failure_report" in seen["tools"]
    payload = json.loads(seen["result"])
    assert payload["by_kind"]["environment"] == 1
    assert "PATH" in payload["report"]


async def test_the_agent_reads_the_calendar_from_the_ics_url(hermes_home,
                                                             monkeypatch):
    """Asked about the schedule, the agent gets real events — and is told to
    set the URL when it is missing, rather than getting a bare failure."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    calls = []
    async def fake_upcoming(url, days=7, now=None):
        calls.append((url, days))
        return [{"summary": "Standup", "start": "2026-08-05T10:00+07:00",
                 "end": "2026-08-05T10:30+07:00", "all_day": False,
                 "location": ""}]
    monkeypatch.setattr("hermes.web_ui.ics.upcoming", fake_upcoming)

    seen = {}
    async def fake_chat(history, tools=None, dispatch=None):
        seen["unset"] = json.loads(await dispatch("calendar_events", {}))
        config.save_settings(config.Settings(
            calendar_ics_url="https://calendar.google.com/ical/x/basic.ics"))
        seen["ok"] = json.loads(await dispatch("calendar_events", {"days": 3}))
        seen["clamped"] = json.loads(await dispatch("calendar_events", {"days": 999}))
        return "besok ada standup"

    client = TestClient(create_app(store, chat=fake_chat))
    client.post("/api/tasks", json={"text": "jadwal besok apa?"})

    # no URL configured: an explanatory error, not an exception
    assert "error" in seen["unset"] and "iCal" in seen["unset"]["error"]

    assert seen["ok"]["days"] == 3
    assert seen["ok"]["events"][0]["summary"] == "Standup"
    assert calls[0] == ("https://calendar.google.com/ical/x/basic.ics", 3)

    # an over-wide request is clamped to the 60-day ceiling, not rejected
    assert seen["clamped"]["days"] == 60


def test_webcal_url_is_normalised_to_https(hermes_home):
    """Google's copy button sometimes yields webcal://, which httpx cannot
    fetch — it is the same address over https."""
    s = config.Settings(calendar_ics_url="webcal://calendar.google.com/ical/x/basic.ics")
    assert s.calendar_ics_url == "https://calendar.google.com/ical/x/basic.ics"


def test_calendar_url_must_be_http(hermes_home):
    import pytest
    with pytest.raises(Exception):
        config.Settings(calendar_ics_url="file:///C:/secrets.ics")


async def test_integrate_endpoint_starts_a_run_and_reports_it(hermes_home, monkeypatch):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def fake_integrate(link, **kw):
        await kw["emit"]({"kind": "attempt", "action": "streamable-http", "ok": True})
        from hermes.mcp_integrate import IntegrationResult
        from hermes.config import McpServer
        srv = McpServer(name="notion", type="http", url=link,
                        transport="streamable-http")
        await kw["emit"]({"kind": "done", "ok": True, "reason": "success",
                          "server": srv.model_dump(), "history": []})
        return IntegrationResult(
            ok=True, reason="success",
            server=srv,
            history=[])

    monkeypatch.setattr("hermes.web_ui.mcp_integrate.integrate", fake_integrate)
    
    from httpx import AsyncClient, ASGITransport
    app = create_app(store)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/mcp/integrate", json={"link": "https://mcp.notion.com/mcp"})
        assert r.status_code == 200
        run_id = r.json()["run_id"]

        for _ in range(50):
            await asyncio.sleep(0.005)
            body = (await client.get(f"/api/mcp/integrate/{run_id}")).json()
            if body["state"] == "done":
                break
        assert body["state"] == "done"
        assert body["server"]["name"] == "notion"
        # a successful run registers the server, alongside the shipped defaults
        assert config.load_settings().mcp_servers[-1].name == "notion"


async def test_integrate_run_can_be_answered_with_a_secret(hermes_home, monkeypatch):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def fake_integrate(link, **kw):
        await kw["emit"]({"kind": "need_secret", "name": "Authorization",
                          "hint": link})
        value = await kw["ask_secret"]("Authorization", link)
        from hermes.mcp_integrate import IntegrationResult
        await kw["emit"]({"kind": "done", "ok": bool(value), "reason": "success" if value else "circles",
                          "server": None, "history": []})
        return IntegrationResult(ok=bool(value), server=None,
                                 reason="success" if value else "circles",
                                 history=[])

    monkeypatch.setattr("hermes.web_ui.mcp_integrate.integrate", fake_integrate)
    
    from httpx import AsyncClient, ASGITransport
    app = create_app(store)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/mcp/integrate",
                             json={"link": "https://x.dev/mcp"})
        run_id = r.json()["run_id"]

        for _ in range(50):
            await asyncio.sleep(0.005)
            body = (await client.get(f"/api/mcp/integrate/{run_id}")).json()
            if body["pending_secret"]:
                break
        assert body["pending_secret"] == "Authorization"

        r = await client.post(f"/api/mcp/integrate/{run_id}/secret", json={"value": "Bearer K"})
        assert r.json()["ok"] is True


async def test_oauth_callback_rejects_an_unknown_state(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    client = TestClient(create_app(store))
    r = client.get("/api/mcp/oauth/callback?code=C&state=NOBODY-WAITS-FOR-THIS")
    assert r.status_code == 400


async def test_oauth_callback_accepts_a_waiting_state(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    app = create_app(store)
    client = TestClient(app)
    wait_id = app.state.pending_auth.start()
    app.state.pending_auth.set_state(wait_id, "STATE-OK")
    r = client.get("/api/mcp/oauth/callback?code=C&state=STATE-OK")
    assert r.status_code == 200
    assert "window.close" in r.text


async def test_chat_can_start_and_follow_an_integration(hermes_home, monkeypatch):
    """Chat cannot hold a turn open for ten minutes, so starting a run returns
    a run_id immediately and progress is read back with a second tool."""
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    async def fake_integrate(link, **kw):
        await kw["emit"]({"kind": "attempt", "action": "npx", "ok": True})
        from hermes.mcp_integrate import IntegrationResult
        await kw["emit"]({"kind": "done", "ok": True, "reason": "success",
                          "server": None, "history": []})
        return IntegrationResult(ok=True, server=None, reason="success", history=[])

    monkeypatch.setattr("hermes.web_ui.mcp_integrate.integrate", fake_integrate)

    seen = {}
    async def fake_chat(history, tools=None, dispatch=None):
        seen["tools"] = [t["function"]["name"] for t in tools]
        seen["start"] = json.loads(await dispatch("integrate_mcp",
                                                  {"link": "https://x.dev/mcp"}))
        return "sedang kupasang"

    client = TestClient(create_app(store, chat=fake_chat))
    client.post("/api/tasks", json={"text": "pasang https://x.dev/mcp"})

    assert "integrate_mcp" in seen["tools"]
    assert "integrate_status" in seen["tools"]
    assert "integrate_secret" in seen["tools"]
    assert seen["start"]["run_id"]


async def test_chat_integrate_status_reports_a_missing_run(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    seen = {}
    async def fake_chat(history, tools=None, dispatch=None):
        seen["missing"] = json.loads(
            await dispatch("integrate_status", {"run_id": "nope"}))
        return "tidak ada"

    client = TestClient(create_app(store, chat=fake_chat))
    client.post("/api/tasks", json={"text": "status?"})
    assert "error" in seen["missing"]
