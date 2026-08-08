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
import subprocess
import uuid
from pathlib import Path

# Accepts the common YouTube host shapes plus generic http(s); yt-dlp itself is
# the real validator, this just rejects obvious non-URLs early.
_URL_RE = re.compile(r"^https?://\S+$", re.I)

# 9:16 reformat filters for Shorts/Reels/TikTok, on a 1080x1920 canvas.
#  - blur: the whole frame stays visible, scaled to fit, over a scaled+blurred
#          copy of itself — the standard "vertical with blurred bars" look.
#  - crop: a centre 9:16 slice, filling the screen but cutting the sides.
_VERTICAL = {
    "blur": ("-filter_complex",
             "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
             "crop=1080:1920,boxblur=20:5[bg];"
             "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg];"
             "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[outv]"),
    "crop": ("-vf",
             "crop='min(iw,ih*9/16)':ih,scale=1080:1920,setsar=1"),
}

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


def suggest_window(url: str, *, max_seconds: float = 60.0, timeout: int = 60) -> dict:
    """Pick the most viral-looking window of a video, from YouTube's own
    "most replayed" heatmap.

    The heatmap buckets the video into ~100 slices, each with a replay `value`
    in [0,1]. The hottest contiguous span is the segment viewers rewatch most —
    the best proxy for "goes viral" available without downloading and analysing
    the footage. Returns {"status":"suggested","start","end","reason","title"}
    or {"status":"error",...} (e.g. a video with no heatmap).
    """
    windows, info, err = _analyse(url, n=1, max_seconds=max_seconds, timeout=timeout)
    if err:
        return {"status": "error", "error": err}
    w = windows[0]
    return {"status": "suggested", "start": w["start"], "end": w["end"],
            "title": info.get("title") or "",
            "reason": "bagian yang paling banyak diputar ulang (most replayed)"}


def _extract_info(url: str, timeout: int):
    from yt_dlp import YoutubeDL
    # Prime ffmpeg on PATH before the first extractor run: yt-dlp caches ffmpeg
    # availability there, and a later clip() would inherit a cached "missing".
    _ensure_ffmpeg()
    with YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True,
                    "noplaylist": True, "socket_timeout": timeout}) as ydl:
        return ydl.extract_info(url, download=False)


def _windows_from_heatmap(heat: list, duration: float, n: int,
                          win: float) -> list[dict]:
    """Top-`n` non-overlapping windows of length `win`, hottest first by replay
    heat, returned in time order. Greedy: take the highest-scoring window, bar
    everything it overlaps, repeat."""
    buckets = sorted(heat, key=lambda h: h.get("start_time", 0))
    width = (buckets[0].get("end_time", 0) - buckets[0].get("start_time", 0)) or (
        duration / len(buckets))
    k = max(1, round(win / width))
    vals = [float(b.get("value") or 0) for b in buckets]
    scored = sorted(
        ((sum(vals[i:i + k]), i) for i in range(0, max(1, len(buckets) - k + 1))),
        reverse=True)
    chosen, used = [], []
    for score, i in scored:
        if len(chosen) >= n:
            break
        if any(i < b and i + k > a for a, b in used):   # overlaps a taken window
            continue
        used.append((i, i + k))
        start = float(buckets[i].get("start_time", 0))
        if start + win > duration:
            start = max(0.0, duration - win)
        chosen.append({"start": round(start, 1),
                       "end": round(min(start + win, duration), 1),
                       "score": round(score, 3)})
    chosen.sort(key=lambda w: w["start"])
    return chosen


def _analyse(url: str, *, n: int, max_seconds: float, timeout: int):
    """(windows, info, error). Shared by suggest_window(s) and viral_candidates."""
    url = (url or "").strip()
    if not _URL_RE.match(url):
        return None, None, "URL tidak valid"
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return None, None, "yt-dlp belum terpasang"
    try:
        info = _extract_info(url, timeout)
    except Exception as ex:
        return None, None, str(ex)[:300]
    duration = float(info.get("duration") or 0)
    heat = info.get("heatmap") or []
    if not heat or duration <= 0:
        return None, info, ("video ini tidak punya data 'most replayed' — "
                            "sebutkan waktu mulai & selesai manual")
    win = min(max_seconds, duration)
    return _windows_from_heatmap(heat, duration, n, win), info, None


def suggest_windows(url: str, *, n: int = 3, max_seconds: float = 60.0,
                    timeout: int = 60) -> dict:
    """Top-`n` viral-looking windows (most-replayed), newest-first by time."""
    windows, info, err = _analyse(url, n=n, max_seconds=max_seconds, timeout=timeout)
    if err:
        return {"status": "error", "error": err}
    return {"status": "suggested", "title": info.get("title") or "",
            "windows": windows}


def _transcript_segments(info: dict) -> list[tuple[float, str]]:
    """Timed transcript lines [(start_s, text)] from the video's captions, or [].

    Prefers manual subs, falls back to auto-captions; Indonesian then English.
    Fetches the json3 caption track directly — no file writes. Best-effort: any
    failure yields [], and titling simply proceeds without a transcript."""
    import urllib.request

    tracks = {**(info.get("automatic_captions") or {}),
              **(info.get("subtitles") or {})}   # manual wins on key collision
    fmts = None
    for lang in ("id", "en", "a.id", "a.en", "en-US", "en-GB"):
        if tracks.get(lang):
            fmts = tracks[lang]
            break
    if not fmts:
        return []
    j3 = next((f for f in fmts if f.get("ext") == "json3"), None) or fmts[0]
    url = j3.get("url")
    if not url:
        return []
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.loads(r.read().decode())
    except Exception:
        return []
    out = []
    for ev in data.get("events", []):
        segs = ev.get("segs")
        if not segs:
            continue
        text = "".join(s.get("utf8", "") for s in segs).strip()
        if text:
            out.append((float(ev.get("tStartMs", 0)) / 1000.0, text))
    return out


def _snippet(segments: list[tuple[float, str]], start: float, end: float,
             limit: int = 700) -> str:
    """The transcript text spoken within [start, end]."""
    return " ".join(t for ts, t in segments if start <= ts < end).strip()[:limit]


def viral_title(base_url: str, key: str, model: str, *, video_title: str,
                snippet: str, start: float, timeout: int = 40) -> str:
    """A short catchy clip title from the LLM, or "" on any failure.

    Uses the same gateway as the chat agent. Best-effort: no key, no model, or a
    network error just yields no title and the caller falls back to a template.
    """
    if not (base_url and key and model):
        return ""
    ctx = f"Judul video: {video_title}\n"
    if snippet:
        ctx += f"Transkrip bagian ini: {snippet}\n"
    else:
        ctx += f"(tanpa transkrip; bagian pada detik {int(start)})\n"
    prompt = (ctx + "\nBuat SATU judul pendek yang menarik/clickbait wajar untuk "
              "klip pendek (Shorts/Reels) dari bagian ini, maksimal 8 kata, "
              "bahasa Indonesia, tanpa tanda kutip. Keluarkan judulnya saja.")
    try:
        # local import to avoid a hard dependency cycle; imagegen owns the POST.
        from . import imagegen
        data = imagegen._post(base_url, key, model, prompt, timeout)
        title = (data["choices"][0]["message"]["content"] or "").strip()
        return title.splitlines()[0].strip(' "\'')[:120]
    except Exception:
        return ""


def viral_clip(url: str, *, max_seconds: float = 60.0, out_dir: Path,
               vertical: str = "blur", timeout: int = 300) -> dict:
    """Find the most-replayed window of a video and cut it into a clip.

    `vertical` defaults to "blur": a viral clip is for Shorts/Reels, which want
    9:16. Pass "none" to keep the source aspect."""
    sug = suggest_window(url, max_seconds=max_seconds, timeout=min(timeout, 120))
    if sug.get("status") != "suggested":
        return sug
    res = clip(url, start=sug["start"], end=sug["end"], out_dir=out_dir,
               vertical=vertical, timeout=timeout)
    if res.get("status") == "clipped":
        res.update(start=sug["start"], end=sug["end"],
                   reason=sug["reason"], title=sug["title"])
    return res


def viral_candidates(url: str, *, n: int = 3, max_seconds: float = 60.0,
                     out_dir: Path, base_url: str = "", key: str = "",
                     model: str = "", do_clip: bool = True,
                     vertical: str = "blur", timeout: int = 300) -> dict:
    """Top-`n` viral candidates: each a most-replayed window with an LLM title
    and (by default) a cut clip.

    Returns {"status":"ok","video_title","candidates":[{start,end,title,path?},...]}
    or {"status":"error",...}. Titling and clipping are per-candidate best-effort
    — a candidate whose clip fails is dropped, but the rest still come back.
    """
    windows, info, err = _analyse(url, n=n, max_seconds=max_seconds,
                                  timeout=min(timeout, 120))
    if err:
        return {"status": "error", "error": err}
    video_title = info.get("title") or ""
    segments = _transcript_segments(info)
    out = []
    for w in windows:
        snip = _snippet(segments, w["start"], w["end"])
        title = viral_title(base_url, key, model, video_title=video_title,
                            snippet=snip, start=w["start"]) or \
            f"{video_title} — momen {_fmt(w['start'])}"
        cand = {"start": w["start"], "end": w["end"], "title": title,
                "reason": "paling banyak diputar ulang (most replayed)"}
        if do_clip:
            res = clip(url, start=w["start"], end=w["end"], out_dir=out_dir,
                       vertical=vertical, timeout=timeout)
            if res.get("status") != "clipped":
                continue                       # skip a candidate we could not cut
            cand["path"] = res["path"]
        out.append(cand)
    if not out:
        return {"status": "error", "error": "tidak ada kandidat yang berhasil dibuat"}
    return {"status": "ok", "video_title": video_title, "candidates": out}


def _fmt(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 60}:{s % 60:02d}"


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


def _ffmpeg_exe() -> str | None:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _to_vertical(src: Path, mode: str, timeout: int) -> Path | None:
    """Re-encode `src` to a 1080x1920 (9:16) mp4 for Shorts/Reels/TikTok, and
    replace the original. Returns the new path, or None if it could not (unknown
    mode, no ffmpeg, or a failed run) — the caller then keeps the source clip."""
    spec = _VERTICAL.get(mode)
    exe = _ffmpeg_exe()
    if spec is None or exe is None:
        return None
    flag, filt = spec
    out = src.with_name(src.stem + "_v.mp4")
    cmd = [exe, "-y", "-i", str(src), flag, filt]
    if mode == "blur":
        cmd += ["-map", "[outv]", "-map", "0:a?"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode == 0 and out.exists() and out.stat().st_size > 0:
        src.unlink(missing_ok=True)
        return out
    out.unlink(missing_ok=True)
    return None


def clip(url: str, *, start, end, out_dir: Path, vertical: str = "none",
         timeout: int = 300) -> dict:
    """Download the [start, end] segment of `url` and save it as one mp4.

    `vertical` reframes the clip for vertical platforms: "blur" (whole frame on a
    blurred 9:16 canvas), "crop" (centre 9:16 slice), or "none" (keep source
    aspect). A reformat failure falls back to the source clip, never an error.

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
    path = files[0]
    if vertical in _VERTICAL:
        v = _to_vertical(path, vertical, timeout)
        if v is not None:
            path = v
    return {"status": "clipped", "path": str(path), "seconds": round(e - s, 1),
            "vertical": vertical if path.name.endswith("_v.mp4") else "none"}
