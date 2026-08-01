"""Bridge between the native tray helper and the browser.

The tray helper (a separate process) owns the always-on wake word; the browser
owns the heavy STT and the conversation. They never talk directly — both go
through the running FastAPI server, which holds a little shared state in memory:

* the browser POSTs its voice state every few seconds — this doubles as a
  heartbeat, so the helper can tell whether a tab is even open;
* the helper POSTs a wake event, which the browser picks up on its next poll and
  turns into a hands-free recording;
* the helper GETs the voice state to colour its tray icon.

The state logic is a plain object so it can be unit-tested; the router is a thin
wrapper. Single event loop, so the reads and writes here need no lock.
"""
from __future__ import annotations
import time
from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel

VoiceStateName = Literal["idle", "listen", "think", "speak"]

# A browser is considered present if it has checked in within this window. It
# posts on every state change and at least this often as a keepalive, so a
# generous multiple of that interval avoids flapping to "offline" between beats.
_ONLINE_WINDOW_MS = 12000


def _now_ms() -> int:
    return int(time.monotonic() * 1000)


class DesktopState:
    """Shared tray/browser state. Time is injected so tests are deterministic."""

    def __init__(self) -> None:
        self.state: VoiceStateName = "idle"
        self._last_seen_ms: Optional[int] = None
        self._wake_pending = False

    def heartbeat(self, state: VoiceStateName, now_ms: int) -> None:
        """Browser check-in: record its state and mark it present."""
        self.state = state
        self._last_seen_ms = now_ms

    def browser_online(self, now_ms: int, window_ms: int = _ONLINE_WINDOW_MS) -> bool:
        if self._last_seen_ms is None:
            return False
        return now_ms - self._last_seen_ms <= window_ms

    def raise_wake(self) -> None:
        """Helper detected the wake word. Latch it for the browser to collect."""
        self._wake_pending = True

    def take_wake(self) -> bool:
        """Browser poll: return whether a wake is pending and clear it. A latch,
        so a wake raised between polls is never missed, and reading it twice does
        not start two recordings."""
        pending = self._wake_pending
        self._wake_pending = False
        return pending


class _StateBody(BaseModel):
    state: VoiceStateName


class _WakeReply(BaseModel):
    wake: bool


class _StateReply(BaseModel):
    state: VoiceStateName
    browser_online: bool


class _WakeAck(BaseModel):
    browser_online: bool


def build_router(desktop: DesktopState) -> APIRouter:
    """A router bound to one DesktopState. Built rather than module-global so a
    test gets a fresh state per app and the instance is explicit."""
    router = APIRouter()

    @router.post("/api/voice/state")
    def post_voice_state(body: _StateBody) -> _StateReply:
        now = _now_ms()
        desktop.heartbeat(body.state, now)
        return _StateReply(state=desktop.state,
                           browser_online=desktop.browser_online(now))

    @router.get("/api/voice/state")
    def get_voice_state() -> _StateReply:
        now = _now_ms()
        return _StateReply(state=desktop.state,
                           browser_online=desktop.browser_online(now))

    @router.post("/api/voice/wake")
    def post_voice_wake() -> _WakeAck:
        now = _now_ms()
        desktop.raise_wake()
        return _WakeAck(browser_online=desktop.browser_online(now))

    @router.get("/api/voice/wake")
    def get_voice_wake() -> _WakeReply:
        return _WakeReply(wake=desktop.take_wake())

    return router
