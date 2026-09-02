import asyncio
import pytest
from hermes import office as office_mod
from hermes.config import Settings, Secrets
from hermes.office import (
    OfficeManager, BURNOUT_THRESHOLD, RECOVERY_THRESHOLD,
    ENERGY_DECAY_PER_TICK, ENERGY_RECOVER_PER_TICK, DELEGATION_MEETING_MIN_SUBTASKS,
)
from hermes.office_store import OfficeStore


class FakeMainStore:
    def __init__(self):
        self.published = []

    def publish(self, event):
        self.published.append(event)


class FakeCompletions:
    """Consumes canned responses in order; falls back to a bland "ok" once
    exhausted so a test only needs to script the calls it cares about."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        text = self._responses.pop(0) if self._responses else "ok"
        msg = type("M", (), {"content": text})()
        return type("R", (), {"choices": [type("C", (), {"message": msg})()]})()


def install_fake_llm(monkeypatch, responses):
    """Points office.py's AsyncOpenAI client at a fake that returns
    `responses` in order (see FakeCompletions). Clears the module's client
    cache first — it's keyed by (base_url, api_key, timeout), so a stale
    real/previous-test client would otherwise survive the monkeypatch."""
    completions = FakeCompletions(responses)

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": completions})()

    office_mod._CLIENT_CACHE.clear()
    monkeypatch.setattr(office_mod, "AsyncOpenAI", FakeClient)
    return completions


@pytest.fixture(autouse=True)
def _reset_office_client_cache():
    office_mod._CLIENT_CACHE.clear()
    yield
    office_mod._CLIENT_CACHE.clear()


@pytest.fixture
def store(tmp_path):
    s = OfficeStore(tmp_path / "office.db", FakeMainStore())
    s.init_schema()
    return s


@pytest.fixture
def settings():
    return Settings()


@pytest.fixture
def secrets():
    return Secrets(nvidia_api_key="nvapi-test")


@pytest.fixture
def manager(store, settings, secrets):
    mgr = OfficeManager(
        store, main_store=FakeMainStore(), orchestrator=object(),
        secrets_loader=lambda: secrets, settings_loader=lambda: settings)
    return mgr


# --- assign_task: burnout gate + lead dispatch ---

def test_assign_task_refuses_a_resting_employee(manager, store):
    store.create_employee("e1", "Ada")
    store.update_employee("e1", status="on_break", publish=False)
    with pytest.raises(ValueError, match="on break"):
        manager.assign_task("e1", "do the thing")


def test_assign_task_routes_a_team_lead_to_delegation(manager, store, monkeypatch):
    team = manager.create_team("Eng")
    store.create_employee("lead1", "Lea", team_id=team["team_id"], is_lead=True)
    calls = []
    monkeypatch.setattr(
        manager, "_delegate_task",
        lambda lead, prompt, project: calls.append((lead["employee_id"], prompt)) or {"work_id": "w1"})
    result = manager.assign_task("lead1", "ship the feature")
    assert calls == [("lead1", "ship the feature")]
    assert result == {"work_id": "w1"}


def test_assign_task_requires_a_prompt(manager, store):
    store.create_employee("e1", "Ada")
    with pytest.raises(ValueError, match="prompt"):
        manager.assign_task("e1", "   ")


# --- _least_busy: energy-aware task routing ---

def test_least_busy_prefers_an_available_member_over_a_resting_one(manager, store):
    store.create_employee("a", "A")
    store.create_employee("b", "B")
    store.update_employee("a", status="on_break", publish=False)
    chosen = manager._least_busy(store.list_employees(active_only=False))
    assert chosen["employee_id"] == "b"


def test_least_busy_falls_back_to_everyone_if_the_whole_pool_is_resting(manager, store):
    store.create_employee("a", "A")
    store.create_employee("b", "B")
    store.update_employee("a", status="on_break", publish=False)
    store.update_employee("b", status="on_break", publish=False)
    chosen = manager._least_busy(store.list_employees())
    assert chosen["employee_id"] in ("a", "b")


def test_least_busy_picks_fewest_open_items_among_available_members(manager, store):
    store.create_employee("a", "A")
    store.create_employee("b", "B")
    store.create_work_item("w1", "a", kind="chat_output", prompt="x", status="running")
    chosen = manager._least_busy(store.list_employees())
    assert chosen["employee_id"] == "b"


async def test_assign_team_task_skips_a_resting_member(manager, store):
    team = manager.create_team("Eng")
    store.create_employee("a", "A", team_id=team["team_id"])
    store.create_employee("b", "B", team_id=team["team_id"])
    store.update_employee("a", status="on_break", publish=False)

    async def fake_chat_work_item(work_id, employee, prompt):
        store.update_work_item(work_id, output_text="done", status="done")
        store.update_employee(employee["employee_id"], status="idle")

    manager._run_chat_work_item = fake_chat_work_item
    work = manager.assign_team_task(team["team_id"], "ship it")
    assert work["employee_id"] == "b"
    await asyncio.sleep(0)  # let the fire-and-forget work task finish


# --- tick(): energy/status simulation ---

async def test_tick_decays_a_working_employee(manager, store, settings):
    store.create_employee("e1", "Ada")
    start = BURNOUT_THRESHOLD + ENERGY_DECAY_PER_TICK + 5  # stays above threshold
    store.update_employee("e1", status="working", energy=start, publish=False)
    await manager.tick(settings)
    row = store.get_employee("e1")
    assert row["energy"] == pytest.approx(start - ENERGY_DECAY_PER_TICK)
    assert row["status"] == "working"


async def test_tick_flips_a_working_employee_to_on_break_past_burnout(manager, store, settings):
    store.create_employee("e1", "Ada")
    start = BURNOUT_THRESHOLD + ENERGY_DECAY_PER_TICK - 1  # crosses below threshold
    store.update_employee("e1", status="working", energy=start, publish=False)
    await manager.tick(settings)
    assert store.get_employee("e1")["status"] == "on_break"


async def test_tick_recovers_an_on_break_employee_to_idle_past_recovery(manager, store, settings):
    store.create_employee("e1", "Ada")
    start = RECOVERY_THRESHOLD - ENERGY_RECOVER_PER_TICK + 1  # crosses above threshold
    store.update_employee("e1", status="on_break", energy=start, publish=False)
    await manager.tick(settings)
    assert store.get_employee("e1")["status"] == "idle"


async def test_tick_trickles_idle_energy_toward_100(manager, store, settings):
    store.create_employee("e1", "Ada")
    store.update_employee("e1", status="idle", energy=90.0, publish=False)
    await manager.tick(settings)
    row = store.get_employee("e1")
    assert row["energy"] == pytest.approx(min(100.0, 90.0 + ENERGY_RECOVER_PER_TICK))
    assert row["status"] == "idle"


async def test_tick_publishes_one_batched_event_naming_only_changed_employees(manager, store, settings):
    store.create_employee("e1", "Ada")
    store.create_employee("e2", "Bea")
    store.update_employee("e1", status="working", energy=50.0, publish=False)
    store.update_employee("e2", status="idle", energy=100.0, publish=False)  # already full — no-op
    store.main_store.published.clear()  # drop the create_employee publishes above
    await manager.tick(settings)
    events = [e for e in store.main_store.published if e.get("type") == "office_employee_updated"]
    assert len(events) == 1
    assert events[0]["employee_ids"] == ["e1"]


async def test_tick_does_not_clobber_an_employee_whose_status_changed_concurrently(manager, store, settings, monkeypatch):
    """Regression test for the TOCTOU race: tick() snapshots via
    list_employees(), then writes decisions row by row. A plain FastAPI
    route (e.g. PUT /api/office/employees/{id}) runs in a threadpool, off
    the event loop — genuinely concurrent with tick(). If that request
    moves an employee out of the status tick saw in its snapshot before
    tick's write for that row executes, tick must not stomp it."""
    store.create_employee("e1", "Ada")
    store.update_employee("e1", status="working", energy=22.0, publish=False)

    real_list_employees = store.list_employees

    def snapshot_then_concurrent_write(*a, **kw):
        rows = real_list_employees(*a, **kw)
        store.update_employee("e1", status="idle", energy=5.0, publish=False)
        return rows

    monkeypatch.setattr(store, "list_employees", snapshot_then_concurrent_write)

    await manager.tick(settings)
    row = store.get_employee("e1")
    assert row["status"] == "idle"
    assert row["energy"] == 5.0  # tick's stale-snapshot decay must not apply


# --- delegation: resting teammates excluded from the roster ---

async def test_plan_subtasks_falls_back_to_least_busy_when_llm_reply_is_not_json(manager, store, monkeypatch):
    install_fake_llm(monkeypatch, ["not json at all"])
    lead = store.create_employee("lead1", "Lea", is_lead=True)
    store.create_employee("a", "A")
    store.create_employee("b", "B")
    store.update_employee("a", status="on_break", publish=False)

    members = [store.get_employee("a"), store.get_employee("b")]
    subtasks = await manager._plan_subtasks(lead, members, "ship it")
    assert [emp["employee_id"] for emp, _ in subtasks] == ["b"]


async def test_run_delegation_excludes_resting_teammates_from_the_roster(manager, store, monkeypatch):
    # First call is _plan_subtasks' planning prompt (forced to fall back by
    # invalid JSON); later calls are the spawned subtask's own completion and
    # the lead's synthesis — their exact content doesn't matter here.
    install_fake_llm(monkeypatch, ["not json"])

    team = manager.create_team("Eng")
    lead = store.create_employee("lead1", "Lea", team_id=team["team_id"], is_lead=True)
    store.create_employee("a", "A", team_id=team["team_id"])
    store.create_employee("b", "B", team_id=team["team_id"])
    store.update_employee("a", status="on_break", publish=False)

    store.create_work_item("w1", "lead1", kind="delegation", prompt="ship it",
                           team_id=team["team_id"], status="running")
    await manager._run_delegation("w1", lead, "ship it", None)

    children = store.list_work_items(parent_work_id="w1")
    assert {c["employee_id"] for c in children} == {"b"}
    assert store.get_work_item("w1")["status"] == "done"


async def test_run_delegation_falls_back_to_everyone_if_the_whole_team_is_resting(manager, store, monkeypatch):
    install_fake_llm(monkeypatch, ["not json"])

    team = manager.create_team("Eng")
    lead = store.create_employee("lead1", "Lea", team_id=team["team_id"], is_lead=True)
    store.create_employee("a", "A", team_id=team["team_id"])
    store.update_employee("a", status="on_break", publish=False)

    store.create_work_item("w1", "lead1", kind="delegation", prompt="ship it",
                           team_id=team["team_id"], status="running")
    await manager._run_delegation("w1", lead, "ship it", None)

    # Everyone was resting, so the delegation still has to land somewhere
    # rather than silently dropping the task.
    children = store.list_work_items(parent_work_id="w1")
    assert {c["employee_id"] for c in children} == {"a"}


def test_delegation_meeting_min_subtasks_constant_is_at_least_two():
    # Sanity guard: a 1-2 person delegation is meant to skip the kickoff
    # meeting (see _run_delegation) — this constant must stay above that.
    assert DELEGATION_MEETING_MIN_SUBTASKS >= 2


class RecordingMainStore(FakeMainStore):
    """FakeMainStore plus the task surface `_run_code_work_item` touches."""
    def __init__(self):
        super().__init__()
        self.tasks = {}

    def create_task(self, task_id, chat_id, text, session_id=None, origin=None):
        self.tasks[task_id] = {"task_id": task_id, "chat_id": chat_id, "text": text,
                               "session_id": session_id, "origin": origin}

    def get_task(self, task_id):
        return self.tasks.get(task_id)


class StubOrchestrator:
    def __init__(self):
        self.ran = []

    async def run_task(self, task_id, **kw):
        self.ran.append(task_id)


async def test_office_code_work_stamps_the_task_with_its_origin(store, settings, secrets, tmp_path):
    """An Office task carries no session_id — it belongs to an employee, not a
    conversation — so `origin` is the only thing that can tell the detail page
    to send "back" to the Office rather than the dashboard."""
    main_store = RecordingMainStore()
    orch = StubOrchestrator()
    mgr = OfficeManager(store, main_store=main_store, orchestrator=orch,
                        secrets_loader=lambda: secrets, settings_loader=lambda: settings)
    store.create_employee("e1", "Ada")
    work = store.create_work_item("w1", "e1", kind="code_task", prompt="fix the navbar")

    await mgr._run_code_work_item(work["work_id"], store.get_employee("e1"),
                                  "fix the navbar", tmp_path)

    assert orch.ran, "the shared Orchestrator should still be what runs the work"
    (task,) = main_store.tasks.values()
    assert task["origin"] == "office"
    assert task["session_id"] is None
