import base64
import pytest

from hermes import uploads

PNG = b"\x89PNG\r\n\x1a\n" + b"rest of the file"
JPEG = b"\xff\xd8\xff\xe0" + b"jfif"
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"vp8"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def test_sniff_accepts_the_raster_formats_models_read():
    assert uploads.sniff(PNG) == ("png", "image/png")
    assert uploads.sniff(JPEG) == ("jpg", "image/jpeg")
    assert uploads.sniff(WEBP) == ("webp", "image/webp")
    assert uploads.sniff(b"GIF89a...")[0] == "gif"


def test_sniff_rejects_svg_and_anything_else():
    """An SVG served from the dashboard's own origin runs its script with the
    operator's session. The name means nothing; the bytes decide."""
    for data in (SVG, b"not an image at all", b"", b"MZ\x90\x00"):
        with pytest.raises(uploads.UnsupportedImage):
            uploads.sniff(data)


def test_save_names_the_file_itself(tmp_path):
    """The browser filename is the one field an attacker fully controls: it can
    collide, and it can carry a path."""
    name, mime = uploads.save(tmp_path, "conv-1", PNG)
    assert name.endswith(".png") and "/" not in name and "\\" not in name
    assert mime == "image/png"
    assert (tmp_path / "conv-1" / name).read_bytes() == PNG


def test_save_refuses_an_oversized_image(tmp_path):
    with pytest.raises(ValueError) as e:
        uploads.save(tmp_path, "conv-1", PNG + b"x" * uploads.MAX_UPLOAD_BYTES)
    assert "besar" in str(e.value)


def test_save_refuses_a_conversation_id_that_escapes(tmp_path):
    with pytest.raises(ValueError):
        uploads.save(tmp_path, "../elsewhere", PNG)
    assert not (tmp_path.parent / "elsewhere").exists()


def test_resolve_returns_none_for_anything_it_cannot_vouch_for(tmp_path):
    name, _ = uploads.save(tmp_path, "conv-1", PNG)
    assert uploads.resolve(tmp_path, "conv-1", name) is not None
    # another conversation's file, a traversal, a discarded name, junk
    assert uploads.resolve(tmp_path, "conv-2", name) is None
    assert uploads.resolve(tmp_path, "conv-1", "../conv-1/" + name) is None
    assert uploads.resolve(tmp_path, "conv-1", "gone.png") is None
    assert uploads.resolve(tmp_path, "..", name) is None


def test_content_parts_inline_the_bytes(tmp_path):
    """Providers cannot reach a path on this machine, so the image travels in
    the request as a data URL."""
    name, _ = uploads.save(tmp_path, "conv-1", PNG)
    path = uploads.resolve(tmp_path, "conv-1", name)
    parts = uploads.as_content_parts("apa ini?", [path])
    assert parts[0] == {"type": "text", "text": "apa ini?"}
    url = parts[1]["image_url"]["url"]
    assert url.startswith("data:image/png;base64,")
    assert base64.b64decode(url.split(",", 1)[1]) == PNG


def test_discard_removes_the_files_and_tolerates_a_missing_one(tmp_path):
    name, _ = uploads.save(tmp_path, "conv-1", PNG)
    path = uploads.resolve(tmp_path, "conv-1", name)
    uploads.discard([path, tmp_path / "conv-1" / "never-existed.png"])
    assert not path.exists()
