from __future__ import annotations

_MAX_LISTED = 5
_MAX_TEXT = 60

# awaiting_confirm is reported apart from the rest: its inline buttons are dead
# after a restart (bridge.pending is in-memory), so its required action differs.
_WAITING = "awaiting_confirm"


def _line(row: dict) -> str:
    text = row["text"] or ""
    if len(text) > _MAX_TEXT:
        text = text[:_MAX_TEXT - 1] + "…"
    return f"  {row['task_id']}  {text}"


def _section(title: str, rows: list[dict]) -> list[str]:
    if not rows:
        return []
    out = [title]
    out += [_line(r) for r in rows[:_MAX_LISTED]]
    extra = len(rows) - _MAX_LISTED
    if extra > 0:
        out.append(f"  …and {extra} more — see http://127.0.0.1:8799")
    out.append("")
    return out


def group_digests(swept: list[dict]) -> list[tuple[int, str]]:
    """One restart notice per affected chat.

    `swept` is the output of Store.sweep_interrupted(): rows carrying the
    status each task held before it was retired.
    """
    by_chat: dict[int, list[dict]] = {}
    for row in swept:                       # dict preserves first-seen order
        by_chat.setdefault(row["chat_id"], []).append(row)

    digests = []
    for chat_id, rows in by_chat.items():
        waiting = [r for r in rows if r["status"] == _WAITING]
        started = [r for r in rows if r["status"] != _WAITING]
        n = len(rows)
        parts = [f"Hermes restarted. {n} task{'s' if n != 1 else ''} "
                 f"{'were' if n != 1 else 'was'} interrupted:", ""]
        parts += _section("Running at restart:", started)
        parts += _section(
            "Waiting for confirmation (the buttons are dead — please resubmit):",
            waiting)
        parts.append("Nothing was resumed automatically.")
        digests.append((chat_id, "\n".join(parts)))
    return digests
