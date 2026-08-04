from datetime import datetime, timedelta, timezone

from hermes.ics import parse

WIB = timezone(timedelta(hours=7))
NOW = datetime(2026, 8, 4, 9, 0, tzinfo=WIB)


def _cal(*vevents: str) -> str:
    body = "\n".join(vevents)
    return f"BEGIN:VCALENDAR\nVERSION:2.0\n{body}\nEND:VCALENDAR\n"


def test_timed_event_with_tzid():
    ics = _cal(
        "BEGIN:VEVENT\n"
        "SUMMARY:Standup\n"
        "LOCATION:Ruang 2\n"
        "DTSTART;TZID=Asia/Jakarta:20260805T100000\n"
        "DTEND;TZID=Asia/Jakarta:20260805T103000\n"
        "END:VEVENT")
    (ev,) = parse(ics, NOW, days=7)
    assert ev["summary"] == "Standup"
    assert ev["location"] == "Ruang 2"
    assert ev["start"] == "2026-08-05T10:00+07:00"
    assert ev["end"] == "2026-08-05T10:30+07:00"
    assert ev["all_day"] is False


def test_utc_start_is_converted_to_local():
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Sync\n"
               "DTSTART:20260805T030000Z\nEND:VEVENT")
    (ev,) = parse(ics, NOW, days=7)
    assert ev["start"] == "2026-08-05T10:00+07:00"


def test_all_day_event():
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Libur\n"
               "DTSTART;VALUE=DATE:20260806\nDTEND;VALUE=DATE:20260807\nEND:VEVENT")
    (ev,) = parse(ics, NOW, days=7)
    assert ev["all_day"] is True
    assert ev["start"] == "2026-08-06T00:00+07:00"


def test_folded_line_is_unfolded():
    # Exporters wrap long values; the continuation carries one leading space.
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Rapat panjang sekali\n judulnya\n"
               "DTSTART;TZID=Asia/Jakarta:20260805T100000\nEND:VEVENT")
    (ev,) = parse(ics, NOW, days=7)
    assert ev["summary"] == "Rapat panjang sekalijudulnya"


def test_escaped_text_is_unescaped():
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Review\\, lalu rilis\n"
               "DTSTART;TZID=Asia/Jakarta:20260805T100000\nEND:VEVENT")
    (ev,) = parse(ics, NOW, days=7)
    assert ev["summary"] == "Review, lalu rilis"


def test_past_and_far_future_events_are_outside_the_window():
    ics = _cal(
        "BEGIN:VEVENT\nSUMMARY:Kemarin\n"
        "DTSTART;TZID=Asia/Jakarta:20260803T100000\nEND:VEVENT",
        "BEGIN:VEVENT\nSUMMARY:Bulan depan\n"
        "DTSTART;TZID=Asia/Jakarta:20260905T100000\nEND:VEVENT")
    assert parse(ics, NOW, days=7) == []


def test_weekly_rrule_expands_each_matching_day():
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Weekly\n"
               "DTSTART;TZID=Asia/Jakarta:20260706T100000\n"
               "RRULE:FREQ=WEEKLY;BYDAY=MO,WE\nEND:VEVENT")
    starts = [e["start"] for e in parse(ics, NOW, days=7)]
    # Window is Tue 4 Aug 09:00 -> Tue 11 Aug: Wed 5, Mon 10.
    assert starts == ["2026-08-05T10:00+07:00", "2026-08-10T10:00+07:00"]


def test_exdate_removes_one_occurrence():
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Weekly\n"
               "DTSTART;TZID=Asia/Jakarta:20260706T100000\n"
               "RRULE:FREQ=WEEKLY;BYDAY=MO,WE\n"
               "EXDATE;TZID=Asia/Jakarta:20260805T100000\nEND:VEVENT")
    starts = [e["start"] for e in parse(ics, NOW, days=7)]
    assert starts == ["2026-08-10T10:00+07:00"]


def test_until_stops_the_series():
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Daily\n"
               "DTSTART;TZID=Asia/Jakarta:20260801T100000\n"
               "RRULE:FREQ=DAILY;UNTIL=20260806T000000Z\nEND:VEVENT")
    starts = [e["start"] for e in parse(ics, NOW, days=7)]
    assert starts == ["2026-08-04T10:00+07:00", "2026-08-05T10:00+07:00"]


def test_count_stops_the_series():
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Daily\n"
               "DTSTART;TZID=Asia/Jakarta:20260803T100000\n"
               "RRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT")
    starts = [e["start"] for e in parse(ics, NOW, days=7)]
    # Occurrences are 3, 4, 5 Aug; the 3rd is already past `now`.
    assert starts == ["2026-08-04T10:00+07:00", "2026-08-05T10:00+07:00"]


def test_monthly_rrule_skips_months_without_that_day():
    # 31 Jan monthly: February has no 31st, so the series must skip it rather
    # than drift onto the 28th.
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Tutup buku\n"
               "DTSTART;TZID=Asia/Jakarta:20260131T100000\n"
               "RRULE:FREQ=MONTHLY\nEND:VEVENT")
    march = datetime(2026, 2, 1, 0, 0, tzinfo=WIB)
    starts = [e["start"] for e in parse(ics, march, days=60)]
    assert starts == ["2026-03-31T10:00+07:00"]


def test_daily_rrule_with_interval():
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Selang\n"
               "DTSTART;TZID=Asia/Jakarta:20260804T100000\n"
               "RRULE:FREQ=DAILY;INTERVAL=3\nEND:VEVENT")
    starts = [e["start"] for e in parse(ics, NOW, days=7)]
    assert starts == ["2026-08-04T10:00+07:00", "2026-08-07T10:00+07:00",
                      "2026-08-10T10:00+07:00"]


def test_events_are_sorted_by_start():
    ics = _cal(
        "BEGIN:VEVENT\nSUMMARY:Nanti\n"
        "DTSTART;TZID=Asia/Jakarta:20260807T100000\nEND:VEVENT",
        "BEGIN:VEVENT\nSUMMARY:Duluan\n"
        "DTSTART;TZID=Asia/Jakarta:20260805T100000\nEND:VEVENT")
    assert [e["summary"] for e in parse(ics, NOW, days=7)] == ["Duluan", "Nanti"]


def test_event_without_dtstart_is_dropped_not_fatal():
    ics = _cal(
        "BEGIN:VEVENT\nSUMMARY:Rusak\nEND:VEVENT",
        "BEGIN:VEVENT\nSUMMARY:Sehat\n"
        "DTSTART;TZID=Asia/Jakarta:20260805T100000\nEND:VEVENT")
    assert [e["summary"] for e in parse(ics, NOW, days=7)] == ["Sehat"]


def test_unresolvable_tzid_falls_back_to_local_zone():
    ics = _cal("BEGIN:VEVENT\nSUMMARY:Zona aneh\n"
               "DTSTART;TZID=Mars/Olympus:20260805T100000\nEND:VEVENT")
    (ev,) = parse(ics, NOW, days=7)
    assert ev["start"] == "2026-08-05T10:00+07:00"


def test_empty_calendar():
    assert parse("BEGIN:VCALENDAR\nEND:VCALENDAR\n", NOW, days=7) == []
