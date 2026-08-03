"""Open a URL in the machine's default browser — and nothing else.

One entry point so no code path can drift into launching a specific browser
(Chrome, Edge) instead of whatever the user set as their Windows default. The
user runs Arc as their default; opening links must honour that.

Why not just `webbrowser.open`: its `_tryorder` can end up preferring a
concrete browser it discovered (Edge/Chrome on PATH) over the OS default. On
Windows `os.startfile(url)` goes straight through ShellExecute, which obeys the
exact same http/https UserChoice association a clicked link does — i.e. the
real default browser. That is the behaviour we want, guaranteed.

An explicit `HERMES_BROWSER` (or the conventional `BROWSER`) env var still wins,
for a user who deliberately wants a different browser than their OS default.
"""
from __future__ import annotations

import os
import sys
import webbrowser


def open_default_browser(url: str) -> None:
    """Open `url` in the OS default browser. Never raises."""
    override = os.environ.get("HERMES_BROWSER") or os.environ.get("BROWSER")
    if override:
        try:
            webbrowser.get(override).open(url)
            return
        except Exception:
            # A bad override falls through to the OS default rather than failing
            # to open anything at all.
            pass

    if sys.platform.startswith("win"):
        try:
            os.startfile(url)  # type: ignore[attr-defined]  # Windows-only
            return
        except OSError:
            pass

    try:
        webbrowser.open(url)
    except Exception:
        pass
