"""Write actions the chat agent proposed and the operator must approve.

A risky MCP tool call (send email, delete file, submit a form) is not executed
in chat; it is parked here as a PendingAction and surfaced to the operator, who
approves or declines it with a button or by voice ("konfirmasi" / "batal"). On
approval the server runs the tool for real; on decline it is dropped. Nothing in
here runs the tool — that stays in web_ui with the hub — so this stays a plain,
testable store.

Single web conversation, single process: a dict guarded by the event loop is
enough, no lock.
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
    created: float = field(default_factory=time.time)

    def summary(self) -> str:
        """A short human label for the card and the voice prompt. The server and
        verb are the operator's decision-relevant facts; full args show in the
        card body, not here."""
        server, _, tool = self.tool.partition("__")
        return f"{server}: {tool}" if server else self.tool


class PendingStore:
    def __init__(self) -> None:
        self._items: dict[str, PendingAction] = {}
        self._counter = itertools.count(1)

    def add(self, tool: str, args: dict, conv_id: str) -> PendingAction:
        pid = f"p{next(self._counter)}"
        pa = PendingAction(id=pid, tool=tool, args=dict(args or {}), conv_id=conv_id)
        self._items[pid] = pa
        return pa

    def list(self) -> list[PendingAction]:
        """Oldest first, so voice resolution ('konfirmasi' with no id) acts on the
        action the operator has been looking at longest — FIFO, not a surprise."""
        return sorted(self._items.values(), key=lambda a: a.created)

    def get(self, pid: str) -> PendingAction | None:
        return self._items.get(pid)

    def pop(self, pid: str) -> PendingAction | None:
        return self._items.pop(pid, None)

    def pop_oldest(self) -> PendingAction | None:
        items = self.list()
        return self._items.pop(items[0].id) if items else None
