"""Text-to-speech synthesis for Hermes using edge-tts.
"""
from __future__ import annotations
import asyncio
from pathlib import Path

DEFAULT_VOICE = "id-ID-ArdiNeural"
FALLBACK_VOICE = "en-US-AndrewMultilingualNeural"

def available() -> bool:
    """True when edge-tts is installed and usable."""
    try:
        import edge_tts  # noqa: F401
        return True
    except ImportError:
        return False

async def synthesize(text: str, out_path: Path | str, voice: str | None = None) -> str:
    """Synthesize plain text to an MP3 file using edge-tts."""
    import edge_tts
    chosen_voice = voice or DEFAULT_VOICE
    out_p = Path(out_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    # Strip markdown and action tags from spoken audio
    import re
    clean = re.sub(r"\[Action:\s*[^\|\]]+\s*\|\s*[^\]]+\]", "", text)
    clean = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", clean)
    clean = re.sub(r"[*_`#~]", "", clean).strip()
    if not clean:
        clean = "Tugas selesai."
    # Limit length to avoid excessively long audio notes
    clean = clean[:600]
    communicate = edge_tts.Communicate(clean, chosen_voice)
    await communicate.save(str(out_p))
    return str(out_p)
