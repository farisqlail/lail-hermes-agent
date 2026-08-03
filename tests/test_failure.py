"""Classification, checked against the ten failures that actually happened.

The strings below are copied from the live task history, not invented. A
classifier that agrees with imaginary errors and disagrees with the real ones
would leave the loop exactly as blind as it was.
"""
from hermes import failure


def test_the_four_rate_limit_failures_are_transient():
    """`engine failed after 3 round(s): 429` — four tasks, three instant rounds
    each, one of them $0.49 for nothing. A wait was the answer, not a reword."""
    assert failure.classify("429") == failure.TRANSIENT
    assert failure.classify("Error code: 429 - rate limit exceeded") == failure.TRANSIENT
    assert failure.classify(
        "Error code: 503 - {'error': {'message': 'ResourceExhausted: Worker "
        "local total request limit reached (48/48)'}}") == failure.TRANSIENT
    assert failure.classify("The model endpoint is overloaded right now") == failure.TRANSIENT


def test_the_three_missing_binary_failures_are_environmental():
    """Repeating these three changed nothing except the bill."""
    assert failure.classify(
        "engine executable 'claude' not found on PATH - is it installed?") == failure.ENVIRONMENT
    assert failure.classify(
        "[WinError 2] The system cannot find the file specified") == failure.ENVIRONMENT
    assert failure.classify("flutter: command not found") == failure.ENVIRONMENT


def test_the_two_impossible_steps_are_structural():
    assert failure.classify("unsupported project type: unknown") == failure.STRUCTURAL
    assert failure.classify("no apk artifact to test") == failure.STRUCTURAL


def test_a_compile_error_is_semantic_because_the_engine_can_fix_it():
    assert failure.classify(
        "src/main.dart:42:5: Error: Expected ';' after this.") == failure.SEMANTIC
    assert failure.classify("FAILED: 3 tests failed") == failure.SEMANTIC


def test_unrecognised_text_keeps_todays_behaviour():
    """Semantic means "retry with the error fed back", which is what the loop
    did for everything before this existed. An unfamiliar error must not gain a
    new failure mode from a guess."""
    assert failure.classify("something nobody has seen before") == failure.SEMANTIC
    assert failure.classify("") == failure.SEMANTIC


def test_should_retry_only_where_repeating_can_help():
    assert failure.should_retry("429") is True
    assert failure.should_retry("Expected ';' after this") is True
    assert failure.should_retry("'claude' not found on PATH") is False
    assert failure.should_retry("unsupported project type: unknown") is False


def test_advice_names_the_thing_to_fix():
    assert "PATH" in failure.advice("'claude' not found on PATH")
    assert "flutter" in failure.advice("[WinError 2] The system cannot find the file specified")
    assert "API key" in failure.advice("Error code: 401 unauthorized")
    assert "plan needs to change" in failure.advice("unsupported project type: unknown")


def test_no_advice_where_the_loop_handles_it():
    """Transient and semantic failures are the loop's problem, not the
    operator's — a tip there is noise on a line they cannot act on."""
    assert failure.advice("429") == ""
    assert failure.advice("Expected ';' after this") == ""


def test_backoff_widens_then_holds():
    assert failure.delay_for(0) == 5
    assert failure.delay_for(1) == 15
    assert failure.delay_for(2) == 30
    assert failure.delay_for(9) == 30      # bounded, never grows without limit


def test_signature_matches_two_goes_at_the_same_wall():
    """Line numbers, temp paths and session ids move between two attempts at
    one failure. What varies says nothing about progress, so it is flattened."""
    a = failure.signature(r"C:\proj\lib\main.dart:42:5: Error: Expected ';'")
    b = failure.signature(r"C:\proj\lib\main.dart:57:9: Error: Expected ';'")
    assert a == b


def test_signature_separates_genuinely_different_failures():
    assert failure.signature("Expected ';' after this") != \
           failure.signature("Undefined name 'foo'")
