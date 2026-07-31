"""Speech-to-text for the web UI's voice input.

Kept out of web_ui.py so the model lifecycle can be tested without standing
up FastAPI. Nothing here knows about HTTP.
"""
from __future__ import annotations
import io
import threading

# base int8 on CPU. Indonesian is harder for small models than English, so if
# transcripts come back wrong on project names and technical terms, "small" is
# the next step up — a one-line change, at roughly triple the transcribe time
# and a ~500MB model download instead of ~145MB.
MODEL_SIZE = "base"
DEVICE = "cpu"
COMPUTE_TYPE = "int8"

# A generous ceiling for a spoken instruction. Its job is to stop a runaway
# recorder from handing the model a file that exhausts memory, not to police
# ordinary use — a minute of opus is well under a megabyte.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


class SttUnavailable(RuntimeError):
    """faster-whisper is not installed. Carries the install command."""


_model = None
_model_lock = threading.Lock()


def available() -> bool:
    """True when the optional dependency is importable. Cheap: it does not
    load the model, so the status endpoint can call it on every request."""
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False
    return True


def is_loaded() -> bool:
    """True once a transcribe() call has paid the model-load cost."""
    return _model is not None


def _load_model():
    """The model is loaded once and reused. Loading reads ~145MB off disk and
    takes seconds; doing it per request would dwarf the transcription itself.
    The lock matters because transcribe() runs in a thread pool, so two
    concurrent first-requests would otherwise each build their own model."""
    global _model
    with _model_lock:
        if _model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as e:
                raise SttUnavailable(
                    "faster-whisper belum terinstal. Jalankan: "
                    "pip install -e .[voice]") from e
            _model = WhisperModel(MODEL_SIZE, device=DEVICE,
                                  compute_type=COMPUTE_TYPE)
    return _model


def _reset_model_for_tests() -> None:
    global _model
    with _model_lock:
        _model = None


def transcribe(audio: bytes, language: str = "id") -> str:
    """Blocking. Call it from a worker thread, never straight from an async
    endpoint. `audio` is whatever the browser's MediaRecorder produced —
    faster-whisper decodes it through av, so webm/opus needs no conversion
    and no ffmpeg binary."""
    if not audio:
        return ""
    if len(audio) > MAX_AUDIO_BYTES:
        raise ValueError(
            f"audio terlalu besar: {len(audio)} byte, maksimal "
            f"{MAX_AUDIO_BYTES}")

    model = _load_model()
    # vad_filter drops silence before it reaches the model: shorter audio,
    # faster transcription, and no phantom words invented out of room tone.
    segments, _info = model.transcribe(
        io.BytesIO(audio),
        language=language or None,
        vad_filter=True,
    )
    # transcribe() returns a generator — nothing runs until it is consumed.
    return "".join(segment.text for segment in segments).strip()
