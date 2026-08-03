from hermes import mcp_risk


def test_is_mcp_name():
    assert mcp_risk.is_mcp_name("gmail__send_email") is True
    assert mcp_risk.is_mcp_name("start_task") is False
    assert mcp_risk.is_mcp_name("list_projects") is False


def test_writes_and_sends_are_risky():
    for n in ("gmail__send_email", "calendar__create_event",
              "calendar__update_event", "calendar__delete_event",
              "filesystem__write_file", "filesystem__move_file",
              "filesystem__delete_file", "playwright__browser_click",
              "playwright__browser_type", "playwright__browser_fill",
              "gmail__reply", "gmail__forward"):
        assert mcp_risk.is_risky_tool(n) is True, n


def test_reads_are_not_risky():
    for n in ("gmail__list_messages", "gmail__search_email",
              "gmail__read_email", "calendar__list_events",
              "calendar__get_event", "filesystem__read_file",
              "filesystem__list_directory", "filesystem__search_files",
              "playwright__browser_snapshot",
              "playwright__browser_take_screenshot",
              "playwright__browser_navigate",
              "playwright__browser_navigate_back"):
        assert mcp_risk.is_risky_tool(n) is False, n


def test_unknown_verb_is_gated_by_default():
    # A tool we cannot classify must not run unattended.
    assert mcp_risk.is_risky_tool("weird__flonk") is True
    assert mcp_risk.is_risky_tool("server__") is True


def test_bare_tool_name_without_server_prefix():
    assert mcp_risk.is_risky_tool("send_email") is True
    assert mcp_risk.is_risky_tool("read_file") is False
