"""GitHub App auth + REST calls behind the `github_review_pr` chat tool.

Auth is a GitHub App, not a personal access token: the operator registers an
App, installs it on the target repo(s), and gives Hermes three values (App
ID, private key, installation ID — see Settings > Secrets). Every call mints
a short-lived JWT signed with the private key (RS256), trades it for a
per-installation access token (GitHub-issued, ~1h expiry, cached here), and
uses that token as the Bearer for the actual REST calls. See
https://docs.github.com/apps/creating-github-apps/authenticating-with-github-apps
for the flow this mirrors.

Read calls (get_pr, get_pr_diff, review_diff_with_llm) run freely, same as
any other read tool. post_pr_review is the one write call — chat_engine.py
never calls it directly from a model turn; it only runs from
ChatEngine.resolve_pending, after the operator approves the parked
PendingAction (see chat_engine.py's github_review_pr tool + native-pending
dispatch).
"""
from __future__ import annotations
import datetime as _dt
import json
import re
import time

import httpx
import jwt
from openai import AsyncOpenAI

GITHUB_API = "https://api.github.com"
_JWT_TTL_S = 540  # GitHub allows a max of 10 minutes; stay under with margin
_TOKEN_CACHE: dict[str, tuple[str, float]] = {}  # installation_id -> (token, expires_at epoch)


class GitHubAppError(Exception):
    """Raised for both misconfiguration and GitHub API failures — always
    caught at the chat-tool boundary and turned into a plain error string,
    never left to surface as a raw traceback in a chat reply."""


def _require(secrets) -> tuple[str, str, str]:
    app_id = (secrets.github_app_id or "").strip()
    private_key = (secrets.github_app_private_key or "").strip()
    installation_id = (secrets.github_app_installation_id or "").strip()
    if not (app_id and private_key and installation_id):
        raise GitHubAppError(
            "GitHub App belum dikonfigurasi — isi App ID, private key, dan "
            "installation ID di Settings > Secrets.")
    return app_id, private_key, installation_id


def _build_app_jwt(app_id: str, private_key: str) -> str:
    now = int(time.time())
    payload = {"iat": now - 60, "exp": now + _JWT_TTL_S, "iss": app_id}
    return jwt.encode(payload, private_key, algorithm="RS256")


async def _installation_token(secrets) -> str:
    app_id, private_key, installation_id = _require(secrets)
    cached = _TOKEN_CACHE.get(installation_id)
    if cached and cached[1] - 60 > time.time():
        return cached[0]
    try:
        app_jwt = _build_app_jwt(app_id, private_key)
    except Exception as e:
        raise GitHubAppError(f"Private key GitHub App tidak valid: {e}") from e
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{GITHUB_API}/app/installations/{installation_id}/access_tokens",
            headers={"Authorization": f"Bearer {app_jwt}",
                     "Accept": "application/vnd.github+json"})
    if resp.status_code >= 400:
        raise GitHubAppError(
            f"Gagal ambil installation token: {resp.status_code} {resp.text[:200]}")
    data = resp.json()
    token = data["token"]
    expires_at = _dt.datetime.fromisoformat(
        data["expires_at"].replace("Z", "+00:00")).timestamp()
    _TOKEN_CACHE[installation_id] = (token, expires_at)
    return token


# Accepts a full PR URL (github.com/owner/repo/pull/123, with or without a
# trailing slash/fragment) or the short 'owner/repo#123' form.
_PR_REF_RE = re.compile(
    r"(?:https?://github\.com/)?([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/pull)?[/#](\d+)")


def parse_pr_ref(ref: str) -> tuple[str, str, int]:
    ref = (ref or "").strip()
    m = _PR_REF_RE.search(ref)
    if not m:
        raise GitHubAppError(
            f"Tidak bisa membaca referensi PR: {ref!r} — pakai format "
            "'owner/repo#123' atau link penuh github.com/owner/repo/pull/123")
    return m.group(1), m.group(2), int(m.group(3))


async def get_pr(owner: str, repo: str, number: int, secrets) -> dict:
    token = await _installation_token(secrets)
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{number}",
            headers={"Authorization": f"Bearer {token}",
                     "Accept": "application/vnd.github+json"})
    if resp.status_code >= 400:
        raise GitHubAppError(f"Gagal ambil PR: {resp.status_code} {resp.text[:200]}")
    return resp.json()


async def get_pr_diff(owner: str, repo: str, number: int, secrets,
                      max_chars: int = 60_000) -> str:
    token = await _installation_token(secrets)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{number}",
            headers={"Authorization": f"Bearer {token}",
                     "Accept": "application/vnd.github.v3.diff"})
    if resp.status_code >= 400:
        raise GitHubAppError(f"Gagal ambil diff PR: {resp.status_code} {resp.text[:200]}")
    diff = resp.text
    if len(diff) > max_chars:
        diff = diff[:max_chars] + "\n\n... (diff dipotong, terlalu panjang untuk direview sekaligus)"
    return diff


async def post_pr_review(owner: str, repo: str, number: int, body: str,
                         event: str, secrets) -> str:
    """The one write call — only ever invoked from ChatEngine.resolve_pending
    after operator approval (see chat_engine.py's native-pending dispatch),
    never from a model turn directly."""
    if event not in ("COMMENT", "APPROVE", "REQUEST_CHANGES"):
        event = "COMMENT"
    token = await _installation_token(secrets)
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{number}/reviews",
            headers={"Authorization": f"Bearer {token}",
                     "Accept": "application/vnd.github+json"},
            json={"body": body, "event": event})
    if resp.status_code >= 400:
        raise GitHubAppError(f"Gagal posting review: {resp.status_code} {resp.text[:200]}")
    data = resp.json()
    return json.dumps({
        "status": "posted", "review_id": data.get("id"),
        "html_url": data.get("html_url"), "state": data.get("state"),
    }, ensure_ascii=False)


_REVIEW_SYSTEM = (
    "You are a senior software engineer doing a thorough, specific code review "
    "of a GitHub pull request diff. Read the diff below and write a review "
    "comment: call out real bugs, security issues, and correctness problems "
    "first; style/naming nits last and only if they're actually worth "
    "mentioning. Be concrete — reference the file and the specific change, "
    "not generic advice. If the diff looks solid, say so plainly instead of "
    "inventing nitpicks. End your comment with EXACTLY one line "
    "'VERDICT: APPROVE' or 'VERDICT: REQUEST_CHANGES' or 'VERDICT: COMMENT' "
    "— REQUEST_CHANGES only for real bugs/security issues that must be fixed "
    "before merge, APPROVE when it's genuinely fine, COMMENT otherwise "
    "(questions, suggestions, nothing blocking).\n\n"
    f"PR title: {{title}}\nPR description:\n{{description}}\n\nDiff:\n{{diff}}"
)

_VERDICT_RE = re.compile(r"VERDICT:\s*(APPROVE|REQUEST_CHANGES|COMMENT)\s*$", re.MULTILINE)


async def review_diff_with_llm(pr: dict, diff: str, settings, secrets) -> dict:
    """One LLM call producing the review body + a recommended verdict — same
    "separate extraction call" shape as office.py's
    _extract_meeting_followups, just for a diff instead of a transcript."""
    system = _REVIEW_SYSTEM.format(
        title=pr.get("title") or "", description=(pr.get("body") or "")[:2000], diff=diff)
    client = AsyncOpenAI(base_url=settings.nvidia_base_url, api_key=secrets.nvidia_api_key)
    resp = await client.chat.completions.create(
        model=settings.chat_model or settings.model,
        messages=[{"role": "system", "content": system},
                 {"role": "user", "content": "Write the review now."}],
        temperature=0.2,
    )
    text = (resp.choices[0].message.content or "").strip()
    m = _VERDICT_RE.search(text)
    event = m.group(1) if m else "COMMENT"
    body = _VERDICT_RE.sub("", text).strip() or text
    return {"body": body, "event": event}
