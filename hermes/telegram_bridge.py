from __future__ import annotations
import secrets, time
from .config import Settings
from .session_store import Store

def is_allowed(user_id: int, settings: Settings) -> bool:
    return user_id in settings.allowed_user_ids

def new_task_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)

class Bridge:
    def __init__(self, settings: Settings, store: Store, orchestrator, sender):
        self.settings = settings
        self.store = store
        self.orchestrator = orchestrator
        self.sender = sender  # async (chat_id, text)

    async def handle_task(self, user_id: int, chat_id: int, text: str):
        if not is_allowed(user_id, self.settings):
            await self.sender(chat_id, "You are not authorized to use this bot.")
            return None
        task_id = new_task_id()
        self.store.create_task(task_id, chat_id, text)
        await self.sender(chat_id, f"Task {task_id} queued.")

        async def report(tid, msg):
            await self.sender(chat_id, f"[{tid}] {msg}")

        await self.orchestrator.run_task(task_id, chat_id, text, report)
        return task_id
