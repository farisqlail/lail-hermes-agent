"""How a parked MCP write action looks in Telegram, and how a tap comes back.

Same split as hermes/ask_ui.py, same reason: everything here is a pure
function over a PendingAction, testable without a bot token.
"""
from __future__ import annotations
import json
from .pending_actions import PendingAction

CB_PREFIX = "pend"
ARGS_PREVIEW_MAX = 300


def pending_text(pa: PendingAction) -> str:
    args = json.dumps(pa.args, ensure_ascii=False)
    if len(args) > ARGS_PREVIEW_MAX:
        args = args[:ARGS_PREVIEW_MAX - 1] + "\u2026"
    return (f"\u26a0\ufe0f Aksi menulis/mengirim menunggu persetujuan:\n"
            f"{pa.summary()}\n{args}\n\n"
            "Tekan salah satu tombol, atau balas dengan 'konfirmasi' / 'batal'.")


def keyboard(pa: PendingAction):
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("\u2705 Jalankan", callback_data=f"{CB_PREFIX}:{pa.id}:yes"),
        InlineKeyboardButton("\u274c Batal", callback_data=f"{CB_PREFIX}:{pa.id}:no"),
    ]])


def parse_callback(data: str) -> tuple[str, bool] | None:
    parts = (data or "").split(":")
    if len(parts) != 3 or parts[0] != CB_PREFIX or not parts[1]:
        return None
    pid, ans = parts[1], parts[2]
    if ans not in ("yes", "no"):
        return None
    return (pid, ans == "yes")
