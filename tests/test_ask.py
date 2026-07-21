import asyncio
import pytest
from hermes import ask as ask_mod
from hermes.ask import (
    Ask, AskRegistry, Deadline, BUDGET_SPENT, NO_ANSWER, NO_CHANNEL,
    format_choice, format_free_text)


class FakeClock:
    """A hand-cranked monotonic clock, so deadline tests never sleep."""
    def __init__(self): self.t = 0.0
    def __call__(self): return self.t
    def tick(self, secs): self.t += secs


def test_deadline_expires_after_its_budget():
    c = FakeClock()
    d = Deadline(10, clock=c)
    c.tick(9.9)
    assert not d.expired()
    c.tick(0.2)
    assert d.expired()


def test_paused_deadline_never_expires_however_long_the_human_takes():
    """The whole point: a step must not die because the operator went to lunch."""
    c = FakeClock()
    d = Deadline(10, clock=c)
    d.pause()
    c.tick(100000)
    assert not d.expired()


def test_resume_restores_only_the_time_that_was_left():
    c = FakeClock()
    d = Deadline(10, clock=c)
    c.tick(4)          # 6s left
    d.pause()
    c.tick(3600)       # thinking time is free
    d.resume()
    c.tick(5.9)
    assert not d.expired()
    c.tick(0.2)
    assert d.expired()


def test_nested_pauses_need_matching_resumes():
    """Two overlapping asks must not un-pause the clock on the first answer."""
    c = FakeClock()
    d = Deadline(10, clock=c)
    d.pause(); d.pause()
    d.resume()
    assert d.paused
    c.tick(1000)
    assert not d.expired()
    d.resume()
    assert not d.paused


def test_resume_without_pause_is_a_no_op():
    c = FakeClock()
    d = Deadline(10, clock=c)
    d.resume()
    assert not d.paused


def _registry(timeout_s=900):
    """A registry with a channel bound, capturing what it was asked to send."""
    r = AskRegistry(timeout_s=timeout_s)
    sent: list[Ask] = []
    closed: list[tuple[str, str]] = []
    async def on_ask(a): sent.append(a)
    async def on_close(a, state): closed.append((a.ask_id, state))
    r.on_ask, r.on_close = on_ask, on_close
    return r, sent, closed


async def test_ask_resolves_with_the_chosen_option():
    r, sent, _ = _registry()
    token = r.open_run("t1", 5)
    run = r.run_for_token(token)
    task = asyncio.create_task(
        r.ask(run, "Riverpod atau Bloc?",
              [{"label": "Riverpod"}, {"label": "Bloc"}]))
    await asyncio.sleep(0)
    assert r.answer_options(sent[0].ask_id, [0])
    assert await task == "User chose: Riverpod"


async def test_multi_select_answer_lists_every_chosen_label():
    r, sent, _ = _registry()
    run = r.run_for_token(r.open_run("t1", 5))
    task = asyncio.create_task(
        r.ask(run, "Paket apa?",
              [{"label": "Riverpod"}, {"label": "Freezed"}, {"label": "Dio"}],
              multi=True))
    await asyncio.sleep(0)
    r.answer_options(sent[0].ask_id, [0, 1])
    assert await task == "User chose: Riverpod, Freezed"


async def test_free_text_answer_is_labelled_as_such():
    """The engine must be able to tell a typed answer from a tapped one — it
    may contain an instruction no option covered."""
    r, sent, _ = _registry()
    run = r.run_for_token(r.open_run("t1", 5))
    task = asyncio.create_task(r.ask(run, "Q?", [{"label": "A"}]))
    await asyncio.sleep(0)
    assert r.answer(sent[0].ask_id, "pakai Bloc saja")
    assert await task == "User replied (free text): pakai Bloc saja"


async def test_unanswered_ask_times_out_into_an_actionable_string():
    r, sent, closed = _registry(timeout_s=0.05)
    run = r.run_for_token(r.open_run("t1", 5))
    assert await r.ask(run, "Q?", [{"label": "A"}]) == NO_ANSWER
    assert closed == [(sent[0].ask_id, "expired")]
    assert r.pending_for_chat(5) is None


async def test_a_second_answer_is_rejected():
    """Two people tapping at once must not resolve the same Future twice."""
    r, sent, _ = _registry()
    run = r.run_for_token(r.open_run("t1", 5))
    task = asyncio.create_task(r.ask(run, "Q?", [{"label": "A"}]))
    await asyncio.sleep(0)
    aid = sent[0].ask_id
    assert r.answer_options(aid, [0])
    await task
    assert not r.answer_options(aid, [0])
    assert not r.answer(aid, "late")


async def test_answering_an_unknown_ask_is_false_not_a_crash():
    r, _, _ = _registry()
    assert not r.answer("deadbeef", "hi")
    assert not r.answer_options("deadbeef", [0])


async def test_without_a_bound_channel_the_tool_degrades_instead_of_hanging():
    """No Telegram token configured: the tool is still registered, so it has
    to answer something the engine can act on."""
    r = AskRegistry()
    run = r.run_for_token(r.open_run("t1", 5))
    assert await r.ask(run, "Q?", [{"label": "A"}]) == NO_CHANNEL


async def test_a_failing_send_degrades_instead_of_raising():
    r = AskRegistry()
    async def boom(a): raise RuntimeError("telegram down")
    r.on_ask = boom
    run = r.run_for_token(r.open_run("t1", 5))
    assert await r.ask(run, "Q?", [{"label": "A"}]) == NO_CHANNEL
    assert r.pending_for_chat(5) is None


async def test_ask_budget_is_capped_per_run():
    r, sent, _ = _registry()
    run = r.run_for_token(r.open_run("t1", 5))
    for _ in range(ask_mod.MAX_ASKS_PER_RUN):
        task = asyncio.create_task(r.ask(run, "Q?", [{"label": "A"}]))
        await asyncio.sleep(0)
        r.answer_options(sent[-1].ask_id, [0])
        await task
    assert await r.ask(run, "Q?", [{"label": "A"}]) == BUDGET_SPENT


async def test_the_run_deadline_is_paused_for_exactly_the_wait():
    c = FakeClock()
    d = Deadline(10, clock=c)
    r, sent, _ = _registry()
    run = r.run_for_token(r.open_run("t1", 5, deadline=d))
    c.tick(4)
    task = asyncio.create_task(r.ask(run, "Q?", [{"label": "A"}]))
    await asyncio.sleep(0)
    assert d.paused
    c.tick(3600)
    r.answer_options(sent[0].ask_id, [0])
    await task
    assert not d.paused
    c.tick(5.9)
    assert not d.expired()      # 6s was left when the ask began
    c.tick(0.2)
    assert d.expired()


async def test_pending_for_chat_finds_the_open_ask_then_forgets_it():
    r, sent, _ = _registry()
    run = r.run_for_token(r.open_run("t1", 5))
    task = asyncio.create_task(r.ask(run, "Q?", [{"label": "A"}]))
    await asyncio.sleep(0)
    assert r.pending_for_chat(5) == sent[0].ask_id
    r.answer(sent[0].ask_id, "x")
    await task
    assert r.pending_for_chat(5) is None


async def test_toggle_flips_selection_for_multi_select():
    r, sent, _ = _registry()
    run = r.run_for_token(r.open_run("t1", 5))
    task = asyncio.create_task(
        r.ask(run, "Q?", [{"label": "A"}, {"label": "B"}], multi=True))
    await asyncio.sleep(0)
    aid = sent[0].ask_id
    assert r.toggle(aid, 1).selected == {1}
    assert r.toggle(aid, 0).selected == {0, 1}
    assert r.toggle(aid, 1).selected == {0}
    r.answer_options(aid, sorted(r.get(aid).selected))
    assert await task == "User chose: A"


async def test_toggle_on_an_unknown_ask_returns_none():
    r, _, _ = _registry()
    assert r.toggle("deadbeef", 0) is None


async def test_answer_options_ignores_out_of_range_indices():
    """A stale keyboard from a previous question could carry an index this
    ask does not have; it must not IndexError inside the handler."""
    r, sent, _ = _registry()
    run = r.run_for_token(r.open_run("t1", 5))
    task = asyncio.create_task(r.ask(run, "Q?", [{"label": "A"}]))
    await asyncio.sleep(0)
    r.answer_options(sent[0].ask_id, [0, 7])
    assert await task == "User chose: A"


async def test_closing_a_run_forgets_its_token():
    r, _, _ = _registry()
    token = r.open_run("t1", 5)
    r.close_run(token)
    assert r.run_for_token(token) is None


async def test_every_question_and_answer_is_logged_against_its_task():
    """The dashboard and the step transcript are the only record of what the
    operator was asked — an unlogged ask is an unexplainable decision."""
    logged = []
    r = AskRegistry(log=lambda tid, msg: logged.append((tid, msg)))
    sent = []
    async def on_ask(a): sent.append(a)
    r.on_ask = on_ask
    run = r.run_for_token(r.open_run("t1", 5))
    task = asyncio.create_task(r.ask(run, "Riverpod atau Bloc?",
                                     [{"label": "Riverpod"}]))
    await asyncio.sleep(0)
    r.answer_options(sent[0].ask_id, [0])
    await task
    assert logged[0] == ("t1", "ask: Riverpod atau Bloc?")
    assert logged[1] == ("t1", "answer: User chose: Riverpod")


async def test_a_timed_out_ask_is_logged_too():
    logged = []
    r = AskRegistry(timeout_s=0.05, log=lambda tid, msg: logged.append(msg))
    async def on_ask(a): pass
    r.on_ask = on_ask
    run = r.run_for_token(r.open_run("t1", 5))
    await r.ask(run, "Q?", [{"label": "A"}])
    assert logged[-1] == "answer: (expired, no answer)"


async def test_a_failing_log_never_breaks_an_ask():
    """A store write is a courtesy; losing it must not lose the answer."""
    def boom(tid, msg): raise RuntimeError("db locked")
    r = AskRegistry(log=boom)
    sent = []
    async def on_ask(a): sent.append(a)
    r.on_ask = on_ask
    run = r.run_for_token(r.open_run("t1", 5))
    task = asyncio.create_task(r.ask(run, "Q?", [{"label": "A"}]))
    await asyncio.sleep(0)
    r.answer_options(sent[0].ask_id, [0])
    assert await task == "User chose: A"


async def test_concurrent_asks_on_same_run_nest_pause_correctly():
    """Two parallel asks from the same run must nest pause/resume so the clock
    stays paused until both are answered. This can happen in production when the
    engine emits parallel tool calls."""
    c = FakeClock()
    d = Deadline(10, clock=c)
    r, sent, _ = _registry()
    run = r.run_for_token(r.open_run("t1", 5, deadline=d))

    # Start two asks concurrently
    c.tick(2)  # advance time a bit, leaving 8 seconds
    task1 = asyncio.create_task(
        r.ask(run, "Question 1?", [{"label": "Answer 1"}]))
    task2 = asyncio.create_task(
        r.ask(run, "Question 2?", [{"label": "Answer 2"}]))
    await asyncio.sleep(0)

    # Both asks should now be pending; deadline is paused with nesting count 2
    assert len(sent) == 2
    assert d.paused

    # Advance clock way into the future while both are pending
    c.tick(3600)
    assert not d.expired()  # deadline must still be paused

    # Answer the first ask; nesting count drops to 1, still paused
    r.answer_options(sent[0].ask_id, [0])
    result1 = await task1
    assert d.paused  # key property: one answer does not restart the clock
    assert result1 == "User chose: Answer 1"

    # Advance clock again while the second ask is still pending
    c.tick(3600)
    assert not d.expired()

    # Answer the second ask; nesting count drops to 0, now running
    r.answer_options(sent[1].ask_id, [0])
    result2 = await task2
    assert not d.paused
    assert result2 == "User chose: Answer 2"

    # The deadline should expire after the remaining time (8 seconds after tick(2))
    c.tick(7.9)
    assert not d.expired()
    c.tick(0.2)
    assert d.expired()
