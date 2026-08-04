"""Turn one pasted link into a working MCP server.

Adding a server by hand means already knowing the package name, its arguments,
and which environment variables it reads. This module works those out instead:
it probes the link, tries the transports in order, runs OAuth when the server
asks for it, and pauses for an API key when it asks for that.

Everything that reaches outside — progress, a question for the operator, a
browser — arrives as an injected callback, so the whole ladder runs in a test
with no network, no browser, and no model.
"""
from __future__ import annotations
import re
from dataclasses import dataclass
from urllib.parse import urlparse

TRANSPORTS = ("streamable-http", "sse")

# A URL that already names its MCP endpoint. Guessing further paths against one
# of these only fills the log with 404s.
_EXPLICIT_ENDPOINT = re.compile(r"/(mcp|sse)/?$", re.I)

_PACKAGE_HOSTS = {"github.com", "www.github.com",
                  "npmjs.com", "www.npmjs.com"}

# npm package name: optional @scope, then the name.
_BARE_PACKAGE = re.compile(r"^(@[a-z0-9][\w.-]*/)?[a-z0-9][\w.-]*$", re.I)


@dataclass
class Link:
    kind: str            # "remote" | "package"
    url: str = ""
    package: str = ""


def classify(link: str) -> Link:
    """Sort a pasted string into the two paths. Never touches the network."""
    text = (link or "").strip()
    if not text:
        raise ValueError("link kosong")
    if text.startswith(("http://", "https://")):
        host = (urlparse(text).hostname or "").lower()
        if host in _PACKAGE_HOSTS:
            return Link(kind="package", url=text, package=_package_from_url(text))
        return Link(kind="remote", url=text.rstrip("/") or text)
    if _BARE_PACKAGE.match(text):
        return Link(kind="package", package=text)
    raise ValueError(
        "bukan link yang dikenali — tempel URL server MCP (https://...), "
        "link GitHub/npm, atau nama paket npm")


def _package_from_url(url: str) -> str:
    """npm URLs carry the package name; GitHub URLs only carry owner/repo, and
    the real name lives in that repo's package.json — resolved later, over the
    network, not here."""
    parts = [p for p in urlparse(url).path.split("/") if p]
    host = (urlparse(url).hostname or "").lower()
    if "npmjs.com" in host and parts and parts[0] == "package":
        return "/".join(parts[1:])
    return ""


def remote_candidates(url: str) -> list[str]:
    base = url.rstrip("/")
    if _EXPLICIT_ENDPOINT.search(url):
        return [url.rstrip("/") if url.endswith("/") else url]
    return [base, f"{base}/mcp", f"{base}/sse"]


def derive_name(link: Link, taken) -> str:
    """A short id for the server list.

    Hosts lose their `mcp.` prefix and TLD, packages lose their scope and the
    `-mcp` suffix, because "notion" is what the operator will type, not
    "mcp.notion.com".
    """
    if link.kind == "remote":
        host = (urlparse(link.url).hostname or "server").lower()
        parts = [p for p in host.split(".") if p not in ("www", "mcp", "com",
                                                         "io", "dev", "ai",
                                                         "org", "net")]
        base = parts[0] if parts else "server"
    else:
        pkg = link.package or "server"
        base = pkg.split("/")[-1]
        base = re.sub(r"^(server|mcp)-|-(server|mcp)$", "", base)
    base = re.sub(r"[^a-z0-9-]", "-", base.lower()).strip("-") or "server"
    if base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"
