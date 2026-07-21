"""Rule checks scored against a planner-produced plan.

Every rule here restates something the planner's own system prompt already
mandates. Nothing scores taste: which engine was picked, how the step prompt is
worded, how many words it used. Those vary between correct answers, so
asserting on them would measure noise and train whoever reads the scorecard to
ignore it.

Pure functions over an already-parsed plan — no network, no filesystem — so the
scoring logic is ordinary tested code and the only non-deterministic part of an
eval run is the model call itself.

A rule returns None when it holds, or a sentence saying what went wrong.
"""
from __future__ import annotations

_KNOWN_TYPES = ("code", "build", "test")


def _types(steps: list[dict]) -> list[str]:
    return [s.get("type") for s in steps]


def known_step_types(steps: list[dict], case) -> str | None:
    """Every step type is one the orchestrator can execute.

    Prompt: the schema line. An unknown type reaches `_exec_step` and returns
    "unknown step type", failing the task at run time.
    """
    bad = [t for t in _types(steps) if t not in _KNOWN_TYPES]
    if bad:
        return f"unknown step type(s): {bad}"
    return None


def plan_is_not_empty(steps: list[dict], case) -> str | None:
    return "plan has no steps" if not steps else None


def no_build_for_non_apk(steps: list[dict], case) -> str | None:
    """No `build` step and no emulator test for a project that cannot produce
    an APK.

    Prompt rules 2 and 3. This is the rule behind the live failure in task
    20260715-104754-5b44a5, where a build step was planned for a project with
    no Android markers and died on "unsupported project type: unknown".
    """
    if case.builds_apk:
        return None
    offenders = []
    for i, s in enumerate(steps):
        if s.get("type") == "build":
            offenders.append(f"step {i} is a build")
        if s.get("type") == "test" and s.get("mode") == "emulator":
            offenders.append(f"step {i} is an emulator test")
        if s.get("target") == "apk" and s.get("type") in ("build", "test"):
            offenders.append(f"step {i} targets apk")
    if offenders:
        return ("project cannot produce an APK, but " + "; ".join(offenders))
    return None


def test_needs_prior_build(steps: list[dict], case) -> str | None:
    """An emulator test must follow a build in the same plan.

    Prompt rule 4, and the same condition `orchestrator.validate_plan` rejects.
    Scoring it measures how often that safety net is actually load-bearing.
    """
    built = False
    for i, s in enumerate(steps):
        if s.get("type") == "build":
            built = True
        elif s.get("type") == "test" and s.get("mode") == "emulator" and not built:
            return f"step {i} is an emulator test with no build before it"
    return None


def single_code_step(steps: list[dict], case) -> str | None:
    """A fix / investigate task is one code step, with no test step appended.

    Prompt rule 1: a code step verifies its own work, so a test step added
    merely to "verify" costs a whole extra engine run and proves nothing.
    """
    kinds = _types(steps)
    if kinds.count("code") != 1:
        return f"expected exactly one code step, got {kinds}"
    if "test" in kinds:
        return f"a fix task should not append a test step, got {kinds}"
    return None


RULES = {
    "R0-schema": known_step_types,
    "R0-nonempty": plan_is_not_empty,
    "R1-no-apk": no_build_for_non_apk,
    "R2-build-first": test_needs_prior_build,
    "R5-single-code": single_code_step,
}


def check(steps: list[dict], case) -> list[tuple[str, str | None]]:
    """Run the rules a case opted into. Returns (rule id, failure or None)."""
    return [(rid, RULES[rid](steps, case)) for rid in case.rules]
