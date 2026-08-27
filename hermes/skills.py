"""SKILL.md read/write and trusted-tap install — the agentskills.io open file
shape (frontmatter + markdown body), the same format Claude's own skills use.
Storing skills as real SKILL.md files (not a blob in config.json) means a
skill authored here is portable to any other agent that speaks the format,
and a file from anthropics/skills or openai/skills drops in unmodified.

Frontmatter parsing is deliberately minimal — flat `key: value` lines, no
YAML dependency. Every real SKILL.md checked (anthropics/skills) uses exactly
that shape; a file with nested/list frontmatter still parses, those extra
fields just are not read back out (only name/description are).
"""
from __future__ import annotations
import re
import shutil
import time
from html import unescape
from pathlib import Path

import httpx

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)

# Repos whose SKILL.md we install without a security scanner (none exists in
# this codebase yet — see docs on Skills Guard for what a real one looks
# like). Trusted by the same reasoning the real Hermes Agent's "trusted"
# tier uses: these are the vendor-published official skill repos, not
# arbitrary community content.
TRUSTED_TAPS = frozenset({
    "anthropics/skills", "openai/skills", "nvidia/skills", "huggingface/skills",
})


def parse_skill_md(text: str) -> dict:
    """{'name', 'description', 'content'} from a SKILL.md's frontmatter and
    body. A file with no frontmatter still loads — name/description come
    back empty and the whole text is the content."""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {"name": "", "description": "", "content": text.strip()}
    front, body = m.group(1), m.group(2)
    fields: dict[str, str] = {}
    for line in front.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return {"name": fields.get("name", ""), "description": fields.get("description", ""),
            "content": body.strip()}


def render_skill_md(name: str, description: str, content: str) -> str:
    # Flat one-line frontmatter, matching every real SKILL.md checked — a
    # colon or newline in name/description would break this parser's own
    # read side, so callers keep those single-line and simple.
    return f"---\nname: {name}\ndescription: {description}\n---\n\n{content}\n"


def _skill_dir(base: Path, skill_id: str) -> Path:
    return base / skill_id


def _skill_md_path(base: Path, skill_id: str) -> Path:
    return _skill_dir(base, skill_id) / "SKILL.md"


def read_skill_file(base: Path, skill_id: str) -> dict | None:
    p = _skill_md_path(base, skill_id)
    if not p.exists():
        return None
    return parse_skill_md(p.read_text(encoding="utf-8"))


def write_skill_file(base: Path, skill_id: str, name: str, description: str, content: str) -> None:
    d = _skill_dir(base, skill_id)
    d.mkdir(parents=True, exist_ok=True)
    _skill_md_path(base, skill_id).write_text(
        render_skill_md(name, description, content), encoding="utf-8")


def delete_skill_file(base: Path, skill_id: str) -> None:
    d = _skill_dir(base, skill_id)
    if d.exists():
        shutil.rmtree(d)


AGENTICSKILLS_LIST_URL = "https://agenticskills.io/skills"
_BROWSER_UA = {"User-Agent": "Mozilla/5.0"}

# agenticskills.io has no public API — this parses the server-rendered SEO
# fallback list (a plain <li><a>Name</a> — Description</li> per skill),
# confirmed present for all ~191 catalog entries as of 2026-08-27. Unofficial
# and fragile by nature: it breaks the moment that markup changes, with no
# contract backing it. Every caller degrades to [] / a clear error rather
# than raising into a crashed settings page.
_CATALOG_ITEM_RE = re.compile(
    r'<li><a href="https://agenticskills\.io/skills/([\w-]+)">([^<]*)</a>\s*—\s*([^<]*)</li>')
# The detail page's embedded Next.js RSC payload names the skill's own
# GitHub source once, under "skillContent" — unlike the plain githubUrl
# field, this key does not also appear on the "related skills" sidebar
# entries, so it cannot accidentally resolve to the wrong repo. The quotes
# come through backslash-escaped in the page as actually served (it's a
# JSON string nested inside the RSC stream's own JSON) — every `\\?` below
# matches that escaped form or a plain one, since which it is has changed
# under us once already without any other markup change.
_SOURCE_RE = re.compile(
    r'\\?"skillContent\\?":\{\\?"markdown\\?":\\?"[^"\\]*\\?",'
    r'\\?"sourcePath\\?":\\?"([^"\\]+)\\?",\\?"branch\\?":\\?"([^"\\]+)\\?"')

_catalog_cache: dict = {"items": None, "at": 0.0}
_CATALOG_TTL_S = 3600


async def fetch_agenticskills_catalog(force: bool = False) -> list[dict]:
    """[{'slug','name','description'}] for the whole agenticskills.io
    catalog. Cached in-process for _CATALOG_TTL_S — a settings tab opened
    repeatedly must not hammer a third-party site on every click.
    force=True bypasses the cache. Returns [] (or the last good cache, if
    any) on any fetch/parse failure — see module docstring above."""
    now = time.monotonic()
    if not force and _catalog_cache["items"] is not None and now - _catalog_cache["at"] < _CATALOG_TTL_S:
        return _catalog_cache["items"]
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
            r = await c.get(AGENTICSKILLS_LIST_URL, headers=_BROWSER_UA)
            r.raise_for_status()
            body = r.text
    except Exception:
        return _catalog_cache["items"] or []
    items = [{"slug": m.group(1), "name": unescape(m.group(2)), "description": unescape(m.group(3))}
             for m in _CATALOG_ITEM_RE.finditer(body)]
    if items:
        _catalog_cache["items"] = items
        _catalog_cache["at"] = now
        return items
    return _catalog_cache["items"] or []


async def fetch_agenticskills_skill(slug: str) -> dict:
    """Resolve one agenticskills.io catalog entry to its real SKILL.md, by
    way of the community GitHub repo its detail page names.

    Community-sourced, not vendor-published like TRUSTED_TAPS — callers
    must install the result disabled (Skill.enabled=False) until the
    operator has actually looked at it, since no scanner here vets
    arbitrary repos. Raises ValueError if the detail page's structure
    changes and the source can no longer be located.
    """
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
        r = await c.get(f"https://agenticskills.io/skills/{slug}", headers=_BROWSER_UA)
        r.raise_for_status()
        detail_html = r.text
    m = _SOURCE_RE.search(detail_html)
    if not m:
        raise ValueError(f"tidak menemukan sumber GitHub untuk skill: {slug}")
    source_path, branch = m.group(1), m.group(2)
    owner, repo, *rest = source_path.split("/")
    raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{'/'.join(rest)}"
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
        r = await c.get(raw_url)
        r.raise_for_status()
        return parse_skill_md(r.text)


async def fetch_github_skill(tap: str, skill_path: str) -> dict:
    """Fetch and parse a SKILL.md from a trusted GitHub tap's `main` branch.

    Raises ValueError for anything outside TRUSTED_TAPS — this is the whole
    safety boundary for GitHub installs until this codebase has a real
    Skills Guard scanner; do not widen it without one.
    """
    if tap not in TRUSTED_TAPS:
        raise ValueError(f"tap tidak dipercaya: {tap}")
    url = f"https://raw.githubusercontent.com/{tap}/main/{skill_path}/SKILL.md"
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
        r = await c.get(url)
        r.raise_for_status()
        return parse_skill_md(r.text)
