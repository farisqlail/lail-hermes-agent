"""Wake-word detection for the native tray helper.

Runs openWakeWord over a live microphone so "Hey Ev" can start a conversation
with the browser tab closed. Kept out of tray.py so the decision logic — when a
score should actually fire — is testable without a sound card or a model.

Two optional dependencies, both guarded: openwakeword (the model) and
sounddevice (the mic). available() reports whether the feature can run at all;
the tray helper degrades to a manual hotkey when it cannot.
"""
from __future__ import annotations
import threading
from typing import Callable, Optional

# openWakeWord's native frame: 80 ms of 16 kHz mono PCM. Feeding it this exact
# size keeps its internal melspectrogram buffer aligned; odd sizes still work
# but waste a resample.
SAMPLE_RATE = 16000
FRAME_SAMPLES = 1280


class WakeUnavailable(RuntimeError):
    """openwakeword or sounddevice is not installed. Carries the install hint."""


def available() -> bool:
    """True when both optional deps import. Cheap: loads no model and opens no
    device, so the tray helper can probe it at startup."""
    try:
        import openwakeword  # noqa: F401
        import sounddevice  # noqa: F401
    except ImportError:
        return False
    return True


class WakeGate:
    """Turns a stream of per-frame scores into fire / don't-fire decisions.

    Pure and deterministic so it can be unit-tested. Two rules:

    * Rising edge only — a score that stays above the threshold across many
      frames (one long "Hey Ev") fires once, on the crossing, not every frame.
    * Cooldown — after a fire, ignore everything until `cooldown_ms` has passed,
      so a word that wobbles around the threshold cannot double-trigger.

    Time is passed in rather than read from a clock, so tests drive it directly.
    """

    def __init__(self, threshold: float, cooldown_ms: int) -> None:
        self.threshold = threshold
        self.cooldown_ms = cooldown_ms
        self._above = False
        self._last_fire_ms: Optional[int] = None

    def reset(self) -> None:
        self._above = False
        self._last_fire_ms = None

    def push(self, score: float, now_ms: int) -> bool:
        """Feed one frame's score at time `now_ms`. Returns True exactly on the
        frame that should trigger the wake action."""
        was_above = self._above
        self._above = score >= self.threshold

        # Only the low→high crossing is a candidate; staying high is not.
        if not (self._above and not was_above):
            return False

        if self._last_fire_ms is not None and \
                now_ms - self._last_fire_ms < self.cooldown_ms:
            return False

        self._last_fire_ms = now_ms
        return True


def _resolve_model_arg(model: str):
    """A bundled openWakeWord name is passed through; a filesystem path is used
    as-is. Returns the argument list for Model(wakeword_models=...)."""
    import os
    if model and (os.path.sep in model or model.endswith((".onnx", ".tflite"))):
        return [model]
    return [model] if model else []


class WakeWordListener:
    """Owns the microphone and the model. Calls `on_wake` from the audio thread
    whenever the wake word is detected; the callback must be cheap and
    thread-safe (post to a queue, do not block on I/O).

    Not covered by the unit tests — it is device and model plumbing. The
    decision it delegates to WakeGate is what the tests exercise.
    """

    def __init__(
        self,
        on_wake: Callable[[], None],
        model: str = "hey_jarvis",
        threshold: float = 0.5,
        cooldown_ms: int = 2000,
    ) -> None:
        self._on_wake = on_wake
        self._model_name = model
        self._gate = WakeGate(threshold, cooldown_ms)
        self._model = None
        self._stream = None
        self._lock = threading.Lock()
        self._elapsed_ms = 0

    def _load(self):
        """Import and build the model on first start. Downloads the bundled
        models once if they are missing — a no-op on later runs."""
        try:
            from openwakeword.model import Model
            import openwakeword
        except ImportError as e:
            raise WakeUnavailable(
                "openwakeword belum terinstal. Jalankan: "
                "pip install -e .[desktop]") from e

        try:
            openwakeword.utils.download_models()
        except Exception:
            # Already present, or offline with a custom path model — the Model
            # constructor is the real check, and it raises usefully.
            pass

        args = _resolve_model_arg(self._model_name)
        return Model(wakeword_models=args) if args else Model()

    def start(self) -> None:
        """Open the mic and begin detecting. Raises WakeUnavailable if the deps
        are missing; other errors (no input device) propagate from sounddevice."""
        with self._lock:
            if self._stream is not None:
                return
            try:
                import sounddevice as sd
            except ImportError as e:
                raise WakeUnavailable(
                    "sounddevice belum terinstal. Jalankan: "
                    "pip install -e .[desktop]") from e

            self._model = self._load()
            self._gate.reset()
            self._elapsed_ms = 0

            def _callback(indata, frames, time_info, status):  # noqa: ARG001
                # indata is int16 mono. openWakeWord returns {name: score}; the
                # highest score across loaded models is what we gate on, so a
                # single-model and an all-models load behave the same.
                self._elapsed_ms += int(frames * 1000 / SAMPLE_RATE)
                try:
                    scores = self._model.predict(indata[:, 0])
                except Exception:
                    return
                top = max(scores.values()) if scores else 0.0
                if self._gate.push(top, self._elapsed_ms):
                    self._on_wake()

            self._stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="int16",
                blocksize=FRAME_SAMPLES,
                callback=_callback,
            )
            self._stream.start()

    def stop(self) -> None:
        with self._lock:
            if self._stream is not None:
                self._stream.stop()
                self._stream.close()
                self._stream = None
            self._model = None

    @property
    def running(self) -> bool:
        return self._stream is not None
