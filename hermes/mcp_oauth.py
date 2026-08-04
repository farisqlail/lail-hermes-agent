"""The two things OAuth needs that this codebase does not already have.

The MCP SDK's OAuthClientProvider awaits a `(code, state)` tuple inline, but
that tuple arrives minutes later on a completely different HTTP request — the
provider redirected a browser away and something has to catch the return. That
mismatch is what PendingAuth bridges.

FileTokenStorage keeps tokens out of config.yaml on purpose: GET /api/settings
returns the whole settings object to the browser on every page load, so a
refresh token stored there would be shipped to the front-end every time.
"""
from __future__ import annotations
import asyncio
import itertools
from pathlib import Path

from . import paths


def token_dir() -> Path:
    return paths.config_dir() / "mcp_tokens"


def _safe(name: str) -> str:
    # A server name reaches this from a pasted link, so it must not be able to
    # climb out of the token directory.
    return "".join(c for c in name if c.isalnum() or c in "-_") or "server"


class FileTokenStorage:
    """The SDK's TokenStorage protocol, one JSON file per server."""

    def __init__(self, name: str) -> None:
        self.name = _safe(name)

    def _path(self, kind: str) -> Path:
        suffix = "" if kind == "tokens" else "-client"
        return token_dir() / f"{self.name}{suffix}.json"

    async def _read(self, kind: str, model):
        p = self._path(kind)
        if not p.exists():
            return None
        try:
            return model.model_validate_json(p.read_text(encoding="utf-8"))
        except Exception:
            # A corrupt or half-written file must read as "not authorised yet",
            # which re-runs the flow, rather than crashing every connect.
            return None

    async def _write(self, kind: str, obj) -> None:
        token_dir().mkdir(parents=True, exist_ok=True)
        self._path(kind).write_text(obj.model_dump_json(), encoding="utf-8")

    async def get_tokens(self):
        from mcp.shared.auth import OAuthToken
        return await self._read("tokens", OAuthToken)

    async def set_tokens(self, tokens) -> None:
        await self._write("tokens", tokens)

    async def get_client_info(self):
        from mcp.shared.auth import OAuthClientInformationFull
        return await self._read("client", OAuthClientInformationFull)

    async def set_client_info(self, client_info) -> None:
        await self._write("client", client_info)


class PendingAuth:
    """Authorizations waiting for a browser to come back.

    Single process, single event loop, so a dict is enough — the same reasoning
    as PendingStore in pending_actions.py.
    """

    def __init__(self) -> None:
        self._futures: dict[str, asyncio.Future] = {}
        self._states: dict[str, str] = {}
        self._counter = itertools.count(1)

    def start(self) -> str:
        wait_id = f"a{next(self._counter)}"
        self._futures[wait_id] = asyncio.get_event_loop().create_future()
        return wait_id

    def set_state(self, wait_id: str, state: str) -> None:
        self._states[wait_id] = state

    def authorize_url_state(self, wait_id: str) -> str:
        return self._states.get(wait_id, "")

    def resolve(self, state: str, code: str) -> bool:
        """True when `state` matched a run that is currently waiting.

        A mismatch is answered False and changes nothing — this is what stops
        anything else on this machine from injecting an authorization code.
        """
        for wait_id, s in self._states.items():
            if s and s == state:
                fut = self._futures.get(wait_id)
                if fut is not None and not fut.done():
                    fut.set_result((code, state))
                    return True
        return False

    async def wait(self, wait_id: str, timeout_s: float = 300.0):
        fut = self._futures[wait_id]
        try:
            return await asyncio.wait_for(fut, timeout_s)
        finally:
            self.cancel(wait_id)

    def cancel(self, wait_id: str) -> None:
        fut = self._futures.pop(wait_id, None)
        self._states.pop(wait_id, None)
        if fut is not None and not fut.done():
            fut.cancel()
