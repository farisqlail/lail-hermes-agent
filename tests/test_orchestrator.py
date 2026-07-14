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
