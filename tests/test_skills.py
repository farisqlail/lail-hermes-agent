import pytest
from hermes import skills


def test_parse_skill_md_extracts_frontmatter_and_body():
    text = (
        "---\n"
        "name: pdf\n"
        "description: Use this skill whenever the user wants to do anything with PDF files.\n"
        "license: Proprietary.\n"
        "---\n"
        "\n"
        "# PDF Processing Guide\n"
        "\n"
        "Some instructions here.\n"
    )
    result = skills.parse_skill_md(text)
    assert result["name"] == "pdf"
    assert result["description"] == "Use this skill whenever the user wants to do anything with PDF files."
    assert result["content"] == "# PDF Processing Guide\n\nSome instructions here."


def test_parse_skill_md_without_frontmatter_treats_whole_text_as_content():
    result = skills.parse_skill_md("Just plain instructions, no frontmatter.")
    assert result["name"] == ""
    assert result["description"] == ""
    assert result["content"] == "Just plain instructions, no frontmatter."


def test_render_skill_md_roundtrips_through_parse():
    rendered = skills.render_skill_md("Ringkasan Rapat", "Ringkas notulen jadi poin aksi.",
                                      "Baca transkrip, ekstrak keputusan dan PIC.")
    parsed = skills.parse_skill_md(rendered)
    assert parsed == {"name": "Ringkasan Rapat", "description": "Ringkas notulen jadi poin aksi.",
                      "content": "Baca transkrip, ekstrak keputusan dan PIC."}


def test_write_then_read_skill_file_roundtrips(tmp_path):
    skills.write_skill_file(tmp_path, "meeting-notes", "Ringkasan Rapat",
                            "Ringkas notulen.", "Isi instruksi lengkap.")
    result = skills.read_skill_file(tmp_path, "meeting-notes")
    assert result == {"name": "Ringkasan Rapat", "description": "Ringkas notulen.",
                      "content": "Isi instruksi lengkap."}


def test_read_skill_file_returns_none_when_missing(tmp_path):
    assert skills.read_skill_file(tmp_path, "does-not-exist") is None


def test_delete_skill_file_removes_the_whole_skill_directory(tmp_path):
    skills.write_skill_file(tmp_path, "temp-skill", "Temp", "desc", "content")
    assert skills.read_skill_file(tmp_path, "temp-skill") is not None
    skills.delete_skill_file(tmp_path, "temp-skill")
    assert skills.read_skill_file(tmp_path, "temp-skill") is None
    # deleting again (already gone) must not raise
    skills.delete_skill_file(tmp_path, "temp-skill")


async def test_fetch_github_skill_rejects_an_untrusted_tap():
    with pytest.raises(ValueError, match="tidak dipercaya"):
        await skills.fetch_github_skill("some-random/repo", "pdf")


async def test_fetch_agenticskills_catalog_parses_the_server_rendered_list(monkeypatch):
    html = (
        '<ul><li><a href="https://agenticskills.io/skills/taste-skill">Taste Skill</a> '
        '— Anti-slop frontend skill that infers a design direction.</li>'
        '<li><a href="https://agenticskills.io/skills/animate">Animate</a> '
        '— Builds an animation from scratch.</li></ul>'
    )

    class FakeResponse:
        text = html
        def raise_for_status(self):
            pass

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, url, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(skills.httpx, "AsyncClient", FakeAsyncClient)
    skills._catalog_cache["items"] = None
    skills._catalog_cache["at"] = 0.0

    items = await skills.fetch_agenticskills_catalog()
    assert items == [
        {"slug": "taste-skill", "name": "Taste Skill",
         "description": "Anti-slop frontend skill that infers a design direction."},
        {"slug": "animate", "name": "Animate",
         "description": "Builds an animation from scratch."},
    ]


async def test_fetch_agenticskills_catalog_caches_between_calls(monkeypatch):
    calls = []
    html = ('<li><a href="https://agenticskills.io/skills/a">A</a> — desc.</li>')

    class FakeResponse:
        text = html
        def raise_for_status(self):
            pass

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, url, **kwargs):
            calls.append(url)
            return FakeResponse()

    monkeypatch.setattr(skills.httpx, "AsyncClient", FakeAsyncClient)
    skills._catalog_cache["items"] = None
    skills._catalog_cache["at"] = 0.0

    await skills.fetch_agenticskills_catalog()
    await skills.fetch_agenticskills_catalog()
    assert len(calls) == 1, "second call within the TTL must not re-fetch"

    await skills.fetch_agenticskills_catalog(force=True)
    assert len(calls) == 2, "force=True must bypass the cache"


async def test_fetch_agenticskills_skill_resolves_the_github_source_and_fetches_content(monkeypatch):
    detail_html = (
        r'"skillContent":{"markdown":"$16","sourcePath":'
        r'"Leonxlnx/taste-skill/skills/taste-skill/SKILL.md","branch":"main",'
        r'"sha":"deadbeef"}'
    )
    raw_md = "---\nname: taste-skill\ndescription: Anti-slop frontend skill.\n---\n\nIsi panduan."

    class FakeDetailResponse:
        text = detail_html
        def raise_for_status(self):
            pass

    class FakeRawResponse:
        text = raw_md
        def raise_for_status(self):
            pass

    calls = []

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, url, **kwargs):
            calls.append(url)
            return FakeRawResponse() if "raw.githubusercontent.com" in url else FakeDetailResponse()

    monkeypatch.setattr(skills.httpx, "AsyncClient", FakeAsyncClient)

    result = await skills.fetch_agenticskills_skill("taste-skill")
    assert result == {"name": "taste-skill", "description": "Anti-slop frontend skill.",
                      "content": "Isi panduan."}
    assert calls == [
        "https://agenticskills.io/skills/taste-skill",
        "https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/skills/taste-skill/SKILL.md",
    ]


async def test_fetch_agenticskills_skill_handles_the_backslash_escaped_rsc_payload(monkeypatch):
    """The page as actually served nests skillContent inside the RSC
    stream's own JSON, so the quotes come through backslash-escaped
    (\\"skillContent\\":...) rather than plain — verified against a real
    fetch of agenticskills.io/skills/taste-skill on 2026-08-27. A fixture
    with plain quotes would not have caught this."""
    detail_html = (
        r'\"skillContent\":{\"markdown\":\"$16\",\"sourcePath\":'
        r'\"Leonxlnx/taste-skill/skills/taste-skill/SKILL.md\",\"branch\":\"main\",'
        r'\"sha\":\"deadbeef\"}'
    )
    raw_md = "---\nname: taste-skill\ndescription: Anti-slop frontend skill.\n---\n\nIsi panduan."

    class FakeDetailResponse:
        text = detail_html
        def raise_for_status(self):
            pass

    class FakeRawResponse:
        text = raw_md
        def raise_for_status(self):
            pass

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, url, **kwargs):
            return FakeRawResponse() if "raw.githubusercontent.com" in url else FakeDetailResponse()

    monkeypatch.setattr(skills.httpx, "AsyncClient", FakeAsyncClient)
    result = await skills.fetch_agenticskills_skill("taste-skill")
    assert result["name"] == "taste-skill"


async def test_fetch_agenticskills_skill_raises_when_source_not_found(monkeypatch):
    class FakeResponse:
        text = "<html>no skillContent here</html>"
        def raise_for_status(self):
            pass

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, url, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(skills.httpx, "AsyncClient", FakeAsyncClient)
    with pytest.raises(ValueError, match="tidak menemukan"):
        await skills.fetch_agenticskills_skill("ghost-skill")


async def test_fetch_github_skill_fetches_and_parses_from_a_trusted_tap(monkeypatch):
    calls = []

    class FakeResponse:
        text = ("---\nname: pdf\ndescription: Proses file PDF.\n---\n\nIsi panduan PDF.")
        def raise_for_status(self):
            pass

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, url):
            calls.append(url)
            return FakeResponse()

    monkeypatch.setattr(skills.httpx, "AsyncClient", FakeAsyncClient)
    result = await skills.fetch_github_skill("anthropics/skills", "skills/pdf")
    assert result == {"name": "pdf", "description": "Proses file PDF.", "content": "Isi panduan PDF."}
    assert calls == ["https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md"]
