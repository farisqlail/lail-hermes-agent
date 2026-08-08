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


def _ffmpeg_dir() -> str | None:
    """A directory containing an executable named `ffmpeg.exe`/`ffmpeg`.

    yt-dlp locates ffmpeg by that exact base name, but the imageio-ffmpeg wheel
    ships it as `ffmpeg-win-x86_64-v7.1.exe`. So copy it once to a canonically
    named sibling and hand yt-dlp the directory."""
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
            return str(exe.parent)  # fall back; yt-dlp may still find it
    return str(canonical.parent)


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
    ff = _ffmpeg_dir()
    if ff:
        opts["ffmpeg_location"] = ff
        # yt-dlp's partial-download guard checks ffmpeg via PATH (it builds an
        # FFmpegPostProcessor without the options), so ffmpeg_location alone is
        # not enough — put the bundled binary's dir on PATH for this process.
        import os
        if ff not in os.environ.get("PATH", "").split(os.pathsep):
            os.environ["PATH"] = ff + os.pathsep + os.environ.get("PATH", "")
    try:
        with YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as ex:  # network, unavailable, geo-block — all reported
        return {"status": "error", "error": str(ex)[:300]}

    files = sorted(out.glob(f"{stem}.*"))
    if not files:
        return {"status": "error", "error": "klip gagal dibuat (tidak ada berkas keluaran)"}
    return {"status": "clipped", "path": str(files[0]), "seconds": round(e - s, 1)}
