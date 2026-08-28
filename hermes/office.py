"""Office mode: the AI-employee roster + real-work-execution + autonomous
simulation layer on top of `office_store.OfficeStore`.

Phase 1: roster CRUD. Phase 2: real execution — an employee assigned a task
either runs a single LLM completion under their persona (no project given),
or runs as a real Hermes task through the *existing*, shared `Orchestrator`
(a project is given), so it gets real steps/logs/artifacts/cost tracking and
shows up in the normal Dashboard/TaskDetail UI, with `work_items` acting as a
thin "who did it" pointer rather than a parallel tracking system. Phase 4
(this addition): `run_meeting` — one real LLM call generating a transcript
between participant personas — and `run_office_loop`, a background tick that
manages energy/burnout state transitions unconditionally (a pure state
machine, no LLM cost) and triggers periodic team meetings only when the
operator has opted in (`Settings.office_meetings_enabled`, off by default).
"""
from __future__ import annotations
import asyncio
import random
import time
from pathlib import Path
from uuid import uuid4

from openai import AsyncOpenAI

from . import config, paths, voice
from .chat_engine import DOCUMENT_MARKER, IMAGE_MARKER, RESUME_NUDGE
from .office_store import OfficeStore
from .project_resolve import resolve_project

# Energy is 0-100. BURNOUT_THRESHOLD is when a working employee is forced onto
# a break; RECOVERY_THRESHOLD is when a resting employee is considered fit to
# work again. The gap between them (not a single threshold) is what stops an
# employee flapping working/on_break every tick right at the boundary.
BURNOUT_THRESHOLD = 20.0
RECOVERY_THRESHOLD = 80.0
ENERGY_DECAY_PER_TICK = 4.0
ENERGY_RECOVER_PER_TICK = 10.0
OFFICE_TICK_S = 10

# How much conversation an employee "remembers" — same idea as the main web
# chat's history window, just a separate (smaller) constant: an employee chat
# is one persona having many short exchanges, not the primary assistant.
OFFICE_CHAT_HISTORY_LIMIT = 24


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


# One AsyncOpenAI client per (endpoint, key, timeout), same reasoning as
# main.py's `_client`: a fresh client per completion pays a new TLS handshake
# for no reason. A separate cache from main.py's — Office has its own module
# boundary and no need to share the dict, just the pattern.
_CLIENT_CACHE: dict[tuple[str, str, int], AsyncOpenAI] = {}


def _client(base_url: str, api_key: str, timeout: int = 120) -> AsyncOpenAI:
    key = (base_url or "", api_key or "", timeout)
    c = _CLIENT_CACHE.get(key)
    if c is None:
        c = AsyncOpenAI(base_url=base_url, api_key=api_key, timeout=timeout)
        _CLIENT_CACHE[key] = c
    return c


def build_persona_system_prompt(employee: dict, settings) -> str:
    """The employee's persona as a system prompt: who they are, how they work,
    and the bodies of whatever skills they've been given — inlined directly
    rather than exposed as callable tools, since a single completion call has
    no tool loop to offer them through."""
    lines = [
        f"You are {employee.get('name') or 'an employee'}, working as "
        f"{employee.get('role') or 'a team member'} at an AI-staffed office.",
    ]
    personality = (employee.get("personality") or "").strip()
    if personality:
        lines.append(f"Personality / working style: {personality}")

    skill_ids = set(employee.get("skill_ids") or [])
    if skill_ids:
        from . import skills as skills_mod
        base = paths.skills_dir()
        wanted = [s for s in settings.skills if s.id in skill_ids and s.enabled]
        for sk in wanted:
            body = skills_mod.read_skill_file(base, sk.id)
            if body and body.get("content"):
                lines.append(f"\n--- Skill: {sk.name or sk.id} ---\n{body['content']}")

    lines.append(
        "\nRespond directly with the finished work product for whatever task "
        "you're given — no meta-commentary about being an AI."
    )
    return "\n".join(lines)


async def run_employee_completion(employee: dict, prompt: str, secrets, settings) -> str:
    """One completion call under an employee's persona. No tool loop — for
    project-bound coding work, `OfficeManager` routes through the real
    Orchestrator instead (see `_run_code_work_item`)."""
    model = employee.get("model") or settings.chat_model or settings.model
    client = _client(settings.nvidia_base_url, secrets.nvidia_api_key)
    system = build_persona_system_prompt(employee, settings)
    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        temperature=0.4,
    )
    return (resp.choices[0].message.content or "").strip()


class OfficeManager:

    def __init__(self, office_store: OfficeStore, main_store=None, orchestrator=None,
                secrets_loader=None, settings_loader=None, chat_engine=None, chat=None):
        self.store = office_store
        # main_store/orchestrator are None in a Phase-1-only wiring (tests,
        # older callers) — assign_task/assign_team_task need them and raise a
        # clear error rather than an AttributeError deep in a background task.
        self.main_store = main_store
        self.orchestrator = orchestrator
        self.secrets_loader = secrets_loader or config.load_secrets
        self.settings_loader = settings_loader or config.load_settings
        # chat_engine/chat give a project-less (casual) employee chat the same
        # tool-equipped brain the main agent uses (ChatEngine.run_turn + the
        # NIM tool-calling `chat` callable), instead of the old bare
        # completion. Both start None and are filled in by main.py once built
        # (same "constructed later, assigned once ready" pattern `bridge`
        # already uses on ChatEngine itself) — a caller that never wires them
        # (tests, a Phase-1-only setup) gets a clear RuntimeError instead of
        # an AttributeError deep in a request.
        self.chat_engine = chat_engine
        self.chat = chat
        # One lock per project directory: two employees assigned code work in
        # the same repo run one after another, not concurrently git-conflicting
        # each other. Keyed by resolved path, built lazily.
        self._project_locks: dict[str, asyncio.Lock] = {}

    # --- employees ---

    def create_employee(self, name: str, role: str = "", avatar: str = "",
                        personality: str = "", model: str = "", engine: str = "",
                        skill_ids: list[str] | None = None, team_id: str | None = None) -> dict:
        return self.store.create_employee(
            _new_id("emp"), name=name, role=role, avatar=avatar, personality=personality,
            model=model, engine=engine, skill_ids=skill_ids, team_id=team_id)

    def update_employee(self, employee_id: str, **fields) -> dict | None:
        return self.store.update_employee(employee_id, **fields)

    def delete_employee(self, employee_id: str) -> bool:
        return self.store.delete_employee(employee_id)

    def get_employee(self, employee_id: str) -> dict | None:
        return self.store.get_employee(employee_id)

    def list_employees(self, team_id: str | None = None) -> list[dict]:
        return self.store.list_employees(team_id=team_id)

    # --- teams ---

    def create_team(self, name: str, description: str = "") -> dict:
        return self.store.create_team(_new_id("team"), name=name, description=description)

    def update_team(self, team_id: str, **fields) -> dict | None:
        return self.store.update_team(team_id, **fields)

    def delete_team(self, team_id: str) -> bool:
        return self.store.delete_team(team_id)

    def list_teams(self) -> list[dict]:
        return self.store.list_teams()

    # --- work items ---

    def list_work_items(self, employee_id: str | None = None, team_id: str | None = None,
                        limit: int = 50) -> list[dict]:
        return self.store.list_work_items(employee_id=employee_id, team_id=team_id, limit=limit)

    def _project_lock(self, proj_path: Path) -> asyncio.Lock:
        key = str(proj_path)
        lock = self._project_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._project_locks[key] = lock
        return lock

    def _rest_status(self, employee_id: str) -> str:
        """Where an employee lands after finishing work: back to idle, or
        straight to on_break if the office tick has already run them low on
        energy — so the game state agrees with the energy bar the moment
        work ends, not one tick later."""
        row = self.store.get_employee(employee_id)
        energy = (row or {}).get("energy", 100.0)
        return "on_break" if energy <= BURNOUT_THRESHOLD else "idle"

    async def _run_chat_work_item(self, work_id: str, employee: dict, prompt: str) -> None:
        settings = self.settings_loader()
        secrets = self.secrets_loader()
        self.store.update_work_item(work_id, status="running")
        self.store.update_employee(employee["employee_id"], status="working")
        try:
            text = await run_employee_completion(employee, prompt, secrets, settings)
            self.store.update_work_item(work_id, output_text=text, status="done")
        except Exception as e:
            self.store.update_work_item(work_id, output_text=f"error: {e}", status="failed")
        finally:
            self.store.update_employee(employee["employee_id"], status=self._rest_status(employee["employee_id"]))

    async def _run_code_work_item(self, work_id: str, employee: dict, prompt: str,
                                  proj_path: Path) -> None:
        from .telegram_bridge import new_task_id
        task_id = new_task_id()
        self.store.update_work_item(work_id, task_id=task_id, status="running")
        self.store.update_employee(employee["employee_id"], status="working")
        # chat_id=0: a real, visible task — same sentinel a normal web-submitted
        # task gets (web_ui.py's `/task` branch), so it shows up in the regular
        # Dashboard/TaskDetail like any other task. `work_items.employee_id` is
        # what marks it as Office-originated, not a new chat_id sentinel.
        self.main_store.create_task(task_id, chat_id=0, text=prompt, session_id=None)

        async def report(tid, msg, html=False):
            # No chat channel to notify — step-by-step progress already lands
            # in store.logs via Orchestrator itself, which TaskDetail reads.
            pass

        settings = self.settings_loader()
        model = employee.get("model") or ""
        if model:
            settings = settings.model_copy(update={"claude_model": model, "agy_model": model})
        engine = employee.get("engine") or None
        if engine:
            settings = settings.model_copy(update={"default_engine": engine})

        try:
            async with self._project_lock(proj_path):
                await self.orchestrator.run_task(
                    task_id, chat_id=0, text=prompt, report=report,
                    proj=proj_path, send_file=None, engine=engine,
                    settings_override=settings)
            task = self.main_store.get_task(task_id)
            ok = bool(task) and task.get("status") == "done"
            self.store.update_work_item(work_id, status="done" if ok else "failed")
        except Exception as e:
            self.store.update_work_item(work_id, status="failed", output_text=f"error: {e}")
        finally:
            self.store.update_employee(employee["employee_id"], status=self._rest_status(employee["employee_id"]))

    def assign_task(self, employee_id: str, prompt: str, project: str | None = None) -> dict:
        if self.main_store is None or self.orchestrator is None:
            raise RuntimeError("Office task execution is not configured")
        employee = self.store.get_employee(employee_id)
        if employee is None:
            raise ValueError("employee not found")
        prompt = (prompt or "").strip()
        if not prompt:
            raise ValueError("prompt is required")

        if project:
            settings = self.settings_loader()
            proj_path = resolve_project(project, settings)  # raises ProjectNotFound/ProjectPathMissing
            work = self.store.create_work_item(
                _new_id("work"), employee_id, kind="code_task", prompt=prompt,
                team_id=employee.get("team_id"))
            asyncio.create_task(self._run_code_work_item(work["work_id"], employee, prompt, proj_path))
        else:
            work = self.store.create_work_item(
                _new_id("work"), employee_id, kind="chat_output", prompt=prompt,
                team_id=employee.get("team_id"))
            asyncio.create_task(self._run_chat_work_item(work["work_id"], employee, prompt))
        return work

    def assign_team_task(self, team_id: str, prompt: str, project: str | None = None) -> dict:
        """Picks one member to execute the whole prompt — decomposing a task
        across members is a later idea, not this phase's scope."""
        members = self.store.list_employees(team_id=team_id)
        if not members:
            raise ValueError("team has no members")
        open_counts = {}
        for m in members:
            items = self.store.list_work_items(employee_id=m["employee_id"], limit=50)
            open_counts[m["employee_id"]] = sum(1 for w in items if w["status"] in ("queued", "running"))
        chosen = min(members, key=lambda m: open_counts[m["employee_id"]])
        return self.assign_task(chosen["employee_id"], prompt, project=project)

    # --- sessions (chat threads bound to one employee) ---
    # A work_item is a deliberate "do this task" with a tracked outcome
    # (shown in the Recent Work feed); a session is an ongoing conversation
    # thread, the same role the main web assistant chat plays for the
    # operator — reusing the exact same `messages` table/conv_id mechanism,
    # just keyed by session_id instead of "web". A session with no `project`
    # is a casual persona chat (one completion call per message, full thread
    # fed back as context — that's the "memory"). A session WITH a project
    # makes every message in it a real, continuing task through the same
    # Orchestrator `assign_task` already uses: the "continuous work" the
    # operator asked for is just "same session, same project, next message".

    def create_session(self, employee_id: str, title: str = "", project: str | None = None,
                       model: str = "", engine: str = "") -> dict:
        employee = self.store.get_employee(employee_id)
        if employee is None:
            raise ValueError("employee not found")
        if not title:
            title = f"Chat with {employee['name']}"
        return self.store.create_session(_new_id("osess"), employee_id, title=title,
                                         project=project, model=model, engine=engine)

    def list_sessions(self, employee_id: str | None = None) -> list[dict]:
        return self.store.list_sessions(employee_id=employee_id)

    def get_session(self, session_id: str) -> dict | None:
        return self.store.get_session(session_id)

    def update_session(self, session_id: str, **fields) -> dict | None:
        return self.store.update_session(session_id, **fields)

    def delete_session(self, session_id: str) -> bool:
        return self.store.delete_session(session_id)

    def get_session_messages(self, session_id: str, limit: int = OFFICE_CHAT_HISTORY_LIMIT) -> list[dict]:
        if self.main_store is None:
            raise RuntimeError("Office chat is not configured")
        return self.main_store.get_messages(session_id, limit=limit)

    def _task_outcome_line(self, task_id: str) -> str:
        """The task's own verdict — same extraction `session_store._archive_task`
        uses for its archive note: the last non-empty log line, first physical
        line only (a done task's change-summary table under it is noise here)."""
        for line in reversed(self.main_store.get_logs(task_id)):
            if line and line.strip():
                return line.strip().splitlines()[0].strip()[:300]
        return "no output"

    async def _run_session_task(self, session_id: str, work_id: str, employee: dict, prompt: str,
                                proj_path: Path, model: str, engine: str) -> None:
        from .telegram_bridge import new_task_id
        task_id = new_task_id()
        self.store.update_work_item(work_id, task_id=task_id, status="running")
        self.store.update_employee(employee["employee_id"], status="working")
        self.main_store.create_task(task_id, chat_id=0, text=prompt, session_id=None)

        async def report(tid, msg, html=False):
            pass

        settings = self.settings_loader()
        if model:
            settings = settings.model_copy(update={"claude_model": model, "agy_model": model})
        if engine:
            settings = settings.model_copy(update={"default_engine": engine})

        try:
            async with self._project_lock(proj_path):
                await self.orchestrator.run_task(
                    task_id, chat_id=0, text=prompt, report=report,
                    proj=proj_path, send_file=None, engine=engine or None,
                    settings_override=settings)
            task = self.main_store.get_task(task_id)
            ok = bool(task) and task.get("status") == "done"
            self.store.update_work_item(work_id, status="done" if ok else "failed")
            outcome = self._task_outcome_line(task_id)
            self.main_store.add_message(session_id, "assistant",
                                        f"{'Done' if ok else 'Failed'} — {outcome}")
        except Exception as e:
            self.store.update_work_item(work_id, status="failed", output_text=f"error: {e}")
            self.main_store.add_message(session_id, "assistant", f"Failed — {e}")
        finally:
            self.store.update_employee(employee["employee_id"], status=self._rest_status(employee["employee_id"]))
            self.store.touch_session(session_id)

    async def send_session_message(self, session_id: str, text: str) -> dict:
        if self.main_store is None or self.orchestrator is None:
            raise RuntimeError("Office chat is not configured")
        session = self.store.get_session(session_id)
        if session is None:
            raise ValueError("session not found")
        employee = self.store.get_employee(session["employee_id"])
        if employee is None:
            raise ValueError("employee not found")
        text = (text or "").strip()
        if not text:
            raise ValueError("message is required")

        project = session.get("project")
        if project:
            self.main_store.add_message(session_id, "user", text)
            self.store.touch_session(session_id)
            settings = self.settings_loader()
            proj_path = resolve_project(project, settings)  # ProjectNotFound/ProjectPathMissing propagate
            work = self.store.create_work_item(
                _new_id("work"), employee["employee_id"], kind="code_task", prompt=text,
                team_id=employee.get("team_id"), session_id=session_id)
            model = session.get("model") or employee.get("model") or ""
            engine = session.get("engine") or employee.get("engine") or ""
            asyncio.create_task(self._run_session_task(
                session_id, work["work_id"], employee, text, proj_path, model, engine))
            return {"kind": "task", "work_id": work["work_id"]}

        # Casual (project-less) chat: the same tool-equipped brain the main
        # agent uses (ChatEngine.run_turn — MCP tools, write-action
        # confirmation gating, @project auto-task routing), just under the
        # employee's persona instead of the main agent's identity. run_turn
        # records both the user and assistant messages itself, so we don't
        # duplicate that here the way the project branch above does.
        if self.chat_engine is None or self.chat is None:
            raise RuntimeError("Office chat engine is not configured")
        system = self._persona_system_prompt(session, employee)
        self.store.touch_session(session_id)
        # Sit the 3D avatar at its desk for the turn's duration — same status
        # flip _run_session_task uses for a real background task, just spanning
        # this one (synchronous) completion instead of an asyncio.create_task.
        self.store.update_employee(employee["employee_id"], status="working")
        try:
            result = await self.chat_engine.run_turn(
                session_id, text, chat=self.chat, chat_id=0, user_id=0,
                system_prompt=system)
        finally:
            self.store.update_employee(
                employee["employee_id"], status=self._rest_status(employee["employee_id"]))
        return {"kind": "chat", "reply": result["reply"]}

    def _persona_system_prompt(self, session: dict, employee: dict) -> str:
        settings = self.settings_loader()
        employee_for_call = dict(employee)
        if session.get("model"):
            employee_for_call["model"] = session["model"]
        return build_persona_system_prompt(employee_for_call, settings)

    async def resume_session_message(self, session_id: str) -> dict:
        """The turn after an approved write action ran mid-casual-chat (see
        send_session_message) — no new operator message, the persona just
        picks its plan back up. Mirrors ChatEngine.run_resume_turn's own
        caller in web_ui.py's /api/chat/stream resume branch."""
        if self.chat_engine is None or self.chat is None:
            raise RuntimeError("Office chat engine is not configured")
        session = self.store.get_session(session_id)
        if session is None:
            raise ValueError("session not found")
        employee = self.store.get_employee(session["employee_id"])
        if employee is None:
            raise ValueError("employee not found")
        self.store.update_employee(employee["employee_id"], status="working")
        try:
            result = await self.chat_engine.run_resume_turn(
                session_id, self.chat, chat_id=0, user_id=0)
        finally:
            self.store.update_employee(
                employee["employee_id"], status=self._rest_status(employee["employee_id"]))
        self.store.touch_session(session_id)
        return {"kind": "chat", "reply": result["reply"]}

    async def stream_session_message(self, session_id: str, text: str,
                                     images: list[Path] | None = None,
                                     documents: list[Path] | None = None,
                                     resume: bool = False):
        """Token-streaming twin of send_session_message's casual-chat branch —
        same persona, tools, and gating, just yielding as the model emits
        instead of waiting for the full reply. Input-bar parity with the main
        chat pane's /api/chat/stream needs this: a typed-out reply reads as
        "the same brain", a reply that pops in all at once does not, even
        when the underlying answer is identical.

        Only for casual (project-less) sessions — a project-bound session's
        "reply" is a background task's outcome (see _run_session_task), which
        has nothing to stream token-by-token.

        Yields ("token", str) | ("usage", dict) | ("done", None), mirroring
        ChatEngine's own stream shape so the SSE route can forward it as-is.
        """
        if self.chat_engine is None or self.chat is None or not hasattr(self.chat, "stream"):
            raise RuntimeError("Office chat engine is not configured")
        session = self.store.get_session(session_id)
        if session is None:
            raise ValueError("session not found")
        employee = self.store.get_employee(session["employee_id"])
        if employee is None:
            raise ValueError("employee not found")
        text = (text or "").strip()
        if not resume and not text:
            raise ValueError("message is required")

        engine = self.chat_engine
        system = self._persona_system_prompt(session, employee)
        dispatch = engine.make_dispatch(session_id, images, chat_id=0, user_id=0)
        if resume:
            history = [*engine.history_with_context(session_id, system_override=system),
                      {"role": "user", "content": RESUME_NUDGE}]
            auto_id = None
        else:
            self.main_store.add_message(session_id, "user", text
                                        + (IMAGE_MARKER if images else "")
                                        + (DOCUMENT_MARKER if documents else ""))
            history, auto_id = await engine.history_for_turn(
                session_id, text, images, dispatch, documents, system_override=system)

        # Sit the 3D avatar at its desk for the stream's duration. `finally`
        # on a generator fires on normal exhaustion, an error, AND the
        # StreamingResponse closing early on client disconnect (GeneratorExit)
        # — the avatar never gets stuck "working" from an abandoned stream.
        self.store.update_employee(employee["employee_id"], status="working")
        try:
            acc = ""
            async for kind, payload in self.chat.stream(
                    history, tools=await engine.chat_tools(text), dispatch=dispatch):
                if kind == "token":
                    acc += payload
                    yield ("token", payload)
                elif kind == "usage":
                    yield ("usage", payload)
            clean, _ = voice.strip_voice_tag(acc)
            suffix = engine.task_card_suffix(clean, auto_id)
            if suffix:
                yield ("token", suffix)
                clean += suffix
            self.main_store.add_message(session_id, "assistant", clean)
            self.store.touch_session(session_id)
            yield ("done", None)
        finally:
            self.store.update_employee(
                employee["employee_id"], status=self._rest_status(employee["employee_id"]))

    # --- meetings ---

    def list_meetings(self, team_id: str | None = None, limit: int = 50) -> list[dict]:
        return self.store.list_meetings(team_id=team_id, limit=limit)

    async def run_meeting(self, team_id: str, participant_ids: list[str], topic: str,
                          triggered_by: str = "manual") -> dict:
        """One real LLM call: a short transcript of the given personas discussing
        `topic`. Not a multi-turn agent loop — bounded cost, simple to reason
        about, and enough to make a meeting a real, readable work output rather
        than a status-bubble animation."""
        employees = [e for e in (self.store.get_employee(eid) for eid in participant_ids) if e]
        if not employees:
            raise ValueError("a meeting needs at least one valid participant")

        settings = self.settings_loader()
        secrets = self.secrets_loader()
        for e in employees:
            self.store.update_employee(e["employee_id"], status="in_meeting")

        try:
            roster = "\n".join(
                f"- {e['name']} ({e['role'] or 'team member'})"
                + (f": {e['personality']}" if e.get("personality") else "")
                for e in employees)
            system = (
                "You are simulating a short, realistic workplace meeting. Write 6-10 lines "
                "of dialogue between the participants below, one line per turn, each prefixed "
                "with the speaker's name (e.g. 'Sarah: ...'). Stay concrete and specific to the "
                "topic — no filler pleasantries, no meta-commentary about being an AI.\n\n"
                f"Participants:\n{roster}\n\nTopic: {topic}"
            )
            model = employees[0].get("model") or settings.chat_model or settings.model
            client = _client(settings.nvidia_base_url, secrets.nvidia_api_key)
            resp = await client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": system},
                         {"role": "user", "content": "Begin the meeting."}],
                temperature=0.6,
            )
            transcript = (resp.choices[0].message.content or "").strip()
        finally:
            for e in employees:
                self.store.update_employee(
                    e["employee_id"], status=self._rest_status(e["employee_id"]))

        meeting = self.store.create_meeting(
            _new_id("meeting"), team_id, participant_ids, topic, transcript,
            triggered_by=triggered_by)
        work = self.store.create_work_item(
            _new_id("work"), participant_ids[0], kind="meeting_transcript", prompt=topic,
            team_id=team_id, status="done")
        self.store.update_work_item(work["work_id"], output_text=transcript, status="done")
        return meeting

    async def _maybe_trigger_meeting(self, team: dict, settings) -> None:
        """One team's meeting-trigger check for a single tick. Best-effort: an
        LLM hiccup here must not take down the whole tick loop."""
        cooldown_s = max(60, getattr(settings, "office_meeting_cooldown_s", 1800))
        daily_cap = max(0, getattr(settings, "office_max_auto_meetings_per_day", 5))
        if daily_cap <= 0:
            return

        recent = self.store.list_meetings(team_id=team["team_id"], limit=daily_cap + 1)
        now = time.time()
        if recent and (now - recent[0]["created"]) < cooldown_s:
            return  # still on cooldown since the last meeting (any trigger)
        today_count = sum(1 for m in recent if (now - m["created"]) < 86400)
        if today_count >= daily_cap:
            return

        members = self.store.list_employees(team_id=team["team_id"])
        idle = [m for m in members if m["status"] == "idle"]
        if len(idle) < 2:
            return  # a meeting needs at least two people actually free to attend
        participants = random.sample(idle, k=min(len(idle), random.randint(2, 4)))
        try:
            await self.run_meeting(
                team["team_id"], [p["employee_id"] for p in participants],
                topic=f"Quick sync for {team['name']} — status and blockers",
                triggered_by="periodic")
        except Exception:
            pass

    async def tick(self, settings) -> None:
        """One pass over every active employee: energy decays while working,
        recovers on a break, and flips status at the burnout/recovery
        thresholds. Recovery doesn't stop dead at RECOVERY_THRESHOLD — that's
        only the bar the employee to go back to work; energy keeps trickling
        up to 100 while idle too, so the bar can actually read full instead
        of permanently capping around 80-90. Every changed employee is
        written individually (each needs its own SET clause/values) but with
        publish=False — one batched `office_employee_updated` event covers
        the whole pass instead of one SSE message per employee, so a roster
        with many employees working at once doesn't burst the event queue
        every tick. Meetings are checked per-team afterward, gated on
        `settings.office_meetings_enabled`."""
        changed_ids: list[str] = []
        for emp in self.store.list_employees():
            if emp["status"] == "working":
                energy = max(0.0, emp["energy"] - ENERGY_DECAY_PER_TICK)
                updates = {"energy": energy}
                if energy <= BURNOUT_THRESHOLD:
                    updates["status"] = "on_break"
                self.store.update_employee(emp["employee_id"], publish=False, **updates)
                changed_ids.append(emp["employee_id"])
            elif emp["status"] == "on_break":
                energy = min(100.0, emp["energy"] + ENERGY_RECOVER_PER_TICK)
                updates = {"energy": energy}
                if energy >= RECOVERY_THRESHOLD:
                    updates["status"] = "idle"
                self.store.update_employee(emp["employee_id"], publish=False, **updates)
                changed_ids.append(emp["employee_id"])
            elif emp["status"] == "idle" and emp["energy"] < 100.0:
                energy = min(100.0, emp["energy"] + ENERGY_RECOVER_PER_TICK)
                self.store.update_employee(emp["employee_id"], publish=False, energy=energy)
                changed_ids.append(emp["employee_id"])

        if changed_ids:
            self.store.publish({"type": "office_employee_updated", "employee_ids": changed_ids})

        if getattr(settings, "office_meetings_enabled", False):
            for team in self.store.list_teams():
                await self._maybe_trigger_meeting(team, settings)


async def run_office_loop(office: "OfficeManager", settings_loader=None,
                          sleep=asyncio.sleep, max_ticks: int | None = None) -> None:
    """The forever loop, started once from main.py as a fire-and-forget task —
    same shape as `proactive.run_loop`: settings re-read every tick (so an
    operator toggling `office_meetings_enabled` takes effect within one tick,
    no restart), and the whole tick wrapped so one bad tick sleeps and retries
    rather than killing the only simulation thread in the process.

    `max_ticks` bounds the loop for tests; None runs forever.
    """
    settings_loader = settings_loader or config.load_settings
    ticks = 0
    while max_ticks is None or ticks < max_ticks:
        ticks += 1
        try:
            settings = settings_loader()
            await office.tick(settings)
        except Exception as e:
            print(f"[office] tick crashed: {e!r}")
        await sleep(OFFICE_TICK_S)
