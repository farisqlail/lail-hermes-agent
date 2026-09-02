"""Distill an engine's `--output-format stream-json` into trace events.

Where `engine_result` reads the single envelope that ends a run, this reads the
JSONL that leads up to it: the model's reasoning, every tool call and its
result, and the per-turn token usage. That stream is what the task timeline
renders — the difference between "step 2 finished" and showing the operator
what the agent actually did.

Both CLIs emit line-delimited JSON and nothing else in common, so there is one
distiller each and a `DISTILLERS` map to pick between them — the same shape
`engine_runner.PARSERS` uses for the closing envelope. `claude` keys on `type`
with Anthropic content blocks; `agy` keys on `event` with a flat `step_update`
carrying a state machine (ACTIVE then DONE/ERROR). They meet at `TraceEvent`,
which is what the UI actually renders.

Pure functions, no I/O, mirroring `engine_result` for the same reason: these
shapes belong to the CLIs, so the awkward ones (a truncated line, an unknown
block type, a `usage` field holding a string) are cheap to pin down in tests. A
line that cannot be understood yields no events and never raises — a malformed
trace must not be able to take down a step whose real work succeeded.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

# Per-field storage cap. Every one of these is headed for a SQLite row and a
# browser, and a single `Read` of a large file would otherwise land whole.
# Distilling means keeping what gets rendered, not the raw stream.
MAX_TEXT = 4096

# Tools whose call means a file changed on disk. `Read`/`Grep` also carry a
# `file_path`, so matching on the field alone would report files the agent only
# looked at as files it edited.
_EDIT_TOOLS = frozenset({"Edit", "Write", "MultiEdit", "NotebookEdit"})
_PATH_FIELDS = ("file_path", "notebook_path")


@dataclass(frozen=True)
class TraceEvent:
    """One renderable moment in a run.

    `kind` is the discriminator the UI switches on; the remaining fields are
    populated per kind and left at their defaults otherwise, which keeps this
    flat enough to map onto one SQLite table without a JSON blob column.
    """
    kind: str
    text: str = ""
    tool_name: str = ""
    tool_use_id: str = ""
    tool_input: str = ""
    file_path: str = ""
    ok: bool | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_usd: float | None = None


def _truncate(text: str) -> str:
    if len(text) <= MAX_TEXT:
        return text
    return text[:MAX_TEXT - 1] + "…"


def _as_object(line: str) -> dict | None:
    line = line.strip()
    if not line:
        return None
    try:
        data = json.loads(line)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _opt(value, kind):
    # bool is an int subclass; a stray `true` must not read as a token count.
    if isinstance(value, bool):
        return None
    return value if isinstance(value, kind) else None


def _blocks(data: dict) -> list:
    message = data.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    return content if isinstance(content, list) else []


def _total_input_tokens(usage: dict) -> int | None:
    """Everything that was fed to the model this turn.

    Cache reads and cache writes are billed differently but are still context
    the turn consumed, so the operator-facing "tokens in" sums all three. A
    breakdown would need three more columns and has no reader yet.
    """
    parts = [_opt(usage.get(k), int) for k in
             ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")]
    present = [p for p in parts if p is not None]
    return sum(present) if present else None


def _usage(data: dict) -> tuple[int | None, int | None]:
    usage = data.get("usage")
    if not isinstance(usage, dict):
        return None, None
    return _total_input_tokens(usage), _opt(usage.get("output_tokens"), int)


def _edited_path(name: str, args: dict) -> str:
    if name not in _EDIT_TOOLS:
        return ""
    for field in _PATH_FIELDS:
        value = args.get(field)
        if isinstance(value, str) and value:
            return value
    return ""


def _tool_result_text(content) -> str:
    """A tool result's content is either a string or a list of blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [b.get("text", "") for b in content
                 if isinstance(b, dict) and isinstance(b.get("text"), str)]
        return "\n".join(p for p in parts if p)
    return ""


def _from_assistant(data: dict) -> list[TraceEvent]:
    events: list[TraceEvent] = []
    for block in _blocks(data):
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        if kind == "thinking":
            events.append(TraceEvent("thinking", text=_truncate(str(block.get("thinking", "")))))
        elif kind == "text":
            events.append(TraceEvent("text", text=_truncate(str(block.get("text", "")))))
        elif kind == "tool_use":
            args = block.get("input")
            args = args if isinstance(args, dict) else {}
            name = str(block.get("name", ""))
            events.append(TraceEvent(
                "tool_use",
                tool_name=name,
                tool_use_id=str(block.get("id", "")),
                tool_input=_truncate(json.dumps(args, ensure_ascii=False)),
                # Read off `args` before truncation: the path is what the
                # edited-files list reads, and a big `content` argument would
                # otherwise push it out of the stored JSON.
                file_path=_edited_path(name, args),
            ))
    if not events:
        return []
    message = data.get("message")
    tokens_in, tokens_out = _usage(message if isinstance(message, dict) else {})
    if tokens_in is None and tokens_out is None:
        return events
    # Once per turn, not once per block: the timeline sums these, and repeating
    # a turn's usage across its blocks would inflate the total.
    head = events[0]
    events[0] = TraceEvent(
        head.kind, text=head.text, tool_name=head.tool_name,
        tool_use_id=head.tool_use_id, tool_input=head.tool_input,
        file_path=head.file_path, ok=head.ok,
        tokens_in=tokens_in, tokens_out=tokens_out)
    return events


def _from_user(data: dict) -> list[TraceEvent]:
    """Tool results arrive as user turns; a real user prompt is not one."""
    events = []
    for block in _blocks(data):
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue
        events.append(TraceEvent(
            "tool_result",
            tool_use_id=str(block.get("tool_use_id", "")),
            ok=not bool(block.get("is_error")),
            text=_truncate(_tool_result_text(block.get("content"))),
        ))
    return events


def _from_result(data: dict) -> list[TraceEvent]:
    tokens_in, tokens_out = _usage(data)
    result = data.get("result")
    return [TraceEvent(
        "result",
        text=_truncate(result if isinstance(result, str) else ""),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=_opt(data.get("total_cost_usd"), (int, float)),
    )]


def distill_claude_line(line: str) -> list[TraceEvent]:
    """Zero or more trace events from one line of claude's stream-json.

    Zero is the normal answer for plenty of lines — a system warning, a user
    turn that is a prompt rather than a tool result, a block type this version
    does not render. One `assistant` line can carry several events, which is
    why this returns a list rather than an optional.
    """
    data = _as_object(line)
    if data is None:
        return []
    kind = data.get("type")
    if kind == "system":
        if data.get("subtype") != "init":
            return []
        return [TraceEvent("init", text=str(data.get("model", "")))]
    if kind == "assistant":
        return _from_assistant(data)
    if kind == "user":
        return _from_user(data)
    if kind == "result":
        return _from_result(data)
    return []


# --- antigravity (`agy --output-format stream-json`) -------------------------

# agy's tool names for the calls that change a file. Its parameters are
# PascalCase and undocumented, so the path is found by key shape rather than a
# fixed field name — see _agy_edited_path.
_AGY_EDIT_TOOLS = frozenset({
    "write_to_file", "replace_file_content", "multi_replace_file_content",
    "notebook_edit", "sed_file",
})


def _agy_usage(body: dict) -> tuple[int | None, int | None]:
    """agy reports `cache_read_tokens` outside `input_tokens` (its own
    `total_tokens` excludes them). Summed here anyway, to mean the same thing
    the claude side means: everything the turn consumed.

    `thinking_tokens` is deliberately not added — agy counts it inside
    `output_tokens`, so adding it would bill the same tokens twice.
    """
    usage = body.get("usage")
    if not isinstance(usage, dict):
        return None, None
    parts = [_opt(usage.get(k), int) for k in ("input_tokens", "cache_read_tokens")]
    present = [p for p in parts if p is not None]
    return (sum(present) if present else None), _opt(usage.get("output_tokens"), int)


def _agy_tool_id(body: dict) -> str:
    """A stable id pairing a tool's ACTIVE event with its DONE/ERROR one.

    agy has no equivalent of claude's `tool_use_id`; `step_index` is unique
    only within one conversation, and a step that retries opens a new one — so
    the conversation id has to ride along or round two's results would pair
    with round one's calls.
    """
    return f"{body.get('conversation_id', '')}:{body.get('step_index', '')}"


def _agy_edited_path(name: str, params: dict) -> str:
    if name not in _AGY_EDIT_TOOLS:
        return ""
    for key, value in params.items():
        if not isinstance(value, str) or not value:
            continue
        low = key.lower()
        # `DirectoryPath` is a folder, not an edited file.
        if "dir" in low:
            continue
        if "file" in low or "path" in low:
            return value
    return ""


def _from_agy_step(body: dict) -> list[TraceEvent]:
    step_type = body.get("step_type")
    if step_type == "agent_response":
        text = body.get("text_delta")
        tokens_in, tokens_out = _agy_usage(body)
        text = _truncate(text) if isinstance(text, str) else ""
        if not text and tokens_in is None and tokens_out is None:
            return []
        # A response step with usage but no text still counts toward the
        # totals, and renders as nothing — which is correct: agy reports
        # thinking as a token count, never as text.
        return [TraceEvent("text", text=text, tokens_in=tokens_in, tokens_out=tokens_out)]
    if step_type != "tool":
        return []          # `user_input`, and whatever agy adds next
    info = body.get("tool_info")
    info = info if isinstance(info, dict) else {}
    params = info.get("parameters")
    params = params if isinstance(params, dict) else {}
    name = str(body.get("tool_name") or info.get("name") or "")
    tool_id = _agy_tool_id(body)
    if body.get("state") == "ACTIVE":
        return [TraceEvent(
            "tool_use", tool_name=name, tool_use_id=tool_id,
            tool_input=_truncate(json.dumps(params, ensure_ascii=False)),
            file_path=_agy_edited_path(name, params))]
    # Anything not ACTIVE closes the call. Only ERROR is a failure; an
    # unfamiliar terminal state reads as success rather than a false alarm.
    error = info.get("error")
    message = ""
    if isinstance(error, dict):
        message = str(error.get("message", ""))
    return [TraceEvent("tool_result", tool_use_id=tool_id,
                       ok=body.get("state") != "ERROR", text=_truncate(message))]


def distill_agy_line(line: str) -> list[TraceEvent]:
    """Zero or more trace events from one line of agy's stream-json.

    `init` yields nothing on purpose: agy's init reports cwd, its tool list and
    the permission mode, but no model — and the timeline's init row exists only
    to name the model.
    """
    data = _as_object(line)
    if data is None:
        return []
    kind = data.get("event")
    if kind == "step_update":
        body = data.get("step_update")
        return _from_agy_step(body) if isinstance(body, dict) else []
    if kind == "result":
        body = data.get("result")
        if not isinstance(body, dict):
            return []
        tokens_in, tokens_out = _agy_usage(body)
        response = body.get("response")
        # No cost_usd: agy reports tokens only, so the timeline shows no spend
        # for an antigravity run rather than inventing one.
        return [TraceEvent("result",
                           text=_truncate(response if isinstance(response, str) else ""),
                           tokens_in=tokens_in, tokens_out=tokens_out)]
    return []


# Which distiller reads which engine. Absent means the engine emits no stream
# worth rendering, and its tasks simply have no trace.
DISTILLERS = {"claude": distill_claude_line, "antigravity": distill_agy_line}


def distill_line(line: str, engine: str) -> list[TraceEvent]:
    distiller = DISTILLERS.get(engine)
    return distiller(line) if distiller else []
