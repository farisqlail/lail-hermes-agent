from __future__ import annotations

"""Telegram HTML formatting helpers.

Telegram has no table markup. The only way to get columns that line up is a
monospace block (<pre>), which forces two obligations on every caller:

  1. the message must be sent with parse_mode="HTML", and
  2. every value inside it must be escaped, or a filename containing `<` or `&`
     makes Telegram reject the whole message with "can't parse entities".

mono_block() owns obligation 2 so callers only have to remember obligation 1.
"""

_TRUNC = "…"


def escape_html(text: str) -> str:
    """Neutralize the three characters Telegram's HTML parser reacts to.

    Order matters: `&` first, otherwise the ampersands introduced by the `<`
    and `>` replacements get escaped a second time.
    """
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def mono_block(lines: list[str]) -> str:
    """Wrap already-aligned lines in a <pre> block, escaping their content."""
    return "<pre>" + escape_html("\n".join(lines)) + "</pre>"


def plain_text(text: str) -> str:
    """Reverse mono_block(): drop the <pre> wrapper and unescape the content.

    For consumers that are not Telegram — the stored task log, which the web
    UI escapes again before rendering, so a stored tag would surface as
    literal `<pre>` on screen.
    """
    out = text.replace("<pre>", "").replace("</pre>", "")
    return (out.replace("&lt;", "<").replace("&gt;", ">")
               .replace("&amp;", "&"))       # last: mirrors escape_html's order


def fit(value: str, width: int) -> str:
    """Shorten `value` to exactly `width` chars, cutting from the middle.

    Middle-cutting is deliberate for file paths: the tail (the filename) is
    what identifies the change, and the head (the top-level dir) is what
    locates it. A plain right-truncation drops the filename — the one part the
    reader actually needs.
    """
    if len(value) <= width:
        return value
    if width <= 1:
        return value[:width]
    keep = width - 1                      # room for the ellipsis
    # Keep the whole basename when it fits, so the reader always gets a
    # complete filename; fall back to a middle cut when even that is too long.
    base = value.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    tail = len(base) if len(base) <= keep else keep // 2 + keep % 2
    head = keep - tail
    return value[:head] + _TRUNC + value[len(value) - tail:]


def table(headers: list[str], rows: list[list[str]], widths: list[int]
          ) -> list[str]:
    """Render fixed-width columns as plain lines, header first.

    Fixed widths rather than content-derived ones: a phone screen is ~40
    monospace chars, and one long path in one row must not push every other
    row past the wrap point — a wrapped line destroys the alignment for the
    whole block.
    """
    def render(cells: list[str]) -> str:
        return " ".join(fit(c, w).ljust(w) for c, w in zip(cells, widths)).rstrip()

    # rstrip() above trims trailing pad, so re-pad every line to the widest one
    # — a client that renders a selection background needs uniform lines.
    lines = [render(headers)] + [render(r) for r in rows]
    full = max(len(ln) for ln in lines)
    return [ln.ljust(full) for ln in lines]
