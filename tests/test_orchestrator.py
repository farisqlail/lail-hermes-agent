import json
from pathlib import Path
from hermes.orchestrator import Orchestrator, parse_plan, choose_engine
from hermes.config import Settings
from hermes.session_store import Store

def test_parse_plan_with_fences():
    raw = "```json\n{\"steps\":[{\"type\":\"code\",\"engine\":\"claude\",\"prompt\":\"x\"}]}\n```"
    steps = parse_plan(raw)
    assert steps[0]["type"] == "code"

def test_choose_engine_default():
    s = Settings(default_engine="claude")
    assert choose_engine({"type": "code"}, s) == "claude"
    assert choose_engine({"type": "code", "engine": "antigravity"}, s) == "antigravity"

async def test_run_task_executes_steps(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(default_engine="claude", projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [
            {"type": "code", "engine": "claude", "prompt": "make it"},
            {"type": "build", "target": "apk"},
        ]})

    events = []
    async def fake_run_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        events.append(("code", engine)); return RunResult(True, "done", "", False, 0)
    async def fake_build(project_dir, ptype, timeout_s, run=None):
        from hermes.build_runner import BuildResult
        events.append(("build", ptype)); return BuildResult(True, "app.apk", "", "")

    deps = dict(run_engine=fake_run_engine, build_apk=fake_build,
                detect=lambda d: "flutter", test_emulator=None, test_browser=None)
    orch = Orchestrator(settings, store, planner, deps)

    reports = []
    async def report(tid, msg): reports.append(msg)
    store.create_task("t1", 5, "build a flutter app")
    await orch.run_task("t1", 5, "build a flutter app", report)

    assert ("code", "claude") in events
    assert ("build", "flutter") in events
    assert store.get_task("t1")["status"] == "done"

async def test_planning_failure_marks_task_failed(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        raise ValueError("model unavailable")

    orch = Orchestrator(settings, store, planner, {})
    reports = []
    async def report(tid, msg): reports.append(msg)
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)

    assert store.get_task("t1")["status"] == "failed"
    assert any("planning failed" in m for m in reports)

async def test_code_step_failure_halts_task(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(default_engine="claude", projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [
            {"type": "code", "engine": "claude", "prompt": "make it"},
            {"type": "build", "target": "apk"},
        ]})

    built = []
    async def failing_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        return RunResult(False, "", "boom", False, 1)
    async def fake_build(project_dir, ptype, timeout_s, run=None):
        built.append(ptype)

    deps = dict(run_engine=failing_engine, build_apk=fake_build,
                detect=lambda d: "flutter")
    orch = Orchestrator(settings, store, planner, deps)
    async def report(tid, msg): pass
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)

    assert store.get_task("t1")["status"] == "failed"
    assert built == []  # build step never reached

async def test_step_crash_marks_task_failed(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(default_engine="claude", projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "x"}]})

    async def exploding_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        raise FileNotFoundError("engine executable 'claude' not found on PATH")

    orch = Orchestrator(settings, store, planner, dict(run_engine=exploding_engine))
    reports = []
    async def report(tid, msg): reports.append(msg)
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)

    assert store.get_task("t1")["status"] == "failed"
    assert any("step crashed" in m and "not found on PATH" in m for m in reports)

async def test_emulator_step_passes_app_id(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "test", "mode": "emulator"}]})

    from hermes.test_runner import TestResult
    seen = []
    async def fake_test_emulator(apk, out, pkg):
        seen.append((apk, pkg))
        shot = Path(out) / "emulator.png"
        shot.parent.mkdir(parents=True, exist_ok=True)
        shot.write_bytes(b"PNG")
        return TestResult(True, str(shot), "ok")

    deps = dict(test_emulator=fake_test_emulator,
                detect_app_id=lambda proj: "com.example.app")
    orch = Orchestrator(settings, store, planner, deps)
    async def report(tid, msg): pass
    store.create_task("t1", 5, "test it")
    store.add_artifact("t1", "apk", "app.apk")
    await orch.run_task("t1", 5, "test it", report)

    assert seen == [("app.apk", "com.example.app")]
    assert store.get_task("t1")["status"] == "done"
    kinds = [a["kind"] for a in store.get_artifacts("t1")]
    assert "screenshot" in kinds

async def test_emulator_step_fails_without_app_id(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "test", "mode": "emulator"}]})

    async def fake_test_emulator(apk, out, pkg):
        raise AssertionError("must not run without app id")

    deps = dict(test_emulator=fake_test_emulator,
                detect_app_id=lambda proj: None)
    orch = Orchestrator(settings, store, planner, deps)
    reports = []
    async def report(tid, msg): reports.append(msg)
    store.create_task("t1", 5, "test it")
    store.add_artifact("t1", "apk", "app.apk")
    await orch.run_task("t1", 5, "test it", report)

    assert store.get_task("t1")["status"] == "failed"
    assert any("application id" in m for m in reports)

async def test_browser_step_via_injected_dep(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [
            {"type": "test", "mode": "browser", "url": "http://localhost:9"}]})

    from hermes.test_runner import TestResult
    seen = []
    async def fake_test_browser(url, out):
        seen.append(url)
        return TestResult(True, None, "ok")

    orch = Orchestrator(settings, store, planner, dict(test_browser=fake_test_browser))
    async def report(tid, msg): pass
    store.create_task("t1", 5, "test it")
    await orch.run_task("t1", 5, "test it", report)

    assert seen == ["http://localhost:9"]
    assert store.get_task("t1")["status"] == "done"


async def test_failed_code_step_saves_full_engine_transcript(hermes_home):
    """The chat report truncates stderr to 200 chars; the transcript artifact
    must carry the whole of both attempts (initial + corrected retry)."""
    from hermes import paths
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(default_engine="claude", projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "make it"}]})

    calls = []
    async def failing_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        calls.append(prompt)
        return RunResult(False, f"long stdout attempt {len(calls)} " + "x" * 500,
                         f"long stderr attempt {len(calls)} " + "y" * 500, False, 1)

    orch = Orchestrator(settings, store, planner, dict(run_engine=failing_engine))
    async def report(tid, msg): pass
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)

    assert len(calls) == 2                          # initial + corrected retry
    log = paths.artifacts_dir() / "t1" / "step-0-engine.log"
    assert log.is_file()
    body = log.read_text(encoding="utf-8")
    assert "long stdout attempt 1 " + "x" * 500 in body   # nothing truncated
    assert "long stderr attempt 1 " + "y" * 500 in body
    assert "long stderr attempt 2 " + "y" * 500 in body   # retry captured too
    assert {(a["kind"], a["path"]) for a in store.get_artifacts("t1")} == {
        ("log", str(log))}


async def test_successful_code_step_saves_transcript_too(hermes_home):
    """The transcript is for debugging either way — a success whose output
    looks wrong is debugged from the same file."""
    from hermes import paths
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(default_engine="claude", projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "make it"}]})

    async def fake_run_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        return RunResult(True, "all good", "", False, 0)

    orch = Orchestrator(settings, store, planner, dict(run_engine=fake_run_engine))
    async def report(tid, msg): pass
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)

    log = paths.artifacts_dir() / "t1" / "step-0-engine.log"
    assert log.is_file()
    assert "all good" in log.read_text(encoding="utf-8")
    assert store.get_task("t1")["status"] == "done"


async def test_timed_out_code_step_still_saves_transcript(hermes_home):
    from hermes import paths
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(default_engine="claude", projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "make it"}]})

    async def timing_out_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        return RunResult(False, "", "", True, None)

    orch = Orchestrator(settings, store, planner, dict(run_engine=timing_out_engine))
    async def report(tid, msg): pass
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)

    log = paths.artifacts_dir() / "t1" / "step-0-engine.log"
    assert "timed_out: True" in log.read_text(encoding="utf-8")
    assert store.get_task("t1")["status"] == "failed"


def _artifact_task_deps(events):
    """deps for a build+test plan whose artifacts should reach send_file."""
    from hermes.build_runner import BuildResult
    from hermes.test_runner import TestResult

    async def fake_build(project_dir, ptype, timeout_s, run=None):
        return BuildResult(True, "app.apk", "", "")

    async def fake_test_browser(url, out):
        shot = Path(out) / "browser.png"
        shot.parent.mkdir(parents=True, exist_ok=True)
        shot.write_bytes(b"PNG")
        return TestResult(True, str(shot), "ok")

    return dict(build_apk=fake_build, detect=lambda d: "flutter",
                test_browser=fake_test_browser)


async def test_artifacts_are_sent_to_the_chat(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [
            {"type": "build", "target": "apk"},
            {"type": "test", "mode": "browser"},
        ]})

    sent = []
    async def send_file(kind, path): sent.append((kind, path))

    orch = Orchestrator(settings, store, planner, _artifact_task_deps([]))
    async def report(tid, msg): pass
    store.create_task("t1", 5, "build and test")
    await orch.run_task("t1", 5, "build and test", report, send_file=send_file)

    assert store.get_task("t1")["status"] == "done"
    assert [k for k, _ in sent] == ["apk", "screenshot"]
    assert sent[0][1] == "app.apk"
    assert sent[1][1].endswith("browser.png")


async def test_failed_artifact_send_does_not_fail_the_step(hermes_home):
    """The step's real work succeeded; a Telegram hiccup (50 MB cap, chat
    gone) is logged, not escalated."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(projects_path=str(hermes_home / "proj"))

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "build", "target": "apk"}]})

    async def send_file(kind, path):
        raise RuntimeError("Request Entity Too Large")

    orch = Orchestrator(settings, store, planner, _artifact_task_deps([]))
    async def report(tid, msg): pass
    store.create_task("t1", 5, "build it")
    await orch.run_task("t1", 5, "build it", report, send_file=send_file)

    assert store.get_task("t1")["status"] == "done"
    assert [a["kind"] for a in store.get_artifacts("t1")] == ["apk"]
    assert any("could not send apk" in l for l in store.get_logs("t1"))


async def test_run_task_uses_supplied_proj(hermes_home):
    """A resolved existing project is used verbatim, not nested under task_id."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    settings = Settings(default_engine="claude",
                        projects_path=str(hermes_home / "proj"))
    existing = hermes_home / "myprofit"
    existing.mkdir()
    (existing / "marker.txt").write_text("pre-existing work")

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "fix it"}]})

    seen = []
    async def fake_run_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        seen.append(Path(cwd))
        return RunResult(True, "done", "", False, 0)

    deps = dict(run_engine=fake_run_engine, build_apk=None,
                detect=lambda d: "flutter", test_emulator=None, test_browser=None)
    orch = Orchestrator(settings, store, planner, deps)

    async def report(tid, msg): pass
    store.create_task("t1", 5, "fix it")
    await orch.run_task("t1", 5, "fix it", report, proj=existing)

    assert seen == [existing]                       # exact dir, not proj/t1
    assert (existing / "marker.txt").exists()       # untouched
    assert not (existing / "t1").exists()           # nothing nested


async def test_run_task_without_proj_creates_workspace(hermes_home):
    """proj=None keeps today's behaviour: a fresh dir named for the task."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    root = hermes_home / "proj"
    settings = Settings(default_engine="claude", projects_path=str(root))

    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "make it"}]})

    seen = []
    async def fake_run_engine(engine, prompt, cwd, timeout_s, extra_env=None):
        from hermes.engine_runner import RunResult
        seen.append(Path(cwd))
        return RunResult(True, "done", "", False, 0)

    deps = dict(run_engine=fake_run_engine, build_apk=None,
                detect=lambda d: "flutter", test_emulator=None, test_browser=None)
    orch = Orchestrator(settings, store, planner, deps)

    async def report(tid, msg): pass
    store.create_task("t1", 5, "make it")
    await orch.run_task("t1", 5, "make it", report)

    assert seen == [root / "t1"]
    assert (root / "t1").is_dir()
