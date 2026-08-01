"""WakeGate decision logic — the part of wake detection that has no sound card.

The listener's audio plumbing is untested by design; the gate it delegates to
is where the rules live (rising edge, cooldown), so that is what is pinned here.
"""
from hermes import wakeword
from hermes.wakeword import WakeGate


def test_fires_once_on_rising_edge_not_every_frame():
    gate = WakeGate(threshold=0.5, cooldown_ms=2000)
    # A single "Hey Ev" holds the score high across several frames.
    assert gate.push(0.2, 0) is False       # below
    assert gate.push(0.8, 80) is True        # crossing -> fire
    assert gate.push(0.9, 160) is False      # still high, no re-fire
    assert gate.push(0.7, 240) is False


def test_refires_after_dropping_and_cooldown_elapsed():
    gate = WakeGate(threshold=0.5, cooldown_ms=2000)
    assert gate.push(0.9, 0) is True
    assert gate.push(0.1, 80) is False       # drop below, arms next edge
    # Second genuine call, comfortably past the cooldown.
    assert gate.push(0.9, 2100) is True


def test_cooldown_blocks_a_second_edge_too_soon():
    gate = WakeGate(threshold=0.5, cooldown_ms=2000)
    assert gate.push(0.9, 0) is True
    assert gate.push(0.1, 80) is False       # drop
    # New edge, but inside the cooldown window -> suppressed.
    assert gate.push(0.9, 1000) is False
    # Once the window passes, the still-armed edge can fire again.
    assert gate.push(0.1, 1100) is False
    assert gate.push(0.9, 2200) is True


def test_reset_clears_edge_and_cooldown():
    gate = WakeGate(threshold=0.5, cooldown_ms=5000)
    assert gate.push(0.9, 0) is True
    gate.reset()
    # After reset the first high frame is a fresh rising edge, cooldown forgotten.
    assert gate.push(0.9, 100) is True


def test_threshold_is_inclusive():
    gate = WakeGate(threshold=0.5, cooldown_ms=0)
    assert gate.push(0.5, 0) is True


def test_zero_cooldown_allows_back_to_back_edges():
    gate = WakeGate(threshold=0.5, cooldown_ms=0)
    assert gate.push(0.9, 0) is True
    assert gate.push(0.1, 1) is False
    assert gate.push(0.9, 2) is True


def test_resolve_model_arg_distinguishes_name_from_path():
    # A bundled name passes through as a one-element list.
    assert wakeword._resolve_model_arg("hey_jarvis") == ["hey_jarvis"]
    # A path (has a separator or a model extension) is used verbatim.
    assert wakeword._resolve_model_arg("hey_ev.onnx") == ["hey_ev.onnx"]
    assert wakeword._resolve_model_arg("models/hey_ev.tflite") == \
        ["models/hey_ev.tflite"]
    # Empty means "load all bundled models" -> no explicit arg.
    assert wakeword._resolve_model_arg("") == []
