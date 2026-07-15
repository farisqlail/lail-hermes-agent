from __future__ import annotations
import re
from pathlib import Path
from .config import Settings, _NAME_CHAR, _PROJECT_NAME

# The first @name in the text is the project reference. Anchored to a word
# boundary on the left so "budi@example.com" is not a reference. The right
# anchor is "next char is not a name char", not "whitespace/end": with the
# latter, "@myprofit, fix" matched nothing and fell back *silently* to a
# fresh workspace with the sigil still in the planner text — while
# "@myprofit. fix" (dot is in the name charset) rejected *loudly*. An
# explicit sigil is explicit intent; its typos must always be loud. The name
# charset itself is _PROJECT_NAME from config, so the two cannot drift.
_REF = re.compile(rf"(?:^|(?<=\s))@({_PROJECT_NAME.pattern})(?!{_NAME_CHAR})")


class ProjectNotFound(Exception):
    """The @name is not a key in Settings.projects — probably a typo."""


class ProjectPathMissing(Exception):
    """The @name is registered, but its path is gone from disk."""


def parse_project_ref(text: str) -> tuple[str | None, str]:
    """Split a task text into (project name, text without the sigil).

    Only the first sigil is the reference; any later @word is left alone, so
    "@myprofit reply to @budi" keeps "@budi" as prose.
    """
    m = _REF.search(text)
    if m is None:
        return None, text
    cleaned = (text[:m.start()] + text[m.end():]).strip()
    return m.group(1), re.sub(r"\s{2,}", " ", cleaned)


def resolve_project(name: str, settings: Settings) -> Path:
    """Map a registry name to its directory.

    `name` is used only as a dict key — it is never joined onto a path — so a
    name like "../../etc" is an ordinary miss, not a traversal.
    """
    path = settings.projects.get(name)
    if path is None:
        known = ", ".join(sorted(settings.projects)) or None
        if known is None:
            raise ProjectNotFound(
                f"Project '@{name}' is not registered, and no projects are "
                f"registered yet. Add one in the settings UI at "
                f"http://127.0.0.1:8799, or drop the @ to start a new workspace.")
        raise ProjectNotFound(
            f"Project '@{name}' is not registered.\nRegistered: {known}\n"
            f"Drop the @ to start a new workspace instead.")
    p = Path(path)
    if not p.is_dir():
        raise ProjectPathMissing(
            f"Project '@{name}' is registered as {path}, but that directory is "
            f"gone. It was moved or deleted after being registered — fix the "
            f"path in the settings UI at http://127.0.0.1:8799.")
    return p
