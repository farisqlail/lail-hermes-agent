import json
from hermes.chat_engine import ChatEngine, wants_code_task, CHAT_TOOLS
from hermes.config import Settings
from hermes.session_store import Store


def _store(hermes_home):
    st = Store(hermes_home / "t.db")
    st.init_schema()
    return st


def test_wants_code_task_separates_work_from_discussion(hermes_home):
    s = Settings(projects={"myprofit": "C:\\x"})
    assert wants_code_task("@myprofit perbaiki bug login di kasir", s)
    assert not wants_code_task("@myprofit kenapa build-nya error", s)
    assert not wants_code_task("@myprofit ringkas arsitekturnya", s)
    assert not wants_code_task("@myprofit   ", s)
    assert not wants_code_task("perbaiki bug login", s)
    assert not wants_code_task("@sayur perbaiki bug login", s)  # not registered


async def test_run_turn_stores_the_thread_and_returns_the_reply(hermes_home):
    store = _store(hermes_home)
    engine = ChatEngine(store)

    async def chat(history, tools=None, dispatch=None):
        return "halo juga"

    out = await engine.run_turn("tg-5", "halo", chat=chat)
    assert out["reply"] == "halo juga"
    assert out["task_id"] is None
    assert out["pending"] == []
    msgs = store.get_messages("tg-5")
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["content"] == "halo"
    assert msgs[1]["content"] == "halo juga"


async def test_run_turn_auto_routes_a_registered_project_code_request(hermes_home):
    from hermes import config
    config.save_settings(Settings(projects={"myprofit": str(hermes_home)}))
    store = _store(hermes_home)

    class FakeBridge:
        async def handle_task(self, user_id, chat_id, text, task_id=None,
                              trusted=False, force_confirm=False,
                              session_id=None, on_decision=None):
            if on_decision:
                on_decision("running", [])
            return task_id

    engine = ChatEngine(store, bridge=FakeBridge())

    async def chat(history, tools=None, dispatch=None):
        # The auto-route already ran before the model was asked; the note
        # about it must be the last message in the prompt.
        assert "[SISTEM]" in history[-1]["content"]
        return "Sudah saya jalankan."

    out = await engine.run_turn("tg-5", "@myprofit perbaiki bug checkout",
                                chat=chat, chat_id=5, user_id=1)
    assert out["task_id"] is not None


async def test_run_turn_parks_a_risky_mcp_write_and_reports_it(hermes_home):
    from hermes import config
    config.save_settings(Settings(confirm_risky=True))
    store = _store(hermes_home)

    class FakeHub:
        async def list_tools(self):
            return [{"name": "gmail__send_email",
                    "inputSchema": {"type": "object", "properties": {}}}]

        async def call(self, name, args):
            raise AssertionError("a gated write must never actually run")

    engine = ChatEngine(store, hub=FakeHub())

    async def chat(history, tools=None, dispatch=None):
        result = await dispatch("gmail__send_email", {"to": "x@y.z"})
        payload = json.loads(result)
        assert payload["status"] == "pending_confirmation"
        return "Sudah saya siapkan, tunggu persetujuanmu."

    out = await engine.run_turn("tg-5", "kirim email ke x", chat=chat,
                                chat_id=5, user_id=1)
    assert len(out["pending"]) == 1
    pa = out["pending"][0]
    assert pa["tool"] == "gmail__send_email"
    assert engine.pending.get(pa["id"]).chat_id == 5


async def test_resolve_pending_declined_records_a_cancellation(hermes_home):
    store = _store(hermes_home)
    engine = ChatEngine(store)
    pa = engine.pending.add("gmail__send_email", {"to": "x@y.z"}, "tg-5", chat_id=5)

    out = await engine.resolve_pending(pa, approved=False)
    assert out["approved"] is False
    assert engine.pending.get(pa.id) is None
    msgs = store.get_messages("tg-5")
    assert "dibatalkan" in msgs[-1]["content"].lower()


async def test_resolve_pending_approved_runs_the_tool_and_says_so(hermes_home):
    store = _store(hermes_home)

    class FakeHub:
        async def call(self, name, args):
            return json.dumps({"ok": True})

    engine = ChatEngine(store, hub=FakeHub())
    pa = engine.pending.add("gmail__send_email", {"to": "x@y.z"}, "tg-5", chat_id=5)

    out = await engine.resolve_pending(pa, approved=True)
    assert out["approved"] is True and out["resume"] is True
    msgs = store.get_messages("tg-5")
    assert "selesai" in msgs[-1]["content"].lower()


async def test_wrap_dispatch_routes_known_names_to_the_extra_map(hermes_home):
    store = _store(hermes_home)
    engine = ChatEngine(store)
    dispatch = engine.make_dispatch("tg-5")
    seen = []

    async def fake_integrate(args):
        seen.append(args)
        return json.dumps({"run_id": "i1"})

    wrapped = engine.wrap_dispatch(dispatch, {"integrate_mcp": fake_integrate})
    out = await wrapped("integrate_mcp", {"link": "some-pkg"})
    assert json.loads(out) == {"run_id": "i1"}
    assert seen == [{"link": "some-pkg"}]
    # Falls through to the real dispatch for anything not in the extra map.
    other = await wrapped("list_projects", {})
    assert json.loads(other) == []
    # The pending_created list is the same object as the wrapped dispatch's —
    # a pending action added through either name is visible via either handle.
    assert wrapped.pending_created is dispatch.pending_created


async def test_run_resume_turn_uses_the_nudge_and_does_not_store_a_user_turn(hermes_home):
    store = _store(hermes_home)
    engine = ChatEngine(store)
    seen = []

    async def chat(history, tools=None, dispatch=None):
        seen.append(history[-1]["content"])
        return "Lanjut ya."

    out = await engine.run_resume_turn("tg-5", chat, chat_id=5)
    assert out["reply"] == "Lanjut ya."
    from hermes.chat_engine import RESUME_NUDGE
    assert seen == [RESUME_NUDGE]
    msgs = store.get_messages("tg-5")
    assert [m["role"] for m in msgs] == ["assistant"]  # no user turn recorded


async def test_generate_image_sends_file_to_telegram(hermes_home, monkeypatch):
    store = _store(hermes_home)
    sent_files = []

    class FakeBridge:
        async def send_file(self, chat_id, kind, path):
            sent_files.append((chat_id, kind, str(path)))

    engine = ChatEngine(store, bridge=FakeBridge())
    fake_png = hermes_home / "fake.png"
    fake_png.write_bytes(b"PNG")

    import hermes.imagegen
    monkeypatch.setattr(hermes.imagegen, "generate", lambda prompt, **kw: {"status": "generated", "path": str(fake_png)})

    from hermes import config
    config.save_settings(config.Settings(image_model="flux", nvidia_base_url="http://x"))
    config.save_secrets(config.Secrets(nvidia_api_key="nvapi-test"))

    dispatch = engine.make_dispatch("tg-10", chat_id=10)
    res = await dispatch("generate_image", {"prompt": "kucing lucu"})
    assert "generated" in res
    assert len(sent_files) == 1
    assert sent_files[0] == (10, "screenshot", str(fake_png))


def _figma_children_schema():
    tool = next(t for t in CHAT_TOOLS if t["function"]["name"] == "figma_web_design")
    return tool["function"]["parameters"]["properties"]["children"]["items"]


def test_figma_schema_offers_row_and_stack_containers():
    level0 = _figma_children_schema()
    type_enum = level0["properties"]["type"]["enum"]
    assert "ROW" in type_enum
    assert "STACK" in type_enum
    assert "children" in level0["properties"]


def test_figma_schema_caps_container_nesting_at_two_levels():
    level0 = _figma_children_schema()
    level1 = level0["properties"]["children"]["items"]
    level2 = level1["properties"]["children"]["items"]

    assert "ROW" in level1["properties"]["type"]["enum"]
    assert "STACK" in level1["properties"]["type"]["enum"]

    # Bottom level is leaf-only: no ROW/STACK, no further `children` field.
    assert "ROW" not in level2["properties"]["type"]["enum"]
    assert "STACK" not in level2["properties"]["type"]["enum"]
    assert "children" not in level2["properties"]

