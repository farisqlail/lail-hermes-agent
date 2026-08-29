import pytest
from hermes.office_store import OfficeStore


class FakeMainStore:
    def __init__(self):
        self.published = []

    def publish(self, event):
        self.published.append(event)


@pytest.fixture
def store(tmp_path):
    s = OfficeStore(tmp_path / "office.db", FakeMainStore())
    s.init_schema()
    return s


def test_create_and_get_employee_round_trip(store):
    row = store.create_employee("e1", "Ada", role="dev", skill_ids=["py"])
    assert row["name"] == "Ada"
    assert row["status"] == "idle"
    assert row["energy"] == 100
    assert row["skill_ids"] == ["py"]
    assert store.get_employee("e1")["employee_id"] == "e1"


def test_update_employee_can_unset_team_id(store):
    """PUT /api/office/employees/{id} sends `exclude_unset=True`, so a
    field explicitly present in the body — even set to null — means the
    operator wants it cleared. Before this was fixed, `None` values were
    silently dropped and there was no way to unassign an employee's team."""
    store.create_employee("e1", "Ada", team_id="team_1")
    assert store.get_employee("e1")["team_id"] == "team_1"
    row = store.update_employee("e1", team_id=None)
    assert row["team_id"] is None
    assert store.get_employee("e1")["team_id"] is None


def test_update_employee_can_clear_skill_ids(store):
    store.create_employee("e1", "Ada", skill_ids=["py", "js"])
    row = store.update_employee("e1", skill_ids=None)
    assert row["skill_ids"] == []


def test_update_employee_ignores_unknown_fields(store):
    store.create_employee("e1", "Ada")
    row = store.update_employee("e1", not_a_real_column="x")
    assert row is not None
    assert row["name"] == "Ada"


def test_update_team_can_clear_description(store):
    team = store.create_team("team_1", "Eng", description="builds stuff")
    row = store.update_team(team["team_id"], description=None)
    assert row["description"] is None


def test_update_session_can_clear_project(store):
    store.create_employee("e1", "Ada")
    sess = store.create_session("s1", "e1", project="myapp")
    assert store.get_session("s1")["project"] == "myapp"
    row = store.update_session("s1", project=None)
    assert row["project"] is None


def test_delete_employee_is_a_soft_delete(store):
    store.create_employee("e1", "Ada")
    assert store.delete_employee("e1") is True
    # still fetchable directly (work_items keep pointing at a real row)...
    assert store.get_employee("e1")["active"] is False
    # ...but excluded from the default active-only roster listing.
    assert store.list_employees() == []
    assert len(store.list_employees(active_only=False)) == 1


def test_delete_team_unassigns_members_instead_of_orphaning_them(store):
    team = store.create_team("team_1", "Eng")
    store.create_employee("e1", "Ada", team_id=team["team_id"])
    store.delete_team(team["team_id"])
    assert store.get_employee("e1")["team_id"] is None


class TestApplyEnergyTick:
    """apply_energy_tick is one atomic UPDATE that computes the new energy
    from the row's *current* value and only fires if `status` still matches
    `from_status` at execution time — the fix for tick()'s TOCTOU race
    against concurrent request-thread writes (see office.py's tick())."""

    def test_working_decay_crosses_burnout_threshold(self, store):
        store.create_employee("e1", "Ada")
        store.update_employee("e1", status="working", energy=22.0, publish=False)
        changed = store.apply_energy_tick(
            "e1", from_status="working", delta=-5.0,
            cross_status="on_break", cross_when_delta_positive=False, threshold=20.0)
        row = store.get_employee("e1")
        assert changed is True
        assert row["energy"] == pytest.approx(17.0)
        assert row["status"] == "on_break"

    def test_working_decay_stays_working_above_threshold(self, store):
        store.create_employee("e1", "Ada")
        store.update_employee("e1", status="working", energy=50.0, publish=False)
        store.apply_energy_tick(
            "e1", from_status="working", delta=-5.0,
            cross_status="on_break", cross_when_delta_positive=False, threshold=20.0)
        row = store.get_employee("e1")
        assert row["energy"] == pytest.approx(45.0)
        assert row["status"] == "working"

    def test_decay_never_drops_energy_below_zero(self, store):
        store.create_employee("e1", "Ada")
        store.update_employee("e1", status="working", energy=2.0, publish=False)
        store.apply_energy_tick(
            "e1", from_status="working", delta=-5.0,
            cross_status="on_break", cross_when_delta_positive=False, threshold=20.0)
        assert store.get_employee("e1")["energy"] == 0.0

    def test_recovery_crosses_into_idle(self, store):
        store.create_employee("e1", "Ada")
        store.update_employee("e1", status="on_break", energy=78.0, publish=False)
        store.apply_energy_tick(
            "e1", from_status="on_break", delta=5.0,
            cross_status="idle", cross_when_delta_positive=True, threshold=80.0)
        row = store.get_employee("e1")
        assert row["energy"] == pytest.approx(83.0)
        assert row["status"] == "idle"

    def test_idle_trickle_clamps_at_100(self, store):
        store.create_employee("e1", "Ada")
        store.update_employee("e1", status="idle", energy=99.0, publish=False)
        store.apply_energy_tick(
            "e1", from_status="idle", delta=5.0,
            cross_status="idle", cross_when_delta_positive=True, threshold=100.0)
        assert store.get_employee("e1")["energy"] == 100.0

    def test_guard_skips_a_row_whose_status_already_moved_on(self, store):
        """The core regression test: if something else (a concurrent PUT
        /api/office/employees/{id} request, which FastAPI runs in a
        threadpool off the event loop) already moved the employee out of
        `from_status`, this write must be a no-op rather than stomping
        whatever that other writer set."""
        store.create_employee("e1", "Ada")
        store.update_employee("e1", status="idle", energy=50.0, publish=False)
        changed = store.apply_energy_tick(
            "e1", from_status="working", delta=-5.0,
            cross_status="on_break", cross_when_delta_positive=False, threshold=20.0)
        row = store.get_employee("e1")
        assert changed is False
        assert row["status"] == "idle"
        assert row["energy"] == 50.0  # untouched
