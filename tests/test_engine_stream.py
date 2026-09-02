"""Distilling `--output-format stream-json` into renderable trace events.

Same posture as test_engine_result: the JSONL shape belongs to the `claude`
CLI, not to us, so the coverage is greedy. Every case here is a way that
surface can move under our feet — and unlike the single result envelope, this
stream carries the model's reasoning and tool calls, which is what the task
timeline renders.
"""
import json

from hermes.engine_stream import (MAX_TEXT, TraceEvent, distill_agy_line,
                                  distill_claude_line, distill_line)


def kinds(events: list[TraceEvent]) -> list[str]:
    return [e.kind for e in events]


# --- lines that carry nothing ------------------------------------------------

def test_blank_and_garbage_lines_yield_nothing():
    assert distill_claude_line("") == []
    assert distill_claude_line("   ") == []
    assert distill_claude_line("not json at all") == []
    assert distill_claude_line('{"truncated": ') == []


def test_json_that_is_not_an_object_yields_nothing():
    assert distill_claude_line("[1, 2, 3]") == []
    assert distill_claude_line('"a string"') == []


def test_unknown_event_type_is_ignored():
    assert distill_claude_line(json.dumps({"type": "wat", "payload": 1})) == []


def test_assistant_without_content_yields_nothing():
    assert distill_claude_line(json.dumps({"type": "assistant", "message": {}})) == []


# --- init --------------------------------------------------------------------

def test_init_reports_the_model():
    line = json.dumps({"type": "system", "subtype": "init",
                       "model": "claude-opus-5", "cwd": "/repo",
                       "tools": ["Read", "Edit"], "session_id": "s1"})
    (ev,) = distill_claude_line(line)
    assert ev.kind == "init"
    assert ev.text == "claude-opus-5"


def test_system_subtype_other_than_init_is_ignored():
    assert distill_claude_line(json.dumps({"type": "system", "subtype": "warning"})) == []


# --- assistant blocks --------------------------------------------------------

def test_one_assistant_line_can_carry_thinking_text_and_a_tool_call():
    line = json.dumps({"type": "assistant", "message": {"content": [
        {"type": "thinking", "thinking": "weighing options"},
        {"type": "text", "text": "Reading the config first."},
        {"type": "tool_use", "id": "tu_1", "name": "Read",
         "input": {"file_path": "/repo/config.py"}},
    ]}})
    events = distill_claude_line(line)
    assert kinds(events) == ["thinking", "text", "tool_use"]
    assert events[0].text == "weighing options"
    assert events[1].text == "Reading the config first."
    assert events[2].tool_name == "Read"
    assert events[2].tool_use_id == "tu_1"
    assert json.loads(events[2].tool_input) == {"file_path": "/repo/config.py"}


def test_per_turn_usage_lands_on_the_first_event_only():
    """Attached once so summing a task's events cannot double-count a turn."""
    line = json.dumps({"type": "assistant", "message": {
        "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}],
        "usage": {"input_tokens": 10, "cache_creation_input_tokens": 5,
                  "cache_read_input_tokens": 2, "output_tokens": 7}}})
    first, second = distill_claude_line(line)
    assert (first.tokens_in, first.tokens_out) == (17, 7)
    assert (second.tokens_in, second.tokens_out) == (None, None)


def test_unknown_block_types_are_skipped_without_losing_their_siblings():
    line = json.dumps({"type": "assistant", "message": {"content": [
        {"type": "redacted_thinking", "data": "xx"},
        {"type": "text", "text": "still here"},
    ]}})
    assert kinds(distill_claude_line(line)) == ["text"]


# --- file extraction ---------------------------------------------------------

def test_edit_tools_expose_the_file_they_touch():
    for tool in ("Edit", "Write", "MultiEdit"):
        line = json.dumps({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "id": "t", "name": tool,
             "input": {"file_path": "/repo/app.py"}}]}})
        (ev,) = distill_claude_line(line)
        assert ev.file_path == "/repo/app.py", tool


def test_notebook_edit_uses_its_own_path_field():
    line = json.dumps({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "t", "name": "NotebookEdit",
         "input": {"notebook_path": "/repo/nb.ipynb"}}]}})
    (ev,) = distill_claude_line(line)
    assert ev.file_path == "/repo/nb.ipynb"


def test_a_read_only_tool_records_no_edited_file():
    """Read touches a file but never changes it — the timeline's edited-files
    list must not claim otherwise."""
    line = json.dumps({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "t", "name": "Read",
         "input": {"file_path": "/repo/app.py"}}]}})
    (ev,) = distill_claude_line(line)
    assert ev.file_path == ""


def test_bash_tool_records_no_file():
    line = json.dumps({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "t", "name": "Bash",
         "input": {"command": "ls"}}]}})
    (ev,) = distill_claude_line(line)
    assert ev.file_path == ""


# --- tool results ------------------------------------------------------------

def test_tool_result_correlates_and_defaults_to_success():
    line = json.dumps({"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "tu_1", "content": "done"}]}})
    (ev,) = distill_claude_line(line)
    assert ev.kind == "tool_result"
    assert ev.tool_use_id == "tu_1"
    assert ev.ok is True
    assert ev.text == "done"


def test_tool_result_marks_failure():
    line = json.dumps({"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "tu_2",
         "content": "No such file", "is_error": True}]}})
    (ev,) = distill_claude_line(line)
    assert ev.ok is False
    assert ev.text == "No such file"


def test_tool_result_content_may_be_a_block_list():
    line = json.dumps({"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "tu_3", "content": [
            {"type": "text", "text": "line one"},
            {"type": "text", "text": "line two"}]}]}})
    (ev,) = distill_claude_line(line)
    assert ev.text == "line one\nline two"


def test_a_plain_user_message_is_not_a_tool_result():
    line = json.dumps({"type": "user", "message": {"content": [
        {"type": "text", "text": "the original prompt"}]}})
    assert distill_claude_line(line) == []


# --- final envelope ----------------------------------------------------------

def test_result_carries_answer_cost_and_tokens():
    line = json.dumps({
        "type": "result", "subtype": "success", "is_error": False,
        "num_turns": 3, "result": "all done", "total_cost_usd": 0.0249893,
        "usage": {"input_tokens": 10, "cache_creation_input_tokens": 11450,
                  "cache_read_input_tokens": 15593, "output_tokens": 104}})
    (ev,) = distill_claude_line(line)
    assert ev.kind == "result"
    assert ev.text == "all done"
    assert ev.cost_usd == 0.0249893
    assert ev.tokens_in == 10 + 11450 + 15593
    assert ev.tokens_out == 104


def test_result_survives_a_missing_usage_block():
    (ev,) = distill_claude_line(json.dumps({"type": "result", "result": "ok"}))
    assert ev.kind == "result"
    assert ev.tokens_in is None and ev.cost_usd is None


def test_non_numeric_usage_is_ignored_rather_than_crashing():
    (ev,) = distill_claude_line(json.dumps({
        "type": "result", "result": "ok",
        "usage": {"input_tokens": "lots", "output_tokens": None},
        "total_cost_usd": "free"}))
    assert ev.tokens_in is None and ev.tokens_out is None
    assert ev.cost_usd is None


# --- truncation --------------------------------------------------------------

def test_long_text_is_truncated_to_the_storage_cap():
    big = "x" * (MAX_TEXT * 3)
    line = json.dumps({"type": "assistant", "message": {"content": [
        {"type": "text", "text": big}]}})
    (ev,) = distill_claude_line(line)
    assert len(ev.text) == MAX_TEXT
    assert ev.text.endswith("…")


def test_long_tool_input_is_truncated():
    line = json.dumps({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "t", "name": "Write",
         "input": {"file_path": "/repo/a.py", "content": "y" * (MAX_TEXT * 3)}}]}})
    (ev,) = distill_claude_line(line)
    assert len(ev.tool_input) == MAX_TEXT
    # The path must survive truncation — it is what the edited-files list reads.
    assert ev.file_path == "/repo/a.py"


def test_long_tool_result_is_truncated():
    line = json.dumps({"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "t", "content": "z" * (MAX_TEXT * 3)}]}})
    (ev,) = distill_claude_line(line)
    assert len(ev.text) == MAX_TEXT


# --- antigravity (`agy --output-format stream-json`) -------------------------
#
# Shapes captured verbatim from `agy -p ... --output-format stream-json`
# (agy 2026-09-02). Kept whole rather than trimmed to the fields read, so an
# upstream change shows up here instead of in production. agy keys on `event`
# and nests its payload under a key of the same name — nothing like claude's.

def test_agy_ignores_lines_that_carry_nothing():
    assert distill_agy_line("") == []
    assert distill_agy_line("not json") == []
    assert distill_agy_line(json.dumps({"event": "unknown", "unknown": {}})) == []
    assert distill_agy_line(json.dumps({"event": "step_update"})) == []


def test_agy_init_yields_nothing_because_it_names_no_model():
    line = json.dumps({"event": "init", "conversation_id": "c1", "init": {
        "cwd": "C:\repo", "tools": ["list_dir", "run_command"],
        "permission_mode": "request-review"}})
    assert distill_agy_line(line) == []


def test_agy_user_input_step_is_not_rendered():
    line = json.dumps({"event": "step_update", "step_update": {
        "conversation_id": "c1", "step_index": 0, "state": "DONE",
        "step_type": "user_input"}})
    assert distill_agy_line(line) == []


def test_agy_agent_response_carries_text_and_usage():
    line = json.dumps({"event": "step_update", "step_update": {
        "conversation_id": "c1", "step_index": 1, "state": "DONE",
        "step_type": "agent_response", "text_delta": "ok\n",
        "duration_seconds": 1.68,
        "usage": {"input_tokens": 19123, "output_tokens": 23,
                  "thinking_tokens": 22, "cache_read_tokens": 100,
                  "total_tokens": 19146}}})
    (ev,) = distill_agy_line(line)
    assert ev.kind == "text"
    # Kept verbatim: these are deltas, so trimming whitespace here would glue
    # consecutive fragments together in the timeline.
    assert ev.text == "ok\n"
    assert ev.tokens_in == 19123 + 100
    # thinking_tokens sits inside output_tokens; adding it would double-bill.
    assert ev.tokens_out == 23


def test_agy_agent_response_without_text_still_reports_its_tokens():
    """A thinking-only turn shows nothing but must still reach the totals."""
    line = json.dumps({"event": "step_update", "step_update": {
        "conversation_id": "c1", "step_index": 1, "state": "DONE",
        "step_type": "agent_response",
        "usage": {"input_tokens": 3480, "output_tokens": 135,
                  "thinking_tokens": 85, "cache_read_tokens": 16290}}})
    (ev,) = distill_agy_line(line)
    assert ev.kind == "text" and ev.text == ""
    assert ev.tokens_in == 3480 + 16290 and ev.tokens_out == 135


def test_agy_agent_response_with_neither_text_nor_usage_is_dropped():
    line = json.dumps({"event": "step_update", "step_update": {
        "conversation_id": "c1", "step_index": 1, "state": "DONE",
        "step_type": "agent_response"}})
    assert distill_agy_line(line) == []


def _agy_tool(state, step_index=2, conversation_id="c1", **info):
    return json.dumps({"event": "step_update", "step_update": {
        "conversation_id": conversation_id, "step_index": step_index,
        "state": state, "step_type": "tool",
        "tool_name": info.get("name", "list_dir"), "tool_info": info}})


def test_agy_tool_call_opens_and_closes_on_one_id():
    started = _agy_tool("ACTIVE", name="list_dir",
                        parameters={"DirectoryPath": "C:\repo"})
    finished = _agy_tool("DONE", name="list_dir",
                         parameters={"DirectoryPath": "C:\repo"})
    (call,) = distill_agy_line(started)
    (result,) = distill_agy_line(finished)
    assert call.kind == "tool_use" and call.tool_name == "list_dir"
    assert json.loads(call.tool_input) == {"DirectoryPath": "C:\repo"}
    assert result.kind == "tool_result" and result.ok is True
    # Pairing is what makes the two render as one line.
    assert call.tool_use_id == result.tool_use_id == "c1:2"


def test_agy_tool_ids_do_not_collide_across_conversations():
    """A retried step opens a new conversation and restarts step_index, so the
    id has to carry both or round two pairs with round one."""
    a = distill_agy_line(_agy_tool("ACTIVE", step_index=2, conversation_id="c1"))[0]
    b = distill_agy_line(_agy_tool("ACTIVE", step_index=2, conversation_id="c2"))[0]
    assert a.tool_use_id != b.tool_use_id


def test_agy_tool_error_is_marked_and_keeps_its_message():
    line = _agy_tool("ERROR", name="run_command",
                     parameters={"CommandLine": "Get-Location"},
                     error={"type": "TOOL_ERROR",
                            "message": "permission check failed for command"})
    (ev,) = distill_agy_line(line)
    assert ev.kind == "tool_result"
    assert ev.ok is False
    assert "permission check failed" in ev.text


def test_agy_unfamiliar_terminal_state_reads_as_success():
    (ev,) = distill_agy_line(_agy_tool("CANCELLED"))
    assert ev.kind == "tool_result" and ev.ok is True


def test_agy_edit_tools_expose_the_file_they_touch():
    for tool in ("write_to_file", "replace_file_content", "sed_file"):
        (ev,) = distill_agy_line(
            _agy_tool("ACTIVE", name=tool, parameters={"TargetFile": "C:\repo\a.ts"}))
        assert ev.file_path == "C:\repo\a.ts", tool


def test_agy_directory_parameter_is_never_an_edited_file():
    (ev,) = distill_agy_line(_agy_tool(
        "ACTIVE", name="write_to_file", parameters={"DirectoryPath": "C:\repo"}))
    assert ev.file_path == ""


def test_agy_read_only_tool_records_no_edited_file():
    (ev,) = distill_agy_line(_agy_tool(
        "ACTIVE", name="view_file", parameters={"TargetFile": "C:\repo\a.ts"}))
    assert ev.file_path == ""


def test_agy_result_carries_the_response_and_no_cost():
    line = json.dumps({"event": "result", "result": {
        "conversation_id": "c1", "status": "SUCCESS", "response": "all done",
        "duration_seconds": 7.46, "num_turns": 1,
        "usage": {"input_tokens": 26310, "output_tokens": 741,
                  "thinking_tokens": 586, "cache_read_tokens": 32572,
                  "total_tokens": 27051}}})
    (ev,) = distill_agy_line(line)
    assert ev.kind == "result"
    assert ev.text == "all done"
    assert ev.tokens_in == 26310 + 32572
    assert ev.tokens_out == 741
    # agy reports no spend, so the timeline must not invent one.
    assert ev.cost_usd is None


# --- dispatch ----------------------------------------------------------------

def test_distill_line_routes_by_engine():
    claude_line = json.dumps({"type": "assistant", "message": {
        "content": [{"type": "text", "text": "hi"}]}})
    agy_line = json.dumps({"event": "step_update", "step_update": {
        "step_type": "agent_response", "text_delta": "hi"}})
    assert kinds(distill_line(claude_line, "claude")) == ["text"]
    assert kinds(distill_line(agy_line, "antigravity")) == ["text"]
    # Each engine's shape is meaningless to the other's reader.
    assert distill_line(agy_line, "claude") == []
    assert distill_line(claude_line, "antigravity") == []


def test_distill_line_is_silent_for_an_engine_with_no_stream():
    assert distill_line('{"type":"result"}', "some-future-engine") == []
