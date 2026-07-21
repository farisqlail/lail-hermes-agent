from __future__ import annotations
import json, re, uuid
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

def validate_plan(steps: list[dict], default_test_mode: str = "none") -> None:
    """Reject a structurally impossible plan before any step runs.

    The planner LLM sometimes emits a `test`/emulator step with no `build`
    ahead of it — or, as seen against a web project, types a whole bug-fix task
    as a lone emulator test. That step can only ever fail with "no apk artifact
    to test": the emulator needs an APK a build step would have produced.
    Catching it here turns a doomed run into an actionable planning error,
    surfaced the same way as any other planning failure.

    Only emulator tests need a build. A `browser` test, or a test left at the
    default `none` mode, has no such dependency and is left alone. mode is read
    the same way _exec_step reads it: the step's own mode, else the configured
    default.
    """
    built = False
    for i, step in enumerate(steps):
        kind = step.get("type")
        if kind == "build":
            built = True
        elif kind == "test":
            mode = step.get("mode") or default_test_mode
            if mode == "emulator" and not built:
                raise ValueError(
                    f"step {i} is an emulator test with no build step before it "
                    "— nothing produces an APK to install. The plan needs a "
                    "`build` step first, or (for a non-Android project) the test "
                    "should use mode `browser` or be dropped.")

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

def _confirmed_done(final_text: str) -> bool:
    """True only when the engine's own closing line is the sentinel.

    Read `RunResult.final_text`, never raw stdout. Presence anywhere is not
    enough: _COMPLETION_CONTRACT quotes the sentinel, so it is in every prompt.
    An engine emitting a structured envelope gives us only the model's final
    message here — no tool output, no echoed prompt — which is what closes the
    spoof surface. For a text-mode engine this falls back to stdout, where
    matching the last line is the best available proxy.
    """
    lines = [ln.strip() for ln in final_text.splitlines() if ln.strip()]
    return bool(lines) and lines[-1] == _DONE_SENTINEL

def _resume_prompt() -> str:
    """The continuation instruction for a session being reopened.

    Nothing is restated but the contract: the session already holds the task,
    the tree summary, the step, and everything it printed. Re-sending them —
    which is what _continuation_prompt must do for a fresh session — would pay
    for the same context twice.
    """
    return ("# Continuation\nYour previous turn in this session ended without "
            "confirming completion. Check what actually landed on disk, finish "
            "the remaining work, run the verification for real, and fix "
            "anything broken." + _COMPLETION_CONTRACT)

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

def _is_empty(proj: Path) -> bool:
    """True when the directory holds nothing. False if it cannot be read —
    an unreadable directory is not evidence that no work was done."""
    try:
        return not any(proj.iterdir())
    except OSError:
        return False

def _outcome_header(res) -> str:
    """Session, cost and turns for a transcript attempt header, if reported.

    Empty for a text-mode engine, so the header keeps its old shape rather
    than filling up with `None`s that say nothing.
    """
    o = res.outcome
    if o is None:
        return ""
    bits = []
    if o.session_id:
        bits.append(f"session: {o.session_id}")
    if o.cost_usd is not None:
        bits.append(f"cost: ${o.cost_usd:.4f}")
    if o.num_turns is not None:
        bits.append(f"turns: {o.num_turns}")
    if o.api_error:
        bits.append(f"api_error: {o.api_error}")
    return ", " + ", ".join(bits) if bits else ""

def _session_kwargs(engine: str, session_id: str, resume_id: str) -> dict:
    """Session flags for this round, or nothing at all.

    Empty for an engine that cannot resume, which keeps `run_engine` doubles
    free to declare narrow signatures — the same reason model/effort are only
    passed when configured.
    """
    from .engine_runner import RESUMABLE
    if engine not in RESUMABLE:
        return {}
    return {"resume_id": resume_id} if resume_id else {"session_id": session_id}

def _resumable_id(engine: str, res) -> str:
    """The session to reopen next round, or "" to start a fresh one.

    This one expression is the whole fallback story. A round that produced no
    envelope — an unparseable stream, a text-mode engine, a session that never
    got far enough to report — yields "", and the caller drops back to a new
    session carrying the previous output. There is no separate recovery path to
    rot, and the fallback is exercised on every antigravity run.
    """
    from .engine_runner import RESUMABLE
    if engine not in RESUMABLE or not res.outcome:
        return ""
    return res.outcome.session_id or ""

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
        # Captured before the workspace is created: afterwards the two cases are
        # indistinguishable on disk, and an empty workspace detects as `unknown`
        # exactly like an unrecognised existing project would.
        is_new = proj is None
        if proj is None:
            # No registered project: fresh throwaway workspace, named for the task.
            projects_path = self.settings.projects_path or str(paths.projects_dir())
            proj = Path(projects_path) / task_id
            proj.mkdir(parents=True, exist_ok=True)
        # Snapshot the project *before* any step edits it, so the end-of-task
        # summary reflects only this task's work. None for a non-git workspace.
        from . import git_status
        try:
            snapshot = await git_status.start_snapshot(proj)
        except Exception:
            snapshot = None
        await report(task_id, "planning...")
        try:
            raw = await self.planner(text, self._plan_context(proj, is_new))
            steps = parse_plan(raw)
            validate_plan(steps, self.settings.default_test_mode)
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
                                                send_file, chat_id)
            except Exception as e:
                ok, msg = False, f"step crashed: {e}"
            self.store.set_step_status(sid, "done" if ok else "failed")
            self.store.append_log(task_id, f"step {i} [{step.get('type')}]: {msg}")
            await report(task_id, f"step {i} [{step.get('type')}]: {msg}")
            if not ok:
                self.store.set_task_status(task_id, "failed")
                return
        self.store.set_task_status(task_id, "done")
        # A change summary is a courtesy: a failure computing it must never
        # turn a completed task into a reported failure.
        try:
            summary = await git_status.summarize_since(proj, snapshot)
        except Exception:
            summary = None
        done_msg = "task complete" if not summary else f"task complete\n\n{summary}"
        # The log feeds the web UI, which escapes what it renders — store the
        # tag-free form so the summary reads as a table there too.
        from . import tg_format
        self.store.append_log(task_id, tg_format.plain_text(done_msg))
        # The summary embeds a <pre> table, so it — and only it — goes out as
        # HTML. Every other report is raw engine text that must not be parsed.
        await report(task_id, done_msg, html=summary is not None)

    def _plan_context(self, proj: Path, is_new: bool) -> str:
        """The project facts handed to the planner.

        Called inside run_task's planning `try`, so a failure here reports as a
        planning failure rather than needing an error path of its own.

        `detect` is read off deps like every other capability: absent — as in
        the many tests that inject only `run_engine` — means no type is
        claimed, not that the type is unknown.
        """
        from . import plan_context
        detect = self.deps.get("detect")
        ptype = detect(proj) if detect and not is_new else ""
        summary = "" if is_new else _project_summary(proj)
        return plan_context.build(summary, ptype or "", is_new, proj.name)

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
                    f"timed_out: {r.timed_out}{_outcome_header(r)} ===\n"
                    f"--- stdout ---\n{r.stdout}\n"
                    f"--- stderr ---\n{r.stderr}\n")
            log = d / f"step-{idx}-engine.log"
            log.write_text("\n".join(parts), encoding="utf-8")
            self.store.add_artifact(task_id, "log", str(log))
        except OSError as e:
            self.store.append_log(
                task_id, f"could not save engine transcript for step {idx}: {e}")

    def _log_engine_cost(self, task_id: str, idx: int, engine: str,
                         attempts: list) -> None:
        """Record what the step cost, when the engine reports it.

        A log line, not a table: nothing queries spend yet, and the log is
        already what the dashboard renders. A text-mode engine reports no cost
        and so gets no line — an invented $0.0000 would read as free.
        """
        costs = [a.outcome.cost_usd for a in attempts
                 if a.outcome and a.outcome.cost_usd is not None]
        if not costs:
            return
        self.store.append_log(
            task_id, f"step {idx} [{engine}]: {len(attempts)} round(s), "
                     f"${sum(costs):.4f}")

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
                         text: str = "", send_file=None, chat_id: int = 0):
        t = step.get("type")
        if t == "code":
            engine = choose_engine(step, self.settings)
            base = (_compose_engine_prompt(text, proj, step.get("prompt", ""))
                    + _COMPLETION_CONTRACT)
            prompt = base
            attempts = []
            res = None
            # Tuning kwargs only when configured, so fakes and run_engine
            # doubles keep their narrower signature — the send_file pattern.
            # Per-engine: the two CLIs accept different model names.
            tuning = {}
            if engine == "claude":
                if self.settings.claude_model:
                    tuning["model"] = self.settings.claude_model
                if self.settings.claude_effort:
                    tuning["effort"] = self.settings.claude_effort
            elif engine == "antigravity" and self.settings.agy_model:
                tuning["model"] = self.settings.agy_model
            # An engine that can call ask_user gets a per-round run token and a
            # pausable clock: the token maps its tool calls back to this chat,
            # and the deadline is suspended while the operator thinks so a slow
            # answer never times the step out. Opt-in — a registry is injected
            # only in the live app, so the many run_engine-only test doubles
            # keep their narrow signature (the tuning/session pattern).
            from .engine_runner import MCP_CONFIG_FLAG
            ask = self.deps.get("ask_registry")
            ask_here = ask is not None and engine in MCP_CONFIG_FLAG
            # Hermes names the session rather than reading one back, so a
            # round that dies before printing anything is still resumable.
            session_id, resume_id = str(uuid.uuid4()), ""
            for _ in range(MAX_ENGINE_ROUNDS):
                session = _session_kwargs(engine, session_id, resume_id)
                ask_kw, token = {}, ""
                if ask_here:
                    from .ask import Deadline
                    deadline = Deadline(self.settings.timeout_code_s)
                    token = ask.open_run(task_id, chat_id, deadline)
                    ask_kw = {"deadline": deadline,
                              "ask_url": self.deps.get("ask_url", ""),
                              "ask_token": token}
                try:
                    res = await self.deps["run_engine"](
                        engine, prompt, proj, self.settings.timeout_code_s,
                        **tuning, **session, **ask_kw)
                finally:
                    if token:
                        ask.close_run(token)
                attempts.append(res)
                if res.timed_out:
                    break
                if res.ok and _confirmed_done(res.final_text):
                    break                      # confirmed done, stop early
                # error OR unconfirmed completion: let the engine fix/finish
                # its own work. Reopening the session keeps its context for
                # free; without one, the previous output has to be re-sent.
                resume_id = _resumable_id(engine, res)
                if resume_id:
                    prompt = _resume_prompt()
                else:
                    session_id = str(uuid.uuid4())
                    prompt = _continuation_prompt(base, res)
            self._save_engine_transcript(task_id, idx, engine, attempts)
            self._log_engine_cost(task_id, idx, engine, attempts)
            rounds = len(attempts)
            if res.timed_out:
                return (False, f"engine timed out (round {rounds})")
            if not res.ok:
                # An error reported inside the envelope often leaves stderr
                # empty, which used to produce a failure message with no cause
                # in it at all.
                why = (res.outcome.api_error if res.outcome
                       and res.outcome.api_error else res.stderr[:200])
                return (False, f"engine failed after {rounds} round(s): {why}")
            # A code step that leaves the project directory empty did no
            # usable work, whatever it printed and whatever it exited with.
            # Two ways to get here, both worth failing on:
            #   - the workspace was empty all along. The usual cause is a task
            #     meant for an existing project that named it in prose instead
            #     of with the @ sigil: nothing resolves, a throwaway workspace
            #     is created, and the engine opens an empty directory.
            #   - the engine emptied a project that had files in it.
            # A project that has files and keeps them never reaches this check,
            # so a code step that legitimately changes nothing still passes.
            if _is_empty(proj):
                return (False,
                        "engine produced no files — the workspace was empty "
                        "before this step and is still empty. If this task was "
                        "meant for an existing project, reference it as @name "
                        "(send /projects for the registered names).")
            if _confirmed_done(res.final_text):
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
