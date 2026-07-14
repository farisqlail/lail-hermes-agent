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
