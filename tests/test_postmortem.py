"""The report reproduces, from data, the grouping that was done by hand.

The failures below are the ten real ones from the live history — the same set
whose grouping turned "the retry loop is too short" into "the retry loop is
blind". If this module cannot reach that reading on that data, it is not worth
running.
"""
from hermes import failure, postmortem

_HISTORY = [
    ("t1", "step 1 [build]: build failed: unsupported project type: unknown"),
    ("t2", "step 0 [test]: no apk artifact to test"),
    ("t3", "step 0 [code]: step crashed: engine executable 'claude' not found on PATH"),
    ("t4", "step 0 [build]: step crashed: [WinError 2] The system cannot find the file specified"),
    ("t5", "planning failed: The model endpoint is overloaded right now"),
    ("t6", "step 0 [build]: step crashed: [WinError 2] The system cannot find the file specified"),
    ("t7", "step 0 [code]: engine failed after 3 round(s): 429"),
    ("t8", "step 0 [code]: engine failed after 3 round(s): 429"),
    ("t9", "step 0 [code]: engine failed after 3 round(s): 429"),
    ("t10", "step 0 [code]: engine failed after 3 round(s): 429"),
]


def _fixture(extra_done=0):
    tasks = [{"task_id": tid, "status": "failed", "text": "x"} for tid, _ in _HISTORY]
    tasks += [{"task_id": f"ok{i}", "status": "done", "text": "x"}
              for i in range(extra_done)]
    logs = {tid: ["project: C:/x", line] for tid, line in _HISTORY}
    return tasks, (lambda tid: logs.get(tid, []))


def test_cause_is_the_last_log_line():
    """Verified against all ten: a task reports its failure and returns, so
    nothing is written after it."""
    assert postmortem.cause(["project: C:/x", "step 0 [code]: boom"]) == "step 0 [code]: boom"
    assert postmortem.cause(["a", "", "  "]) == "a"
    assert postmortem.cause([]) == ""


def test_the_real_history_groups_the_way_it_was_grouped_by_hand():
    tasks, get_logs = _fixture(extra_done=25)
    s = postmortem.summarize(tasks, get_logs)
    assert s["failed"] == 10 and s["tasks_seen"] == 35
    assert s["by_kind"][failure.TRANSIENT] == 5      # 4x 429 + 1 overloaded
    assert s["by_kind"][failure.ENVIRONMENT] == 3    # 1 PATH + 2 WinError 2
    assert s["by_kind"][failure.STRUCTURAL] == 2
    assert failure.SEMANTIC not in s["by_kind"]      # none were code errors


def test_repeats_are_ranked_and_carry_what_would_fix_them():
    tasks, get_logs = _fixture()
    repeats = postmortem.summarize(tasks, get_logs)["repeats"]
    assert repeats[0]["count"] == 4 and "429" in repeats[0]["example"]
    assert len(repeats[0]["task_ids"]) == 4
    winerror = next(g for g in repeats if "WinError 2" in g["example"])
    assert winerror["count"] == 2
    assert "PATH" in winerror["advice"]              # actionable, not just counted


def test_render_says_what_it_means_not_just_what_happened():
    tasks, get_logs = _fixture(extra_done=25)
    out = postmortem.render(postmortem.summarize(tasks, get_logs))
    assert "10 dari 35 task terakhir gagal" in out
    assert "4x" in out                                # the repeat is called out
    assert "harus dipasang atau diperbaiki di mesin ini" in out
    assert "rencana yang salah" in out
    assert "kirim ulang" in out


def test_a_clean_history_reports_nothing_to_do():
    tasks = [{"task_id": "a", "status": "done", "text": "x"}]
    out = postmortem.render(postmortem.summarize(tasks, lambda tid: []))
    assert "Tidak ada task gagal" in out


def test_a_failure_with_no_logs_is_still_counted():
    """A task that died before writing a line is a failure we know nothing
    about — which must not be silently dropped from the count."""
    tasks = [{"task_id": "a", "status": "failed", "text": "x"}]
    s = postmortem.summarize(tasks, lambda tid: [])
    assert s["failed"] == 1
    assert s["by_kind"] == {failure.SEMANTIC: 1}     # unknown text, default class
