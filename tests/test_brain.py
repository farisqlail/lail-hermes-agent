from datetime import datetime

import pytest

from hermes import brain
from hermes.session_store import Store


class _Tts:
    """Settings stand-in — brain reads flags off it with getattr defaults."""
    def __init__(self, enabled=True, notify=False, narrate=False):
        self.tts_enabled = enabled
        self.tts_task_notify = notify
        self.tts_narrate = narrate


def test_context_block_states_time_project_and_running_tasks():
    """The three things the agent cannot know from the conversation: what time
    it is, which project is in play, and what is running right now."""
    out = brain.context_block(
        facts=[{"key": "hari_deploy", "value": "biasanya deploy hari Jumat"}],
        tasks=[{"task_id": "t1", "status": "running",
                "text": "@myprofit perbaiki checkout"},
               {"task_id": "t0", "status": "done", "text": "sesuatu yang lama"}],
        projects=["myprofit", "hermes"],
        now=datetime(2026, 8, 3, 14, 5))
    assert "Senin, 3 Agustus 2026, 14:05 (siang)" in out
    assert "@myprofit" in out
    assert "t1 [running]" in out
    assert "t0" not in out                     # finished work is not "running"
    assert "hari_deploy: biasanya deploy hari Jumat" in out


def test_context_block_without_tasks_or_facts_still_carries_the_clock():
    """A brand-new install has no facts and no tasks. Saying nothing would
    leave the agent guessing at the time it is asked about most."""
    out = brain.context_block([], [], [], now=datetime(2026, 8, 3, 20, 0))
    assert "malam" in out
    assert "Tidak ada task yang sedang berjalan." in out
    assert "(belum ada)" in out


def test_active_project_reads_the_newest_reference():
    tasks = [{"text": "cek log saja"},
             {"text": "@hermes tambah fitur"},
             {"text": "@myprofit lama sekali"}]
    assert brain.active_project(tasks) == "hermes"
    assert brain.active_project([{"text": "tanpa sigil"}]) == ""


def test_parse_facts_normalises_keys_and_survives_prose():
    """The extractor is a small model: it wraps its JSON in prose and writes
    keys however it likes. Neither may cost us the facts."""
    got = brain.parse_facts(
        'Tentu, ini faktanya:\n{"facts":[{"key":"Hari Deploy","value":"Jumat"},'
        '{"key":"","value":"tanpa key"},{"key":"editor","value":""}]}')
    assert got == [{"key": "hari_deploy", "value": "Jumat"}]


def test_parse_facts_returns_empty_for_junk():
    """A turn that taught us nothing must not raise inside a chat turn."""
    assert brain.parse_facts("maaf, tidak ada fakta") == []
    assert brain.parse_facts("") == []


def test_parse_facts_caps_a_runaway_extraction():
    items = [{"key": f"k{i}", "value": f"v{i}"} for i in range(20)]
    got = brain.parse_facts('{"facts":' + str(items).replace("'", '"') + "}")
    assert len(got) == brain.MAX_FACTS_PER_TURN


def test_speech_for_announces_a_finished_task_only_when_enabled():
    ev = {"type": "task_status", "task_id": "t1", "status": "done"}
    assert brain.speech_for(ev, _Tts(notify=False)) is None
    out = brain.speech_for(ev, _Tts(notify=True), task_text=lambda t: "perbaiki checkout")
    assert out == {"type": "speak", "intent": "notify", "task_id": "t1",
                   "task_text": "perbaiki checkout", "task_status": "done"}


def test_speech_for_narrates_a_starting_step_only_when_enabled():
    ev = {"type": "step_status", "task_id": "t1", "status": "running", "kind": "build"}
    assert brain.speech_for(ev, _Tts(narrate=False)) is None
    out = brain.speech_for(ev, _Tts(narrate=True))
    assert out["intent"] == "say" and "build" in out["text"]


def test_speech_for_is_silent_for_everything_else():
    """Including with TTS on: a running task, a finished step and a log line
    are progress, not announcements."""
    s = _Tts(notify=True, narrate=True)
    assert brain.speech_for({"type": "task_status", "task_id": "t", "status": "running"}, s) is None
    assert brain.speech_for({"type": "step_status", "task_id": "t", "status": "done", "kind": "build"}, s) is None
    assert brain.speech_for({"type": "log_appended", "task_id": "t", "line": "x"}, s) is None
    assert brain.speech_for({"type": "task_status", "task_id": "t", "status": "done"},
                            _Tts(enabled=False, notify=True)) is None


def test_facts_are_keyed_so_a_relearned_fact_replaces_the_old_value(tmp_path):
    """Two contradictory lines in the prompt is the failure this table shape
    exists to prevent."""
    store = Store(tmp_path / "t.db")
    store.init_schema()
    store.set_fact("hari_deploy", "Jumat")
    store.set_fact("editor", "VS Code")
    store.set_fact("hari_deploy", "Kamis")
    facts = {f["key"]: f["value"] for f in store.list_facts()}
    assert facts == {"hari_deploy": "Kamis", "editor": "VS Code"}
    store.delete_fact("editor")
    assert [f["key"] for f in store.list_facts()] == ["hari_deploy"]


@pytest.mark.parametrize("text", [
    "", "ok", "makasih", "halo", "ok makasih ya", "iya siap", "  hai  "])
def test_worth_extracting_skips_trivial_turns(text):
    assert brain.worth_extracting(text) is False


@pytest.mark.parametrize("text", [
    "nama saya Faris", "aku biasanya deploy hari jumat",
    "pakai VS Code dan suka dark mode"])
def test_worth_extracting_keeps_substantive_turns(text):
    assert brain.worth_extracting(text) is True


def test_step_status_event_carries_its_kind(tmp_path):
    """brain.speech_for reads `kind` off the event; without it every step would
    narrate as the generic fallback line."""
    store = Store(tmp_path / "t.db")
    store.init_schema()
    seen = []
    store.subscribe(seen.append)
    sid = store.add_step("t1", 0, "build", "{}")
    store.set_step_status(sid, "running")
    status_events = [e for e in seen if e["type"] == "step_status"]
    assert status_events[0]["kind"] == "build"
