"""The `api` engine: an agentic loop over the 9Router gateway.

Where `engine_runner` spawns a CLI and reads its stdout, this runs the loop in
this process and speaks to the same OpenAI-compatible gateway the planner and
chat already use — so there is no second credential, no second install, and no
CLI to find on PATH.

The load-bearing decision is that it emits **claude-shaped stream-json** rather
than a format of its own. `engine_stream.distill_claude_line` and
`engine_result.parse_claude_json` then read this engine with no changes, and
with them the whole downstream path: the task timeline, token totals,
completion detection, the retry classifier and the budget.

That makes the shapes below a contract with two modules that do not import this
one. Both mismatches found while designing this failed SILENTLY rather than
loudly — a renamed tool empties the edited-files list, an untranslated usage
dict zeroes the token counts — which is why they are pinned by tests.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


@dataclass
class ToolCall:
    """One tool call, after its arguments have been parsed off the wire.

    OpenAI streams `arguments` as a JSON *string* assembled from fragments;
    Anthropic's `tool_use.input` is an object. This holds the parsed form, so
    the translation happens once, at the edge.
    """
    id: str
    name: str
    args: dict = field(default_factory=dict)


def _usage_anthropic(usage) -> dict:
    """Translate the gateway's OpenAI-style usage into Anthropic key names.

    Verified against the live gateway 2026-09-08: it answers `prompt_tokens` /
    `completion_tokens`, and `prompt_tokens_details` is None — so there is no
    cache breakdown to carry, and `input_tokens` is the whole prompt with no
    risk of double counting. `engine_stream._total_input_tokens` reads the
    Anthropic names, and a dict it does not recognise yields None rather than
    an error, so an untranslated usage would blank the timeline's token totals
    without anything failing.
    """
    if not isinstance(usage, dict):
        return {}
    out = {}
    if isinstance(usage.get("prompt_tokens"), int):
        out["input_tokens"] = usage["prompt_tokens"]
    if isinstance(usage.get("completion_tokens"), int):
        out["output_tokens"] = usage["completion_tokens"]
    return out


def emit_init(model: str) -> dict:
    return {"type": "system", "subtype": "init", "model": model}


def emit_assistant(text: str, tool_calls: list[ToolCall], usage: dict) -> dict:
    """One assistant turn as an Anthropic-style message."""
    content = []
    if text:
        content.append({"type": "text", "text": text})
    for c in tool_calls:
        content.append({"type": "tool_use", "id": c.id, "name": c.name,
                        "input": c.args})
    message = {"role": "assistant", "content": content}
    if usage:
        message["usage"] = usage
    return {"type": "assistant", "message": message}


def emit_tool_result(tool_use_id: str, content: str, is_error: bool = False) -> dict:
    return {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": tool_use_id,
         "content": content, "is_error": bool(is_error)}]}}


def emit_result(final_text: str, usage: dict, session_id: str = "",
                num_turns: int = 0, api_error: str = "") -> dict:
    """The closing envelope.

    `result` MUST hold the model's own last message, never tool output:
    `orchestrator._confirmed_done` reads exactly this field to decide whether
    the step finished, and a mismatch costs three full engine rounds per step.

    No `total_cost_usd`: the gateway reports none, so the timeline shows tokens
    without a price rather than an invented one. `Budget` therefore does not
    move for this engine — recorded and accepted in the design spec.
    """
    env = {"type": "result", "subtype": "success", "is_error": False,
           "result": final_text, "session_id": session_id,
           "num_turns": num_turns, "usage": usage}
    if api_error:
        env.update(subtype="error_during_execution", is_error=True,
                   result=api_error)
    return env
