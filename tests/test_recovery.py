from hermes.recovery import group_digests


def _row(tid, chat, status, text="do a thing"):
    return {"task_id": tid, "chat_id": chat, "text": text, "status": status}


def test_empty_input_produces_nothing():
    assert group_digests([]) == []


def test_one_chat_one_task():
    out = group_digests([_row("t1", 5, "running", "refactor auth")])
    assert len(out) == 1
    chat_id, msg = out[0]
    assert chat_id == 5
    assert "t1" in msg
    assert "refactor auth" in msg
    assert "Nothing was resumed" in msg


def test_groups_by_chat():
    out = group_digests([
        _row("t1", 5, "running"),
        _row("t2", 7, "running"),
        _row("t3", 5, "queued"),
    ])
    assert len(out) == 2
    by_chat = dict(out)
    assert "t1" in by_chat[5] and "t3" in by_chat[5]
    assert "t2" in by_chat[7]
    assert "t1" not in by_chat[7]


def test_awaiting_confirm_is_called_out_separately():
    """Its required action differs: the inline buttons are dead after a
    restart, so those tasks must be resubmitted."""
    out = group_digests([
        _row("t1", 5, "running", "refactor auth"),
        _row("t2", 5, "awaiting_confirm", "git push"),
    ])
    _, msg = out[0]
    assert "resubmit" in msg.lower()
    running_at, waiting_at = msg.index("t1"), msg.index("t2")
    assert running_at < waiting_at          # running group first


def test_queued_counts_as_running_for_display():
    """A queued task never started, but from the user's side it is the same
    story: it was submitted and it did not happen."""
    out = group_digests([_row("t1", 5, "queued")])
    _, msg = out[0]
    assert "resubmit" not in msg.lower()    # no dead buttons to explain


def test_caps_listing_at_five_per_group():
    rows = [_row(f"task-{i}", 5, "running") for i in range(9)]
    _, msg = group_digests(rows)[0]
    listed = [r["task_id"] for r in rows if r["task_id"] in msg]
    assert listed == [f"task-{i}" for i in range(5)]   # first five, in order
    assert "and 4 more" in msg
    assert "9 tasks were" in msg            # total is still stated


def test_single_task_message_is_singular():
    _, msg = group_digests([_row("t1", 5, "running")])[0]
    assert "1 task was interrupted" in msg
    assert "tasks were" not in msg


def test_two_tasks_message_is_plural():
    _, msg = group_digests([_row("t1", 5, "running"), _row("t2", 5, "queued")])[0]
    assert "2 tasks were interrupted" in msg


def test_capped_section_plus_waiting_section_totals_all_rows():
    """The stated total must count rows the cap hid AND the other section."""
    rows = [_row(f"task-{i}", 5, "running") for i in range(6)]
    rows.append(_row("task-w", 5, "awaiting_confirm"))
    _, msg = group_digests(rows)[0]
    assert "7 tasks were" in msg            # grand total, not 5 or 6
    assert "and 1 more" in msg              # running section capped at five
    assert "task-w" in msg                  # waiting section still listed


def test_null_task_text_renders():
    """tasks.text has no NOT NULL constraint; a None must not crash."""
    _, msg = group_digests([_row("t1", 5, "running", None)])[0]
    assert "t1" in msg


def test_within_section_order_is_input_order():
    rows = [_row(t, 5, "running") for t in ("task-c", "task-a", "task-b")]
    _, msg = group_digests(rows)[0]
    positions = [msg.index(t) for t in ("task-c", "task-a", "task-b")]
    assert positions == sorted(positions)


def test_long_task_text_is_truncated():
    out = group_digests([_row("t1", 5, "running", "x" * 200)])
    _, msg = out[0]
    assert len(max(msg.splitlines(), key=len)) < 120


def test_chat_order_is_stable():
    rows = [_row("t1", 9, "running"), _row("t2", 3, "running")]
    assert [c for c, _ in group_digests(rows)] == [9, 3]   # first-seen order
