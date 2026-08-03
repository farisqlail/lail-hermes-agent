"""open_default_browser must always target the OS default, never a specific
browser, unless the user set an explicit override env var."""
import sys
import unittest.mock as mock

import pytest

from hermes import browser


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.delenv("BROWSER", raising=False)
    monkeypatch.delenv("HERMES_BROWSER", raising=False)


def test_windows_uses_os_startfile_not_a_named_browser(monkeypatch):
    """On Windows the OS default (Arc for this user) is reached via os.startfile
    — ShellExecute, the same association a clicked link uses — so no code path
    can substitute Chrome/Edge."""
    monkeypatch.setattr(sys, "platform", "win32")
    with mock.patch("os.startfile", create=True) as sf, \
         mock.patch("webbrowser.open") as wb:
        browser.open_default_browser("http://127.0.0.1:8799/")
    sf.assert_called_once_with("http://127.0.0.1:8799/")
    wb.assert_not_called()


def test_explicit_override_env_wins(monkeypatch):
    """A user who really wants a specific browser sets HERMES_BROWSER/BROWSER."""
    monkeypatch.setenv("HERMES_BROWSER", "firefox")
    with mock.patch("webbrowser.get") as get:
        browser.open_default_browser("http://x")
    get.assert_called_once_with("firefox")


def test_never_raises_when_everything_fails(monkeypatch):
    """A dead opener must not crash the caller (a tray click, a wake event)."""
    monkeypatch.setattr(sys, "platform", "win32")
    with mock.patch("os.startfile", create=True, side_effect=OSError), \
         mock.patch("webbrowser.open", side_effect=RuntimeError):
        browser.open_default_browser("http://x")  # must not raise
