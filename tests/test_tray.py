"""Tray decision helpers. The pystray icon and the mic are not tested — the two
pure helpers (open-if-offline, colour fallback) are."""
from hermes import tray


def test_handle_wake_opens_browser_when_offline():
    opened = []
    tray.handle_wake(post_wake=lambda: False, open_browser=lambda: opened.append(1))
    assert opened == [1]


def test_handle_wake_leaves_browser_alone_when_online():
    opened = []
    tray.handle_wake(post_wake=lambda: True, open_browser=lambda: opened.append(1))
    assert opened == []


def test_state_color_known_states_differ():
    colors = {tray.state_color(s) for s in ("idle", "listen", "think", "speak")}
    assert len(colors) == 4


def test_state_color_unknown_falls_back_to_idle():
    assert tray.state_color("nonsense") == tray.state_color("idle")
