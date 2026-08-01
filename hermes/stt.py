"""Speech-to-text for the web UI's voice input.

Kept out of web_ui.py so the model lifecycle can be tested without standing
up FastAPI. Nothing here knows about HTTP.
"""
from __future__ import annotations
import io
import threading

# The model size is a latency/accuracy trade the operator owns via Settings:
# "base" (~145MB) transcribes in roughly a third the time of "small" (~500MB) on
# CPU, which is the delay before the assistant can start replying. `base` is the
# default; hotwords (below) recover most of the proper-noun accuracy that a
# bigger model would buy. `tiny` is fastest/least accurate, `medium` the reverse.
DEFAULT_MODEL_SIZE = "base"
VALID_MODEL_SIZES = ("tiny", "base", "small", "medium", "large")
# Back-compat alias: the status endpoint and tests referenced this name before
# the size became configurable.
MODEL_SIZE = DEFAULT_MODEL_SIZE
DEVICE = "cpu"
COMPUTE_TYPE = "int8"

# A generous ceiling for a spoken instruction. Its job is to stop a runaway
# recorder from handing the model a file that exhausts memory, not to police
# ordinary use — a minute of opus is well under a megabyte.
MAX_AUDIO_BYTES = 25 * 1024 * 1024

# Proper nouns the base model has no reason to expect in Indonesian audio.
# Without a bias, "Jarvis" decodes to phonetic garbage ("Jarfish Jara Fis").
# hotwords nudges the decoder toward these spellings at no extra cost. Extend
# this as the assistant gains named tools or project names it mishears.
HOTWORDS = "Jarvis"


class SttUnavailable(RuntimeError):
    """faster-whisper is not installed. Carries the install command."""


# One model per size, so switching the setting does not throw away a loaded
# model that a later switch-back would need to rebuild.
_models: dict[str, object] = {}
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
    return bool(_models)


def _resolve_size(model_size: str | None) -> str:
    size = (model_size or DEFAULT_MODEL_SIZE).strip().lower()
    return size if size in VALID_MODEL_SIZES else DEFAULT_MODEL_SIZE


def _load_model(model_size: str | None = None):
    """The model is loaded once per size and reused. Loading reads 145MB+ off
    disk and takes seconds; doing it per request would dwarf the transcription
    itself. The lock matters because transcribe() runs in a thread pool, so two
    concurrent first-requests would otherwise each build their own model."""
    size = _resolve_size(model_size)
    with _model_lock:
        if size not in _models:
            try:
                from faster_whisper import WhisperModel
            except ImportError as e:
                raise SttUnavailable(
                    "faster-whisper belum terinstal. Jalankan: "
                    "pip install -e .[voice]") from e
            _models[size] = WhisperModel(size, device=DEVICE,
                                         compute_type=COMPUTE_TYPE)
    return _models[size]


def _reset_model_for_tests() -> None:
    with _model_lock:
        _models.clear()


def transcribe(audio: bytes, language: str = "id",
               model_size: str | None = None) -> str:
    """Blocking. Call it from a worker thread, never straight from an async
    endpoint. `audio` is whatever the browser's MediaRecorder produced —
    faster-whisper decodes it through av, so webm/opus needs no conversion
    and no ffmpeg binary. `model_size` picks the accuracy/latency trade; None
    uses DEFAULT_MODEL_SIZE."""
    if not audio:
        return ""
    if len(audio) > MAX_AUDIO_BYTES:
        raise ValueError(
            f"audio terlalu besar: {len(audio)} byte, maksimal "
            f"{MAX_AUDIO_BYTES}")

    model = _load_model(model_size)
    # vad_filter drops silence before it reaches the model: shorter audio,
    # faster transcription, and no phantom words invented out of room tone.
    segments, _info = model.transcribe(
        io.BytesIO(audio),
        language=language or None,
        vad_filter=True,
        hotwords=HOTWORDS,
    )
    # transcribe() returns a generator — nothing runs until it is consumed.
    return "".join(segment.text for segment in segments).strip()
