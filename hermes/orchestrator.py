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

# Directories whose contents say nothing about the project's own code. Their
# names are still listed (with a marker) so the engine knows they exist.
_SUMMARY_SKIP = {".git", "node_modules", ".venv", "venv", "__pycache__",
                 ".gradle", ".dart_tool", "build", ".idea", ".vscode"}
_SUMMARY_MAX_ENTRIES = 50

def _project_summary(proj: Path) -> str:
    """A two-level, capped listing of the project tree.

    Bounded on purpose: the cap keeps the prompt small even against a big
    registered project, and antigravity still passes its prompt via argv,
    where Windows caps the command line at 8191 chars. Never raises — a
    summary is context, not a precondition.
    """
    try:
        top = sorted(proj.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        return "(directory could not be read)"
    entries: list[str] = []
    for p in top:
        if p.is_dir():
            if p.name in _SUMMARY_SKIP:
                entries.append(f"{p.name}/ (contents omitted)")
                continue
            entries.append(f"{p.name}/")
            try:
                children = sorted(p.iterdir(), key=lambda c: c.name.lower())
            except OSError:
                children = []
            entries.extend(
                f"  {c.name}/" if c.is_dir() else f"  {c.name}" for c in children)
        else:
            entries.append(p.name)
    if not entries:
        return "(empty directory — this is a brand-new project)"
    if len(entries) > _SUMMARY_MAX_ENTRIES:
        extra = len(entries) - _SUMMARY_MAX_ENTRIES
        entries = entries[:_SUMMARY_MAX_ENTRIES] + [f"…and {extra} more entries"]
    return "\n".join(entries)

def _compose_engine_prompt(task_text: str, proj: Path, step_prompt: str) -> str:
    """Give the engine the whole picture, not just the planner's step line.

    A bare step prompt ("implement the login fix") reaches the engine with no
    idea what the user actually asked for or what already exists on disk. The
    original task and a tree summary anchor it; the step stays last so it
    reads as the instruction.
    """
    return ("# Original task (from the user)\n"
            f"{task_text}\n\n"
            "# Project structure (top two levels)\n"
            f"{_project_summary(proj)}\n\n"
            "# Your step (do only this)\n"
            f"{step_prompt}")

# A code step gets up to this many engine sessions: the first, plus fix-up
# rounds that feed the previous session's output back in. Bounded for the
# same reason as MAX_TOOL_ROUNDS — "loop until done" without a cap is a
# runaway-cost bug, not persistence. Worst case per step is
# MAX_ENGINE_ROUNDS * timeout_code_s.
MAX_ENGINE_ROUNDS = 3

_DONE_SENTINEL = "HERMES_STEP_DONE"

# Appended to every code-step prompt. Exists because an engine session can
# exit 0 mid-task ("Waiting on npm install ... will run tests once it lands")
# — exit code alone cannot distinguish "done and verified" from "gave up
# politely", so the engine has to say it explicitly.
_COMPLETION_CONTRACT = (
    "\n\n# Completion contract\n"
    f"When — and only when — this step is fully done and verified in THIS "
    f"session (code written; any build/tests you said you would run actually "
    f"ran and passed), print {_DONE_SENTINEL} on its own line as the last "
    "thing you output. Never print it for work you only plan, promise, or "
    "leave waiting on a background command. If you cannot finish, instead "
    "state precisely what remains to be done."
)

def _confirmed_done(stdout: str) -> bool:
    """True only when the engine's own last output line is the sentinel.

    Presence anywhere is not enough: _COMPLETION_CONTRACT quotes the sentinel,
    so it is in every prompt, and _continuation_prompt feeds a previous
    session's stdout back in. Any engine that echoes its input -- or that just
    says "I'll print HERMES_STEP_DONE when tests pass" -- would otherwise
    confirm a step it never did. Matching the final line is exactly what the
    contract asks the engine for.
    """
    lines = [ln.strip() for ln in stdout.splitlines() if ln.strip()]
    return bool(lines) and lines[-1] == _DONE_SENTINEL

def _continuation_prompt(base: str, prev) -> str:
    reason = ("ended with an error" if not prev.ok
              else "ended without confirming completion")
    return (base
            + f"\n\n# Continuation\nA previous session on this step {reason}. "
            "Its final output is below. Pick up where it left off: check what "
            "actually landed on disk, finish the remaining work, run the "
            "verification for real, and fix anything broken.\n"
            f"--- previous stdout (tail) ---\n{prev.stdout[-800:]}\n"
            f"--- previous stderr (tail) ---\n{prev.stderr[-800:]}")

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

    def get_settings(self):
        from . import config, paths
        if not (paths.config_dir() / "config.yaml").exists():
            return self.settings
        return config.load_settings()

    async def run_task(self, task_id: str, chat_id: int, text: str, report,
                       proj: Path | None = None, send_file=None) -> None:
        from . import paths
        self.settings = self.get_settings()
        self.store.set_task_status(task_id, "running")
        if proj is None:
            # No registered project: fresh throwaway workspace, named for the task.
            projects_path = self.settings.projects_path or str(paths.projects_dir())
            proj = Path(projects_path) / task_id
            proj.mkdir(parents=True, exist_ok=True)
        await report(task_id, "planning...")
        try:
            raw = await self.planner(text, [])
            steps = parse_plan(raw)
        except Exception as e:
            self.store.set_task_status(task_id, "failed")
            self.store.append_log(task_id, f"planning failed: {e}")
            await report(task_id, f"planning failed: {e}")
            return

        await report(task_id, f"plan ready: {len(steps)} step(s) — "
                              + ", ".join(s.get("type", "?") for s in steps))
        for i, step in enumerate(steps):
            sid = self.store.add_step(task_id, i, step.get("type", "?"), json.dumps(step))
            self.store.set_step_status(sid, "running")
            await report(task_id, f"step {i} [{step.get('type')}] started...")
            try:
                ok, msg = await self._exec_step(task_id, proj, step, i, text,
                                                send_file)
            except Exception as e:
                ok, msg = False, f"step crashed: {e}"
            self.store.set_step_status(sid, "done" if ok else "failed")
            self.store.append_log(task_id, f"step {i} [{step.get('type')}]: {msg}")
            await report(task_id, f"step {i} [{step.get('type')}]: {msg}")
            if not ok:
                self.store.set_task_status(task_id, "failed")
                return
        self.store.set_task_status(task_id, "done")
        self.store.append_log(task_id, "task complete")
        await report(task_id, "task complete")

    def _save_engine_transcript(self, task_id: str, idx: int, engine: str,
                                attempts: list) -> None:
        """Persist the full engine output as an artifact.

        The chat report only carries stderr[:200]; without this, the rest of
        the engine's stdout/stderr is gone and a failed step cannot be
        debugged. Saving must never take the step down with it — a transcript
        is a bonus, not a precondition.
        """
        from . import paths
        try:
            d = paths.artifacts_dir() / task_id
            d.mkdir(parents=True, exist_ok=True)
            parts = []
            for n, r in enumerate(attempts, 1):
                parts.append(
                    f"=== attempt {n}/{len(attempts)} — engine: {engine}, "
                    f"ok: {r.ok}, returncode: {r.returncode}, "
                    f"timed_out: {r.timed_out} ===\n"
                    f"--- stdout ---\n{r.stdout}\n"
                    f"--- stderr ---\n{r.stderr}\n")
            log = d / f"step-{idx}-engine.log"
            log.write_text("\n".join(parts), encoding="utf-8")
            self.store.add_artifact(task_id, "log", str(log))
        except OSError as e:
            self.store.append_log(
                task_id, f"could not save engine transcript for step {idx}: {e}")

    async def _send_artifact(self, task_id: str, send_file, kind: str,
                             path) -> None:
        """Push a produced artifact straight to the chat, if a channel exists.

        Guarded like the transcript save: a Telegram hiccup (file too big,
        chat gone, network) must not fail a step whose real work succeeded.
        The artifact row is already in the store either way, so the dashboard
        keeps working.
        """
        if send_file is None or not path:
            return
        try:
            await send_file(kind, path)
        except Exception as e:
            self.store.append_log(
                task_id, f"could not send {kind} to chat: {e}")

    async def _exec_step(self, task_id, proj: Path, step: dict, idx: int,
                         text: str = "", send_file=None):
        t = step.get("type")
        if t == "code":
            engine = choose_engine(step, self.settings)
            base = (_compose_engine_prompt(text, proj, step.get("prompt", ""))
                    + _COMPLETION_CONTRACT)
            prompt = base
            attempts = []
            res = None
            for _ in range(MAX_ENGINE_ROUNDS):
                res = await self.deps["run_engine"](
                    engine, prompt, proj, self.settings.timeout_code_s)
                attempts.append(res)
                if res.timed_out:
                    break
                if res.ok and _confirmed_done(res.stdout):
                    break                      # confirmed done, stop early
                # error OR unconfirmed completion: hand the session's output
                # to a fresh session and let the engine fix/finish it itself
                prompt = _continuation_prompt(base, res)
            self._save_engine_transcript(task_id, idx, engine, attempts)
            rounds = len(attempts)
            if res.timed_out:
                return (False, f"engine timed out (round {rounds})")
            if not res.ok:
                return (False, f"engine failed after {rounds} round(s): "
                               f"{res.stderr[:200]}")
            if _confirmed_done(res.stdout):
                return (True, f"coded (confirmed done, {rounds} round(s))")
            return (True, f"coded ({rounds} round(s), completion not "
                          f"confirmed — check the step transcript)")
        if t == "build":
            ptype = self.deps["detect"](proj)
            res = await self.deps["build_apk"](proj, ptype, self.settings.timeout_build_s)
            if res.ok:
                self.store.add_artifact(task_id, "apk", res.apk_path)
                await self._send_artifact(task_id, send_file, "apk", res.apk_path)
            return (res.ok, f"apk: {res.apk_path}" if res.ok else f"build failed: {res.stderr[:200]}")
        if t == "test":
            mode = step.get("mode", self.settings.default_test_mode)
            out = Path(str(proj)) / "test-out"
            if mode == "emulator" and self.deps.get("test_emulator"):
                apks = [a["path"] for a in self.store.get_artifacts(task_id) if a["kind"] == "apk"]
                if not apks:
                    return (False, "no apk artifact to test")
                detect_app_id = self.deps.get("detect_app_id")
                pkg = detect_app_id(proj) if detect_app_id else None
                if not pkg:
                    return (False, "could not determine application id for emulator launch")
                res = await self.deps["test_emulator"](apks[-1], out, pkg)
            elif mode == "browser" and self.deps.get("test_browser"):
                res = await self.deps["test_browser"](step.get("url", "http://localhost:3000"), out)
            else:
                return (True, "no test mode")
            if getattr(res, "screenshot_path", None):
                self.store.add_artifact(task_id, "screenshot", res.screenshot_path)
                await self._send_artifact(task_id, send_file, "screenshot",
                                          res.screenshot_path)
            return (res.ok, res.detail)
        return (False, f"unknown step type: {t}")
