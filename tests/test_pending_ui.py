from hermes.pending_actions import PendingStore
from hermes.pending_ui import pending_text, keyboard, parse_callback


def test_pending_text_names_the_tool_and_args():
    pa = PendingStore().add("gmail__send_email", {"to": "x@y.z", "subject": "hi"}, "tg-5")
    text = pending_text(pa)
    assert "gmail: send_email" in text
    assert "x@y.z" in text


def test_keyboard_has_approve_and_decline_with_the_id():
    pa = PendingStore().add("gmail__send_email", {}, "tg-5")
    kb = keyboard(pa)
    datas = [b.callback_data for row in kb.inline_keyboard for b in row]
    assert f"pend:{pa.id}:yes" in datas
    assert f"pend:{pa.id}:no" in datas


def test_parse_callback_roundtrips():
    assert parse_callback("pend:p3:yes") == ("p3", True)
    assert parse_callback("pend:p3:no") == ("p3", False)


def test_parse_callback_rejects_garbage():
    assert parse_callback("") is None
    assert parse_callback("ask:p3:yes") is None
    assert parse_callback("pend:p3:maybe") is None
    assert parse_callback("pend::yes") is None
