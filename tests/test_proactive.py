"""The self-initiated loop acts only when told to, only on what happens after
it starts, and never twice on the same trigger.

The decision functions are pure over an injected clock and a fake store/bridge,
so the whole policy is exercised without a database, a network, or waiting on
real time.
"""
import asyncio, time
from datetime import datetime, timezone
from types import SimpleNamespace
from pathlib import Path

from hermes import proactive, failure


def _settings(**over):
    base = dict(
        proactive_enabled=True, proactive_chat_id=42,
        proactive_daily_enabled=False, proactive_daily_time="08:00",
        proactive_watch_enabled=False, proactive_watch_dir="",
        proactive_watch_prompt="", proactive_retry_enabled=False,
        proactive_retry_max=3, calendar_ics_url="",
    )
    base.update(over)
    return SimpleNamespace(**base)


class FakeStore:
    def __init__(self, tasks=None, logs=None):
        self._tasks = tasks or []
        self._logs = logs or {}

    def list_tasks(self, limit=50):
        return list(self._tasks)[:limit]

    def get_logs(self, task_id):
        return self._logs.get(task_id, [])


class FakeBridge:
    def __init__(self):
        self.sent = []      # (chat_id, text)
        self.tasks = []     # (chat_id, text, trusted)

    async def sender(self, chat_id, text, html=False):
        self.sent.append((chat_id, text))

    async def handle_task(self, user_id, chat_id, text, trusted=False, **kw):
        self.tasks.append((chat_id, text, trusted))


def _at(hour, minute=0, day=5):
    return datetime(2026, 8, day, hour, minute, tzinfo=timezone.utc)


# --- daily brief -------------------------------------------------------------

def test_daily_due_only_after_its_time_and_once_per_day():
    s = _settings(proactive_daily_time="08:00")
    state = proactive._default_state()
    assert not proactive.daily_due(s, state, _at(7, 59))   # before time
    assert proactive.daily_due(s, state, _at(8, 0))        # at time
    assert proactive.daily_due(s, state, _at(9, 30))       # after time
    state["last_daily"] = _at(9, 30).date().isoformat()
    assert not proactive.daily_due(s, state, _at(9, 31))   # already fired today


def test_daily_time_junk_falls_back_to_0800():
    assert proactive._parse_hhmm("nonsense") == (8, 0)
    assert proactive._parse_hhmm("25:00") == (8, 0)
    assert proactive._parse_hhmm("13:45") == (13, 45)


def test_daily_brief_pushes_and_records_the_date():
    s = _settings(proactive_daily_enabled=True, proactive_chat_id=42)
    store = FakeStore(tasks=[{"task_id": "a", "status": "done", "text": "x"}])
    bridge = FakeBridge()
    state = proactive._default_state()
    asyncio.run(proactive.tick(s, store, bridge, None, state, _at(8, 1)))
    assert len(bridge.sent) == 1 and bridge.sent[0][0] == 42
    assert "Morning brief" in bridge.sent[0][1]
    assert state["last_daily"] == _at(8, 1).date().isoformat()
    # A second tick the same day does not re-send.
    asyncio.run(proactive.tick(s, store, bridge, None, state, _at(8, 2)))
    assert len(bridge.sent) == 1


def test_daily_brief_with_no_chat_id_is_skipped_not_crashed():
    s = _settings(proactive_daily_enabled=True, proactive_chat_id=0)
    bridge = FakeBridge()
    state = proactive._default_state()
    asyncio.run(proactive.tick(s, FakeStore(), bridge, None, state, _at(8, 1)))
    assert bridge.sent == []
    assert state["last_daily"] == _at(8, 1).date().isoformat()  # still marked done


def test_daily_brief_includes_calendar_when_a_fetcher_is_wired():
    s = _settings(proactive_daily_enabled=True, calendar_ics_url="https://x")

    async def fake_ics(url, days=1, now=None):
        return [{"summary": "Standup", "start": "2026-08-05T09:00",
                 "all_day": False, "location": "Zoom"}]

    now = _at(8, 1)
    out = asyncio.run(proactive.build_daily(s, FakeStore(), fake_ics, now))
    assert "Standup" in out and "09:00" in out and "Zoom" in out


def test_calendar_failure_does_not_sink_the_brief():
    s = _settings(calendar_ics_url="https://x")

    async def boom(url, days=1, now=None):
        raise RuntimeError("dns")

    out = asyncio.run(proactive.build_daily(s, FakeStore(), boom, _at(8, 1)))
    assert "gagal baca kalender" in out
    assert "Tidak ada task gagal" in out   # the failure half still rendered


# --- watcher -----------------------------------------------------------------

def test_scan_yields_only_new_settled_files(tmp_path):
    old = tmp_path / "old.txt"; old.write_text("x")
    # Age it past the settle window.
    past = time.time() - 3600
    import os; os.utime(old, (past, past))
    s = _settings(proactive_watch_dir=str(tmp_path))
    state = proactive._default_state()
    now_ts = time.time()

    first = proactive.scan_new_files(s, state, now_ts)
    assert first == [str(old)]
    # Same file is not re-yielded.
    assert proactive.scan_new_files(s, state, now_ts) == []

    # A brand-new file that has not settled yet is held back.
    fresh = tmp_path / "fresh.txt"; fresh.write_text("y")
    assert proactive.scan_new_files(s, state, now_ts) == []


def test_scan_ignores_partial_and_hidden_files(tmp_path):
    past = time.time() - 3600
    import os
    for name in (".hidden", "download.crdownload", "x.tmp", "real.pdf"):
        p = tmp_path / name; p.write_text("z"); os.utime(p, (past, past))
    s = _settings(proactive_watch_dir=str(tmp_path))
    found = proactive.scan_new_files(s, proactive._default_state(), time.time())
    assert found == [str(tmp_path / "real.pdf")]


def test_watch_prompt_uses_template_then_default():
    s = _settings(proactive_watch_prompt="Analisa invoice ini")
    assert "Analisa invoice ini" in proactive.watch_prompt(s, "C:/x.pdf")
    assert "C:/x.pdf" in proactive.watch_prompt(s, "C:/x.pdf")
    d = _settings(proactive_watch_prompt="")
    assert "berkas baru" in proactive.watch_prompt(d, "C:/x.pdf").lower()


def test_watcher_queues_a_task_through_the_bridge(tmp_path):
    f = tmp_path / "doc.pdf"; f.write_text("x")
    # Age the file relative to the injected tick clock, not the wall clock: the
    # settle check is (now - mtime), and the fake `now` is a fixed date.
    import os; past = _at(12).timestamp() - 3600; os.utime(f, (past, past))
    s = _settings(proactive_watch_enabled=True, proactive_watch_dir=str(tmp_path),
                  proactive_chat_id=42)
    bridge = FakeBridge()
    asyncio.run(proactive.tick(s, FakeStore(), bridge, None,
                               proactive._default_state(), _at(12)))
    assert len(bridge.tasks) == 1
    chat_id, text, trusted = bridge.tasks[0]
    assert chat_id == 42 and trusted is True and str(f) in text


# --- auto-retry --------------------------------------------------------------

def _transient_task(tid="t1", created=None):
    created = created if created is not None else time.time()
    return {"task_id": tid, "status": "failed", "text": "@proj fix login",
            "created": created}


def test_only_transient_recent_failures_are_retried():
    now_ts = time.time()
    tasks = [
        _transient_task("t_busy", now_ts - 60),          # transient, recent -> retry
        {"task_id": "t_path", "status": "failed", "created": now_ts,
         "text": "x"},                                    # environment -> never
        {"task_id": "t_old", "status": "failed", "created": now_ts - 99999,
         "text": "x"},                                    # transient but stale
        {"task_id": "t_ok", "status": "done", "created": now_ts, "text": "x"},
    ]
    logs = {
        "t_busy": ["engine failed after 3 round(s): 429"],
        "t_path": ["step crashed: 'claude' not found on PATH"],
        "t_old": ["service unavailable"],
        "t_ok": ["task complete"],
    }
    store = FakeStore(tasks, logs)
    state = proactive._default_state()
    cands = proactive.retry_candidates(store, state, now_ts, max_fire=3)
    assert [t["task_id"] for t in cands] == ["t_busy"]
    # The environment and stale ones are marked so they are never re-examined.
    assert "t_path" in state["retried"] and "t_old" in state["retried"]


def test_a_task_is_auto_retried_at_most_once():
    now_ts = time.time()
    store = FakeStore([_transient_task("t1", now_ts)],
                      {"t1": ["429 too many requests"]})
    s = _settings(proactive_retry_enabled=True, proactive_chat_id=42)
    bridge = FakeBridge()
    state = proactive._default_state()
    asyncio.run(proactive.tick(s, store, bridge, None, state, _at(12)))
    assert len(bridge.tasks) == 1 and bridge.tasks[0][1] == "@proj fix login"
    # Second tick: same failed task is still in the store but already retried.
    asyncio.run(proactive.tick(s, store, bridge, None, state, _at(12, 1)))
    assert len(bridge.tasks) == 1


def test_retry_respects_the_per_tick_cap():
    now_ts = time.time()
    tasks = [_transient_task(f"t{i}", now_ts) for i in range(10)]
    logs = {f"t{i}": ["503 overloaded"] for i in range(10)}
    s = _settings(proactive_retry_enabled=True, proactive_retry_max=3)
    bridge = FakeBridge()
    asyncio.run(proactive.tick(s, FakeStore(tasks, logs), bridge, None,
                               proactive._default_state(), _at(12)))
    assert len(bridge.tasks) == 3


# --- priming & state ---------------------------------------------------------

def test_prime_records_current_files_and_failures_as_seen(tmp_path):
    (tmp_path / "existing.txt").write_text("x")
    store = FakeStore([{"task_id": "old_fail", "status": "failed", "text": "x",
                        "created": time.time()}],
                      {"old_fail": ["429"]})
    s = _settings(proactive_watch_dir=str(tmp_path))
    state = proactive._default_state()
    proactive.prime(s, store, state, time.time())
    assert str(tmp_path / "existing.txt") in state["seen_files"]
    assert "old_fail" in state["retried"]
    assert state["primed"] is True
    # A primed watcher does not re-report the pre-existing file.
    assert proactive.scan_new_files(s, state, time.time()) == []


def test_state_round_trips_through_disk(tmp_path):
    p = tmp_path / "proactive_state.json"
    state = proactive._default_state()
    state["last_daily"] = "2026-08-05"; state["seen_files"] = ["a", "b"]
    proactive.save_state(p, state)
    assert proactive.load_state(p)["last_daily"] == "2026-08-05"
    assert proactive.load_state(p)["seen_files"] == ["a", "b"]


def test_load_state_tolerates_a_corrupt_file(tmp_path):
    p = tmp_path / "s.json"; p.write_text("{not json")
    assert proactive.load_state(p) == proactive._default_state()


# --- the loop ----------------------------------------------------------------

def test_loop_is_a_noop_while_the_master_switch_is_off(tmp_path):
    bridge = FakeBridge()
    calls = {"n": 0}

    def load_settings():
        calls["n"] += 1
        return _settings(proactive_enabled=False, proactive_retry_enabled=True)

    store = FakeStore([_transient_task()], {"t1": ["429"]})
    asyncio.run(proactive.run_loop(
        store=store, bridge=bridge, load_settings=load_settings,
        state_path=tmp_path / "s.json",
        sleep=_no_sleep, clock=lambda: _at(12), max_ticks=3))
    assert calls["n"] == 3        # it did read settings each tick
    assert bridge.tasks == []     # but did nothing


def test_loop_primes_then_acts_on_new_failures(tmp_path):
    now_ts = time.time()
    store = FakeStore([_transient_task("pre", now_ts)], {"pre": ["429"]})
    bridge = FakeBridge()
    s = _settings(proactive_enabled=True, proactive_retry_enabled=True)

    asyncio.run(proactive.run_loop(
        store=store, bridge=bridge, load_settings=lambda: s,
        state_path=tmp_path / "s.json",
        sleep=_no_sleep, clock=lambda: _at(12), max_ticks=2))
    # "pre" existed at prime time, so it is baselined, not retried.
    assert bridge.tasks == []


async def _no_sleep(_s):
    return None
