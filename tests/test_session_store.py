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


def test_messages_roundtrip_order_and_limit(tmp_path):
    s = Store(tmp_path / "t.db")
    s.init_schema()
    for i in range(5):
        s.add_message("web", "user", f"u{i}")
        s.add_message("web", "assistant", f"a{i}")

    # oldest-first reading order
    all_msgs = s.get_messages("web", limit=100)
    assert [m["content"] for m in all_msgs][:3] == ["u0", "a0", "u1"]
    assert all_msgs[0]["role"] == "user"

    # limit keeps the recent tail (last 3 inserted: a3, u4, a4), oldest-first
    tail = s.get_messages("web", limit=3)
    assert [m["content"] for m in tail] == ["a3", "u4", "a4"]

    # conversations are isolated by id
    s.add_message("other", "user", "x")
    assert [m["content"] for m in s.get_messages("other", 10)] == ["x"]
    assert len(s.get_messages("web", 100)) == 10

    s.clear_messages("web")
    assert s.get_messages("web", 100) == []
    assert [m["content"] for m in s.get_messages("other", 10)] == ["x"]


def test_context_summary_roundtrip_and_default(tmp_path):
    s = Store(tmp_path / "t.db")
    s.init_schema()
    assert s.get_context_summary("web") == ("", 0)

    s.save_context_summary("web", "ringkasan awal", 5)
    assert s.get_context_summary("web") == ("ringkasan awal", 5)

    s.save_context_summary("web", "ringkasan baru", 12)
    assert s.get_context_summary("web") == ("ringkasan baru", 12)

    # conversations are isolated by id
    assert s.get_context_summary("other") == ("", 0)


def test_get_messages_for_compression_returns_only_the_falling_out_tail(tmp_path):
    s = Store(tmp_path / "t.db")
    s.init_schema()
    for i in range(10):
        s.add_message("web", "user", f"m{i}")

    # keep_last=4 keeps the newest 4 live; m0..m5 are eligible to compress
    msgs, boundary = s.get_messages_for_compression("web", keep_last=4, already_through=0)
    assert [m["content"] for m in msgs] == [f"m{i}" for i in range(6)]
    assert all("id" in m and "role" in m for m in msgs)

    # nothing new has piled up past `boundary` yet -> nothing eligible
    msgs2, boundary2 = s.get_messages_for_compression("web", keep_last=4, already_through=boundary)
    assert msgs2 == []
    assert boundary2 == boundary

    # fewer messages than the live window itself -> nothing eligible
    msgs3, boundary3 = s.get_messages_for_compression("web", keep_last=20, already_through=0)
    assert msgs3 == []
    assert boundary3 == 0


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


def test_scheduled_jobs_crud(tmp_path):
    s = Store(tmp_path / "t.db"); s.init_schema()
    s.create_scheduled_job("j1", "run backup", interval_s=3600, next_run_ts=1000.0, chat_id=123)
    jobs = s.list_scheduled_jobs(enabled_only=True)
    assert len(jobs) == 1
    assert jobs[0]["job_id"] == "j1"
    assert jobs[0]["description"] == "run backup"
    assert jobs[0]["interval_s"] == 3600
    assert jobs[0]["next_run_ts"] == 1000.0

    s.update_scheduled_job_run("j1", last_run_ts=1000.0, next_run_ts=4600.0, enabled=True)
    job = s.get_scheduled_job("j1")
    assert job["last_run_ts"] == 1000.0
    assert job["next_run_ts"] == 4600.0

    assert s.delete_scheduled_job("j1") is True
    assert s.get_scheduled_job("j1") is None



def test_task_origin_defaults_to_none_and_round_trips(tmp_path):
    """`origin` says where a task came from when `session_id` cannot — an
    Office task belongs to an employee, not to a conversation."""
    s = Store(tmp_path / "t.db"); s.init_schema()
    s.create_task("plain", chat_id=-1, text="from the web", session_id="sess1")
    s.create_task("office", chat_id=0, text="from an employee", origin="office")

    assert s.get_task("plain")["origin"] is None
    assert s.get_task("office")["origin"] == "office"
    assert s.get_task("office")["session_id"] is None


def test_origin_column_is_added_to_a_pre_existing_tasks_table(tmp_path):
    """The migration path: a database written before the column existed must
    keep working, which is why init_schema pairs CREATE with ALTER."""
    import sqlite3
    db = tmp_path / "old.db"
    con = sqlite3.connect(str(db))
    with con:
        con.execute("CREATE TABLE tasks(task_id TEXT PRIMARY KEY, chat_id INTEGER, "
                    "text TEXT, status TEXT, created REAL)")
        con.execute("INSERT INTO tasks VALUES('legacy', 7, 'old task', 'done', 1.0)")
    con.close()

    s = Store(db); s.init_schema()
    assert s.get_task("legacy")["origin"] is None
    s.create_task("new", chat_id=0, text="after migration", origin="office")
    assert s.get_task("new")["origin"] == "office"
