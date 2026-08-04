import pytest

from hermes import mcp_integrate as mi


def test_classify_remote_url():
    link = mi.classify("https://mcp.notion.com/mcp")
    assert link.kind == "remote" and link.url == "https://mcp.notion.com/mcp"


def test_classify_github_and_npm_links_are_packages():
    assert mi.classify("https://github.com/owner/repo").kind == "package"
    assert mi.classify("https://www.npmjs.com/package/@cocal/x").kind == "package"


def test_classify_bare_package_name():
    link = mi.classify("@cocal/google-calendar-mcp")
    assert link.kind == "package" and link.package == "@cocal/google-calendar-mcp"


def test_classify_rejects_nonsense_with_a_readable_message():
    with pytest.raises(ValueError) as e:
        mi.classify("not a link at all!!")
    assert "link" in str(e.value).lower()


def test_remote_candidates_leaves_an_explicit_endpoint_alone():
    """A URL that already names its endpoint is used as-is; guessing extra
    paths against it only produces 404s in the log."""
    assert mi.remote_candidates("https://x.dev/mcp") == ["https://x.dev/mcp"]
    assert mi.remote_candidates("https://x.dev/sse") == ["https://x.dev/sse"]


def test_remote_candidates_expands_a_bare_host():
    assert mi.remote_candidates("https://x.dev") == [
        "https://x.dev", "https://x.dev/mcp", "https://x.dev/sse"]


def test_remote_candidates_does_not_double_a_trailing_slash():
    assert mi.remote_candidates("https://x.dev/") == [
        "https://x.dev", "https://x.dev/mcp", "https://x.dev/sse"]


def test_derive_name_from_host_and_package():
    assert mi.derive_name(mi.classify("https://mcp.notion.com/mcp"), set()) == "notion"
    assert mi.derive_name(mi.classify("@cocal/google-calendar-mcp"),
                          set()) == "google-calendar"


def test_derive_name_dedupes_against_taken_names():
    assert mi.derive_name(mi.classify("https://mcp.notion.com/mcp"),
                          {"notion"}) == "notion-2"
