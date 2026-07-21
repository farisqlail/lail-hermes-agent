"""Read what an engine actually reported, instead of guessing from stdout.

`claude -p --output-format json` ends its run with a single result envelope
carrying the model's final message, the session id, the cost, and whether the
session died on an API error. Scraping raw stdout can see none of that: it
cannot tell the model's own words from tool output or from an echo of the
prompt, and it cannot tell "exited 0 having finished" from "exited 0 after the
API failed".

Kept as pure functions with no I/O so the awkward shapes — truncated JSON, a
warning line ahead of the envelope, a missing field — are cheap to pin down in
tests. `antigravity` has no equivalent flag (verified against `agy --help`,
2026-07-21), so it never reaches this module and stays on text.
"""
from __future__ import annotations
import json
from dataclasses import dataclass

# The envelope's own self-description. Requiring it means an unrelated JSON
# object printed by the engine cannot be mistaken for the result — which would
# blank out final_text and silently break completion detection. If the CLI ever
# renames this, parsing returns None and the caller falls back to text mode:
# degraded, never wrong.
_RESULT_TYPE = "result"


@dataclass(frozen=True)
class EngineOutcome:
    """What the engine reported about its own session.

    `usage` stays a raw dict on purpose. Nothing consumes the token counts yet;
    modelling them now would mean inventing a shape before there is a reader to
    say what it should be.
    """
    final_text: str
    session_id: str | None = None
    cost_usd: float | None = None
    usage: dict | None = None
    num_turns: int | None = None
    api_error: str | None = None


def _result_objects(stdout: str):
    """Yield candidate result envelopes, last one first.

    Deliberately not the greedy `re.search(r"\\{.*\\}", ...)` used by
    `orchestrator.parse_plan`: against two objects that pattern splices from the
    first brace to the last and produces a string that parses as neither.
    """
    text = stdout.strip()
    if not text:
        return
    whole = _as_object(text)
    if whole is not None:
        yield whole
        return
    # Noise around the envelope (a warning line, a progress banner). The last
    # parseable object is the one that reports the session's outcome.
    for line in reversed(text.splitlines()):
        obj = _as_object(line.strip())
        if obj is not None:
            yield obj


def _as_object(text: str) -> dict | None:
    if not text:
        return None
    try:
        data = json.loads(text)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _api_error(data: dict) -> str | None:
    """Why the session ended badly, or None if it did not.

    Two independent signals. `is_error` covers an API-level failure;
    `subtype` covers a session that ended short of the work — notably
    `error_max_turns`, which reports `is_error: false` and exits 0.
    """
    subtype = data.get("subtype")
    if data.get("is_error"):
        return (data.get("api_error_status") or subtype
                or "engine reported is_error")
    if subtype and subtype != "success":
        return str(subtype)
    return None


def _opt(value, kind):
    return value if isinstance(value, kind) else None


def parse_claude_json(stdout: str) -> EngineOutcome | None:
    """Parse a `--output-format json` run, or None if stdout is unusable.

    None is a supported answer, not a failure: an older CLI, a crash before the
    envelope, or a polluted stream all land here, and the caller degrades to
    reading raw stdout. Never raises — a parse problem must not be able to take
    down a step whose real work may well have succeeded.
    """
    for data in _result_objects(stdout):
        if data.get("type") != _RESULT_TYPE:
            continue
        result = data.get("result")
        return EngineOutcome(
            final_text=result if isinstance(result, str) else "",
            session_id=_opt(data.get("session_id"), str),
            cost_usd=_opt(data.get("total_cost_usd"), (int, float)),
            usage=_opt(data.get("usage"), dict),
            num_turns=_opt(data.get("num_turns"), int),
            api_error=_api_error(data),
        )
    return None
