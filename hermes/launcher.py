"""Open a desktop app (or a URL) directly — an ungated path for the chat agent.

Launching a program is normally a shell action, and the chat dispatch parks any
write/execute tool for operator confirmation (see web_ui + mcp_risk). That gate
exists so the model can never *arbitrarily* run a command. Opening a known,
harmless desktop app the user just asked for should not need a click, so this is
a deliberate narrow hole in that gate:

* the target is matched against a fixed `KNOWN_APPS` map — the model cannot pass
  a raw command line, so there is no injection surface even though it is ungated;
* an unrecognised app is refused, not guessed, so a new name can never quietly
  gain launch access (same posture as mcp_risk's gate-unknown default);
* a URL is delegated to `open_default_browser`, so it still honours the OS
  default browser (Arc for this user) rather than a named one.

Launch goes through `os.startfile` for the same reason `browser.py` does: it is
ShellExecute, which resolves an App-Paths name like ``mspaint`` and returns
immediately (no blocking on the child), and it never pops the wrong window.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

from .browser import open_default_browser

# Friendly name -> executable ShellExecute/PATH can resolve. Kept small and
# explicit: this is the whole allow-list for the ungated path. Add an entry to
# grant an app; never widen this to accept an arbitrary string.
KNOWN_APPS: dict[str, str] = {
    "paint": "mspaint", "mspaint": "mspaint", "ms paint": "mspaint",
    "notepad": "notepad", "notes": "notepad",
    "calculator": "calc", "calc": "calc", "kalkulator": "calc",
    "explorer": "explorer", "file explorer": "explorer", "files": "explorer",
    "wordpad": "write", "write": "write",
}

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


def _norm(target: str) -> str:
    return re.sub(r"\s+", " ", target.strip().lower())


def open_app(target: str) -> dict:
    """Open a known app, or a URL, for the user. Never raises.

    Returns a small dict the chat dispatch hands back to the model:
      {"status": "opened", "app"/"url": ...} on success,
      {"status": "unknown_app", ...} when the name is not in KNOWN_APPS.
    """
    target = (target or "").strip()
    if not target:
        return {"status": "error", "error": "target kosong"}

    if _URL_RE.match(target):
        open_default_browser(target)
        return {"status": "opened", "url": target}

    exe = KNOWN_APPS.get(_norm(target))
    if exe is None:
        return {"status": "unknown_app", "target": target,
                "known": sorted(set(KNOWN_APPS.values())),
                "note": "App tak ada di daftar aman. Belum dibuka."}

    if sys.platform.startswith("win"):
        try:
            os.startfile(exe)  # type: ignore[attr-defined]  # Windows-only
            return {"status": "opened", "app": exe}
        except OSError as e:
            return {"status": "error", "app": exe, "error": str(e)}

    try:
        subprocess.Popen([exe], stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
        return {"status": "opened", "app": exe}
    except OSError as e:
        return {"status": "error", "app": exe, "error": str(e)}
