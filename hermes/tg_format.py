from __future__ import annotations

"""Telegram HTML formatting helpers.

Telegram has no table markup. The only way to get columns that line up is a
monospace block (<pre>), which forces two obligations on every caller:

  1. the message must be sent with parse_mode="HTML", and
  2. every value inside it must be escaped, or a filename containing `<` or `&`
     makes Telegram reject the whole message with "can't parse entities".

mono_block() owns obligation 2 so callers only have to remember obligation 1.

strip_markdown() covers the opposite direction: text Hermes did not write.
Every plain message goes out with no parse_mode at all, so an engine's habitual
`> *"..."*` reaches the operator as literal punctuation rather than as a quote.
"""
import re

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


# Markers that a backslash may neutralize in Markdown. Escaped ones are parked
# on private-use codepoints for the duration of the strip, so `5\*3` cannot pair
# its asterisk with an unrelated one later in the same message.
_ESCAPABLE = "\\`*_{}[]()#+-.!~>"
_PUA = 0xE000
_ESCAPE_RE = re.compile(r"\\([" + re.escape(_ESCAPABLE) + r"])")

_FENCE_LINE = re.compile(r"^ {0,3}(?:```|~~~)")
_HEADING = re.compile(r"^ {0,3}#{1,6}[ \t]+")
_QUOTE = re.compile(r"^ {0,3}(?:>[ \t]?)+")
_RULE_LINE = re.compile(
    r"^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$")

_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)\s]*\)")
_LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]*)\)")
_CODE_SPAN = re.compile(r"`+([^`]+)`+")
# `(?=\S)` / `(?<=\S)` keep a delimiter pair from spanning whitespace, which is
# what makes `run *.py and *.js` come out unchanged: the only candidate closer
# is preceded by a space, so the pair never forms.
_STRONG_STAR = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", re.S)
_STRIKE = re.compile(r"~~(?=\S)(.+?)(?<=\S)~~", re.S)
_EM_STAR = re.compile(r"\*(?=\S)([^*]+?)(?<=\S)\*")
# The underscore forms carry an extra word-boundary guard. Without it the
# stripper would eat the middle of every snake_case identifier an engine
# mentions — `read_file_sync` becomes `readfilesync`.
_STRONG_UNDER = re.compile(r"(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)", re.S)
_EM_UNDER = re.compile(r"(?<!\w)_(?=\S)([^_]+?)(?<=\S)_(?!\w)")

_URL_SCHEME = re.compile(r"^(?:[a-z][a-z0-9+.\-]*:)?//|^mailto:", re.I)


def _mask_escapes(text: str) -> str:
    return _ESCAPE_RE.sub(
        lambda m: chr(_PUA + _ESCAPABLE.index(m.group(1))), text)


def _unmask_escapes(text: str) -> str:
    for i, ch in enumerate(_ESCAPABLE):
        text = text.replace(chr(_PUA + i), ch)
    return text


def _link(m: "re.Match") -> str:
    """`[label](url)` -> `label (url)`, or just the label for a relative one.

    A URL is the actionable half of a link and has to survive; a repo-relative
    target is noise once the surrounding markup is gone.
    """
    label, url = m.group(1).strip(), m.group(2).strip()
    if url and _URL_SCHEME.search(url):
        return f"{label} ({url})" if label else url
    return label


def strip_markdown(text: str) -> str:
    """Render Markdown-ish text as the plain text Telegram will actually show.

    Not a parser and not trying to be: it removes the markers that read as
    noise (emphasis, code spans, headings, blockquotes, rules, links) and
    leaves everything else exactly as written. That bias matters because this
    runs over *every* plain outbound message, including Hermes' own status
    lines — `step 0 [code]: coded` and `run *.py` must come out untouched.
    """
    if not text:
        return text
    out = _mask_escapes(text)
    lines = []
    for line in out.split("\n"):
        if _FENCE_LINE.match(line):
            continue                      # drop the fence, keep the code
        if _RULE_LINE.match(line):
            continue
        line = _QUOTE.sub("", line)
        line = _HEADING.sub("", line)
        lines.append(line)
    out = "\n".join(lines)
    out = _IMAGE.sub(r"\1", out)
    out = _LINK.sub(_link, out)
    out = _CODE_SPAN.sub(r"\1", out)
    out = _STRONG_STAR.sub(r"\1", out)
    out = _STRONG_UNDER.sub(r"\1", out)
    out = _STRIKE.sub(r"\1", out)
    out = _EM_STAR.sub(r"\1", out)
    out = _EM_UNDER.sub(r"\1", out)
    return _unmask_escapes(out)


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
