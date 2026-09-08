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

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path

from . import agent_tools
from .engine_runner import RunResult, _await_within


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


@dataclass
class Turn:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: dict = field(default_factory=dict)


def _parse_args(raw: str) -> dict:
    """Parsed tool arguments, or {} for anything unusable.

    A truncated or malformed arguments string is a bad turn, not a dead run:
    the tool layer reports the missing argument and the model gets to correct
    itself on the next turn.
    """
    try:
        data = json.loads(raw or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


async def _one_turn(client, model: str, messages: list[dict],
                    tools: list[dict]) -> Turn:
    """One assistant turn, assembled from its stream.

    Streamed rather than blocking because the turn's text and tool calls are
    what the live timeline renders. They are still emitted as ONE assistant
    line per turn, not per delta: `distill_claude_line` reads whole content
    blocks, and the CLIs emit per turn too.

    Tool call fragments are keyed by `index`, not by position: a turn making
    two calls at once interleaves their argument fragments in the stream.
    """
    kwargs = {"model": model, "messages": messages, "stream": True,
              "stream_options": {"include_usage": True}}
    if tools:
        kwargs["tools"] = tools
    stream = await client.chat.completions.create(**kwargs)

    text_parts: list[str] = []
    partial: dict[int, dict] = {}
    usage = {}
    async for chunk in stream:
        if getattr(chunk, "usage", None):
            usage = _usage_anthropic(
                chunk.usage.model_dump() if hasattr(chunk.usage, "model_dump") else chunk.usage)
        for choice in (chunk.choices or []):
            delta = choice.delta
            if getattr(delta, "content", None):
                text_parts.append(delta.content)
            for tc in (getattr(delta, "tool_calls", None) or []):
                slot = partial.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                if getattr(tc, "id", None):
                    slot["id"] = tc.id
                fn = getattr(tc, "function", None)
                if fn is not None:
                    if getattr(fn, "name", None):
                        slot["name"] = fn.name
                    if getattr(fn, "arguments", None):
                        slot["args"] += fn.arguments

    calls = [ToolCall(slot["id"], slot["name"], _parse_args(slot["args"]))
             for _, slot in sorted(partial.items())]
    return Turn("".join(text_parts), calls, usage)


# Tool turns inside ONE session, distinct from orchestrator's MAX_ENGINE_ROUNDS
# (repair rounds, outer). A model stuck in a tool loop would otherwise spend the
# whole timeout_code_s budget, and unlike the CLI engines there is no per-call
# cost figure to stop it — see the budget note in the design spec.
MAX_TURNS = 40

# Sent to the model as the tool result when the loop is cut short. Better than
# silence: the closing turn should say why it stopped.
_TURNS_EXHAUSTED = ("Turn budget exhausted. Stop calling tools and state "
                    "plainly what is done and what remains.")


def _system(cwd: Path) -> str:
    """The engine's own preamble. Deliberately thin.

    The task, the project context and the completion contract all arrive in the
    user prompt, composed by `orchestrator._compose_engine_prompt` — restating
    them here would let the two drift apart.
    """
    return ("You are a coding agent working inside a single project directory. "
            f"The project root is {cwd}, and every path you pass to a tool is "
            "resolved inside it — paths outside are refused. "
            "Inspect files with the tools before changing them; never guess a "
            "file's contents. Make the change, verify it, then report. "
            "Do not ask for permission to run a command: run it.")


def _final_text(turns: list[Turn]) -> str:
    """The model's own last words.

    Scans backwards for the last turn that actually said something: a run
    frequently ends with a tool-call-only turn, and reporting that turn's empty
    text as the result would blank `final_text` — which `_confirmed_done` reads
    to decide the step is finished.
    """
    for turn in reversed(turns):
        if turn.text.strip():
            return turn.text
    return ""


def _sum_usage(turns: list[Turn]) -> dict:
    total = {"input_tokens": 0, "output_tokens": 0}
    for turn in turns:
        for key in total:
            total[key] += turn.usage.get(key, 0)
    return total


async def _loop(client, model: str, prompt: str, cwd: Path, emit) -> list[Turn]:
    messages = [{"role": "system", "content": _system(cwd)},
                {"role": "user", "content": prompt}]
    turns: list[Turn] = []
    for n in range(MAX_TURNS):
        turn = await _one_turn(client, model, messages, agent_tools.TOOLS)
        turns.append(turn)
        emit(emit_assistant(turn.text, turn.tool_calls, turn.usage))
        if not turn.tool_calls:
            break
        messages.append({
            "role": "assistant", "content": turn.text or None,
            "tool_calls": [{"id": c.id, "type": "function",
                            "function": {"name": c.name,
                                         "arguments": json.dumps(c.args)}}
                           for c in turn.tool_calls]})
        last = n == MAX_TURNS - 1
        for call in turn.tool_calls:
            # Every id must be answered before the next request, including on
            # the final turn — an unanswered tool_call_id is rejected outright.
            if last:
                text, ok = _TURNS_EXHAUSTED, False
            else:
                text, ok = await agent_tools.call(call.name, call.args, cwd)
            emit(emit_tool_result(call.id, text, is_error=not ok))
            messages.append({"role": "tool", "tool_call_id": call.id,
                             "content": text})
    return turns


async def run(prompt: str, cwd: Path, timeout_s: int, model: str = "",
              on_event=None, deadline=None, client=None, **_) -> RunResult:
    """One engine session against the 9Router gateway.

    Returns `engine_runner.RunResult` unchanged, so every caller — the retry
    loop, the budget, the failure classifier, the step report — reads this
    engine exactly as it reads a CLI. `**_` swallows the CLI-only kwargs
    (`ask_url`, `session_id`, `effort`) that `run_engine` may pass through.
    """
    if client is None:
        from openai import AsyncOpenAI
        from . import config
        settings, secrets = config.load_settings(), config.load_secrets()
        model = model or settings.model
        client = AsyncOpenAI(base_url=settings.nvidia_base_url,
                             api_key=secrets.nvidia_api_key)

    lines: list[str] = []

    def emit(obj: dict) -> None:
        line = json.dumps(obj, ensure_ascii=False)
        lines.append(line)
        if on_event is not None:
            try:
                on_event(line)
            except Exception:
                # A broken trace consumer must never take down a run whose real
                # work is fine — same posture as engine_runner._pump.
                pass

    emit(emit_init(model))
    work = _loop(client, model, prompt, Path(cwd), emit)
    try:
        if deadline is None:
            turns = await asyncio.wait_for(work, timeout=timeout_s)
        else:
            turns = await _await_within(work, deadline)
    except asyncio.TimeoutError:
        # Same shape the subprocess branch returns for a killed engine.
        return RunResult(False, "", "", True, None)
    except Exception as e:
        # The message, not the type: `failure.classify` matches on text like
        # "429" or "401", and the retry loop's whole decision hangs off it.
        why = f"{type(e).__name__}: {e}"
        emit(emit_result("", {}, api_error=why))
        stdout = "\n".join(lines)
        from .engine_result import parse_claude_json
        return RunResult(False, stdout, why, False, 1, parse_claude_json(stdout))

    emit(emit_result(_final_text(turns), _sum_usage(turns), num_turns=len(turns)))
    stdout = "\n".join(lines)
    from .engine_result import parse_claude_json
    return RunResult(True, stdout, "", False, 0, parse_claude_json(stdout))


