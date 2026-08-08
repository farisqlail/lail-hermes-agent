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
    monkeypatch.setattr(ytclip, "_ensure_ffmpeg", lambda: None)

    r = ytclip.clip("https://www.youtube.com/watch?v=abc", start="0:05", end="0:10",
                    out_dir=tmp_path / "clips")
    assert r["status"] == "clipped"
    assert r["seconds"] == 5.0
    assert r["path"].endswith(".mp4")
    assert made["url"].endswith("abc")


def _fake_ydl_with_info(info):
    class FakeYDL:
        def __init__(self, opts):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download=False):
            return info

    fake = types.ModuleType("yt_dlp")
    fake.YoutubeDL = FakeYDL
    return fake


def test_suggest_window_picks_hottest_span(tmp_path, monkeypatch):
    # 20 buckets of 10s over a 200s video; heat concentrated at 100-140s.
    heat = [{"start_time": i * 10, "end_time": i * 10 + 10,
             "value": 1.0 if 10 <= i <= 13 else 0.0} for i in range(20)]
    info = {"duration": 200, "title": "T", "heatmap": heat}
    monkeypatch.setitem(sys.modules, "yt_dlp", _fake_ydl_with_info(info))
    monkeypatch.setattr(ytclip, "_ensure_ffmpeg", lambda: None)
    r = ytclip.suggest_window("https://youtu.be/x", max_seconds=90)
    assert r["status"] == "suggested"
    # the 90s window maximising heat must cover the 100-140s hot band
    assert r["start"] <= 100 and r["end"] >= 140
    assert r["end"] - r["start"] <= 90


def test_suggest_window_errors_without_heatmap(monkeypatch):
    info = {"duration": 200, "title": "T", "heatmap": []}
    monkeypatch.setitem(sys.modules, "yt_dlp", _fake_ydl_with_info(info))
    monkeypatch.setattr(ytclip, "_ensure_ffmpeg", lambda: None)
    r = ytclip.suggest_window("https://youtu.be/x")
    assert r["status"] == "error"


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
    monkeypatch.setattr(ytclip, "_ensure_ffmpeg", lambda: None)

    r = ytclip.clip("https://youtu.be/x", start=0, end=5, out_dir=tmp_path)
    assert r["status"] == "error" and "unavailable" in r["error"].lower()
