import json
from hermes.chat_engine import ChatEngine, wants_code_task, CHAT_TOOLS
from hermes.config import Settings, Skill
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


def test_history_with_context_prepends_the_saved_summary(hermes_home):
    store = _store(hermes_home)
    store.save_context_summary("tg-9", "Operator sedang debug login.", 3)
    store.add_message("tg-9", "user", "lanjutkan")
    engine = ChatEngine(store)

    history = engine.history_with_context("tg-9")
    assert any("Operator sedang debug login." in (m.get("content") or "") for m in history)


def test_history_with_context_skips_the_summary_line_when_there_is_none(hermes_home):
    store = _store(hermes_home)
    store.add_message("tg-9", "user", "halo")
    engine = ChatEngine(store)

    history = engine.history_with_context("tg-9")
    assert not any("Ringkasan" in (m.get("content") or "") for m in history)


async def test_maybe_compress_is_a_noop_without_a_compressor(hermes_home):
    store = _store(hermes_home)
    engine = ChatEngine(store)  # no compressor wired
    for i in range(45):
        store.add_message("tg-9", "user", f"m{i}")

    await engine.maybe_compress("tg-9")
    assert store.get_context_summary("tg-9") == ("", 0)


async def test_maybe_compress_waits_until_enough_messages_pile_up(hermes_home):
    store = _store(hermes_home)
    calls = []

    async def compressor(prior_summary, messages):
        calls.append(messages)
        return "x"

    engine = ChatEngine(store, compressor=compressor)
    for i in range(5):
        store.add_message("tg-9", "user", f"m{i}")

    await engine.maybe_compress("tg-9")
    assert calls == []


async def test_maybe_compress_summarizes_the_falling_out_tail_and_saves_it(hermes_home):
    store = _store(hermes_home)

    async def compressor(prior_summary, messages):
        assert prior_summary == ""
        return f"ringkasan dari {len(messages)} pesan"

    engine = ChatEngine(store, compressor=compressor)
    for i in range(45):
        store.add_message("tg-9", "user", f"m{i}")

    await engine.maybe_compress("tg-9")
    summary, through_id = store.get_context_summary("tg-9")
    assert summary == "ringkasan dari 25 pesan"
    assert through_id > 0

    # nothing new has piled up past the boundary yet -> a second call skips
    # the compressor entirely
    calls = []

    async def counting_compressor(prior_summary, messages):
        calls.append(messages)
        return "should not run"

    engine.compressor = counting_compressor
    await engine.maybe_compress("tg-9")
    assert calls == []


def _many_tools(n):
    return [{"name": f"srv__tool{i}", "inputSchema": {"type": "object", "properties": {}}}
            for i in range(n)]


async def test_chat_tools_skips_routing_below_the_threshold(hermes_home):
    """A small MCP catalog is cheap enough to send whole — no LLM call, no
    latency, no risk of the router mis-narrowing it."""
    store = _store(hermes_home)

    async def router(text, names):
        raise AssertionError("router must not run below the threshold")

    class FakeHub:
        async def list_tools(self):
            return _many_tools(3)

    engine = ChatEngine(store, hub=FakeHub(), mcp_router=router)
    tools = await engine.chat_tools("cek srv tool0")
    names = {t["function"]["name"] for t in tools}
    assert "srv__tool0" in names and "srv__tool2" in names


async def test_chat_tools_skips_routing_for_a_realistic_default_sized_catalog(hermes_home):
    """The default-enabled MCP servers (pc, browser, win, obsidian) combine
    to well over a dozen tools on a fresh install — routing must not fire
    for that, or every plain 'halo' pays for an extra LLM round-trip before
    the real one even starts."""
    store = _store(hermes_home)

    async def router(text, names):
        raise AssertionError("router must not run for a default-sized catalog")

    class FakeHub:
        async def list_tools(self):
            return _many_tools(20)

    engine = ChatEngine(store, hub=FakeHub(), mcp_router=router)
    tools = await engine.chat_tools("halo")
    mcp_names = {t["function"]["name"] for t in tools if t["function"]["name"].startswith("srv__")}
    assert len(mcp_names) == 20


async def test_chat_tools_narrows_a_large_catalog_via_the_router(hermes_home):
    store = _store(hermes_home)

    async def router(text, names):
        assert text == "cek tool3 dong"
        return [n for n in names if n == "srv__tool3"]

    class FakeHub:
        async def list_tools(self):
            return _many_tools(45)

    engine = ChatEngine(store, hub=FakeHub(), mcp_router=router)
    tools = await engine.chat_tools("cek tool3 dong")
    mcp_names = {t["function"]["name"] for t in tools if t["function"]["name"].startswith("srv__")}
    assert mcp_names == {"srv__tool3"}
    # built-ins are never filtered by the router
    assert any(t["function"]["name"] == "start_task" for t in tools)


async def test_chat_tools_fails_open_when_the_router_returns_none(hermes_home):
    store = _store(hermes_home)

    async def router(text, names):
        return None

    class FakeHub:
        async def list_tools(self):
            return _many_tools(45)

    engine = ChatEngine(store, hub=FakeHub(), mcp_router=router)
    tools = await engine.chat_tools("apapun")
    mcp_names = {t["function"]["name"] for t in tools if t["function"]["name"].startswith("srv__")}
    assert len(mcp_names) == 45


async def test_chat_tools_skips_routing_without_text(hermes_home):
    """run_resume_turn has no fresh operator message to route against —
    chat_tools() must fall back to the unfiltered catalog, not crash."""
    store = _store(hermes_home)

    async def router(text, names):
        raise AssertionError("router must not run with no text to route on")

    class FakeHub:
        async def list_tools(self):
            return _many_tools(20)

    engine = ChatEngine(store, hub=FakeHub(), mcp_router=router)
    tools = await engine.chat_tools()
    mcp_names = {t["function"]["name"] for t in tools if t["function"]["name"].startswith("srv__")}
    assert len(mcp_names) == 20


async def test_chat_tools_hides_skill_tools_when_none_installed(hermes_home):
    from hermes import config
    config.save_settings(Settings(skills=[]))
    store = _store(hermes_home)
    engine = ChatEngine(store)
    tools = await engine.chat_tools()
    names = {t["function"]["name"] for t in tools}
    assert "list_skills" not in names and "use_skill" not in names


def _install_skill(hermes_home, skill_id, name, description, content, enabled=True):
    """Test helper mirroring what the /api/skills endpoint does: a Skill
    entry in Settings.skills (metadata only) plus the real SKILL.md file on
    disk that use_skill actually reads."""
    from hermes import config, paths, skills as skills_mod
    settings = config.load_settings()
    settings.skills = [s for s in settings.skills if s.id != skill_id] + [
        Skill(id=skill_id, name=name, description=description, enabled=enabled)]
    config.save_settings(settings)
    skills_mod.write_skill_file(paths.skills_dir(), skill_id, name, description, content)


async def test_chat_tools_exposes_skill_tools_once_one_is_installed(hermes_home):
    _install_skill(hermes_home, "a", "Analisis Kegagalan", "Ringkas failure_report", "isi")
    store = _store(hermes_home)
    engine = ChatEngine(store)
    tools = await engine.chat_tools()
    names = {t["function"]["name"] for t in tools}
    assert "list_skills" in names and "use_skill" in names


async def test_dispatch_list_skills_returns_only_enabled_names_and_descriptions(hermes_home):
    _install_skill(hermes_home, "a", "Analisis Kegagalan", "Ringkas failure_report", "isi lengkap A")
    _install_skill(hermes_home, "b", "Off Skill", "tidak aktif", "isi lengkap B", enabled=False)
    store = _store(hermes_home)
    engine = ChatEngine(store)
    dispatch = engine.make_dispatch("tg-5")

    result = json.loads(await dispatch("list_skills", {}))
    assert result == [{"name": "Analisis Kegagalan", "description": "Ringkas failure_report"}]
    assert "isi lengkap" not in json.dumps(result)


async def test_dispatch_use_skill_returns_the_full_content(hermes_home):
    _install_skill(hermes_home, "a", "Analisis Kegagalan", "Ringkas failure_report",
                   "Panggil failure_report lalu kelompokkan per jenis.")
    store = _store(hermes_home)
    engine = ChatEngine(store)
    dispatch = engine.make_dispatch("tg-5")

    result = json.loads(await dispatch("use_skill", {"name": "Analisis Kegagalan"}))
    assert result["content"] == "Panggil failure_report lalu kelompokkan per jenis."


async def test_dispatch_use_skill_rejects_a_disabled_or_unknown_skill(hermes_home):
    _install_skill(hermes_home, "b", "Off Skill", "tidak aktif", "isi lengkap B", enabled=False)
    store = _store(hermes_home)
    engine = ChatEngine(store)
    dispatch = engine.make_dispatch("tg-5")

    off = json.loads(await dispatch("use_skill", {"name": "Off Skill"}))
    assert "error" in off
    missing = json.loads(await dispatch("use_skill", {"name": "Gak Ada"}))
    assert "error" in missing


async def test_dispatch_use_skill_reports_a_missing_file_instead_of_crashing(hermes_home):
    """Settings.skills and skills_dir() can drift apart (a file deleted by
    hand, a config restored without its skills/ folder) — use_skill must
    say so, not raise."""
    from hermes import config
    config.save_settings(Settings(skills=[
        Skill(id="ghost", name="Ghost Skill", description="berkas hilang", enabled=True)]))
    store = _store(hermes_home)
    engine = ChatEngine(store)
    dispatch = engine.make_dispatch("tg-5")

    result = json.loads(await dispatch("use_skill", {"name": "Ghost Skill"}))
    assert "error" in result


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
    assert out["pending"][0]["risk_note"] == ""


async def test_run_turn_attaches_the_approval_note_to_a_parked_action(hermes_home):
    """When an approval_note explainer is wired, its output rides along on
    both the pending_confirmation tool result and the stored PendingAction —
    purely informational, the gate itself is untouched."""
    from hermes import config
    config.save_settings(Settings(confirm_risky=True))
    store = _store(hermes_home)

    class FakeHub:
        async def list_tools(self):
            return [{"name": "gmail__send_email",
                    "inputSchema": {"type": "object", "properties": {}}}]

        async def call(self, name, args):
            raise AssertionError("a gated write must never actually run")

    async def approval_note(tool, args):
        assert tool == "gmail__send_email"
        return "Ini akan mengirim email ke penerima asing."

    engine = ChatEngine(store, hub=FakeHub(), approval_note=approval_note)

    async def chat(history, tools=None, dispatch=None):
        result = await dispatch("gmail__send_email", {"to": "x@y.z"})
        payload = json.loads(result)
        assert payload["risk_note"] == "Ini akan mengirim email ke penerima asing."
        return "Sudah saya siapkan, tunggu persetujuanmu."

    out = await engine.run_turn("tg-5", "kirim email ke x", chat=chat,
                                chat_id=5, user_id=1)
    assert out["pending"][0]["risk_note"] == "Ini akan mengirim email ke penerima asing."
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

