from __future__ import annotations
import re, secrets, time
from pathlib import Path
from .config import Settings
from .session_store import Store
from .project_resolve import (
    parse_project_ref, resolve_project, ProjectNotFound, ProjectPathMissing)

def is_allowed(user_id: int, settings: Settings) -> bool:
    return user_id in settings.allowed_user_ids

def new_task_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)

# Confirmation gate (design spec §8): tasks that push, delete, or reach outside
# the project dir need explicit approval before running.
_RISKY_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bgit\s+push\b", re.I), "runs `git push`"),
    (re.compile(r"\brm\s+-rf?\b|\bdel\s+/|\b(delete|remove|hapus)\b", re.I),
     "deletes files"),
    (re.compile(r"(?:^|[\s\"'=(])(?:[A-Za-z]:[\\/]|/etc/|~[\\/]|\.\.[\\/])"),
     "touches paths outside the project dir"),
]

def detect_risky(text: str) -> list[str]:
    return [reason for rx, reason in _RISKY_PATTERNS if rx.search(text)]

class Bridge:
    def __init__(self, settings: Settings, store: Store, orchestrator, sender,
                 ask_confirm=None, git_dirty=None):
        self.settings = settings
        self.store = store
        self.orchestrator = orchestrator
        self.sender = sender            # async (chat_id, text)
        self.ask_confirm = ask_confirm  # async (chat_id, task_id, reasons)
        self.git_dirty = git_dirty      # async (path) -> bool | None
        # task_id -> (user, chat, text, proj)
        self.pending: dict[str, tuple[int, int, str, Path | None]] = {}

    def get_settings(self):
        from . import config, paths
        if not (paths.config_dir() / "config.yaml").exists():
            return self.settings
        return config.load_settings()

    async def handle_task(self, user_id: int, chat_id: int, text: str):
        settings = self.get_settings()
        if not is_allowed(user_id, settings):
            await self.sender(chat_id, f"You are not authorized to use this bot. Your Telegram User ID is: {user_id}\n\nPlease add this ID to the allowed user list in the settings UI at http://127.0.0.1:8799")
            return None

        # Resolve before anything else: a bad @name costs zero tokens because
        # the planner never runs, and the gate below needs the project path.
        name, text = parse_project_ref(text)
        proj = None
        if name is not None:
            try:
                proj = resolve_project(name, settings)
            except (ProjectNotFound, ProjectPathMissing) as e:
                await self.sender(chat_id, str(e))
                return None

        task_id = new_task_id()
        self.store.create_task(task_id, chat_id, text)

        reasons = detect_risky(text)
        if proj is not None and self.git_dirty is not None:
            dirty = await self.git_dirty(proj)
            if dirty is None:
                reasons.append(
                    f"@{name} is not a git repo — there is no undo if this goes wrong")
            elif dirty:
                reasons.append(
                    f"@{name} has uncommitted changes that could be lost")

        if reasons and settings.confirm_risky and self.ask_confirm:
            self.store.set_task_status(task_id, "awaiting_confirm")
            self.pending[task_id] = (user_id, chat_id, text, proj)
            await self.ask_confirm(chat_id, task_id, reasons)
            return task_id

        await self.sender(chat_id, f"Task {task_id} queued.")
        await self._run(task_id, chat_id, text, proj)
        return task_id

    async def resolve_confirm(self, user_id: int, task_id: str, approved: bool) -> bool:
        pend = self.pending.pop(task_id, None)
        if pend is None:
            return False
        _, chat_id, text, proj = pend
        if not is_allowed(user_id, self.get_settings()):
            self.pending[task_id] = pend  # keep waiting for an authorized user
            return False
        if not approved:
            self.store.set_task_status(task_id, "cancelled")
            await self.sender(chat_id, f"Task {task_id} cancelled.")
            return True
        await self.sender(chat_id, f"Task {task_id} confirmed, queued.")
        await self._run(task_id, chat_id, text, proj)
        return True

    async def _run(self, task_id: str, chat_id: int, text: str,
                   proj: Path | None = None):
        async def report(tid, msg):
            await self.sender(chat_id, f"[{tid}] {msg}")
        await self.orchestrator.run_task(task_id, chat_id, text, report, proj=proj)
