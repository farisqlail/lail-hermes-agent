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
