"""What has been going wrong lately, grouped so it can be acted on.

Hermes already stores every failure it has ever had. Reading them one by one
says little; grouped by *kind*, ten failures on this machine said something the
retry loop did not know — four were a rate limit hammered three times, three
repeated a missing binary, two ran a step that could never work. That grouping
is what turned "the loop is too short" into "the loop is blind", and it is
exactly the sort of thing nobody does by hand twice.

So it is done here instead, from the same data, by the same rules
`hermes/failure.py` uses to decide whether repeating helps. No autonomy, no
self-modification: this reports, and a human decides.

The cause of a failed task is its last log line. That is not a guess — a task
reports the failure and returns immediately, so the last line is the failure,
verified against all ten in the live history.
"""
from __future__ import annotations

from . import failure

#: Kinds in the order a reader wants them: what you can fix, first.
_ORDER = (failure.ENVIRONMENT, failure.STRUCTURAL, failure.TRANSIENT,
          failure.SEMANTIC)

_KIND_LABEL = {
    failure.ENVIRONMENT: "lingkungan (ada yang belum terpasang / tak terjangkau)",
    failure.STRUCTURAL: "struktural (langkahnya mustahil untuk proyek ini)",
    failure.TRANSIENT: "sesaat (endpoint sibuk / koneksi putus)",
    failure.SEMANTIC: "kode (error yang memang bisa diperbaiki engine)",
}


def cause(logs: list[str]) -> str:
    """The line that explains why a task failed, or "".

    The last non-empty line: `run_task` reports a failure and returns, so
    nothing is appended after it.
    """
    for line in reversed(logs or []):
        if (line or "").strip():
            return line.strip()
    return ""


def collect(tasks: list[dict], get_logs) -> list[dict]:
    """One row per failed task, classified.

    `get_logs` is passed in rather than a Store, so this stays testable
    without a database and cannot accidentally grow a second query.
    """
    rows = []
    for t in tasks:
        if t.get("status") != "failed":
            continue
        why = cause(get_logs(t["task_id"]))
        rows.append({"task_id": t["task_id"],
                     "text": (t.get("text") or "").strip(),
                     "cause": why,
                     "kind": failure.classify(why),
                     "signature": failure.signature(why)})
    return rows


def summarize(tasks: list[dict], get_logs, top: int = 5) -> dict:
    """Failure counts by kind, and the failures that keep coming back.

    Repeats are grouped on the signature `failure.py` already uses, so four
    tasks that died on the same rate limit read as one problem seen four
    times — which is the number that decides what to fix first.
    """
    rows = collect(tasks, get_logs)
    by_kind: dict[str, int] = {}
    groups: dict[str, dict] = {}
    for r in rows:
        by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + 1
        g = groups.setdefault(r["signature"], {
            "kind": r["kind"], "count": 0, "example": r["cause"],
            "advice": failure.advice(r["cause"]), "task_ids": []})
        g["count"] += 1
        g["task_ids"].append(r["task_id"])
    ordered = sorted(groups.values(), key=lambda g: -g["count"])
    # Every distinct fix, not only the ones that have already happened twice.
    # A failure seen once is exactly when knowing what to install is worth
    # most; waiting for it to repeat before saying so is advice arriving late.
    actions, seen = [], set()
    for g in ordered:
        if g["advice"] and g["advice"] not in seen:
            seen.add(g["advice"])
            actions.append(g["advice"])
    return {"tasks_seen": len(tasks), "failed": len(rows),
            "by_kind": by_kind, "repeats": ordered[:top], "actions": actions}


def render(summary: dict) -> str:
    """The report as prose, for chat and Telegram.

    Deliberately says what to do, not just what happened: a count with no
    consequence is a statistic, and nobody changes anything because of one.
    """
    failed = summary.get("failed", 0)
    seen = summary.get("tasks_seen", 0)
    if not failed:
        return f"Tidak ada task gagal dari {seen} task terakhir."

    lines = [f"**{failed} dari {seen} task terakhir gagal.**", "",
             "| Jenis | Jumlah |", "|---|---|"]
    by_kind = summary.get("by_kind", {})
    for kind in _ORDER:
        if by_kind.get(kind):
            lines.append(f"| {_KIND_LABEL[kind]} | {by_kind[kind]} |")

    repeats = [g for g in summary.get("repeats", []) if g["count"] > 1]
    if repeats:
        lines += ["", "**Yang berulang:**"]
        for g in repeats:
            lines.append(f"- {g['count']}x — {g['example'][:120]}")
            if g["advice"]:
                lines.append(f"  - {g['advice']}")

    env = by_kind.get(failure.ENVIRONMENT, 0)
    struct = by_kind.get(failure.STRUCTURAL, 0)
    trans = by_kind.get(failure.TRANSIENT, 0)
    lines += ["", "**Artinya:**"]
    if env:
        lines.append(f"- {env} kegagalan tidak akan hilang dengan mengulang — "
                     "ada yang harus dipasang atau diperbaiki di mesin ini.")
    if struct:
        lines.append(f"- {struct} kegagalan berasal dari rencana yang salah "
                     "untuk proyeknya, bukan dari kodenya.")
    if trans:
        lines.append(f"- {trans} kegagalan hanya karena endpoint sibuk; "
                     "kirim ulang task-nya biasanya cukup.")
    if not (env or struct or trans):
        lines.append("- Semuanya error kode biasa — itu yang memang bisa "
                     "diperbaiki engine.")
    if summary.get("actions"):
        lines += ["", "**Yang bisa kamu perbaiki sekarang:**"]
        lines += [f"- {a}" for a in summary["actions"]]
    return "\n".join(lines)
