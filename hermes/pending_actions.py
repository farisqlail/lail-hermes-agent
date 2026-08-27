"""Write actions the chat agent proposed and the operator must approve.

A risky MCP tool call (send email, delete file, submit a form) is not executed
in chat; it is parked here as a PendingAction and surfaced to the operator, who
approves or declines it with a button or by voice ("konfirmasi" / "batal"). On
approval the server runs the tool for real; on decline it is dropped. Nothing in
here runs the tool — that stays in web_ui with the hub — so this stays a plain,
testable store.

Single process, but no longer a single conversation: the operator can hold
several chat sessions at once, so every read is scoped by `conv_id`. A dict
guarded by the event loop is still enough, no lock.
"""
from __future__ import annotations
import itertools
import time
from dataclasses import dataclass, field


@dataclass
class PendingAction:
    id: str
    tool: str                       # full "server__tool" name for hub.call
    args: dict
    conv_id: str                    # where to report the outcome back
    # The Telegram chat to push the approve/decline outcome to. None for the
    # web UI, which has no push channel and polls /api/chat/pending instead.
    chat_id: int | None = None
    created: float = field(default_factory=time.time)
    # Purely informational one-sentence risk explanation from
    # main.build_nim_approval_note, or "" when unwired/failed. Never
    # consulted by the gate itself — a human still clicks Confirm/Decline
    # either way; this only helps them decide faster.
    risk_note: str = ""

    def summary(self) -> str:
        """A short human label for the card and the voice prompt. The server and
        verb are the operator's decision-relevant facts; full args show in the
        card body, not here."""
        server, sep, tool = self.tool.partition("__")
        return f"{server}: {tool}" if sep else self.tool


class PendingStore:
    def __init__(self) -> None:
        self._items: dict[str, PendingAction] = {}
        self._counter = itertools.count(1)

    def add(self, tool: str, args: dict, conv_id: str,
            chat_id: int | None = None, risk_note: str = "") -> PendingAction:
        pid = f"p{next(self._counter)}"
        pa = PendingAction(id=pid, tool=tool, args=dict(args or {}),
                           conv_id=conv_id, chat_id=chat_id, risk_note=risk_note)
        self._items[pid] = pa
        return pa


    def list(self, conv_id: str | None = None) -> list[PendingAction]:
        """Oldest first, so voice resolution ('konfirmasi' with no id) acts on the
        action the operator has been looking at longest — FIFO, not a surprise.

        Scoped to one conversation when `conv_id` is given, and it always should
        be from a request path: with several sessions open, an unscoped list puts
        another session's parked write action under this session's confirm button
        — and an id-less voice "konfirmasi" would approve it.
        """
        items = self._items.values()
        if conv_id is not None:
            items = [a for a in items if a.conv_id == conv_id]
        return sorted(items, key=lambda a: a.created)

    def get(self, pid: str) -> PendingAction | None:
        return self._items.get(pid)

    def pop(self, pid: str) -> PendingAction | None:
        return self._items.pop(pid, None)
