"""Tell the planner what it is planning against.

The planner's rules already say an emulator test and an `apk` target are for
Android projects only, and that a `build` must precede any test. It had no way
to obey them: the task text was its only input, so "fix the login flow" gave it
nothing to distinguish a Flutter app from a web dashboard, and it sometimes
typed a whole bug-fix as a lone emulator test — a step that can only fail with
"no apk artifact to test".

This module supplies the missing facts, and draws the conclusion in Python
rather than leaving it to the model. Deriving "this cannot produce an APK" from
a file listing is deterministic and testable; asking a small model to derive it
is neither, and the model behind `Settings.model` is configurable.

Pure string assembly, no I/O — the caller has already gathered every fact.
"""
from __future__ import annotations

# Project types that compile to an APK, i.e. the ones for which a `build` step
# and an emulator test are meaningful. Mirrors project_detect.detect's return
# values; anything else it reports is not an Android project.
_APK_TYPES = ("flutter", "react_native", "android")

_HEADING = "# Project context"

_NEW_WORKSPACE = (
    "Target: new empty workspace — this task creates the project from scratch.\n"
    "Nothing exists there yet, so the project type is whatever the task asks "
    "you to build. If the task describes an Android app, a `build` step and an "
    "emulator test are appropriate.")

_NOT_ANDROID = (
    "No Android project markers were found (no pubspec.yaml, no build.gradle, "
    "no android/ directory).\n"
    "This project does NOT produce an APK — do not emit a `build` step or a "
    "test with mode `emulator`. If it genuinely needs testing, use mode "
    "`browser`; otherwise omit the test step.")


def build(summary: str, ptype: str, is_new: bool,
          name: str | None = None) -> str:
    """Assemble the planner's project-context block.

    `is_new` comes from the caller knowing a throwaway workspace was just
    created, not from inspecting the directory. That distinction cannot be
    detected: an empty workspace and an unrecognised project both detect as
    `unknown`, and treating a greenfield task as "not an Android project" would
    forbid the build step it actually needs.

    `ptype` may be empty when detection never ran — the orchestrator's `detect`
    dependency is optional. Then no claim is made about the type at all, since
    asserting a fact that was never measured is worse than staying silent.
    """
    if is_new:
        return f"{_HEADING}\n{_NEW_WORKSPACE}"

    label = f"`{name}`" if name else "the project"
    lines = [_HEADING, f"Target: existing project {label}."]
    if ptype in _APK_TYPES:
        lines.append(f"Detected type: {ptype}. This project builds an APK, so "
                     "a `build` step and an emulator test are valid here.")
    elif ptype:
        lines.append(_NOT_ANDROID)
    return ("\n".join(lines)
            + f"\n\n# Project structure (top two levels)\n{summary}")
