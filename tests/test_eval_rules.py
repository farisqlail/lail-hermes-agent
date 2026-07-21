"""The eval's scoring logic, checked against hand-written plans.

Deterministic and offline: the model call is the only stochastic part of an eval
run, and it lives in the runner. If these rules are wrong, every scorecard is
wrong, so they are pinned here like any other code.
"""
from hermes.evals import rules
from hermes.evals.cases import Case

WEB = Case(id="w", text="x", rules=(), files={"package.json": "{}"},
           builds_apk=False, name="dashboard")
APK = Case(id="a", text="x", rules=(), files={"pubspec.yaml": "name: x"},
           builds_apk=True, name="counter")


def test_build_step_on_a_non_apk_project_is_a_violation():
    """The live failure of task 20260715-104754-5b44a5, as a rule."""
    steps = [{"type": "code", "prompt": "fix it"}, {"type": "build", "target": "apk"}]
    assert "cannot produce an APK" in rules.no_build_for_non_apk(steps, WEB)


def test_emulator_test_on_a_non_apk_project_is_a_violation():
    steps = [{"type": "code"}, {"type": "test", "mode": "emulator"}]
    assert rules.no_build_for_non_apk(steps, WEB)


def test_browser_test_on_a_non_apk_project_is_fine():
    """Rule 3 offers `browser` as the legitimate alternative — scoring it as a
    violation would push the planner away from the one test mode that works."""
    steps = [{"type": "code"}, {"type": "test", "mode": "browser"}]
    assert rules.no_build_for_non_apk(steps, WEB) is None


def test_build_on_an_apk_project_is_fine():
    steps = [{"type": "code"}, {"type": "build", "target": "apk"}]
    assert rules.no_build_for_non_apk(steps, APK) is None


def test_emulator_test_without_a_build_is_a_violation():
    steps = [{"type": "code"}, {"type": "test", "mode": "emulator"}]
    assert "no build before it" in rules.test_needs_prior_build(steps, APK)


def test_emulator_test_after_a_build_is_fine():
    steps = [{"type": "code"}, {"type": "build"}, {"type": "test", "mode": "emulator"}]
    assert rules.test_needs_prior_build(steps, APK) is None


def test_build_after_the_test_does_not_count():
    """Order is the whole point: a build that runs later produces no APK for a
    test that already ran."""
    steps = [{"type": "test", "mode": "emulator"}, {"type": "build"}]
    assert rules.test_needs_prior_build(steps, APK)


def test_browser_test_never_needs_a_build():
    steps = [{"type": "test", "mode": "browser"}]
    assert rules.test_needs_prior_build(steps, APK) is None


def test_single_code_step_rejects_an_appended_test():
    steps = [{"type": "code"}, {"type": "test", "mode": "browser"}]
    assert "should not append a test step" in rules.single_code_step(steps, WEB)


def test_single_code_step_rejects_two_code_steps():
    steps = [{"type": "code"}, {"type": "code"}]
    assert "exactly one code step" in rules.single_code_step(steps, WEB)


def test_single_code_step_accepts_the_lone_code_step():
    assert rules.single_code_step([{"type": "code"}], WEB) is None


def test_unknown_step_type_is_a_violation():
    """An unknown type reaches _exec_step and fails the task at run time."""
    assert "unknown step type" in rules.known_step_types(
        [{"type": "deploy"}], WEB)


def test_known_types_pass():
    steps = [{"type": "code"}, {"type": "build"}, {"type": "test"}]
    assert rules.known_step_types(steps, APK) is None


def test_empty_plan_is_a_violation():
    assert rules.plan_is_not_empty([], WEB)


def test_check_runs_only_the_rules_a_case_opted_into():
    case = Case(id="c", text="x", rules=("R0-schema",), builds_apk=False)
    results = rules.check([{"type": "build"}], case)
    assert [rid for rid, _ in results] == ["R0-schema"]
    # R1 would have failed this plan; it was not selected, so it is not scored.
    assert results[0][1] is None


def test_every_case_names_rules_that_exist():
    """A typo in a case's rule tuple would otherwise KeyError mid-run, after
    the model calls have already been paid for."""
    from hermes.evals.cases import CASES
    for case in CASES:
        for rid in case.rules:
            assert rid in rules.RULES, f"{case.id} names unknown rule {rid}"


def test_case_ids_are_unique():
    from hermes.evals.cases import CASES
    ids = [c.id for c in CASES]
    assert len(ids) == len(set(ids))
