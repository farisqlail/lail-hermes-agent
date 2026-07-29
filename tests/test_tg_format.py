from hermes import tg_format


def test_escape_html_neutralizes_telegram_markup_characters():
    assert tg_format.escape_html("a<b>&c") == "a&lt;b&gt;&amp;c"


def test_mono_block_escapes_content_and_wraps_it_in_pre():
    out = tg_format.mono_block(["M  a<b>.txt"])
    assert out == "<pre>M  a&lt;b&gt;.txt</pre>"


def test_plain_text_undoes_mono_block_for_non_telegram_consumers():
    """The web UI escapes what it renders, so a stored <pre> would show up as
    literal tags in the log console."""
    msg = "task complete\n\n" + tg_format.mono_block(["M  a&b.txt"])
    assert tg_format.plain_text(msg) == "task complete\n\nM  a&b.txt"


def test_strip_markdown_removes_the_blockquote_and_emphasis_markers():
    """The reported symptom: an engine-written quote reached the operator as
    `> *"..."*` because plain sends have no parse_mode to consume the markers."""
    out = tg_format.strip_markdown('> *"Jalankan testing untuk @myprofit"*')
    assert out == '"Jalankan testing untuk @myprofit"'


def test_strip_markdown_unwraps_bold_code_and_strikethrough():
    assert tg_format.strip_markdown("**Ya** jalankan `pytest -q` ~~nanti~~") == (
        "Ya jalankan pytest -q nanti")


def test_strip_markdown_drops_heading_and_fence_lines_keeping_content():
    out = tg_format.strip_markdown("## Hasil\n```bash\npytest -q\n```")
    assert out == "Hasil\npytest -q"


def test_strip_markdown_renders_a_link_as_label_plus_url():
    """The URL is the actionable half; dropping it would leave the operator
    with a label pointing nowhere."""
    assert tg_format.strip_markdown(
        "buka [dashboard](http://127.0.0.1:8799)") == (
        "buka dashboard (http://127.0.0.1:8799)")


def test_strip_markdown_keeps_a_relative_link_label_only():
    assert tg_format.strip_markdown("lihat [spec](docs/design.md)") == "lihat spec"


def test_strip_markdown_leaves_globs_and_snake_case_alone():
    """The stripper runs over every plain message, so a lone `*` in a glob and
    the underscores in an identifier must survive untouched."""
    assert tg_format.strip_markdown("run *.py and *.js") == "run *.py and *.js"
    assert tg_format.strip_markdown("call read_file_sync now") == (
        "call read_file_sync now")


def test_strip_markdown_leaves_hermes_own_report_lines_untouched():
    """Every status line Hermes writes itself goes through the same stripper."""
    for line in ("step 0 [code]: coded (2 round(s))",
                 "/task @sayur perbaiki bug login",
                 "task complete",
                 "engine failed after 3 round(s): rate_limit_error"):
        assert tg_format.strip_markdown(line) == line


def test_strip_markdown_is_idempotent():
    once = tg_format.strip_markdown("> **A** _b_ ***c***")
    assert tg_format.strip_markdown(once) == once


def test_strip_markdown_unescapes_backslash_escaped_markers():
    assert tg_format.strip_markdown(r"harga 5\*3 dan \_x\_") == "harga 5*3 dan _x_"


def test_strip_markdown_drops_a_thematic_break_line():
    assert tg_format.strip_markdown("selesai\n---\nlanjut") == "selesai\nlanjut"


def test_fit_leaves_short_values_untouched():
    assert tg_format.fit("a.txt", 10) == "a.txt"


def test_fit_shortens_long_paths_from_the_middle_keeping_the_filename():
    out = tg_format.fit("src/very/deep/nested/dir/widget.dart", 20)
    assert len(out) == 20
    assert out.endswith("widget.dart")
    assert "…" in out


def test_table_pads_columns_so_values_line_up():
    lines = tg_format.table(
        ["St", "File", "+", "-"],
        [["M", "a.txt", "42", "7"], ["A", "bb.txt", "8", "0"]],
        [2, 8, 4, 4])
    # Every rendered row is the same width, so a monospace client aligns them.
    assert len({len(ln) for ln in lines}) == 1
    assert lines[0].startswith("St")
    assert lines[1].startswith("M ")
    assert lines[2].startswith("A ")


def test_table_truncates_values_wider_than_their_column():
    lines = tg_format.table(["File"], [["averylongfilename.txt"]], [8])
    assert len(lines[1]) == 8
