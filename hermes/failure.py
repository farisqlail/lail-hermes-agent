"""What kind of failure this is, and therefore whether repeating helps.

Written from the ten real failures in the live task history, not from
imagination. Grouped, they say something the retry loop did not know:

    4x  engine failed after 3 round(s): 429        <- hammered a rate limit
    3x  'claude' not found on PATH / [WinError 2]  <- repeated the impossible
    2x  unsupported project type / no apk to test  <- ran an unrunnable step
    1x  model endpoint overloaded                  <- backed off, correctly

Seven of ten were made worse by retrying, and one of those burned $0.49 on
three instant rounds against an endpoint that was refusing everything. The loop
was never too short; it was blind. So the question a failure has to answer
before anything is retried is *which* failure it is:

* TRANSIENT — the world was busy. Wait, then repeat the same request.
* ENVIRONMENT — something is missing or unreachable on this machine. Repeating
  cannot change it; say what to fix and stop.
* STRUCTURAL — the step could never have worked here (a build for a project
  that produces no artifact). The plan is wrong, not the attempt.
* SEMANTIC — the code is wrong. This, and only this, is what feeding the error
  back to the engine actually fixes.

Unrecognised text is SEMANTIC on purpose: that is the loop's existing
behaviour, so an unfamiliar error keeps working exactly as it does today rather
than gaining a new failure mode from a guess.
"""
from __future__ import annotations

TRANSIENT = "transient"
ENVIRONMENT = "environment"
STRUCTURAL = "structural"
SEMANTIC = "semantic"

# Matched case-insensitively against the failure text. Order within a class
# does not matter; order *between* classes does — see classify().
_TRANSIENT = (
    "429", "rate limit", "ratelimit", "too many requests",
    "503", "502", "504", "overloaded", "capacity",
    "resourceexhausted", "temporarily unavailable", "service unavailable",
    "timed out", "timeout", "econnreset", "connection reset",
    "connection aborted", "connection refused",
)

_ENVIRONMENT = (
    "not found on path", "no such file or directory",
    "is not recognized as an internal or external command",
    "command not found", "winerror 2", "winerror 3", "winerror 5",
    "permission denied", "access is denied",
    "no api key", "api key is missing", "401", "403", "unauthorized",
)

_STRUCTURAL = (
    "unsupported project type", "no apk artifact to test",
    "could not determine application id", "unknown step type",
    "no apk artifact",
)

#: What to tell the operator for an environment failure. The generic message
#: ("check the installation") is useless at 2am; these name the thing.
_ADVICE = (
    ("not found on path", "The engine CLI is not on PATH for the Hermes "
                          "process. Install it, or restart Hermes from a shell "
                          "where the command runs."),
    ("winerror 2", "A tool the step needs is missing from PATH — for a build "
                   "step that is usually flutter/gradle/npm."),
    ("permission denied", "The process cannot access that path. Check the "
                          "folder's permissions, or that it is not open "
                          "elsewhere."),
    ("access is denied", "The process cannot access that path. Check the "
                         "folder's permissions, or that it is not open "
                         "elsewhere."),
    ("401", "The model endpoint rejected the credentials. Check the API key "
            "in Settings."),
    ("unauthorized", "The model endpoint rejected the credentials. Check the "
                     "API key in Settings."),
)

_STRUCTURAL_ADVICE = (
    "This step cannot succeed against this project, however many times it is "
    "run — the plan needs to change, not the attempt. Re-submit the task; the "
    "planner is told the project type and will not ask for an artifact this "
    "project cannot produce.")


def classify(text: str) -> str:
    """The failure class of one error message.

    Transient is checked first and environment second: a 429 mentioning a
    missing model reads as busy, not misconfigured, and "not found on PATH" is
    a fact about the machine whatever else the line says. Structural is
    checked before falling through to semantic, since its phrases are ours and
    unambiguous.
    """
    low = (text or "").lower()
    if any(p in low for p in _TRANSIENT):
        return TRANSIENT
    if any(p in low for p in _ENVIRONMENT):
        return ENVIRONMENT
    if any(p in low for p in _STRUCTURAL):
        return STRUCTURAL
    return SEMANTIC


def advice(text: str) -> str:
    """One actionable sentence for a failure that repeating cannot fix, or "".

    Appended to the reported message. Empty for transient and semantic
    failures: those are handled by the loop, not by the operator.
    """
    kind = classify(text)
    low = (text or "").lower()
    if kind == STRUCTURAL:
        return _STRUCTURAL_ADVICE
    if kind == ENVIRONMENT:
        for needle, tip in _ADVICE:
            if needle in low:
                return tip
        return ("Something this step needs is missing or unreachable on this "
                "machine. Repeating will not change it.")
    return ""


def should_retry(text: str) -> bool:
    """True when another engine round could plausibly do better.

    Transient (after a wait) and semantic (with the error fed back) can. An
    environment or structural failure is the same failure next time, at the
    same price.
    """
    return classify(text) in (TRANSIENT, SEMANTIC)


#: Spacing for transient engine rounds. Mirrors the planner's
#: `_PLANNER_RETRY_DELAYS_S` — a rate limit needs a pause, not a re-prompt, and
#: the four 429 failures in the history retried instantly three times over.
RETRY_DELAYS_S = (5, 15, 30)


def delay_for(attempt: int) -> float:
    """Seconds to wait before transient attempt `attempt` (0-based)."""
    if attempt < 0:
        return 0.0
    return float(RETRY_DELAYS_S[min(attempt, len(RETRY_DELAYS_S) - 1)])
