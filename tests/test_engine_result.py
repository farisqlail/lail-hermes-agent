"""Parsing an engine's structured output.

Pure string-in / dataclass-out, so the coverage here can be greedy: the JSON
shape belongs to the `claude` CLI, not to us, and every one of these cases is
a way that surface can move under our feet.
"""
import json
import pytest
from hermes.engine_result import parse_claude_json

# Captured verbatim from `claude -p --output-format json` (2026-07-21). Kept
# whole rather than trimmed to the fields we read, so an upstream shape change
# shows up here instead of in production.
REAL = json.dumps({
    "type": "result", "subtype": "success", "is_error": False,
    "api_error_status": None, "duration_ms": 2781, "duration_api_ms": 2648,
    "num_turns": 1, "result": "pong", "stop_reason": "end_turn",
    "session_id": "8d963e4e-50e4-4735-86c1-1f3a3b9f8526",
    "total_cost_usd": 0.0249893,
    "usage": {"input_tokens": 10, "cache_creation_input_tokens": 11450,
              "cache_read_input_tokens": 15593, "output_tokens": 104},
    "permission_denials": [], "terminal_reason": "completed",
})


def test_parses_a_real_result_envelope():
    out = parse_claude_json(REAL)
    assert out.final_text == "pong"
    assert out.session_id == "8d963e4e-50e4-4735-86c1-1f3a3b9f8526"
    assert out.cost_usd == pytest.approx(0.0249893)
    assert out.num_turns == 1
    assert out.api_error is None
    assert out.usage["output_tokens"] == 104


def test_survives_leading_noise_on_stdout():
    """A warning line before the JSON must not cost us the whole envelope."""
    out = parse_claude_json("warning: config X is deprecated\n" + REAL)
    assert out.final_text == "pong"
    assert out.session_id.startswith("8d963e4e")


def test_is_error_becomes_api_error():
    raw = json.dumps({"type": "result", "subtype": "success", "is_error": True,
                      "api_error_status": "overloaded_error", "result": ""})
    assert parse_claude_json(raw).api_error == "overloaded_error"


def test_error_subtype_becomes_api_error_even_when_is_error_is_false():
    """`error_max_turns` exits 0 with is_error false — the subtype is the only
    thing that says the session died short of the work."""
    raw = json.dumps({"type": "result", "subtype": "error_max_turns",
                      "is_error": False, "result": "half a fix"})
    out = parse_claude_json(raw)
    assert out.api_error == "error_max_turns"
    assert out.final_text == "half a fix"      # partial output still kept


def test_is_error_without_a_status_still_reports_something():
    raw = json.dumps({"type": "result", "is_error": True, "result": ""})
    assert parse_claude_json(raw).api_error


def test_missing_result_field_yields_empty_text_not_a_crash():
    raw = json.dumps({"type": "result", "subtype": "success", "is_error": False,
                      "session_id": "abc"})
    out = parse_claude_json(raw)
    assert out.final_text == ""
    assert out.session_id == "abc"


def test_non_string_result_is_coerced_to_empty():
    raw = json.dumps({"type": "result", "result": {"unexpected": "shape"}})
    assert parse_claude_json(raw).final_text == ""


@pytest.mark.parametrize("raw", [
    "",
    "   \n  ",
    "just some plain text the engine printed",
    '{"type": "result", "result": "truncated mid',
    "[1, 2, 3]",                                    # JSON, but not an object
])
def test_unusable_stdout_returns_none(raw):
    """None is the documented 'fall back to text mode' signal. Unparseable
    stdout is an expected event, not an exception."""
    assert parse_claude_json(raw) is None


def test_a_json_object_that_is_not_a_result_envelope_is_rejected():
    """Some other object on stdout must not be mistaken for the result, which
    would blank out final_text and break sentinel detection."""
    assert parse_claude_json('{"type": "system", "session_id": "abc"}') is None


def test_last_result_object_wins():
    """The greedy `{.*}` regex used elsewhere in this codebase would splice two
    objects into one unparseable string. Scanning from the end takes the final
    envelope, which is the one that reports the session's outcome.
    """
    first = json.dumps({"type": "result", "result": "stale", "session_id": "s1"})
    out = parse_claude_json(first + "\n" + REAL)
    assert out.final_text == "pong"
    assert out.session_id.startswith("8d963e4e")


# --- agy stream-json envelope ------------------------------------------------
#
# Captured verbatim from `agy -p ... --output-format stream-json` (2026-09-02).
# Nothing like claude's: keyed `event`, payload nested, status a string, and no
# cost field at all.

from hermes.engine_result import parse_agy_stream

AGY_RESULT = json.dumps({"event": "result", "result": {
    "conversation_id": "2e612ee7-7560-4749-ab4d-3031b4fc23ec",
    "status": "SUCCESS", "response": "all done", "duration_seconds": 7.46,
    "num_turns": 1,
    "usage": {"input_tokens": 26310, "output_tokens": 741,
              "thinking_tokens": 586, "cache_read_tokens": 32572,
              "total_tokens": 27051}}})

AGY_STREAM = "\n".join([
    json.dumps({"event": "init", "conversation_id": "c1",
                "init": {"cwd": "C:\repo", "tools": [], "permission_mode": "request-review"}}),
    json.dumps({"event": "step_update", "step_update": {
        "conversation_id": "c1", "step_index": 0, "state": "DONE",
        "step_type": "user_input"}}),
    AGY_RESULT,
])


def test_agy_envelope_is_found_at_the_end_of_the_stream():
    out = parse_agy_stream(AGY_STREAM)
    assert out is not None
    assert out.final_text == "all done"
    assert out.session_id == "2e612ee7-7560-4749-ab4d-3031b4fc23ec"
    assert out.num_turns == 1
    assert out.api_error is None
    assert out.usage["total_tokens"] == 27051


def test_agy_reports_no_cost():
    """agy bills in tokens only — inventing a number here would show a spend
    the operator never incurred."""
    assert parse_agy_stream(AGY_STREAM).cost_usd is None


def test_agy_non_success_status_is_an_api_error():
    line = json.dumps({"event": "result", "result": {
        "status": "FAILED", "response": "", "conversation_id": "c1"}})
    out = parse_agy_stream(line)
    assert out.api_error == "FAILED"


def test_agy_parser_returns_none_for_text_mode_output():
    """The degrade path: an older agy, or a run that died before its envelope.
    None means the caller reads raw stdout, exactly as it did before."""
    assert parse_agy_stream("just some prose the CLI printed") is None
    assert parse_agy_stream("") is None


def test_agy_parser_ignores_a_stream_with_no_result_event():
    stream = json.dumps({"event": "step_update", "step_update": {"step_index": 0}})
    assert parse_agy_stream(stream) is None


def test_the_two_engine_parsers_do_not_read_each_other():
    """Both envelopes say `result`, but under different keys — a mix-up would
    blank out final_text and silently break completion detection."""
    assert parse_agy_stream(REAL) is None
    assert parse_claude_json(AGY_RESULT) is None
