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
