"""Windows tray helper: the ears that stay alive when the browser is closed.

Run as its own process: ``python -m hermes.tray``. It shows a tray icon whose
colour tracks the assistant's voice state (idle / listen / think / speak), runs
the wake word in the background, and — when "Hey Ev" fires with no tab open —
opens the dashboard so the browser can take over the conversation.

It talks to the running Hermes server over HTTP (the same 127.0.0.1:8799 the
web UI uses); it does not import the app. pystray and Pillow are optional deps,
guarded so importing this module never hard-fails; the small decision helpers
are kept free of them so they can be unit-tested.
"""
from __future__ import annotations
import json
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from typing import Callable, Optional

from . import config

SERVER = "http://127.0.0.1:8799"
DASHBOARD_URL = SERVER + "/"
POLL_INTERVAL_S = 0.6

# Tray-icon colour per voice state. Matches the web indicator so the two read as
# one system: grey idle, green listening, amber thinking, blue speaking.
STATE_COLOR = {
    "idle": (110, 120, 135),
    "listen": (60, 190, 110),
    "think": (240, 170, 40),
    "speak": (70, 150, 255),
}
STATE_LABEL = {
    "idle": "Siaga",
    "listen": "Mendengar",
    "think": "Berpikir",
    "speak": "Berbicara",
}


def state_color(state: str) -> tuple[int, int, int]:
    """Colour for a voice state, falling back to idle grey for an unknown one so
    a new server-side state never crashes the tray."""
    return STATE_COLOR.get(state, STATE_COLOR["idle"])


def handle_wake(post_wake: Callable[[], bool], open_browser: Callable[[], None]) -> None:
    """What to do when the wake word fires. `post_wake` tells the server and
    returns whether a browser is online; if none is, open one so it can pick up
    the pending wake and start recording. Split out so the open-if-offline rule
    is testable without a real detector or browser."""
    browser_online = post_wake()
    if not browser_online:
        open_browser()


# ── HTTP helpers (stdlib only, so the tray needs no requests dependency) ──

def _post_json(path: str, payload: Optional[dict] = None) -> Optional[dict]:
    data = json.dumps(payload or {}).encode()
    req = urllib.request.Request(
        SERVER + path, data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=2) as resp:
            return json.loads(resp.read() or b"{}")
    except (urllib.error.URLError, OSError, ValueError):
        return None


def _get_json(path: str) -> Optional[dict]:
    try:
        with urllib.request.urlopen(SERVER + path, timeout=2) as resp:
            return json.loads(resp.read() or b"{}")
    except (urllib.error.URLError, OSError, ValueError):
        return None


def _post_wake() -> bool:
    """Announce a wake to the server. Returns whether a browser is online (False
    on any network error, so a dead server means "open a browser")."""
    reply = _post_json("/api/voice/wake")
    return bool(reply and reply.get("browser_online"))


class TrayApp:
    """Owns the pystray icon, the state-poll thread, and the wake listener."""

    def __init__(self) -> None:
        self._icon = None
        self._poll_thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._listener = None
        self._state = "idle"

    # -- icon image, built lazily so a headless import needs no Pillow --
    def _image(self, state: str):
        from PIL import Image, ImageDraw
        size = 64
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse([8, 8, size - 8, size - 8], fill=state_color(state) + (255,))
        return img

    def _set_state(self, state: str) -> None:
        if state == self._state or self._icon is None:
            return
        self._state = state
        self._icon.icon = self._image(state)
        self._icon.title = f"Hermes — {STATE_LABEL.get(state, state)}"

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            reply = _get_json("/api/voice/state")
            if reply and "state" in reply:
                self._set_state(reply["state"])
            self._stop.wait(POLL_INTERVAL_S)

    def _on_wake(self) -> None:
        handle_wake(_post_wake, lambda: webbrowser.open(DASHBOARD_URL))

    def _start_listener(self) -> None:
        from . import wakeword, paths
        if not wakeword.available():
            return
        s = config.load_settings()
        if not s.wakeword_enabled:
            return
        # The spoken phrase follows the agent's name: "auto" turns "Jarvis" into
        # the bundled hey_jarvis, or any other name into a trained
        # hey_<name>.onnx in the wakewords dir.
        model = wakeword.resolve_model(
            s.agent_name, s.wakeword_model, paths.wakewords_dir())
        if not model:
            # No bundled match and no custom model trained yet. Leave the wake
            # word off; the manual "Picu" menu item still starts a capture.
            phrase = wakeword.expected_phrase(s.agent_name)
            print(f"[tray] wake word off: no model for '{phrase}'. Train "
                  f"hey_{wakeword.wake_slug(s.agent_name)}.onnx into "
                  f"{paths.wakewords_dir()}, or set wakeword_model explicitly.")
            return
        self._listener = wakeword.WakeWordListener(
            on_wake=self._on_wake,
            model=model,
            threshold=s.wakeword_threshold,
            cooldown_ms=s.wakeword_cooldown_ms,
        )
        try:
            self._listener.start()
        except Exception:
            # No input device, or a bad model path — the tray still runs, with
            # the manual "Picu" menu item as the fallback trigger.
            self._listener = None

    def _menu(self):
        import pystray
        from . import wakeword
        phrase = wakeword.expected_phrase(config.load_settings().agent_name)
        return pystray.Menu(
            pystray.MenuItem("Buka Dashboard",
                             lambda: webbrowser.open(DASHBOARD_URL),
                             default=True),
            pystray.MenuItem(f"Picu ({phrase})", lambda: self._on_wake()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Keluar", self._quit),
        )

    def _quit(self, *_args) -> None:
        self._stop.set()
        if self._listener is not None:
            self._listener.stop()
        if self._icon is not None:
            self._icon.stop()

    def run(self) -> None:
        import pystray
        self._icon = pystray.Icon(
            "hermes", self._image("idle"), "Hermes — Siaga", self._menu())
        self._poll_thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._poll_thread.start()
        self._start_listener()
        self._icon.run()


def main() -> None:
    try:
        import pystray  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError:
        raise SystemExit(
            "Tray butuh pystray + Pillow. Jalankan: pip install -e .[desktop]")
    TrayApp().run()


if __name__ == "__main__":
    main()
