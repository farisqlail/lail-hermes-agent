"""Cut a clip out of a YouTube (or other yt-dlp-supported) video.

yt-dlp fetches only the requested range (`download_ranges`), and the ffmpeg that
ships inside the `imageio-ffmpeg` wheel does the cut — so no system ffmpeg is
required. Like imagegen, this never raises: every failure comes back as
{"status": "error", ...} for the chat dispatch to report.

Downloading from YouTube can violate its Terms of Service; this is for content
the operator is entitled to clip (their own, licensed, or fair use).
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

# Accepts the common YouTube host shapes plus generic http(s); yt-dlp itself is
# the real validator, this just rejects obvious non-URLs early.
_URL_RE = re.compile(r"^https?://\S+$", re.I)

#: A clip longer than this is almost certainly a mistake (and a large download),
#: so it is refused rather than silently fetched.
MAX_CLIP_SECONDS = 600


def parse_timestamp(v) -> float | None:
    """Seconds from a number or an "HH:MM:SS" / "MM:SS" / "SS" string, or None."""
    if isinstance(v, (int, float)):
        return float(v) if v >= 0 else None
    s = str(v or "").strip()
    if not s:
        return None
    try:
        parts = [float(p) for p in s.split(":")]
    except ValueError:
        return None
    if not 1 <= len(parts) <= 3 or any(p < 0 for p in parts):
        return None
    secs = 0.0
    for p in parts:            # left-to-right: [h,]m,s
        secs = secs * 60 + p
    return secs


def suggest_window(url: str, *, max_seconds: float = 90.0, timeout: int = 60) -> dict:
    """Pick the most viral-looking window of a video, from YouTube's own
    "most replayed" heatmap.

    The heatmap buckets the video into ~100 slices, each with a replay `value`
    in [0,1]. The hottest contiguous span is the segment viewers rewatch most —
    the best proxy for "goes viral" available without downloading and analysing
    the footage. Returns {"status":"suggested","start","end","reason","title"}
    or {"status":"error",...} (e.g. a video with no heatmap).
    """
    url = (url or "").strip()
    if not _URL_RE.match(url):
        return {"status": "error", "error": "URL tidak valid"}
    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        return {"status": "error", "error": "yt-dlp belum terpasang"}
    # Prime ffmpeg on PATH before the first extractor run: yt-dlp caches ffmpeg
    # availability there, and a later clip() would inherit a cached "missing".
    _ensure_ffmpeg()
    try:
        with YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True,
                        "noplaylist": True, "socket_timeout": timeout}) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as ex:
        return {"status": "error", "error": str(ex)[:300]}

    duration = float(info.get("duration") or 0)
    heat = info.get("heatmap") or []
    if not heat or duration <= 0:
        return {"status": "error",
                "error": "video ini tidak punya data 'most replayed' — "
                         "sebutkan waktu mulai & selesai manual"}

    buckets = sorted(heat, key=lambda h: h.get("start_time", 0))
    width = (buckets[0].get("end_time", 0) - buckets[0].get("start_time", 0)) or (
        duration / len(buckets))
    win = min(max_seconds, duration)
    k = max(1, round(win / width))                 # buckets per window
    vals = [float(b.get("value") or 0) for b in buckets]

    best_i, best_sum = 0, -1.0
    for i in range(0, max(1, len(buckets) - k + 1)):
        total = sum(vals[i:i + k])
        if total > best_sum:
            best_sum, best_i = total, i
    start = float(buckets[best_i].get("start_time", 0))
    if start + win > duration:                     # keep the full window inside the video
        start = max(0.0, duration - win)
    end = min(start + win, duration)
    return {"status": "suggested", "start": round(start, 1), "end": round(end, 1),
            "title": info.get("title") or "",
            "reason": "bagian yang paling banyak diputar ulang (most replayed)"}


def viral_clip(url: str, *, max_seconds: float = 90.0, out_dir: Path,
               timeout: int = 300) -> dict:
    """Find the most-replayed window of a video and cut it into a clip.

    One call: analyse (suggest_window) then clip. Returns the clip result with
    the chosen `start`/`end`/`reason` folded in, or the analysis error.
    """
    sug = suggest_window(url, max_seconds=max_seconds, timeout=min(timeout, 120))
    if sug.get("status") != "suggested":
        return sug
    res = clip(url, start=sug["start"], end=sug["end"], out_dir=out_dir, timeout=timeout)
    if res.get("status") == "clipped":
        res.update(start=sug["start"], end=sug["end"],
                   reason=sug["reason"], title=sug["title"])
    return res


def _ensure_ffmpeg() -> str | None:
    """Make the bundled ffmpeg discoverable, and return its directory.

    Two problems, both handled here so it can be called before ANY YoutubeDL is
    built: yt-dlp locates ffmpeg by the exact base name `ffmpeg`, but the
    imageio-ffmpeg wheel ships `ffmpeg-win-x86_64-v7.1.exe` — so copy it once to
    a canonical sibling. And yt-dlp caches ffmpeg availability off PATH on the
    first extractor run, so the directory must be on PATH before that first run,
    not only before the download.
    """
    try:
        import imageio_ffmpeg
        exe = Path(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        return None
    canonical = exe.with_name("ffmpeg.exe" if exe.suffix else "ffmpeg")
    if not canonical.exists():
        try:
            import shutil
            shutil.copy2(exe, canonical)
        except OSError:
            canonical = exe                       # fall back to the shipped name
    d = str(canonical.parent)
    import os
    if d not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
    return d


def clip(url: str, *, start, end, out_dir: Path, timeout: int = 300) -> dict:
    """Download the [start, end] segment of `url` and save it as one mp4.

    Returns {"status": "clipped", "path": <file>, "seconds": <dur>} or
    {"status": "error", "error": <why>}.
    """
    url = (url or "").strip()
    if not _URL_RE.match(url):
        return {"status": "error", "error": "URL tidak valid"}
    s, e = parse_timestamp(start), parse_timestamp(end)
    if s is None or e is None:
        return {"status": "error", "error": "start/end tidak valid (pakai detik atau MM:SS)"}
    if e <= s:
        return {"status": "error", "error": "end harus lebih besar dari start"}
    if e - s > MAX_CLIP_SECONDS:
        return {"status": "error",
                "error": f"klip terlalu panjang (maks {MAX_CLIP_SECONDS} detik)"}
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import download_range_func
    except ImportError:
        return {"status": "error", "error": "yt-dlp belum terpasang"}

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stem = uuid.uuid4().hex
    opts = {
        "format": "mp4/bestvideo*+bestaudio/best",
        "outtmpl": str(out / f"{stem}.%(ext)s"),
        "download_ranges": download_range_func(None, [(s, e)]),
        "force_keyframes_at_cuts": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": timeout,
    }
    # _ensure_ffmpeg also puts it on PATH: yt-dlp's partial-download guard builds
    # an FFmpegPostProcessor without the options and checks PATH, so
    # ffmpeg_location alone is not enough.
    ff = _ensure_ffmpeg()
    if ff:
        opts["ffmpeg_location"] = ff
    try:
        with YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as ex:  # network, unavailable, geo-block — all reported
        return {"status": "error", "error": str(ex)[:300]}

    files = sorted(out.glob(f"{stem}.*"))
    if not files:
        return {"status": "error", "error": "klip gagal dibuat (tidak ada berkas keluaran)"}
    return {"status": "clipped", "path": str(files[0]), "seconds": round(e - s, 1)}
