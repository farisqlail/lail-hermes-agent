import io
import pytest
from hermes import stt


class FakeSegment:
    def __init__(self, text):
        self.text = text


class FakeModel:
    """Stands in for faster_whisper.WhisperModel. Records what it was asked
    to do so the tests can assert on the call, and returns a generator the
    way the real transcribe() does."""

    def __init__(self):
        self.calls = []

    def transcribe(self, audio, language=None, vad_filter=False,
                   hotwords=None, condition_on_previous_text=True):
        self.calls.append({"audio": audio, "language": language,
                           "vad_filter": vad_filter, "hotwords": hotwords,
                           "condition_on_previous_text": condition_on_previous_text})
        return (s for s in [FakeSegment(" Halo"), FakeSegment(" dunia.")]), None


@pytest.fixture
def fake_model(monkeypatch):
    model = FakeModel()
    # _load_model now takes a model_size argument; swallow it in the fake.
    monkeypatch.setattr(stt, "_load_model", lambda *a, **k: model)
    return model


def test_resolve_size_defaults_and_validates():
    assert stt._resolve_size(None) == "base"
    assert stt._resolve_size("small") == "small"
    assert stt._resolve_size("SMALL") == "small"       # case-insensitive
    assert stt._resolve_size("bogus") == "base"        # unknown -> default
    assert stt._resolve_size("") == "base"


def test_transcribe_forwards_model_size(monkeypatch):
    seen = []
    monkeypatch.setattr(stt, "_load_model",
                        lambda size=None: seen.append(size) or FakeModel())
    stt.transcribe(b"fake-webm-bytes", model_size="small")
    assert seen == ["small"]


def test_transcribe_joins_segments_and_strips(fake_model):
    assert stt.transcribe(b"fake-webm-bytes") == "Halo dunia."


def test_transcribe_passes_language_and_enables_vad(fake_model):
    stt.transcribe(b"fake-webm-bytes", language="en")
    call = fake_model.calls[0]
    assert call["language"] == "en"
    assert call["vad_filter"] is True


def test_transcribe_biases_toward_hotwords(fake_model):
    # The base model mishears proper nouns like "Jarvis" in Indonesian audio.
    # hotwords must reach the decoder or the bias does nothing.
    stt.transcribe(b"fake-webm-bytes")
    assert fake_model.calls[0]["hotwords"] == stt.HOTWORDS


def test_transcribe_accepts_a_custom_hotwords_string(fake_model):
    # The caller passes the agent name + project names; that must override the
    # built-in default, not be appended to it silently.
    stt.transcribe(b"fake-webm-bytes", hotwords="Jarvis sayur sayurPos")
    assert fake_model.calls[0]["hotwords"] == "Jarvis sayur sayurPos"


def test_transcribe_disables_cross_segment_conditioning(fake_model):
    # Each recording is one isolated utterance; conditioning on previous text is
    # what feeds whisper's short-audio repetition loop.
    stt.transcribe(b"fake-webm-bytes")
    assert fake_model.calls[0]["condition_on_previous_text"] is False


def test_build_hotwords_dedups_and_drops_empties():
    out = stt.build_hotwords(["Jarvis", "sayur", "", "sayur", "sayurPos"])
    words = out.split()
    assert words[0] == "Jarvis"                 # built-in leads
    assert words.count("sayur") == 1            # deduped
    assert "sayurPos" in words
    assert "" not in words
    # None / no extras still yields at least the built-in bias.
    assert stt.build_hotwords() == stt.HOTWORDS
    assert stt.build_hotwords([]) == stt.HOTWORDS


def test_transcribe_empty_language_means_autodetect(fake_model):
    # Whisper's own contract: language=None asks it to detect. An empty
    # setting string must not be forwarded as the literal language "".
    stt.transcribe(b"fake-webm-bytes", language="")
    assert fake_model.calls[0]["language"] is None


def test_transcribe_wraps_bytes_in_a_file_object(fake_model):
    # faster-whisper accepts a path, a file-like object or a numpy array.
    # Bytes are not in that set, so stt must wrap them.
    stt.transcribe(b"fake-webm-bytes")
    assert isinstance(fake_model.calls[0]["audio"], io.BytesIO)


def test_transcribe_empty_audio_returns_empty_without_loading(monkeypatch):
    def explode():
        raise AssertionError("must not load the model for empty audio")
    monkeypatch.setattr(stt, "_load_model", explode)
    assert stt.transcribe(b"") == ""


def test_transcribe_rejects_oversized_audio(monkeypatch):
    def explode():
        raise AssertionError("must not load the model for oversized audio")
    monkeypatch.setattr(stt, "_load_model", explode)
    with pytest.raises(ValueError, match="terlalu besar"):
        stt.transcribe(b"x" * (stt.MAX_AUDIO_BYTES + 1))


def test_load_model_without_faster_whisper_raises_sttunavailable(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def no_faster_whisper(name, *args, **kwargs):
        if name == "faster_whisper":
            raise ImportError("No module named 'faster_whisper'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_faster_whisper)
    stt._reset_model_for_tests()
    with pytest.raises(stt.SttUnavailable, match=r"\[voice\]"):
        stt._load_model()


def test_available_is_false_without_faster_whisper(monkeypatch):
    import builtins
    real_import = builtins.__import__

    def no_faster_whisper(name, *args, **kwargs):
        if name == "faster_whisper":
            raise ImportError("No module named 'faster_whisper'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_faster_whisper)
    assert stt.available() is False


def test_is_loaded_false_before_first_transcribe():
    stt._reset_model_for_tests()
    assert stt.is_loaded() is False
