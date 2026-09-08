"""Loop agentik engine `api`, dan bentuk stream yang dipancarkannya.

Bentuk itulah yang diuji paling keras: seluruh jalur hilir — timeline, token,
deteksi selesai — membacanya lewat modul yang tidak boleh diubah, dan setiap
ketidakcocokan di sini gagal secara SENYAP, bukan dengan error.
"""
import json

from hermes import engine_api
from hermes.engine_result import parse_claude_json
from hermes.engine_stream import distill_claude_line


def test_usage_is_translated_to_anthropic_key_names():
    """9Router answers OpenAI-style. engine_stream reads Anthropic keys, so an
    untranslated dict makes every token count None without erroring."""
    got = engine_api._usage_anthropic(
        {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120})
    assert got == {"input_tokens": 100, "output_tokens": 20}


def test_usage_of_none_is_empty_not_a_crash():
    assert engine_api._usage_anthropic(None) == {}


def test_translated_usage_is_readable_by_the_distiller():
    usage = engine_api._usage_anthropic({"prompt_tokens": 7, "completion_tokens": 3})
    line = json.dumps(engine_api.emit_assistant("hi", [], usage))
    ev = distill_claude_line(line)[0]
    assert (ev.tokens_in, ev.tokens_out) == (7, 3)


def test_init_line_names_the_model():
    ev = distill_claude_line(json.dumps(engine_api.emit_init("cc/claude-opus-5")))[0]
    assert ev.kind == "init" and ev.text == "cc/claude-opus-5"


def test_tool_call_line_carries_the_edited_path():
    call = engine_api.ToolCall("call_1", "Edit",
                               {"file_path": "src/a.py", "old_string": "a",
                                "new_string": "b"})
    ev = distill_claude_line(json.dumps(engine_api.emit_assistant("", [call], {})))[0]
    assert ev.kind == "tool_use" and ev.tool_name == "Edit"
    assert ev.file_path == "src/a.py"


def test_a_read_call_reports_no_edited_path():
    call = engine_api.ToolCall("call_1", "Read", {"file_path": "src/a.py"})
    ev = distill_claude_line(json.dumps(engine_api.emit_assistant("", [call], {})))[0]
    assert ev.file_path == ""


def test_failed_tool_result_is_marked_not_ok():
    line = json.dumps(engine_api.emit_tool_result("call_1", "boom", is_error=True))
    ev = distill_claude_line(line)[0]
    assert ev.kind == "tool_result" and ev.ok is False


def test_result_envelope_is_parsed_as_the_final_text():
    env = engine_api.emit_result("all done", {"input_tokens": 1, "output_tokens": 2},
                                 session_id="s1", num_turns=3)
    outcome = parse_claude_json(json.dumps(env))
    assert outcome.final_text == "all done"
    assert outcome.session_id == "s1"
    assert outcome.api_error is None


def test_result_envelope_can_report_a_failed_session():
    env = engine_api.emit_result("", {}, api_error="429 rate limited")
    outcome = parse_claude_json(json.dumps(env))
    assert outcome.api_error


from types import SimpleNamespace


def _delta(content=None, tool_calls=None):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(
            content=content, tool_calls=tool_calls))],
        usage=None)


def _tc(index, id=None, name=None, arguments=None):
    return SimpleNamespace(index=index, id=id, function=SimpleNamespace(
        name=name, arguments=arguments))


def _usage_chunk(prompt, completion):
    return SimpleNamespace(choices=[], usage=SimpleNamespace(
        model_dump=lambda: {"prompt_tokens": prompt, "completion_tokens": completion}))


class FakeStream:
    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        async def gen():
            for c in self._chunks:
                yield c
        return gen()


class FakeClient:
    """Scripted AsyncOpenAI double. Each entry in `scripts` is the chunk list
    for one create() call, so a multi-turn loop is scripted turn by turn."""

    def __init__(self, scripts):
        self.scripts = list(scripts)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return FakeStream(self.scripts.pop(0))


async def test_one_turn_collects_streamed_text():
    client = FakeClient([[_delta(content="Hel"), _delta(content="lo"),
                          _usage_chunk(10, 2)]])
    turn = await engine_api._one_turn(client, "m", [], [])
    assert turn.text == "Hello"
    assert turn.tool_calls == []
    assert turn.usage == {"input_tokens": 10, "output_tokens": 2}


async def test_one_turn_reassembles_tool_call_argument_fragments():
    """The gateway streams `arguments` in pieces; a turn that parses a
    fragment would call the tool with half an argument."""
    client = FakeClient([[
        _delta(tool_calls=[_tc(0, id="call_1", name="Read", arguments='{"file')]),
        _delta(tool_calls=[_tc(0, arguments='_path": "a.py"}')]),
    ]])
    turn = await engine_api._one_turn(client, "m", [], [])
    assert turn.tool_calls == [engine_api.ToolCall("call_1", "Read",
                                                   {"file_path": "a.py"})]


async def test_one_turn_keeps_parallel_tool_calls_apart_by_index():
    client = FakeClient([[
        _delta(tool_calls=[_tc(0, id="c1", name="Read", arguments='{"file_path":"a"}'),
                           _tc(1, id="c2", name="Read", arguments='{"file_path":"b"}')]),
    ]])
    turn = await engine_api._one_turn(client, "m", [], [])
    assert [c.id for c in turn.tool_calls] == ["c1", "c2"]
    assert [c.args["file_path"] for c in turn.tool_calls] == ["a", "b"]


async def test_one_turn_survives_unparseable_tool_arguments():
    """A truncated arguments string must reach the tool layer as an empty
    dict and be reported as a missing argument, not crash the run."""
    client = FakeClient([[
        _delta(tool_calls=[_tc(0, id="c1", name="Read", arguments='{"file_pa')]),
    ]])
    turn = await engine_api._one_turn(client, "m", [], [])
    assert turn.tool_calls[0].args == {}


async def test_one_turn_requests_streaming_usage():
    client = FakeClient([[_delta(content="x")]])
    await engine_api._one_turn(client, "m", [], [])
    assert client.calls[0]["stream"] is True
    assert client.calls[0]["stream_options"] == {"include_usage": True}

