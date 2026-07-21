"""What the planner is told about the project it is planning for.

Pure string assembly, so every branch is cheap to pin. The branches matter:
the planner's rules already forbid an emulator test on a non-Android project,
but until now it had no way to know which kind of project this is, and had to
guess from the user's wording.
"""
from hermes.plan_context import build

TREE = "lib/\n  main.dart\npubspec.yaml"


def test_new_workspace_says_nothing_exists_yet():
    """A greenfield task legitimately plans a build and an emulator test, so
    this branch must never carry the non-Android prohibition. Detection on an
    empty directory returns `unknown`, which would otherwise read as
    'not an Android project' and break exactly the smoke-test task."""
    out = build("(empty directory — this is a brand-new project)",
                "unknown", is_new=True, name=None)
    assert "new empty workspace" in out
    assert "do not emit" not in out.lower()
    assert "APK" not in out or "does NOT produce" not in out


def test_new_workspace_omits_the_tree():
    """There is nothing to describe, and the summary for an empty dir is a
    sentence, not a listing."""
    out = build("(empty directory — this is a brand-new project)",
                "unknown", is_new=True, name=None)
    assert "Project structure" not in out


def test_android_project_permits_build_and_emulator():
    out = build(TREE, "flutter", is_new=False, name="myprofit")
    assert "myprofit" in out
    assert "flutter" in out
    assert "APK" in out
    assert "do not emit" not in out.lower()
    assert TREE in out


def test_react_native_and_plain_android_are_also_apk_projects():
    for ptype in ("react_native", "android"):
        out = build(TREE, ptype, is_new=False, name="app")
        assert "do not emit" not in out.lower(), ptype
        assert "APK" in out, ptype


def test_non_android_project_forbids_build_and_emulator():
    """The failure this whole change exists for: a lone emulator test planned
    against a web project, which can only ever fail with 'no apk artifact'."""
    out = build(TREE, "unknown", is_new=False, name="dashboard")
    assert "dashboard" in out
    assert "does NOT produce an APK" in out
    assert "do not emit" in out.lower()
    assert "browser" in out
    assert TREE in out


def test_unknown_detection_result_makes_no_claim_either_way():
    """When `detect` was never run — the dep is optional — the context must not
    assert a project type it did not measure. Silence, not a guess."""
    out = build(TREE, "", is_new=False, name="something")
    assert "does NOT produce an APK" not in out
    assert "do not emit" not in out.lower()
    assert TREE in out          # the tree is still worth sending


def test_missing_name_still_reads_as_a_sentence():
    out = build(TREE, "flutter", is_new=False, name=None)
    assert "``" not in out
    assert "None" not in out


def test_unreadable_directory_summary_is_passed_through_untouched():
    """_project_summary never raises; it returns a sentence. That sentence has
    to survive into the prompt rather than being mistaken for a listing."""
    out = build("(directory could not be read)", "unknown", is_new=False,
                name="x")
    assert "(directory could not be read)" in out


def test_output_starts_with_its_own_heading():
    """It is appended to a prompt that already uses `# ` headings; without one
    of its own it would read as a continuation of the rules above it."""
    assert build(TREE, "flutter", is_new=False, name="x").startswith("# ")
