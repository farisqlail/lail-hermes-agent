# Startup Recovery — retire zombie tasks on restart

Date: 2026-07-15
Status: approved, not yet implemented

## Problem

Task status is only ever advanced by the in-process code that owns the task. If
Hermes dies — crash, restart, power loss — whatever the row said at that instant
is what it says forever. Nothing sweeps it.

The live database already carries the damage:

```
failed      2
queued      1     <- zombie
running     1     <- zombie
```

The dashboard renders both as live work. They are not. Nothing will ever advance
them, because the only thing that could was an `asyncio.Task` that died with the
process.

`bad73e2` added an auto-restart loop to `start.bat`, which makes this louder: a
crashing Hermes now restarts cleanly and leaves a new zombie behind each pass.

## Solution

On startup, sweep every task that claims to be alive into a terminal
`interrupted` status, and tell the relevant Telegram chats once.

This is a foundation, not resume. `interrupted` is terminal. Nothing re-runs.

### Which statuses are zombies

`running`, `awaiting_confirm`, **and `queued`**.

`queued` was not in the original request but is the same bug. `create_task`
inserts at `queued`; `run_task` only later sets `running`. Between them sits
`await self.sender(chat_id, "Task ... queued.")` — a network round-trip to
Telegram. A crash in that window strands the task at `queued` permanently, and
the live database has one such row right now.

`done`, `failed`, and `cancelled` are terminal and are never touched.

### Steps are zombies too

`set_step_status(sid, "running")` strands the same way. Sweeping only the task
leaves an `interrupted` task owning a `running` step, which the dashboard still
renders as active via `.step-row.running`. Steps belonging to swept tasks are
swept in the same transaction.

## Components

### `hermes/session_store.py`

`Store` has no query-by-status at all today. Add one method:

```python
INTERRUPTIBLE = ("running", "awaiting_confirm", "queued")

def sweep_interrupted(self) -> list[dict]:
    """Retire tasks that only look alive. Returns the swept rows."""
    with self._conn() as c:
        rows = c.execute(
            "SELECT task_id, chat_id, text, status FROM tasks "
            "WHERE status IN (?,?,?)", INTERRUPTIBLE).fetchall()
        swept = [dict(r) for r in rows]
        c.execute("UPDATE steps SET status='interrupted' "
                  "WHERE status IN ('running','queued') "
                  "AND task_id IN (SELECT task_id FROM tasks WHERE status IN (?,?,?))",
                  INTERRUPTIBLE)
        c.execute("UPDATE tasks SET status='interrupted' "
                  "WHERE status IN (?,?,?)", INTERRUPTIBLE)
        return swept
```

Steps sweep from `running` *and* `queued`, for the same reason tasks do:
`add_step` inserts at `queued` and `set_step_status(sid, "running")` follows, so
a crash between them strands a `queued` step. `done` and `failed` steps are
terminal and keep their result — an interrupted task's completed steps still
show what finished.

`SELECT` before `UPDATE`, not `UPDATE` alone: the digest needs each task's
*previous* status to separate "was running" from "was waiting for you". One
`UPDATE` destroys that. The step sweep must also run before the task sweep, since
its subquery matches on the pre-sweep task status.

`_conn()` already wraps the body in `with c:`, so the three statements share one
transaction.

### `hermes/recovery.py` (new)

Pure. No I/O, no Telegram objects.

```python
def group_digests(swept: list[dict]) -> list[tuple[int, str]]   # (chat_id, message)
```

Groups by `chat_id`, splits by previous status, caps the listing at 5 per group
with an "…and N more" tail. Being pure makes it table-testable without mocking a
bot.

Message shape:

```
Hermes restarted. 3 tasks were interrupted:

Running at restart:
  20260715-104500-a1b2c3  refactor auth
  20260715-103012-9f8e7d  build APK

Waiting for confirmation (buttons are dead, please resubmit):
  20260715-102233-1c2b3a  git push to origin

Nothing was resumed automatically.
```

The `awaiting_confirm` group is called out separately because its required
action differs: those tasks need resubmitting, and their inline buttons are
already broken (see below).

### `hermes/main.py`

```python
store.init_schema()
swept = store.sweep_interrupted()          # unconditional; DB is correct even if the bot is off
...
async with app:
    await app.start()
    for chat_id, msg in group_digests(swept):
        await sender(chat_id, msg)         # before polling, so the restart notice lands first
    await app.updater.start_polling()
```

The sweep runs immediately after `init_schema()` and does not depend on the bot.
If `TELEGRAM_BOT_TOKEN` is unset or `Application.builder()` raises — both already
handled paths that set `app = None` — the database is still corrected and the
dashboard still tells the truth. Notification is a bonus, not a precondition.

Sending before `start_polling()` means the restart notice arrives ahead of any
newly submitted task's output.

### `hermes/spa.html`

Four lines in the existing badge block:

```css
.badge.interrupted      { /* muted grey */ }
.badge.cancelled        { /* muted grey */ }
.badge.awaiting_confirm { /* warning */ }
```

and delete `.badge.stopped`, which is dead: no code writes a `stopped` status.
Its muted grey is what `interrupted` wants, so the rule is effectively being
renamed to a status that exists.

`cancelled` and `awaiting_confirm` render unstyled today — a pre-existing gap in
the same four-line block, fixed while we are in it.

## Bug this incidentally fixes

`bridge.pending` is an in-memory dict. A restart empties it while the inline
[Run] / [Cancel] buttons stay in the Telegram chat, still tappable.

`resolve_confirm` pops from `pending`, gets `None`, and returns `False`.
`main.on_confirm` discards that return value. So the tap does nothing at all —
no run, no error, no feedback. A silent failure.

The digest converts that dead end into an instruction: the task is
`interrupted`, the buttons are dead, resubmit. Making the stale tap itself
respond ("this task was interrupted by a restart") is a separate, larger change
— `resolve_confirm` would need to distinguish "unknown task" from "interrupted
task" — and is out of scope here.

## Auto-restart loop interaction

`bad73e2` restarts Hermes automatically on exit. The sweep is self-limiting: the
first pass moves everything to `interrupted`, and a second pass finds nothing,
because `interrupted` is not in `INTERRUPTIBLE`. A crash-loop therefore notifies
once, not once per restart.

## Testing

| Unit | Approach |
|---|---|
| `sweep_interrupted` | seed a store with one row per status; assert only the three are swept, `done`/`failed`/`cancelled` untouched |
| `sweep_interrupted` return | assert previous status comes back for digest grouping |
| step sweep | seed `running` and `queued` steps under a `running` task; assert both swept, `done`/`failed` steps keep their result, steps under `done` tasks untouched |
| idempotence | run twice; assert the second call returns `[]` and changes nothing |
| `group_digests` | table-driven; multi-chat, >5 cap, single group, empty input -> `[]` |
| bot disabled | sweep still runs with `app = None` |

The `hermes_home` fixture from `385dd16` covers store setup.

## Out of scope

- Actually resuming an interrupted task. This is the foundation; `interrupted`
  is terminal. Tracked in `docs/TODO.md`.
- Making stale confirm-button taps respond (see above).
- Distinguishing "crashed" from "cleanly restarted" — both are interruptions and
  neither is resumable, so a single status carries its weight.
