"""YouTube clip cutting via yt-dlp + bundled ffmpeg."""
import sys
import types

import pytest

from hermes import ytclip


@pytest.mark.parametrize("val,expected", [
    (30, 30.0), ("30", 30.0), ("1:30", 90.0), ("1:00:00", 3600.0),
    ("0:05", 5.0), (2.5, 2.5),
])
def test_parse_timestamp_ok(val, expected):
    assert ytclip.parse_timestamp(val) == expected


@pytest.mark.parametrize("val", ["", None, "abc", "1:2:3:4", -5, "-3"])
def test_parse_timestamp_bad(val):
    assert ytclip.parse_timestamp(val) is None


def test_clip_rejects_bad_url(tmp_path):
    assert ytclip.clip("not a url", start=0, end=5, out_dir=tmp_path)["status"] == "error"


def test_clip_rejects_reversed_range(tmp_path):
    r = ytclip.clip("https://youtu.be/x", start=10, end=5, out_dir=tmp_path)
    assert r["status"] == "error" and "end" in r["error"]


def test_clip_rejects_overlong(tmp_path):
    r = ytclip.clip("https://youtu.be/x", start=0, end=ytclip.MAX_CLIP_SECONDS + 1,
                    out_dir=tmp_path)
    assert r["status"] == "error"


def test_clip_downloads_range_and_returns_file(tmp_path, monkeypatch):
    """yt-dlp is faked: it 'downloads' by writing the output file the real one
    would produce, so the range plumbing and file discovery are covered offline."""
    made = {}

    class FakeYDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def download(self, urls):
            made["url"] = urls[0]
            made["ranges"] = self.opts.get("download_ranges")
            # outtmpl is "<dir>/<stem>.%(ext)s" -> write "<stem>.mp4"
            tmpl = self.opts["outtmpl"]
            path = tmpl.replace("%(ext)s", "mp4")
            with open(path, "wb") as f:
                f.write(b"\x00\x00\x00\x18ftypmp42fake")

    fake = types.ModuleType("yt_dlp")
    fake.YoutubeDL = FakeYDL
    utils = types.ModuleType("yt_dlp.utils")
    utils.download_range_func = lambda a, b: ("ranges", a, b)
    fake.utils = utils
    monkeypatch.setitem(sys.modules, "yt_dlp", fake)
    monkeypatch.setitem(sys.modules, "yt_dlp.utils", utils)
    monkeypatch.setattr(ytclip, "_ffmpeg_dir", lambda: None)

    r = ytclip.clip("https://www.youtube.com/watch?v=abc", start="0:05", end="0:10",
                    out_dir=tmp_path / "clips")
    assert r["status"] == "clipped"
    assert r["seconds"] == 5.0
    assert r["path"].endswith(".mp4")
    assert made["url"].endswith("abc")


def test_clip_reports_yt_dlp_error(tmp_path, monkeypatch):
    class BoomYDL:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def download(self, urls):
            raise RuntimeError("Video unavailable")

    fake = types.ModuleType("yt_dlp")
    fake.YoutubeDL = BoomYDL
    utils = types.ModuleType("yt_dlp.utils")
    utils.download_range_func = lambda a, b: None
    fake.utils = utils
    monkeypatch.setitem(sys.modules, "yt_dlp", fake)
    monkeypatch.setitem(sys.modules, "yt_dlp.utils", utils)
    monkeypatch.setattr(ytclip, "_ffmpeg_dir", lambda: None)

    r = ytclip.clip("https://youtu.be/x", start=0, end=5, out_dir=tmp_path)
    assert r["status"] == "error" and "unavailable" in r["error"].lower()
