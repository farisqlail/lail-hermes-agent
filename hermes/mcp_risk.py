"""Classify an MCP tool call as read-only or a write/side-effect.

The chat agent runs MCP tools (files, browser, gmail, calendar) inside one turn.
Reads are safe to run straight through; anything that writes a file, sends an
email, creates a calendar event or drives a browser click has an external effect
the operator asked to confirm first. The tool name is all we have to go on — MCP
does not label side effects — so this is a verb heuristic, kept pure and central
so both the chat dispatch and its tests read the same rules.

Unknown verbs are treated as risky on purpose: a tool we cannot recognise is
gated rather than run, so a new integration cannot quietly gain write access.
"""
from __future__ import annotations
import re

# Verbs that mutate state or reach outside the process. Substring-matched against
# the tool-name tokens, so "send_email", "create_event", "browser_click" all hit.
RISKY_VERBS = frozenset({
    "send", "create", "update", "delete", "remove", "write", "move", "rename",
    "put", "post", "insert", "add", "modify", "patch", "upload", "trash",
    "archive", "reply", "forward", "draft", "compose", "fill", "click",
    "submit", "navigate", "type", "press", "drag", "select", "run", "exec",
    "execute", "install", "kill", "set", "edit", "append", "copy", "mkdir",
    "rmdir", "unlink", "sync", "share", "invite", "accept", "decline", "cancel",
    "mark", "label", "star", "download", "save", "clear", "empty",
})

# Exact tool base-names that only READ despite carrying a risky verb, so they run
# straight through. `browser_navigate`/`_back` load a URL (a GET) to read a page
# — the calendar-read flow needs this ungated to be consistent — but the verb
# "navigate" is otherwise risky. Kept as exact names, not a verb, so this never
# widens to a real side-effect tool (click/type/fill stay gated).
SAFE_READ_TOOLS = frozenset({
    "browser_navigate", "browser_navigate_back",
})

# Verbs that only observe. Present so a read tool whose name happens to contain no
# risky verb is recognised as a read rather than falling through to the
# gate-unknown default.
READ_VERBS = frozenset({
    "read", "list", "get", "search", "find", "snapshot", "screenshot", "query",
    "fetch", "describe", "show", "view", "count", "status", "tab", "tabs",
    "history", "info", "detail", "details", "check", "watch", "peek",
})


def _tokens(tool: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", tool.lower()) if t]


def is_mcp_name(name: str) -> bool:
    """True for a "server__tool" name, the shape to_openai_tools mints. The chat
    dispatch uses this to tell an MCP call from a built-in like start_task."""
    return "__" in name


def is_risky_tool(name: str) -> bool:
    """True when the tool should be gated behind operator confirmation.

    `name` may be the full "server__tool" or a bare tool name. Any risky verb
    wins; otherwise a recognised read verb clears it; an unrecognised name is
    gated (returns True) so nothing writes without being understood.
    """
    tool = name.split("__", 1)[1] if "__" in name else name
    toks = _tokens(tool)
    if not toks:
        return True
    if tool in SAFE_READ_TOOLS:
        return False
    if any(t in RISKY_VERBS for t in toks):
        return True
    if any(t in READ_VERBS for t in toks):
        return False
    return True
