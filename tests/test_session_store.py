from hermes.session_store import Store

def test_task_lifecycle(tmp_path):
    s = Store(tmp_path / "t.db")
    s.init_schema()
    s.create_task("t1", chat_id=99, text="build app")
    s.set_task_status("t1", "running")
    sid = s.add_step("t1", 0, "code", "claude prompt")
    s.set_step_status(sid, "done")
    s.append_log("t1", "line one")
    s.add_artifact("t1", "apk", r"E:\Hermes\artifacts\t1\app.apk")

    task = s.get_task("t1")
    assert task["status"] == "running"
    assert task["chat_id"] == 99
    assert s.get_logs("t1") == ["line one"]
    assert s.get_artifacts("t1")[0]["kind"] == "apk"
    assert s.list_tasks()[0]["task_id"] == "t1"


def _task(s, tid, status, chat=99, text="t"):
    s.create_task(tid, chat_id=chat, text=text)
    s.set_task_status(tid, status)


def _step_status(store, task_id) -> dict[int, str]:
    import sqlite3
    c = sqlite3.connect(store.db)
    try:
        return {r[0]: r[1] for r in
                c.execute("SELECT id, status FROM steps WHERE task_id=?", (task_id,))}
    finally:
        c.close()


def test_sweep_retires_only_live_looking_tasks(tmp_path):
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "run", "running")
    _task(s, "wait", "awaiting_confirm")
    _task(s, "queue", "queued")
    _task(s, "done", "done")
    _task(s, "fail", "failed")
    _task(s, "cancel", "cancelled")

    s.sweep_interrupted()

    assert s.get_task("run")["status"] == "interrupted"
    assert s.get_task("wait")["status"] == "interrupted"
    assert s.get_task("queue")["status"] == "interrupted"
    assert s.get_task("done")["status"] == "done"
    assert s.get_task("fail")["status"] == "failed"
    assert s.get_task("cancel")["status"] == "cancelled"


def test_sweep_returns_previous_status_and_fields(tmp_path):
    """The digest splits 'was running' from 'was waiting for you', so the
    pre-sweep status must survive the sweep."""
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "run", "running", chat=5, text="refactor auth")
    _task(s, "wait", "awaiting_confirm", chat=7, text="git push")

    swept = {r["task_id"]: r for r in s.sweep_interrupted()}

    assert swept["run"]["status"] == "running"
    assert swept["run"]["chat_id"] == 5
    assert swept["run"]["text"] == "refactor auth"
    assert swept["wait"]["status"] == "awaiting_confirm"
    assert swept["wait"]["chat_id"] == 7


def test_sweep_retires_live_steps_of_swept_tasks(tmp_path):
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "run", "running")
    running_step = s.add_step("run", 1, "build", "{}")
    s.set_step_status(running_step, "running")
    queued_step = s.add_step("run", 2, "test", "{}")      # left at "queued"
    done_step = s.add_step("run", 0, "code", "{}")
    s.set_step_status(done_step, "done")

    s.sweep_interrupted()

    rows = _step_status(s, "run")
    assert rows[running_step] == "interrupted"
    assert rows[queued_step] == "interrupted"
    assert rows[done_step] == "done"          # finished work keeps its result


def test_sweep_leaves_steps_of_terminal_tasks_alone(tmp_path):
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "done", "done")
    orphan = s.add_step("done", 0, "code", "{}")
    s.set_step_status(orphan, "running")      # oddball, but not ours to fix

    s.sweep_interrupted()

    assert _step_status(s, "done")[orphan] == "running"


def test_sweep_is_idempotent(tmp_path):
    """interrupted is terminal. start.bat restarts on crash, so a second pass
    must find nothing — otherwise a crash-loop spams the chat."""
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "run", "running")

    assert len(s.sweep_interrupted()) == 1
    assert s.sweep_interrupted() == []
    assert s.get_task("run")["status"] == "interrupted"


def test_sweep_on_empty_db(tmp_path):
    s = Store(tmp_path / "t.db"); s.init_schema()
    assert s.sweep_interrupted() == []
