"""Self-initiated work: the one place Hermes acts without an incoming message.

Everything else in this codebase is reactive — a Telegram message, a web chat
turn, a button tap. This module is the exception: a single background loop,
started once in `main.run()`, that wakes on a fixed interval and decides whether
there is anything to do on its own. Three jobs, each independently gated in
Settings and each best-effort:

  * DAILY BRIEF — once a day at a configured local time, push a morning digest
    (today's calendar + how tasks have been failing lately) to the operator.
  * WATCHER — watch a folder; when a new, settled file appears, queue a task
    about it through the same Bridge a human `/task` goes through.
  * AUTO-RETRY — re-submit a task that failed for a TRANSIENT reason (the
    endpoint was busy), which an in-task retry could not outlast but a later one
    can. Only transient, only once per task, only recent ones.

Design rules that keep an autonomous loop safe:

  * Master switch off by default. An agent that starts doing things on its own
    is a surprise; the operator opts in.
  * State persists (config_dir/proactive_state.json) so a restart does not
    re-fire today's brief, re-process every file in the watch dir, or re-retry
    an old failure. On first run the state is *primed* to "now": existing files
    and existing failures are recorded as already-seen, so the loop only ever
    acts on what happens after it started.
  * Nothing here raises out of a tick. A blown sub-job logs and the loop lives.
    The queued work still runs through Bridge's own risk gate — proactivity does
    not bypass confirm_risky.

The decision functions are pure and clock-injected so the whole policy is
testable without a database, a network, or real time.
"""
from __future__ import annotations
import asyncio, json, time
from datetime import datetime
from pathlib import Path

from . import failure, postmortem

# One tick a minute is plenty: the daily brief is minute-accurate, the watcher's
# files are settled before pickup anyway, and a retry that waits an extra minute
# for a busy endpoint to recover is no worse for the wait.
TICK_S = 60

# A settled file has not been written to for this long. A file still being
# copied in has a fresh mtime; waiting this out avoids queuing a half-written
# upload as though it were done.
FILE_SETTLE_S = 5

# Only auto-retry failures this recent. On startup the loop primes over the
# whole history, but a failure that slips through (created just before a
# restart) must not resurrect a task from last week. Six hours: long enough that
# a transient outage has plausibly cleared, short enough that nothing stale runs.
RETRY_WINDOW_S = 6 * 3600

# chat_id sentinel meaning "no Telegram chat" — mirrors main.NO_CHAT. A proactive
# task with no configured operator chat is queued silently (visible in the web
# UI) rather than crashing on a send to a chat that does not exist.
NO_CHAT = 0


def _safe(e: object) -> str:
    """str() that print() can never choke on, on a redirected legacy-codepage
    stdout. Same guarantee as main._console_safe, duplicated so this module
    carries no import from main (which imports half the app)."""
    return str(e).encode("ascii", errors="backslashreplace").decode("ascii")


def _log(msg: str) -> None:
    print(f"[proactive] {msg}")


# --- state persistence -------------------------------------------------------

def _default_state() -> dict:
    return {"last_daily": "", "seen_files": [], "retried": [], "primed": False}


def load_state(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _default_state()
    base = _default_state()
    if isinstance(data, dict):
        base.update({k: data[k] for k in base if k in data})
    return base


def save_state(path: Path, state: dict) -> None:
    """Atomic write, so a reader (or the next tick after a crash) never sees a
    half-written file. Best-effort: losing state costs a duplicate brief, not a
    task."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        tmp.replace(path)
    except OSError as e:
        _log(f"could not save state: {_safe(e)}")


# --- daily brief -------------------------------------------------------------

def _parse_hhmm(text: str) -> tuple[int, int]:
    """"HH:MM" -> (hour, minute), falling back to 08:00 on anything malformed —
    a bad time string must schedule the brief, not crash the loop."""
    try:
        hh, mm = text.split(":", 1)
        h, m = int(hh), int(mm)
        if 0 <= h <= 23 and 0 <= m <= 59:
            return h, m
    except (ValueError, AttributeError):
        pass
    return 8, 0


def daily_due(settings, state: dict, now: datetime) -> bool:
    """True when today's brief has not gone out yet and the clock has reached
    its time. One per calendar day: `last_daily` holds the date it last fired."""
    if state.get("last_daily") == now.date().isoformat():
        return False
    h, m = _parse_hhmm(getattr(settings, "proactive_daily_time", "08:00"))
    return (now.hour, now.minute) >= (h, m)


def _fmt_events(events: list[dict]) -> str:
    if not events:
        return "📅 Tidak ada agenda hari ini."
    lines = ["📅 Agenda hari ini:"]
    for e in events:
        # start is an isoformat string "...THH:MM"; the clock is its tail.
        clock = "sepanjang hari" if e.get("all_day") else e["start"].split("T")[-1]
        loc = f" @ {e['location']}" if e.get("location") else ""
        lines.append(f"- {clock} — {e['summary']}{loc}")
    return "\n".join(lines)


async def build_daily(settings, store, ics_upcoming, now: datetime) -> str:
    """The morning digest: calendar first (if a calendar URL is configured),
    then the failure picture from recent tasks. Each half is guarded — a broken
    calendar fetch must not cost the failure summary, and vice versa."""
    parts = [f"☀️ *Morning brief* — {now.strftime('%A, %d %b %Y')}"]

    url = getattr(settings, "calendar_ics_url", "")
    if url and ics_upcoming is not None:
        try:
            events = await ics_upcoming(url, days=1, now=now)
            parts.append(_fmt_events(events))
        except Exception as e:
            parts.append(f"📅 (gagal baca kalender: {_safe(e)})")

    try:
        summary = postmortem.summarize(store.list_tasks(limit=50), store.get_logs)
        parts.append(postmortem.render(summary))
    except Exception as e:
        parts.append(f"(gagal ringkas kegagalan: {_safe(e)})")

    return "\n\n".join(parts)


# --- watcher -----------------------------------------------------------------

def _is_settled(p: Path, now_ts: float) -> bool:
    """A real file that has not changed in FILE_SETTLE_S. Skips directories,
    hidden files, and the partial-download suffixes browsers and copy tools
    leave behind."""
    try:
        if not p.is_file():
            return False
        if p.name.startswith(".") or p.suffix.lower() in (".tmp", ".part", ".crdownload"):
            return False
        return (now_ts - p.stat().st_mtime) >= FILE_SETTLE_S
    except OSError:
        return False


def scan_new_files(settings, state: dict, now_ts: float) -> list[str]:
    """New, settled files in the watch dir since the last scan. Records them in
    `state["seen_files"]` so each file is reported exactly once, and never
    yields a file already seen even if it is later modified — the trigger is
    arrival, not every edit."""
    d = getattr(settings, "proactive_watch_dir", "")
    if not d:
        return []
    base = Path(d)
    if not base.is_dir():
        return []
    seen = set(state.get("seen_files", []))
    found = []
    for p in sorted(base.iterdir()):
        key = str(p)
        if key in seen:
            continue
        if _is_settled(p, now_ts):
            found.append(key)
            seen.add(key)
    if found:
        # Bound the record so a busy dir cannot grow the state file without
        # limit; the newest 1000 names is far more than any watch needs.
        state["seen_files"] = (state.get("seen_files", []) + found)[-1000:]
    return found


def watch_prompt(settings, file_path: str) -> str:
    """The task text for a newly-arrived file: the operator's template with the
    path appended, or a sane default when no template is set."""
    tmpl = (getattr(settings, "proactive_watch_prompt", "") or "").strip()
    if tmpl:
        return f"{tmpl}\n\nBerkas: {file_path}"
    return (f"Sebuah berkas baru muncul di folder pantauan: {file_path}\n"
            "Periksa isinya dan lakukan tindakan yang sesuai.")


# --- auto-retry --------------------------------------------------------------

def retry_candidates(store, state: dict, now_ts: float,
                     max_fire: int) -> list[dict]:
    """Failed tasks worth re-submitting: transient cause, not retried before,
    recent. A task outside the window is marked retried in passing so it is not
    re-examined every tick for the rest of the run."""
    retried = set(state.get("retried", []))
    out = []
    for t in store.list_tasks(limit=50):
        tid = t["task_id"]
        if t.get("status") != "failed" or tid in retried:
            continue
        cause = postmortem.cause(store.get_logs(tid))
        if failure.classify(cause) != failure.TRANSIENT:
            retried.add(tid)                      # never a candidate; stop re-reading
            continue
        if now_ts - (t.get("created") or 0) > RETRY_WINDOW_S:
            retried.add(tid)                      # too old to resurrect
            continue
        out.append(t)
        if len(out) >= max_fire:
            break
    state["retried"] = list(retried)[-1000:]
    return out


# --- priming -----------------------------------------------------------------

def prime(settings, store, state: dict, now_ts: float) -> None:
    """First-run baseline: record current files and current failures as already
    handled, so the loop acts only on what happens after it starts — not on the
    entire backlog the moment it is switched on."""
    d = getattr(settings, "proactive_watch_dir", "")
    if d and Path(d).is_dir():
        state["seen_files"] = [str(p) for p in Path(d).iterdir()][-1000:]
    try:
        state["retried"] = [t["task_id"] for t in store.list_tasks(limit=50)
                            if t.get("status") == "failed"][-1000:]
    except Exception:
        pass
    # A brief already sent today (before the loop existed) should not fire on
    # boot; one that has not will fire at its time as usual.
    state["last_daily"] = state.get("last_daily") or ""
    state["primed"] = True


# --- the tick ----------------------------------------------------------------

async def tick(settings, store, bridge, ics_upcoming, state: dict,
               now: datetime) -> bool:
    """Run one round of every enabled job. Returns True if state changed (so the
    caller knows to persist). Each job is isolated: one failing must not skip the
    others."""
    now_ts = now.timestamp()
    changed = False
    chat_id = int(getattr(settings, "proactive_chat_id", 0) or 0)

    # DAILY BRIEF
    if getattr(settings, "proactive_daily_enabled", False):
        try:
            if daily_due(settings, state, now):
                text = await build_daily(settings, store, ics_upcoming, now)
                if chat_id != NO_CHAT:
                    await bridge.sender(chat_id, text)
                else:
                    _log("daily brief ready but no proactive_chat_id set; skipped send")
                state["last_daily"] = now.date().isoformat()
                changed = True
        except Exception as e:
            _log(f"daily brief failed: {_safe(e)}")

    # WATCHER
    if getattr(settings, "proactive_watch_enabled", False):
        try:
            for f in scan_new_files(settings, state, now_ts):
                changed = True
                await bridge.handle_task(
                    user_id=0, chat_id=chat_id, text=watch_prompt(settings, f),
                    trusted=True)
                _log(f"queued task for new file: {f}")
        except Exception as e:
            _log(f"watcher failed: {_safe(e)}")

    # AUTO-RETRY
    if getattr(settings, "proactive_retry_enabled", False):
        try:
            cap = int(getattr(settings, "proactive_retry_max", 3) or 3)
            cands = retry_candidates(store, state, now_ts, cap)
            if cands:
                changed = True
            for t in cands:
                state.setdefault("retried", []).append(t["task_id"])
                await bridge.handle_task(
                    user_id=0, chat_id=chat_id, text=t["text"], trusted=True)
                _log(f"auto-retried transient failure: {t['task_id']}")
        except Exception as e:
            _log(f"auto-retry failed: {_safe(e)}")

    return changed


async def run_loop(*, store, bridge, ics_upcoming=None, load_settings=None,
                   state_path: Path | None = None, sleep=asyncio.sleep,
                   clock=None, max_ticks: int | None = None) -> None:
    """The forever loop. Started once from main.run() as a fire-and-forget task.

    Settings are re-read every tick (`load_settings`), so toggling a job in the
    web UI takes effect within a tick with no restart. The whole body is wrapped
    so a bug in one tick sleeps and tries again rather than killing the only
    autonomous thread in the process.

    `max_ticks` bounds the loop for tests; None runs forever.
    """
    from . import config, paths
    load_settings = load_settings or config.load_settings
    state_path = state_path or (paths.config_dir() / "proactive_state.json")
    clock = clock or (lambda: datetime.now().astimezone())

    state = load_state(state_path)
    ticks = 0
    while max_ticks is None or ticks < max_ticks:
        ticks += 1
        try:
            settings = load_settings()
            if getattr(settings, "proactive_enabled", False):
                if not state.get("primed"):
                    prime(settings, store, state, clock().timestamp())
                    save_state(state_path, state)
                if await tick(settings, store, bridge, ics_upcoming, state, clock()):
                    save_state(state_path, state)
        except Exception as e:
            _log(f"tick crashed: {_safe(e)}")
        await sleep(TICK_S)
