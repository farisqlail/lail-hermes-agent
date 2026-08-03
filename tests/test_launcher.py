"""open_app is the ungated launch path: a known app or a URL opens directly, an
unknown name is refused (never guessed into an arbitrary command), and nothing
here may raise into the chat turn."""
import sys
import unittest.mock as mock

from hermes import launcher


def test_known_app_launches_via_startfile(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    with mock.patch("os.startfile", create=True) as sf:
        res = launcher.open_app("paint")
    sf.assert_called_once_with("mspaint")
    assert res["status"] == "opened"
    assert res["app"] == "mspaint"


def test_app_name_is_normalised(monkeypatch):
    """'MS  Paint' (case + extra space) still resolves to the same exe."""
    monkeypatch.setattr(sys, "platform", "win32")
    with mock.patch("os.startfile", create=True) as sf:
        launcher.open_app("  MS   Paint ")
    sf.assert_called_once_with("mspaint")


def test_url_goes_through_default_browser():
    """A URL must not be treated as an app — it delegates to open_default_browser
    so the OS default (Arc) is honoured."""
    with mock.patch("hermes.launcher.open_default_browser") as ob, \
         mock.patch("os.startfile", create=True) as sf:
        res = launcher.open_app("https://calendar.google.com/")
    ob.assert_called_once_with("https://calendar.google.com/")
    sf.assert_not_called()
    assert res["status"] == "opened"
    assert res["url"] == "https://calendar.google.com/"


def test_unknown_app_is_refused_not_launched(monkeypatch):
    """An unrecognised name never launches: the ungated path only opens the
    allow-list, so a raw string can't become a command."""
    monkeypatch.setattr(sys, "platform", "win32")
    with mock.patch("os.startfile", create=True) as sf:
        res = launcher.open_app("cmd; rm -rf /")
    sf.assert_not_called()
    assert res["status"] == "unknown_app"


def test_empty_target_is_error():
    assert launcher.open_app("")["status"] == "error"


def test_launch_failure_does_not_raise(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    with mock.patch("os.startfile", create=True, side_effect=OSError("boom")):
        res = launcher.open_app("notepad")  # must not raise
    assert res["status"] == "error"
