from __future__ import annotations
import json, re
from pathlib import Path
from .config import Settings
from .session_store import Store

def parse_plan(raw: str) -> list[dict]:
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        raise ValueError("no JSON object in planner output")
    data = json.loads(m.group(0))
    steps = data.get("steps")
    if not isinstance(steps, list):
        raise ValueError("plan has no steps list")
    return steps

def choose_engine(step: dict, settings: Settings) -> str:
    if step.get("engine") in ("claude", "antigravity"):
        return step["engine"]
    if settings.default_engine in ("claude", "antigravity"):
        return settings.default_engine
    return "antigravity" if step.get("scope") == "large" else "claude"

class Orchestrator:
    def __init__(self, settings: Settings, store: Store, planner, deps: dict):
        self.settings = settings
        self.store = store
        self.planner = planner          # async (text, tools) -> str
        self.deps = deps                # run_engine, build_apk, detect, test_*

    async def run_task(self, task_id: str, chat_id: int, text: str, report) -> None:
        self.store.create_task(task_id, chat_id, text)
        self.store.set_task_status(task_id, "running")
        proj = Path(self.settings.projects_path) / task_id
        proj.mkdir(parents=True, exist_ok=True)
        try:
            raw = await self.planner(text, [])
            steps = parse_plan(raw)
        except Exception as e:
            self.store.set_task_status(task_id, "failed")
            await report(task_id, f"planning failed: {e}")
            return

        for i, step in enumerate(steps):
            sid = self.store.add_step(task_id, i, step.get("type", "?"), json.dumps(step))
            self.store.set_step_status(sid, "running")
            ok, msg = await self._exec_step(task_id, proj, step)
            self.store.set_step_status(sid, "done" if ok else "failed")
            await report(task_id, f"step {i} [{step.get('type')}]: {msg}")
            if not ok:
                self.store.set_task_status(task_id, "failed")
                return
        self.store.set_task_status(task_id, "done")
        await report(task_id, "task complete")

    async def _exec_step(self, task_id, proj: Path, step: dict):
        t = step.get("type")
        if t == "code":
            engine = choose_engine(step, self.settings)
            res = await self.deps["run_engine"](
                engine, step.get("prompt", ""), proj, self.settings.timeout_code_s)
            if not res.ok and not res.timed_out:
                # one corrected retry
                res = await self.deps["run_engine"](
                    engine, step.get("prompt", "") + f"\n\nPrevious error:\n{res.stderr[:800]}",
                    proj, self.settings.timeout_code_s)
            return (res.ok, "coded" if res.ok else f"engine failed: {res.stderr[:200]}")
        if t == "build":
            ptype = self.deps["detect"](proj)
            res = await self.deps["build_apk"](proj, ptype, self.settings.timeout_build_s)
            if res.ok:
                self.store.add_artifact(task_id, "apk", res.apk_path)
            return (res.ok, f"apk: {res.apk_path}" if res.ok else f"build failed: {res.stderr[:200]}")
        if t == "test":
            mode = step.get("mode", self.settings.default_test_mode)
            return (True, f"test mode {mode} scheduled")  # wired in main with real adb/browser
        return (False, f"unknown step type: {t}")
