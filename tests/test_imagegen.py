"""Image generation through the OpenAI-compatible gateway."""
import base64

from hermes import imagegen

# 1x1 transparent PNG
_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


def _reply(content):
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


def test_extract_image_pulls_data_uri():
    b64 = base64.b64encode(_PNG).decode()
    ext, raw = imagegen.extract_image(f"here ![img](data:image/png;base64,{b64})")
    assert ext == "png"
    assert raw == _PNG


def test_extract_image_normalises_jpeg():
    b64 = base64.b64encode(_PNG).decode()
    ext, _ = imagegen.extract_image(f"data:image/jpeg;base64,{b64}")
    assert ext == "jpg"


def test_extract_image_none_when_no_image():
    assert imagegen.extract_image("just text, no picture") is None


def test_generate_saves_file(tmp_path, monkeypatch):
    b64 = base64.b64encode(_PNG).decode()
    monkeypatch.setattr(imagegen, "_post",
                        lambda *a, **k: _reply(f"![x](data:image/png;base64,{b64})"))
    res = imagegen.generate("a red circle", base_url="http://x/v1", key="k",
                            model="m", out_dir=tmp_path / "gen")
    assert res["status"] == "generated"
    p = tmp_path / "gen"
    saved = list(p.glob("*.png"))
    assert len(saved) == 1
    assert saved[0].read_bytes() == _PNG


def test_generate_empty_prompt_is_error(tmp_path):
    res = imagegen.generate("  ", base_url="http://x/v1", key="k", model="m",
                            out_dir=tmp_path)
    assert res["status"] == "error"


def test_generate_reports_missing_image(tmp_path, monkeypatch):
    monkeypatch.setattr(imagegen, "_post", lambda *a, **k: _reply("sorry, only text"))
    res = imagegen.generate("x", base_url="http://x/v1", key="k", model="m",
                            out_dir=tmp_path)
    assert res["status"] == "error"
    assert "text" in res


def test_generate_swallows_network_error(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise OSError("connection refused")
    monkeypatch.setattr(imagegen, "_post", boom)
    res = imagegen.generate("x", base_url="http://x/v1", key="k", model="m",
                            out_dir=tmp_path)
    assert res["status"] == "error"
    assert "connection refused" in res["error"]
