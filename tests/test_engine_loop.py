"""The code-step engine loop: sessions, resume, and what confirms completion.

Split from test_orchestrator.py, which covers planning, step dispatch and
artifacts. What is exercised here is one thing — how a code step decides to run
again, and what it trusts when deciding.
"""
import json
from pathlib import Path
import pytest
from hermes.orchestrator import Orchestrator, MAX_ENGINE_ROUNDS, _DONE_SENTINEL
from hermes.engine_runner import RunResult
from hermes.engine_result import EngineOutcome
from hermes.config import Settings
from hermes.session_store import Store


def _structured(text, session_id=None, cost=None, api_error=None):
    """A RunResult carrying an envelope, the shape a real claude run returns."""
    return RunResult(api_error is None, "", "", False, 0,
                     EngineOutcome(final_text=text, session_id=session_id,
                                   cost_usd=cost, api_error=api_error))


def _orch(hermes_home, store, engine, default_engine="claude"):
    async def planner(text, tools):
        return json.dumps({"steps": [{"type": "code", "prompt": "make it"}]})
    settings = Settings(default_engine=default_engine,
                        projects_path=str(hermes_home / "proj"))
    return Orchestrator(settings, store, planner, dict(run_engine=engine))


async def _run(orch, store):
    reports = []
    async def report(tid, msg, html=False): reports.append(msg)
    store.create_task("t1", 5, "x")
    await orch.run_task("t1", 5, "x", report)
    return reports


async def test_second_round_resumes_the_first_rounds_session(hermes_home):
    """The point of the change: round two reopens the session instead of
    re-sending the task, the tree, and the previous output to a fresh one."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    calls = []
    async def engine(engine_name, prompt, cwd, timeout_s, **kw):
        calls.append((prompt, kw))
        if len(calls) == 1:
            return _structured("still installing deps", session_id="sess-1")
        return _structured(f"tests pass\n{_DONE_SENTINEL}", session_id="sess-1")

    reports = await _run(_orch(hermes_home, store, engine), store)

    assert len(calls) == 2
    assert calls[0][1].get("session_id") and not calls[0][1].get("resume_id")
    assert calls[1][1].get("resume_id") == "sess-1"
    assert not calls[1][1].get("session_id")
    assert "Continuation" in calls[1][0]
    assert "Project structure" not in calls[1][0]      # context not re-sent
    assert "still installing deps" not in calls[1][0]  # nor the prior output
    assert store.get_task("t1")["status"] == "done"
    assert any("confirmed done, 2 round(s)" in m for m in reports)


async def test_round_without_an_envelope_falls_back_to_a_fresh_session(hermes_home):
    """No envelope means no session to reopen, so the pre-existing path has to
    carry the round: new session, base prompt re-sent, previous output fed in.
    This is also the path every antigravity run takes."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    calls = []
    async def engine(engine_name, prompt, cwd, timeout_s, **kw):
        calls.append((prompt, kw))
        if len(calls) == 1:
            return RunResult(False, "crashed early", "boom", False, 1)
        return _structured(f"fixed\n{_DONE_SENTINEL}", session_id="sess-2")

    await _run(_orch(hermes_home, store, engine), store)

    assert len(calls) == 2
    assert not calls[1][1].get("resume_id")
    assert calls[1][1]["session_id"] != calls[0][1]["session_id"]
    assert "ended with an error" in calls[1][0]
    assert "boom" in calls[1][0]                   # previous stderr fed back
    assert "Project structure" in calls[1][0]      # base prompt re-sent


async def test_antigravity_never_receives_session_flags(hermes_home):
    """agy cannot resume, so it keeps the narrow call shape it always had —
    the same reason model/effort are only passed when configured."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    calls = []
    async def engine(engine_name, prompt, cwd, timeout_s, **kw):
        calls.append(kw)
        return RunResult(True, f"done\n{_DONE_SENTINEL}", "", False, 0)

    await _run(_orch(hermes_home, store, engine, "antigravity"), store)

    assert calls == [{}]


async def test_sentinel_only_in_stdout_does_not_confirm_a_structured_run(hermes_home):
    """The anti-spoof property. Once the engine reports an envelope, only the
    model's own closing message counts: a sentinel sitting in tool output or an
    echoed prompt on stdout must not confirm a step the model says it failed.
    """
    store = Store(hermes_home / "t.db"); store.init_schema()
    calls = []
    async def engine(engine_name, prompt, cwd, timeout_s, **kw):
        calls.append(1)
        # stdout ends with the sentinel on its own line — indistinguishable
        # from a real confirmation to anything reading raw stdout. Only the
        # envelope knows the model itself said it failed.
        return RunResult(True, f"a tool printed:\n{_DONE_SENTINEL}", "",
                         False, 0,
                         EngineOutcome(final_text="I could not finish this",
                                       session_id="sess-3"))

    reports = await _run(_orch(hermes_home, store, engine), store)

    assert len(calls) == MAX_ENGINE_ROUNDS
    assert not any("confirmed done" in m for m in reports)
    assert any("completion not confirmed" in m for m in reports)


async def test_text_mode_still_confirms_from_stdout(hermes_home):
    """The fallback must keep working: with no envelope, stdout's last line is
    still the only signal there is."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    calls = []
    async def engine(engine_name, prompt, cwd, timeout_s, **kw):
        calls.append(1)
        return RunResult(True, f"built it\n{_DONE_SENTINEL}", "", False, 0)

    reports = await _run(_orch(hermes_home, store, engine, "antigravity"), store)

    assert calls == [1]
    assert any("confirmed done, 1 round(s)" in m for m in reports)


async def test_api_error_is_the_reported_cause_when_stderr_is_empty(hermes_home):
    """A session killed by an API error exits 0 with nothing on stderr, so the
    message used to read 'engine failed after 3 round(s): ' and stop there."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    async def engine(engine_name, prompt, cwd, timeout_s, **kw):
        return _structured("", session_id="s", api_error="overloaded_error")

    reports = await _run(_orch(hermes_home, store, engine), store)

    assert store.get_task("t1")["status"] == "failed"
    assert any("overloaded_error" in m for m in reports)


async def test_reported_cost_is_summed_across_rounds(hermes_home):
    store = Store(hermes_home / "t.db"); store.init_schema()
    calls = []
    async def engine(engine_name, prompt, cwd, timeout_s, **kw):
        calls.append(1)
        if len(calls) == 1:
            return _structured("not yet", session_id="sess-5", cost=0.25)
        return _structured(f"done\n{_DONE_SENTINEL}", session_id="sess-5",
                           cost=0.5)

    await _run(_orch(hermes_home, store, engine), store)

    assert any("2 round(s), $0.7500" in l for l in store.get_logs("t1"))


async def test_text_mode_engine_logs_no_cost_line(hermes_home):
    """An engine that reports nothing must not be recorded as costing $0.0000,
    which would read as free rather than as unknown."""
    store = Store(hermes_home / "t.db"); store.init_schema()
    async def engine(engine_name, prompt, cwd, timeout_s, **kw):
        return RunResult(True, f"done\n{_DONE_SENTINEL}", "", False, 0)

    await _run(_orch(hermes_home, store, engine, "antigravity"), store)

    assert not any("round(s), $" in l for l in store.get_logs("t1"))


async def test_transcript_header_carries_session_and_cost(hermes_home):
    from hermes import paths
    store = Store(hermes_home / "t.db"); store.init_schema()
    async def engine(engine_name, prompt, cwd, timeout_s, **kw):
        return _structured(f"done\n{_DONE_SENTINEL}", session_id="sess-6",
                           cost=0.125)

    await _run(_orch(hermes_home, store, engine), store)

    body = (paths.artifacts_dir() / "t1" / "step-0-engine.log").read_text(
        encoding="utf-8")
    assert "session: sess-6" in body
    assert "cost: $0.1250" in body
