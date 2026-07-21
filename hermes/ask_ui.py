"""How a pending Ask looks in Telegram, and how a tap comes back.

Split from main.py so the rendering and parsing are testable without a bot:
everything above `make_handlers` is a pure function over an `Ask`.
"""
from __future__ import annotations
from .ask import Ask, AskRegistry

CB_PREFIX = "ask"
LABEL_MAX = 60      # button faces stay readable on a phone
_UNCHECKED, _CHECKED = "☐", "☑"


def _clip(label: str) -> str:
    label = " ".join(str(label).split())     # newlines break button layout
    return label if len(label) <= LABEL_MAX else label[:LABEL_MAX - 1] + "…"


def question_text(ask: Ask) -> str:
    """Plain text only: sender() sends without parse_mode, so any markup
    marker here would reach the operator literally."""
    lines = [f"❓ {ask.question}"]
    for i, opt in enumerate(ask.options, 1):
        desc = str(opt.get("description", "")).strip()
        lines.append(f"{i}. {opt.get('label', '')}" + (f" — {desc}" if desc else ""))
    lines.append("")
    lines.append("Pilih beberapa lalu tekan Kirim, atau balas dengan teks."
                 if ask.multi else
                 "Tekan salah satu tombol, atau balas dengan teks.")
    return "\n".join(lines)


def keyboard_rows(ask: Ask) -> list[list[tuple[str, str]]]:
    """One option per row. Labels never enter callback_data — indices do, which
    is what keeps every payload inside Telegram's 64-byte cap."""
    rows = []
    for i, opt in enumerate(ask.options):
        face = _clip(opt.get("label", ""))
        if ask.multi:
            face = f"{_CHECKED if i in ask.selected else _UNCHECKED} {face}"
            face = _clip(face)
        rows.append([(face, f"{CB_PREFIX}:{ask.ask_id}:{i}")])
    if ask.multi:
        rows.append([("✅ Kirim", f"{CB_PREFIX}:{ask.ask_id}:ok")])
    return rows


def to_markup(rows):
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton(face, callback_data=data) for face, data in row]
         for row in rows])


def parse_callback(data: str) -> tuple[str, str, int] | None:
    parts = (data or "").split(":")
    if len(parts) != 3 or parts[0] != CB_PREFIX or not parts[1]:
        return None
    ask_id, tail = parts[1], parts[2]
    if tail == "ok":
        return (ask_id, "ok", -1)
    if tail.isdigit():
        return (ask_id, "opt", int(tail))
    return None


def make_handlers(registry: AskRegistry, sender, edit_markup):
    """Build the two coroutines main.py wires into python-telegram-bot.

    `sender` is the shared async (chat_id, text) sender; `edit_markup` is an
    async (chat_id, message_id, markup) used to redraw a multi-select keyboard
    in place. Both may be None in tests that only exercise routing.
    """

    async def on_ask_callback(ask_id: str, kind: str, idx: int,
                              message_id: int | None = None) -> str:
        """Returns the short toast text for `CallbackQuery.answer`."""
        ask = registry.get(ask_id)
        if ask is None:
            return "Pertanyaan ini sudah tidak aktif."
        if kind == "ok":
            if not ask.selected:
                return "Pilih dulu minimal satu."
            registry.answer_options(ask_id, sorted(ask.selected))
            return "Terkirim."
        if not ask.multi:
            registry.answer_options(ask_id, [idx])
            return "Terkirim."
        registry.toggle(ask_id, idx)
        if edit_markup is not None and message_id is not None:
            try:
                await edit_markup(ask.chat_id, message_id,
                                  to_markup(keyboard_rows(ask)))
            except Exception:
                # Telegram rejects an edit that changes nothing, and a redraw
                # failure must not lose the selection the registry already has.
                pass
        return ""

    async def on_ask_text(chat_id: int, text: str) -> bool:
        """True when this message was consumed as an answer."""
        ask_id = registry.pending_for_chat(chat_id)
        if ask_id is None:
            return False
        return registry.answer(ask_id, text)

    return on_ask_callback, on_ask_text
