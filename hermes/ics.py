"""Read a calendar from a published iCalendar (.ics) URL.

Google Calendar hands out a "secret address in iCal format" per calendar: a
long unguessable https URL serving the whole calendar as text. That is the only
way to read a Google calendar without registering an OAuth client in a Google
Cloud project, so it is what Hermes uses — the URL is the credential, and it is
read-only by construction (there is no way to write back through it).

Parsing is done here rather than handed to the model: an .ics export of a busy
calendar is tens of kilobytes of folded text with recurrence rules, and asking
an LLM to expand an RRULE by hand is both expensive and wrong often enough to
matter. This returns the concrete occurrences inside a window instead.

Scope, deliberately: FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT,
UNTIL, BYDAY (weekly) and EXDATE. That covers ordinary standing meetings.

ponytail: BYMONTHDAY/BYSETPOS ("last Friday of the month") and RECURRENCE-ID
(one instance of a series moved to another time — it is reported twice, at both
the old and the new slot) are not handled. Reach for the `icalendar` +
`recurring-ical-events` packages if either starts mattering; they are a real
dependency, which is why they are not here for a seven-day read.
"""
from __future__ import annotations
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# A window is days, not years, so an event list is a reading, not a dataset.
MAX_EVENTS = 200

# ponytail: a recurring event that started years ago is walked one occurrence at
# a time from its DTSTART, so the cap is what stops a malformed or endless rule
# (COUNT missing, UNTIL in the far future) from spinning. 5000 daily occurrences
# is ~13 years of history, well past any real calendar's start.
_MAX_OCCURRENCES = 5000

_WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def _unfold(text: str) -> list[str]:
    """RFC 5545 line unfolding: a leading space or tab continues the line above.

    Exporters wrap at 75 octets mid-word, so a SUMMARY is routinely split across
    lines; joining first is what makes every later split safe.
    """
    out: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and out:
            out[-1] += raw[1:]
        else:
            out.append(raw)
    return out


def _parse_line(line: str) -> tuple[str, dict[str, str], str]:
    """"NAME;PARAM=VAL:value" -> ("NAME", {"PARAM": "VAL"}, "value")."""
    head, sep, value = line.partition(":")
    if not sep:
        return ("", {}, "")
    name, *param_parts = head.split(";")
    params = {}
    for p in param_parts:
        k, eq, v = p.partition("=")
        if eq:
            params[k.upper()] = v.strip('"')
    return (name.upper(), params, value)


def _unescape(v: str) -> str:
    # TEXT values escape comma, semicolon, backslash and newline (RFC 5545 3.3.11).
    return (v.replace("\\n", "\n").replace("\\N", "\n")
             .replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\"))


def _zone(params: dict[str, str], default: timezone | ZoneInfo):
    tzid = params.get("TZID")
    if not tzid:
        return default
    try:
        return ZoneInfo(tzid)
    except (ZoneInfoNotFoundError, ValueError):
        # An exporter's own zone id we cannot resolve (no tzdata on this box).
        # Falling back to the operator's zone keeps the event visible with a
        # possibly-wrong clock time, which beats dropping it silently.
        return default


def _parse_dt(value: str, params: dict[str, str], local) -> tuple[datetime, bool]:
    """One DTSTART/DTEND/EXDATE value -> (aware datetime, is_all_day).

    All-day values (VALUE=DATE, "20260804") are anchored at local midnight so
    every occurrence in this module is directly comparable.
    """
    value = value.strip()
    if params.get("VALUE") == "DATE" or (len(value) == 8 and "T" not in value):
        d = datetime.strptime(value, "%Y%m%d")
        return (d.replace(tzinfo=local), True)
    if value.endswith("Z"):
        return (datetime.strptime(value, "%Y%m%dT%H%M%SZ")
                .replace(tzinfo=timezone.utc), False)
    naive = datetime.strptime(value, "%Y%m%dT%H%M%S")
    return (naive.replace(tzinfo=_zone(params, local)), False)


def _add_months(dt: datetime, months: int) -> datetime | None:
    """Same day-of-month, `months` later. None when that day does not exist in
    the target month (31 Jan + 1 month) — RFC 5545 skips those, it does not
    clamp them back to the 28th."""
    total = dt.month - 1 + months
    year, month = dt.year + total // 12, total % 12 + 1
    try:
        return dt.replace(year=year, month=month)
    except ValueError:
        return None


def _parse_rrule(value: str) -> dict[str, str]:
    parts = {}
    for chunk in value.split(";"):
        k, eq, v = chunk.partition("=")
        if eq:
            parts[k.upper()] = v
    return parts


def _occurrences(start: datetime, rrule: dict[str, str], exdates: set[datetime],
                 window_end: datetime, local) -> list[datetime]:
    """Every start time this event has, up to `window_end`.

    Occurrences are computed from DTSTART by index rather than by stepping off
    the previous one: a monthly rule skips months that lack the day, and
    stepping would then drift the whole series onto the wrong day.
    """
    if not rrule:
        return [start] if start not in exdates else []
    freq = rrule.get("FREQ", "").upper()
    try:
        interval = max(1, int(rrule.get("INTERVAL", "1")))
        count = int(rrule["COUNT"]) if "COUNT" in rrule else None
    except ValueError:
        return [start]
    until = None
    if "UNTIL" in rrule:
        try:
            until, _ = _parse_dt(rrule["UNTIL"], {}, local)
        except ValueError:
            until = None
    bydays = [_WEEKDAYS[d[-2:]] for d in rrule.get("BYDAY", "").split(",")
              if d[-2:] in _WEEKDAYS]

    out: list[datetime] = []
    emitted = 0
    # Monday of DTSTART's week — the anchor a WEEKLY;BYDAY series counts from.
    week0 = start - timedelta(days=start.weekday())
    for i in range(_MAX_OCCURRENCES):
        if freq == "DAILY":
            candidates = [start + timedelta(days=i * interval)]
        elif freq == "WEEKLY":
            base = week0 + timedelta(weeks=i * interval)
            candidates = ([base + timedelta(days=d) for d in sorted(bydays)]
                          if bydays else [start + timedelta(weeks=i * interval)])
        elif freq == "MONTHLY":
            candidates = [_add_months(start, i * interval)]
        elif freq == "YEARLY":
            candidates = [_add_months(start, 12 * i * interval)]
        else:
            return [start]                      # unknown FREQ: show it once
        # A BYDAY week can begin before DTSTART; those are not occurrences.
        candidates = [c for c in candidates if c is not None and c >= start]
        if not candidates:
            # Nothing this cycle (skipped month, or pre-DTSTART week). Only stop
            # once the cycle itself has run past the window.
            probe = week0 + timedelta(weeks=i * interval) if freq == "WEEKLY" \
                else start + timedelta(days=i * interval)
            if probe > window_end:
                break
            continue
        stop = False
        for c in candidates:
            if until is not None and c > until:
                stop = True
                break
            if count is not None and emitted >= count:
                stop = True
                break
            emitted += 1
            if c > window_end:
                stop = True
                break
            if c not in exdates:
                out.append(c)
        if stop:
            break
    return out


def parse(text: str, now: datetime, days: int = 7) -> list[dict]:
    """Events starting inside [now, now + days), soonest first.

    `now` must be timezone-aware; its zone is the one every result is rendered
    in and the fallback for any DTSTART without a resolvable TZID.
    """
    local = now.tzinfo
    window_end = now + timedelta(days=days)
    events: list[dict] = []

    current: dict | None = None
    for line in _unfold(text):
        name, params, value = _parse_line(line)
        if name == "BEGIN" and value == "VEVENT":
            current = {"exdates": set()}
            continue
        if current is None:
            continue
        if name == "END" and value == "VEVENT":
            start = current.get("start")
            if start is not None:
                duration = current.get("end", start) - start
                for occ in _occurrences(start, current.get("rrule", {}),
                                        current["exdates"], window_end, local):
                    # The window is enforced here, not in _occurrences: that
                    # only bounds how far a recurrence walks, and a one-off
                    # event never goes through the walk at all.
                    if occ < now or occ >= window_end:
                        continue
                    events.append({
                        "summary": current.get("summary", "(tanpa judul)"),
                        "start": occ.astimezone(local).isoformat(timespec="minutes"),
                        "end": (occ + duration).astimezone(local).isoformat(timespec="minutes"),
                        "all_day": current.get("all_day", False),
                        "location": current.get("location", ""),
                    })
            current = None
            continue
        try:
            if name == "SUMMARY":
                current["summary"] = _unescape(value)
            elif name == "LOCATION":
                current["location"] = _unescape(value)
            elif name == "DTSTART":
                current["start"], current["all_day"] = _parse_dt(value, params, local)
            elif name == "DTEND":
                current["end"], _ = _parse_dt(value, params, local)
            elif name == "RRULE":
                current["rrule"] = _parse_rrule(value)
            elif name == "EXDATE":
                for one in value.split(","):
                    current["exdates"].add(_parse_dt(one, params, local)[0])
        except ValueError:
            # One unparseable property must not cost the whole calendar; the
            # event simply loses that field (and is dropped if it was DTSTART).
            continue

    events.sort(key=lambda e: e["start"])
    return events[:MAX_EVENTS]


async def upcoming(url: str, days: int = 7, now: datetime | None = None) -> list[dict]:
    """Fetch `url` and return its events for the next `days`.

    Raises on a transport or HTTP error — the caller turns that into data for
    the model, the same way every other chat tool reports its failures.
    """
    import httpx
    now = now or datetime.now().astimezone()
    # follow_redirects: Google serves the secret address through a redirect.
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return parse(resp.text, now, days)
