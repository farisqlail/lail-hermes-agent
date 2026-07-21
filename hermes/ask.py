"""Outstanding questions to the human operator, and the clock they suspend.

One `asyncio.Future` per question. The MCP handler awaits it, a Telegram tap
resolves it. Nothing here knows about Telegram or HTTP — the transports bind
themselves to `on_ask` / `on_close` at wiring time, which is what lets the
whole ask lifecycle be tested without a bot token or a socket.
"""
from __future__ import annotations
import asyncio, secrets, time
from dataclasses import dataclass, field

DEFAULT_ASK_TIMEOUT_S = 900   # 15 minutes for a human to answer
MAX_ASKS_PER_RUN = 5          # an engine that asks in a loop is a cost bug

# Returned to the engine, never to Telegram, so these stay English: they are
# read by the model, and every other engine-facing string in this codebase
# (the completion contract, the continuation prompt) is English too.
NO_CHANNEL = ("No interactive channel available. Proceed with your best "
              "judgment and state the assumption you made.")
NO_ANSWER = ("User did not answer in time. Proceed with your best assumption "
             "and state it explicitly.")
BUDGET_SPENT = ("Ask budget exhausted for this step. Decide yourself and "
                "state the assumption.")
# The CLI cancels a tools/call after ~60s unless progress notifications keep
# resetting its timer (verified 2026-07-21). A client that sends no
# progressToken cannot be kept waiting long enough to reach a human at all, so
# say so instead of asking a question nobody will see answered.
NO_STREAM = ("This client cannot hold a tool call open long enough to reach "
             "the operator. Proceed with your best judgment and state the "
             "assumption you made.")


def format_choice(labels: list[str]) -> str:
    return "User chose: " + ", ".join(labels)


def format_free_text(text: str) -> str:
    return f"User replied (free text): {text}"


class Deadline:
    """A wall-clock budget that can be suspended while a human is thinking.

    `run_engine` used a fixed `asyncio.wait_for`, which would kill an engine
    blocked on `ask_user` — the step would die of the operator's lunch break.
    Pauses nest: two overlapping asks must both be answered before the clock
    restarts.
    """

    def __init__(self, timeout_s: float, clock=time.monotonic):
        self._clock = clock
        self._left = float(timeout_s)
        self._started = clock()
        self._pauses = 0

    @property
    def paused(self) -> bool:
        return self._pauses > 0

    def pause(self) -> None:
        if self._pauses == 0:
            self._left -= self._clock() - self._started
        self._pauses += 1

    def resume(self) -> None:
        if self._pauses == 0:
            return
        self._pauses -= 1
        if self._pauses == 0:
            self._started = self._clock()

    def expired(self) -> bool:
        if self._pauses:
            return False
        return (self._clock() - self._started) >= self._left


@dataclass
class Ask:
    ask_id: str
    chat_id: int
    task_id: str
    question: str
    options: list[dict]
    multi: bool
    future: asyncio.Future
    selected: set[int] = field(default_factory=set)

    def labels(self, idxs) -> list[str]:
        """Labels for the given option indices, skipping any that this ask
        does not have — a stale keyboard can carry an index from an older
        question, and an IndexError there would escape into the handler."""
        return [str(self.options[i].get("label", i))
                for i in idxs if 0 <= i < len(self.options)]


@dataclass
class Run:
    """One engine invocation's right to ask, and the clock it suspends.

    `deadline` is None for the pre-planning round: the planner is an HTTP call
    inside this process, not a subprocess with a timeout to protect.
    """
    token: str
    task_id: str
    chat_id: int
    deadline: "Deadline | None" = None
    spent: int = 0


class AskRegistry:
    def __init__(self, timeout_s: float = DEFAULT_ASK_TIMEOUT_S, log=None):
        self.timeout_s = timeout_s
        # Sync (task_id, message) -> None, normally Store.append_log. Optional
        # so the registry stays testable without a database.
        self._log = log
        self._runs: dict[str, Run] = {}
        self._asks: dict[str, Ask] = {}
        self._by_chat: dict[int, str] = {}
        # Bound at wiring time. Unbound means no Telegram channel exists, which
        # is a degradation (NO_CHANNEL), never an error.
        self.on_ask = None      # async (Ask) -> None
        self.on_close = None    # async (Ask, state: str) -> None

    def open_run(self, task_id: str, chat_id: int,
                 deadline: "Deadline | None" = None) -> str:
        token = secrets.token_urlsafe(24)
        self._runs[token] = Run(token, task_id, chat_id, deadline)
        return token

    def close_run(self, token: str) -> None:
        self._runs.pop(token, None)

    def run_for_token(self, token: str) -> Run | None:
        return self._runs.get(token) if token else None

    def pending_for_chat(self, chat_id: int) -> str | None:
        return self._by_chat.get(chat_id)

    def get(self, ask_id: str) -> Ask | None:
        return self._asks.get(ask_id)

    def toggle(self, ask_id: str, idx: int) -> Ask | None:
        a = self._asks.get(ask_id)
        if a is None or not (0 <= idx < len(a.options)):
            return None
        a.selected.symmetric_difference_update({idx})
        return a

    async def ask(self, run: Run, question: str, options: list[dict],
                  multi: bool = False) -> str:
        if self.on_ask is None:
            return NO_CHANNEL
        if run.spent >= MAX_ASKS_PER_RUN:
            return BUDGET_SPENT
        run.spent += 1
        a = Ask(secrets.token_hex(4), run.chat_id, run.task_id, question,
                list(options or []), bool(multi),
                asyncio.get_running_loop().create_future())
        self._asks[a.ask_id] = a
        self._by_chat[a.chat_id] = a.ask_id
        self._note(a, f"ask: {question}")
        if run.deadline is not None:
            run.deadline.pause()
        try:
            try:
                await self.on_ask(a)
            except Exception:
                # A send that never landed leaves nothing for the operator to
                # tap. Degrade now rather than block for the full timeout.
                return NO_CHANNEL
            try:
                answer = await asyncio.wait_for(a.future, self.timeout_s)
            except asyncio.TimeoutError:
                self._note(a, "answer: (expired, no answer)")
                await self._closed(a, "expired")
                return NO_ANSWER
            self._note(a, f"answer: {answer}")
            return answer
        finally:
            self._drop(a)
            if run.deadline is not None:
                run.deadline.resume()

    def answer(self, ask_id: str, text: str) -> bool:
        return self._resolve(ask_id, format_free_text(text))

    def answer_options(self, ask_id: str, idxs) -> bool:
        a = self._asks.get(ask_id)
        if a is None:
            return False
        return self._resolve(ask_id, format_choice(a.labels(idxs)))

    def _resolve(self, ask_id: str, result: str) -> bool:
        a = self._asks.get(ask_id)
        if a is None or a.future.done():
            return False
        a.future.set_result(result)
        return True

    def _note(self, a: Ask, message: str) -> None:
        """Record an ask or its answer. Best-effort: a store write is a
        courtesy, and losing it must never lose the answer."""
        if self._log is None:
            return
        try:
            self._log(a.task_id, message)
        except Exception:
            pass

    def _drop(self, a: Ask) -> None:
        self._asks.pop(a.ask_id, None)
        if self._by_chat.get(a.chat_id) == a.ask_id:
            self._by_chat.pop(a.chat_id, None)

    async def _closed(self, a: Ask, state: str) -> None:
        """Tell the UI an ask ended without an answer. Best-effort: editing a
        dead keyboard must not change what the engine is told."""
        if self.on_close is None:
            return
        try:
            await self.on_close(a, state)
        except Exception:
            pass
