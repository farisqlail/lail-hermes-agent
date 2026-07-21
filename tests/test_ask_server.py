import asyncio
import pytest
from hermes.ask import Ask, AskRegistry, NO_CHANNEL, NO_STREAM
from hermes import ask_server
from hermes.ask_server import resolve_ask, _norm_options, NEED_QUESTION


def _registry():
    r = AskRegistry()
    sent: list[Ask] = []
    async def on_ask(a): sent.append(a)
    r.on_ask = on_ask
    return r, sent


# ---- _norm_options ---------------------------------------------------------

def test_norm_options_keeps_label_and_description():
    assert _norm_options([{"label": "Riverpod", "description": "reactive"}]) == \
        [{"label": "Riverpod", "description": "reactive"}]


def test_norm_options_accepts_bare_strings():
    """A model that skips the object wrapper still gets tappable buttons."""
    assert _norm_options(["Riverpod", "Bloc"]) == \
        [{"label": "Riverpod"}, {"label": "Bloc"}]


def test_norm_options_drops_empty_and_labelless_entries():
    assert _norm_options([{"description": "no label"}, {"label": "  "}, "", "OK"]) == \
        [{"label": "OK"}]


def test_norm_options_tolerates_none():
    assert _norm_options(None) == []


# ---- resolve_ask -----------------------------------------------------------

async def test_resolve_ask_returns_no_stream_when_client_cannot_stream():
    """No progressToken: the call cannot be held open long enough to reach a
    human, so say so rather than start a wait nobody will see resolved."""
    r, _ = _registry()
    token = r.open_run("t1", 5)
    assert await resolve_ask(r, token, "Q?", [{"label": "A"}], False,
                             can_stream=False) == NO_STREAM


async def test_resolve_ask_unknown_token_degrades_to_no_channel():
    r, _ = _registry()
    assert await resolve_ask(r, "never-opened", "Q?", [{"label": "A"}], False,
                             can_stream=True) == NO_CHANNEL


async def test_resolve_ask_rejects_a_blank_question():
    r, _ = _registry()
    token = r.open_run("t1", 5)
    assert await resolve_ask(r, token, "   ", [{"label": "A"}], False,
                             can_stream=True) == NEED_QUESTION


async def test_resolve_ask_resolves_with_the_operators_choice():
    r, sent = _registry()
    token = r.open_run("t1", 5)
    task = asyncio.create_task(
        resolve_ask(r, token, "Riverpod atau Bloc?",
                    [{"label": "Riverpod"}, {"label": "Bloc"}], False,
                    can_stream=True))
    await asyncio.sleep(0.01)
    assert r.answer_options(sent[0].ask_id, [1])
    assert await task == "User chose: Bloc"


async def test_resolve_ask_normalises_string_options_before_asking():
    r, sent = _registry()
    token = r.open_run("t1", 5)
    task = asyncio.create_task(
        resolve_ask(r, token, "Pick", ["Riverpod", "Bloc"], False, can_stream=True))
    await asyncio.sleep(0.01)
    assert [o["label"] for o in sent[0].options] == ["Riverpod", "Bloc"]
    r.answer_options(sent[0].ask_id, [0])
    await task


async def test_resolve_ask_beats_the_transport_while_waiting():
    """The heartbeat must fire while a human is thinking, or claude kills the
    tools/call at ~60s regardless of the registry's own longer timeout."""
    r, sent = _registry()
    token = r.open_run("t1", 5)
    beats = 0
    async def beat():
        nonlocal beats
        beats += 1
    task = asyncio.create_task(
        resolve_ask(r, token, "Q?", [{"label": "A"}], False, can_stream=True,
                    heartbeat=beat, interval=0.01))
    await asyncio.sleep(0.05)          # several intervals pass with no answer
    r.answer_options(sent[0].ask_id, [0])
    assert await task == "User chose: A"
    assert beats >= 1


async def test_resolve_ask_cancel_propagates_and_drops_the_ask():
    """A dropped MCP request must cancel the pending ask, not leak it — the
    registry must forget the chat so a later ask is not shadowed."""
    r, sent = _registry()
    token = r.open_run("t1", 5)
    async def beat(): pass
    task = asyncio.create_task(
        resolve_ask(r, token, "Q?", [{"label": "A"}], False, can_stream=True,
                    heartbeat=beat, interval=0.01))
    await asyncio.sleep(0.02)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0)
    assert r.pending_for_chat(5) is None
