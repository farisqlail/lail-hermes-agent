"""What Hermes knows about the operator, and what it says while it works.

Three things live here, all of them pure string/dict work so they can be
tested without a database, a model or a browser:

* `context_block` — the situational preamble handed to the chat agent: the
  clock, the project in play, what is running right now, and the facts learned
  about the operator. Same shape and same reason as `plan_context.build`: the
  agent cannot answer "apa yang lagi jalan?" from the conversation alone, and
  asking a model to guess is worse than telling it.
* `FACT_SYSTEM` / `parse_facts` — the extractor's instruction and the reader
  for what it answers. Extraction itself is a model call the caller owns.
* `speech_for` — turns one store event into the utterance the dashboard should
  speak, or None. Server-side on purpose: the browser used to decide this, so
  narration only happened on the page that held the notify effect.

Nothing here does I/O; every caller gathers the facts first.
"""
from __future__ import annotations
import json
import re
from datetime import datetime

from .orchestrator import json_objects
from .project_resolve import parse_project_ref

# Statuses that mean a task is still in play. Mirrors session_store.INTERRUPTIBLE
# — same set, different purpose: that one retires them at startup, this one
# reports them to the agent.
LIVE_STATUSES = ("running", "queued", "awaiting_confirm")

# Facts are cheap to store and expensive to read: every one rides in the prompt
# on every chat turn. Beyond this the oldest stop being sent (they stay in the
# table, so nothing the operator said is silently destroyed).
MAX_FACTS_IN_PROMPT = 25

_DAYS = ("Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu")
_MONTHS = ("Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
           "Agustus", "September", "Oktober", "November", "Desember")


def time_of_day(now: datetime | None = None) -> str:
    """Indonesian time-of-day bucket. Server-side on purpose: the wake-word and
    Telegram paths that reuse this have no browser clock to ask.

    Lives here rather than in voice.py — which re-exports it — because voice.py
    imports edge_tts at module scope, and neither the context block nor the
    planner should drag a speech dependency in to ask what time it is.
    """
    h = (now or datetime.now()).hour
    return "pagi" if h < 11 else "siang" if h < 15 else "sore" if h < 18 else "malam"


def _stamp(now: datetime) -> str:
    """A human date in Indonesian. `strftime('%A')` follows the process locale,
    which on this app's Windows host is English — the one language the agent is
    told not to default to."""
    return (f"{_DAYS[now.weekday()]}, {now.day} {_MONTHS[now.month - 1]} "
            f"{now.year}, {now:%H:%M}")


def active_project(tasks: list[dict]) -> str:
    """The project the operator is working in, or "".

    Read off the most recent task that names one with the @ sigil. Hermes has
    no "currently open project" — a task is the only moment a project is ever
    named — so the newest reference is the best available answer. `tasks` is
    expected newest-first, as `Store.list_tasks` returns it.
    """
    for t in tasks:
        name, _ = parse_project_ref(t.get("text") or "")
        if name:
            return name
    return ""


def context_block(facts: list[dict], tasks: list[dict], projects: list[str],
                  now: datetime | None = None) -> str:
    """The situational preamble, as one system message.

    Always non-empty: even with no facts and no tasks, the clock and the
    registry are worth stating — "jam berapa sekarang" and "proyek apa saja
    yang terdaftar" are both questions the agent would otherwise invent an
    answer to.
    """
    now = now or datetime.now()
    lines = ["# Konteks saat ini",
             f"Waktu: {_stamp(now)} ({time_of_day(now)})"]

    proj = active_project(tasks)
    if proj:
        lines.append(f"Proyek yang sedang dikerjakan: @{proj} "
                     "(dari task terakhir yang menyebut proyek)")
    lines.append("Proyek terdaftar: " + (", ".join(sorted(projects)) or "(belum ada)"))

    live = [t for t in tasks if t.get("status") in LIVE_STATUSES]
    if live:
        lines.append("Task yang masih berjalan / menunggu:")
        lines += [f"- {t['task_id']} [{t['status']}] {(t.get('text') or '').strip()[:80]}"
                  for t in live[:5]]
    else:
        lines.append("Tidak ada task yang sedang berjalan.")

    if facts:
        lines.append("")
        lines.append("# Yang kamu ingat tentang operator")
        lines += [f"- {f['key']}: {f['value']}" for f in facts[:MAX_FACTS_IN_PROMPT]]
        lines.append("Pakai fakta ini agar jawabanmu personal. Jangan membacakannya "
                     "kembali apa adanya, dan jangan mengarang fakta baru di sini.")
    return "\n".join(lines)


# ── automatic fact extraction ──
# Runs after a chat turn, on the turn's own text. Deliberately a separate,
# tiny model call rather than an extra tool on the chat agent: a tool the
# agent may call is a tool it forgets to call, and the extraction prompt can
# be blunt in a way the conversational system prompt cannot.

FACT_SYSTEM = (
    "Kamu adalah pengekstrak fakta. Baca percakapan berikut dan keluarkan HANYA "
    "objek JSON:\n"
    '{"facts":[{"key":"slug_singkat","value":"fakta dalam satu kalimat"}]}\n\n'
    "ATURAN:\n"
    "1. Simpan HANYA fakta yang tahan lama tentang operator: preferensi, "
    "kebiasaan kerja, proyek favorit, gaya komunikasi, jadwal rutin, alat yang "
    "dipakai.\n"
    "2. JANGAN simpan hal sesaat: pertanyaan, status task, error, isi kode, "
    "atau apa pun yang hanya berlaku hari ini.\n"
    "3. JANGAN simpan fakta tentang dirimu sendiri atau tentang Hermes.\n"
    "4. `key` adalah slug singkat huruf kecil dengan garis bawah, mis. "
    '"hari_deploy". Fakta yang sama harus selalu memakai key yang sama agar '
    "menimpa nilai lama.\n"
    "5. Kalau tidak ada yang layak disimpan, keluarkan {\"facts\":[]}.\n"
    "6. Tulis `value` dalam bahasa yang dipakai operator."
)

#: Per turn. A model that suddenly "learns" ten things has started summarising
#: the conversation rather than extracting facts from it.
MAX_FACTS_PER_TURN = 5
MAX_KEY_LEN = 40
MAX_VALUE_LEN = 200


def _slug(key: str) -> str:
    out = "".join(c if c.isalnum() else "_" for c in key.strip().lower())
    while "__" in out:
        out = out.replace("__", "_")
    return out.strip("_")[:MAX_KEY_LEN]


def parse_facts(raw: str) -> list[dict]:
    """Read the extractor's answer. Never raises — a turn that produced junk
    teaches Hermes nothing, which is the same outcome as an empty list and must
    not take the chat turn down with it."""
    try:
        for data in json_objects(raw or ""):
            items = data.get("facts")
            if not isinstance(items, list):
                continue
            out: dict[str, str] = {}
            for item in items:
                if not isinstance(item, dict):
                    continue
                key = _slug(str(item.get("key") or ""))
                value = str(item.get("value") or "").strip()[:MAX_VALUE_LEN]
                if key and value:
                    out[key] = value          # last write per key wins
            return [{"key": k, "value": v}
                    for k, v in list(out.items())[:MAX_FACTS_PER_TURN]]
    except Exception:
        pass
    return []


# Words that, alone, carry no durable fact — greetings and acknowledgements. A
# turn made only of these is not worth a model call. Kept small and lowercase;
# the point is to catch the common trivial turns, not every possible one.
_ACK_WORDS = frozenset({
    "ok", "oke", "okay", "sip", "siap", "makasih", "terima", "kasih", "thanks",
    "thx", "ya", "iya", "yaudah", "yoi", "mantap", "noted", "baik", "oks",
    "halo", "hai", "hi", "hello", "hey", "pagi", "siang", "sore", "malam",
    "bye", "dah", "udah", "yes", "no", "yup", "nope", "wkwk", "haha",
})

#: A turn shorter than this (characters) cannot state a durable fact worth the
#: extraction call. "nama saya Faris" clears it; "ok" and "makasih" do not.
_MIN_EXTRACT_CHARS = 8


def worth_extracting(user_text: str) -> bool:
    """Whether this turn is worth a fact-extraction model call.

    Extraction runs on every chat turn, and most turns — greetings, one-word
    acknowledgements, "ok makasih" — carry nothing durable. Skipping those is a
    free saving on tokens and latency. Deliberately conservative: it only rules
    out turns that are plainly trivial (too short, or made entirely of
    acknowledgement words), so a real fact is never dropped to save a call.
    """
    t = (user_text or "").strip()
    if len(t) < _MIN_EXTRACT_CHARS:
        return False
    words = [w for w in re.split(r"[^\wÀ-ÿ]+", t.lower()) if w]
    if len(words) < 3:
        return False
    if all(w in _ACK_WORDS for w in words):
        return False
    return True


def conversation_snippet(user_text: str, reply: str) -> str:
    """The one turn handed to the extractor. The operator's own words carry
    nearly every durable fact, so the reply is included only as context and
    truncated hard — a long answer would otherwise dominate the prompt."""
    return f"OPERATOR: {user_text.strip()[:1500]}\nASISTEN: {reply.strip()[:500]}"


# ── real-time narration ──

_STEP_NARRATION = {
    "code": "Saya mulai mengerjakan kodenya sekarang.",
    "build": "Saya jalankan build sekarang.",
    "test": "Saya mulai pengujian sekarang.",
}


def step_narration(kind: str | None) -> str:
    """What to say as a step starts. Fixed strings, not a model call: this
    fires on every step of every task, and a sentence that costs a completion
    (and a second of latency) to say "starting the build" is a bad trade."""
    if not kind:
        return ""
    return _STEP_NARRATION.get(kind, f"Saya mulai langkah {kind} sekarang.")


def speech_for(event: dict, settings, task_text=None) -> dict | None:
    """The utterance one store event should produce, or None for silence.

    `task_text` is a callable the caller supplies (a store lookup) — kept out
    of here so this stays pure. It is only consulted for the events that need
    it, so a task-less event costs no query.

    Two gates, both off by default in `Settings`: `tts_task_notify` for the
    end-of-task announcement, `tts_narrate` for the running commentary. With
    TTS off entirely, neither fires.
    """
    if not getattr(settings, "tts_enabled", False):
        return None
    kind = event.get("type")
    if kind == "task_status" and event.get("status") in ("done", "failed"):
        if not getattr(settings, "tts_task_notify", False):
            return None
        text = (task_text(event["task_id"]) if task_text else "") or ""
        return {"type": "speak", "intent": "notify",
                "task_id": event.get("task_id"),
                "task_text": text, "task_status": event["status"]}
    if kind == "step_status" and event.get("status") == "running":
        if not getattr(settings, "tts_narrate", False):
            return None
        line = step_narration(event.get("kind"))
        if not line:
            return None
        return {"type": "speak", "intent": "say",
                "task_id": event.get("task_id"), "text": line}
    return None


def sse(obj: dict) -> str:
    """One Server-Sent Event frame. Here rather than in web_ui because both the
    event stream and its tests need the exact wire shape."""
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
