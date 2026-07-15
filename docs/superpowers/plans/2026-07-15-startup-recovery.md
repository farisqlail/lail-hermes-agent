# Startup Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On startup, retire tasks that only *look* alive into a terminal `interrupted` status, and tell each affected Telegram chat once.

**Architecture:** `Store.sweep_interrupted()` does the whole database change in one transaction and returns the swept rows, including each task's *previous* status. `hermes/recovery.py` turns those rows into one digest message per chat — a pure function, so it is table-testable without a bot. `main.run()` calls the sweep immediately after `init_schema()`, unconditionally, and sends the digests only if a bot exists.

**Tech Stack:** Python 3.11+, sqlite3, pytest (`asyncio_mode = "auto"`), python-telegram-bot.

**Spec:** `docs/superpowers/specs/2026-07-15-startup-recovery-design.md`

## Global Constraints

- Test runner is the venv interpreter: `.venv/Scripts/python.exe -m pytest`. Run from `E:\Hermes\app`.
- `pyproject.toml` sets `asyncio_mode = "auto"`. Async tests are bare `async def test_x():` with **no** `@pytest.mark.asyncio` decorator.
- `Store` takes an explicit db path, so store tests use `tmp_path` directly, not the `hermes_home` fixture. Follow `tests/test_session_store.py`.
- Interruptible statuses are exactly `("running", "awaiting_confirm", "queued")`. `done`, `failed`, and `cancelled` are terminal and must never be touched.
- `interrupted` is itself terminal. It must **not** appear in `INTERRUPTIBLE`, or `start.bat`'s auto-restart loop would re-notify on every restart.
- This plan is the foundation only. Nothing resumes an interrupted task; do not add resume logic.
- Baseline is 68 passing tests. Every task must leave the full suite green.
- Branch: `feat/project-registry`.

---

### Task 1: `Store.sweep_interrupted()`

**Files:**
- Modify: `hermes/session_store.py` (add a module constant and one method)
- Test: `tests/test_session_store.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `INTERRUPTIBLE: tuple[str, str, str]` — module-level constant.
  - `Store.sweep_interrupted() -> list[dict]` — each dict has keys `task_id`, `chat_id`, `text`, `status`, where `status` is the status the task held **before** the sweep. Task 2 groups these; Task 3 calls it.

Order inside the transaction matters. `SELECT` must run before either `UPDATE`, because the digest needs the previous status and one `UPDATE` destroys it. The steps `UPDATE` must run before the tasks `UPDATE`, because its subquery matches on the pre-sweep task status.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_session_store.py`:

```python
def _task(s, tid, status, chat=99, text="t"):
    s.create_task(tid, chat_id=chat, text=text)
    s.set_task_status(tid, status)


def _step_status(store, task_id) -> dict[int, str]:
    import sqlite3
    c = sqlite3.connect(store.db)
    try:
        return {r[0]: r[1] for r in
                c.execute("SELECT id, status FROM steps WHERE task_id=?", (task_id,))}
    finally:
        c.close()


def test_sweep_retires_only_live_looking_tasks(tmp_path):
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "run", "running")
    _task(s, "wait", "awaiting_confirm")
    _task(s, "queue", "queued")
    _task(s, "done", "done")
    _task(s, "fail", "failed")
    _task(s, "cancel", "cancelled")

    s.sweep_interrupted()

    assert s.get_task("run")["status"] == "interrupted"
    assert s.get_task("wait")["status"] == "interrupted"
    assert s.get_task("queue")["status"] == "interrupted"
    assert s.get_task("done")["status"] == "done"
    assert s.get_task("fail")["status"] == "failed"
    assert s.get_task("cancel")["status"] == "cancelled"


def test_sweep_returns_previous_status_and_fields(tmp_path):
    """The digest splits 'was running' from 'was waiting for you', so the
    pre-sweep status must survive the sweep."""
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "run", "running", chat=5, text="refactor auth")
    _task(s, "wait", "awaiting_confirm", chat=7, text="git push")

    swept = {r["task_id"]: r for r in s.sweep_interrupted()}

    assert swept["run"]["status"] == "running"
    assert swept["run"]["chat_id"] == 5
    assert swept["run"]["text"] == "refactor auth"
    assert swept["wait"]["status"] == "awaiting_confirm"
    assert swept["wait"]["chat_id"] == 7


def test_sweep_retires_live_steps_of_swept_tasks(tmp_path):
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "run", "running")
    running_step = s.add_step("run", 1, "build", "{}")
    s.set_step_status(running_step, "running")
    queued_step = s.add_step("run", 2, "test", "{}")      # left at "queued"
    done_step = s.add_step("run", 0, "code", "{}")
    s.set_step_status(done_step, "done")

    s.sweep_interrupted()

    rows = _step_status(s, "run")
    assert rows[running_step] == "interrupted"
    assert rows[queued_step] == "interrupted"
    assert rows[done_step] == "done"          # finished work keeps its result


def test_sweep_leaves_steps_of_terminal_tasks_alone(tmp_path):
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "done", "done")
    orphan = s.add_step("done", 0, "code", "{}")
    s.set_step_status(orphan, "running")      # oddball, but not ours to fix

    s.sweep_interrupted()

    assert _step_status(s, "done")[orphan] == "running"


def test_sweep_is_idempotent(tmp_path):
    """interrupted is terminal. start.bat restarts on crash, so a second pass
    must find nothing — otherwise a crash-loop spams the chat."""
    s = Store(tmp_path / "t.db"); s.init_schema()
    _task(s, "run", "running")

    assert len(s.sweep_interrupted()) == 1
    assert s.sweep_interrupted() == []
    assert s.get_task("run")["status"] == "interrupted"


def test_sweep_on_empty_db(tmp_path):
    s = Store(tmp_path / "t.db"); s.init_schema()
    assert s.sweep_interrupted() == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_session_store.py -v`
Expected: FAIL with `AttributeError: 'Store' object has no attribute 'sweep_interrupted'`.

- [ ] **Step 3: Write the implementation**

In `hermes/session_store.py`, add the constant just below the imports, above `class Store`:

```python
# Statuses that only a live in-process task can advance. Nothing else ever
# moves them, so after a restart they are lies. "interrupted" is deliberately
# absent: it is terminal, which is what makes the sweep idempotent and keeps
# start.bat's auto-restart loop from re-notifying on every pass.
INTERRUPTIBLE = ("running", "awaiting_confirm", "queued")
```

Add this method to `Store`, after `set_task_status`:

```python
    def sweep_interrupted(self) -> list[dict]:
        """Retire tasks that only look alive. Returns the swept rows, each
        carrying the status it held before the sweep."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT task_id, chat_id, text, status FROM tasks "
                "WHERE status IN (?,?,?)", INTERRUPTIBLE).fetchall()
            swept = [dict(r) for r in rows]
            # Steps first: this subquery reads the pre-sweep task status.
            c.execute(
                "UPDATE steps SET status='interrupted' "
                "WHERE status IN ('running','queued') "
                "AND task_id IN (SELECT task_id FROM tasks WHERE status IN (?,?,?))",
                INTERRUPTIBLE)
            c.execute("UPDATE tasks SET status='interrupted' "
                      "WHERE status IN (?,?,?)", INTERRUPTIBLE)
            return swept
```

`_conn()` already wraps its body in `with c:`, so all three statements share one transaction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_session_store.py -v`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add hermes/session_store.py tests/test_session_store.py
git commit -m "feat(session_store): sweep zombie tasks into interrupted

Task status is only ever advanced by the in-process code that owns it, so
anything left at running/awaiting_confirm/queued after a restart is a lie
the dashboard renders as live work.

queued is included because it is the same bug: create_task inserts at
queued and run_task only later sets running, with a Telegram round-trip in
between. The live database has a stranded queued row right now.

Steps are swept too, from running and queued, since an interrupted task
owning a running step still renders as active. done and failed steps keep
their result.

SELECT runs before UPDATE because the digest needs the previous status;
the steps UPDATE runs before the tasks UPDATE because its subquery reads
the pre-sweep status."
```

---

### Task 2: `recovery.group_digests()`

**Files:**
- Create: `hermes/recovery.py`
- Test: `tests/test_recovery.py`

**Interfaces:**
- Consumes: the row shape produced by `Store.sweep_interrupted()` (Task 1) — dicts with `task_id`, `chat_id`, `text`, `status`.
- Produces: `group_digests(swept: list[dict]) -> list[tuple[int, str]]` — one `(chat_id, message)` per affected chat. Task 3 calls it.

Pure: no I/O, no Telegram objects. That is what makes it table-testable.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_recovery.py`:

```python
from hermes.recovery import group_digests


def _row(tid, chat, status, text="do a thing"):
    return {"task_id": tid, "chat_id": chat, "text": text, "status": status}


def test_empty_input_produces_nothing():
    assert group_digests([]) == []


def test_one_chat_one_task():
    out = group_digests([_row("t1", 5, "running", "refactor auth")])
    assert len(out) == 1
    chat_id, msg = out[0]
    assert chat_id == 5
    assert "t1" in msg
    assert "refactor auth" in msg
    assert "Nothing was resumed" in msg


def test_groups_by_chat():
    out = group_digests([
        _row("t1", 5, "running"),
        _row("t2", 7, "running"),
        _row("t3", 5, "queued"),
    ])
    assert len(out) == 2
    by_chat = dict(out)
    assert "t1" in by_chat[5] and "t3" in by_chat[5]
    assert "t2" in by_chat[7]
    assert "t1" not in by_chat[7]


def test_awaiting_confirm_is_called_out_separately():
    """Its required action differs: the inline buttons are dead after a
    restart, so those tasks must be resubmitted."""
    out = group_digests([
        _row("t1", 5, "running", "refactor auth"),
        _row("t2", 5, "awaiting_confirm", "git push"),
    ])
    _, msg = out[0]
    assert "resubmit" in msg.lower()
    running_at, waiting_at = msg.index("t1"), msg.index("t2")
    assert running_at < waiting_at          # running group first


def test_queued_counts_as_running_for_display():
    """A queued task never started, but from the user's side it is the same
    story: it was submitted and it did not happen."""
    out = group_digests([_row("t1", 5, "queued")])
    _, msg = out[0]
    assert "resubmit" not in msg.lower()    # no dead buttons to explain


def test_caps_listing_at_five_per_group():
    rows = [_row(f"t{i}", 5, "running") for i in range(9)]
    _, msg = group_digests(rows)[0]
    assert msg.count("  t") == 5            # five indented task lines
    assert "and 4 more" in msg
    assert "9 task" in msg                  # total is still stated


def test_long_task_text_is_truncated():
    out = group_digests([_row("t1", 5, "running", "x" * 200)])
    _, msg = out[0]
    assert len(max(msg.splitlines(), key=len)) < 120


def test_chat_order_is_stable():
    rows = [_row("t1", 9, "running"), _row("t2", 3, "running")]
    assert [c for c, _ in group_digests(rows)] == [9, 3]   # first-seen order
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_recovery.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'hermes.recovery'`.

- [ ] **Step 3: Write the implementation**

Create `hermes/recovery.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_recovery.py -v`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add hermes/recovery.py tests/test_recovery.py
git commit -m "feat(recovery): group swept tasks into one digest per chat

Pure function, so it is table-testable without a bot.

awaiting_confirm gets its own section because its required action differs:
bridge.pending is in-memory, so after a restart those inline buttons are
dead and the task must be resubmitted. Listing is capped at five per group
with the total still stated, so the first run against a database full of
old zombies does not produce a wall of text."
```

---

### Task 3: Sweep on startup and send the digests

**Files:**
- Modify: `hermes/main.py:92` (after `init_schema()`), `hermes/main.py:210-212` (the `async with app` block)
- Test: `tests/test_main_smoke.py`

**Interfaces:**
- Consumes: `Store.sweep_interrupted()` (Task 1), `group_digests()` (Task 2).
- Produces: nothing downstream.

The sweep is unconditional and runs before the bot exists. If `TELEGRAM_BOT_TOKEN` is unset or `Application.builder()` raises — both already set `app = None` — the database is still corrected and the dashboard still tells the truth. Notification is a bonus, not a precondition.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_main_smoke.py`:

```python
async def test_notify_restart_sends_one_digest_per_chat():
    sent = []
    async def sender(chat, text): sent.append((chat, text))
    swept = [
        {"task_id": "t1", "chat_id": 5, "text": "refactor auth", "status": "running"},
        {"task_id": "t2", "chat_id": 7, "text": "build apk", "status": "queued"},
    ]
    assert await main._notify_restart(swept, sender) == 2
    assert {c for c, _ in sent} == {5, 7}


async def test_notify_restart_with_nothing_swept():
    async def sender(chat, text): raise AssertionError("nothing to say")
    assert await main._notify_restart([], sender) == 0


async def test_notify_restart_survives_one_bad_chat():
    """A chat that blocked the bot must not silence the others, nor take
    startup down with it."""
    sent = []
    async def sender(chat, text):
        if chat == 5:
            raise RuntimeError("Forbidden: bot was blocked by the user")
        sent.append(chat)
    swept = [
        {"task_id": "t1", "chat_id": 5, "text": "x", "status": "running"},
        {"task_id": "t2", "chat_id": 7, "text": "y", "status": "running"},
    ]
    assert await main._notify_restart(swept, sender) == 1
    assert sent == [7]
```

The send loop carries real logic — one chat that blocked the bot must not
silence the others, nor take startup down — so it is extracted into
`_notify_restart` where a test can drive it. Where the sweep call *sits* inside
`run()` is structural placement, not logic: that is covered by the manual
Verification section at the end of this plan, rather than by asserting on the
text of `inspect.getsource(run)`, which would go red on any rename that changed
no behaviour.

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_main_smoke.py -k notify_restart -v`
Expected: FAIL with `AttributeError: module 'hermes.main' has no attribute '_notify_restart'`.

- [ ] **Step 3: Write the implementation**

In `hermes/main.py`, add to the imports near the other `hermes` imports:

```python
from .recovery import group_digests
```

Replace line 92:

```python
    store = Store(paths.db_path()); store.init_schema()
```

with:

```python
    store = Store(paths.db_path()); store.init_schema()
    # Unconditional, and before the bot: anything still marked live is a lie
    # left by the last exit, and the dashboard must be honest even when no
    # token is configured. Notifying is a bonus, not a precondition.
    swept = store.sweep_interrupted()
    if swept:
        print(f"Startup recovery: retired {len(swept)} interrupted task(s).")
```

Add this helper at module level, above `async def run(`:

```python
async def _notify_restart(swept: list[dict], sender) -> int:
    """Tell each affected chat once that its tasks did not survive the restart.

    Returns the number of chats successfully notified. Each send is guarded on
    its own: a chat that blocked the bot must not silence the others, and must
    not take startup down with it.
    """
    sent = 0
    for chat_id, msg in group_digests(swept):
        try:
            await sender(chat_id, msg)
            sent += 1
        except Exception as e:
            print(f"Could not notify chat {chat_id} of restart: {e}")
    return sent
```

Replace lines 210-212:

```python
            async with app:
                await app.start()
                await app.updater.start_polling()
```

with:

```python
            async with app:
                await app.start()
                # Before polling, so the restart notice lands ahead of any
                # newly submitted task's output.
                await _notify_restart(swept, sender)
                await app.updater.start_polling()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_main_smoke.py -v`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add hermes/main.py tests/test_main_smoke.py
git commit -m "feat(main): retire zombie tasks on startup and notify once

The sweep runs right after init_schema, before and independent of the bot,
so a token-less install still gets an honest dashboard.

Digests go out after app.start() but before polling, so the restart notice
lands ahead of any new task's output. The send loop lives in _notify_restart
rather than inline in run(), because its per-chat guard is real logic worth
testing: a chat that blocked the bot must not silence the others, nor take
startup down with it."
```

---

### Task 4: Badge the new status in the dashboard

**Files:**
- Modify: `hermes/spa.html:358-362`

**Interfaces:**
- Consumes: the `interrupted` status written by Task 1.
- Produces: nothing.

`spa.html` renders `<span class="badge ${t.status}">`, so a status with no rule renders unstyled. `.badge.stopped` is dead — no code writes a `stopped` status — and its muted grey is exactly what `interrupted` wants, so the rule is effectively being renamed to a status that exists. `cancelled` and `awaiting_confirm` are unstyled today; they are in the same five-line block and are fixed while we are in it.

- [ ] **Step 1: Apply the change**

In `hermes/spa.html`, replace lines 358-362:

```css
        .badge.queued { background-color: hsla(38, 92%, 50%, 0.15); color: var(--warning); }
        .badge.running { background-color: hsla(217, 100%, 61%, 0.15); color: var(--primary); }
        .badge.done { background-color: hsla(142, 70%, 50%, 0.15); color: var(--success); }
        .badge.failed { background-color: hsla(346, 80%, 55%, 0.15); color: var(--danger); }
        .badge.stopped { background-color: hsla(215, 20%, 65%, 0.15); color: var(--text-muted); }
```

with:

```css
        .badge.queued { background-color: hsla(38, 92%, 50%, 0.15); color: var(--warning); }
        .badge.running { background-color: hsla(217, 100%, 61%, 0.15); color: var(--primary); }
        .badge.done { background-color: hsla(142, 70%, 50%, 0.15); color: var(--success); }
        .badge.failed { background-color: hsla(346, 80%, 55%, 0.15); color: var(--danger); }
        .badge.awaiting_confirm { background-color: hsla(38, 92%, 50%, 0.15); color: var(--warning); }
        .badge.interrupted { background-color: hsla(215, 20%, 65%, 0.15); color: var(--text-muted); }
        .badge.cancelled { background-color: hsla(215, 20%, 65%, 0.15); color: var(--text-muted); }
```

- [ ] **Step 2: Verify by eye**

Run: `.venv/Scripts/python.exe -m hermes.main`, open http://127.0.0.1:8799.
Expected: the two zombie tasks already in `hermes.db` (one `queued`, one `running`) now show a muted grey `INTERRUPTED` badge, not an unstyled one. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add hermes/spa.html
git commit -m "fix(spa): badge interrupted, cancelled, and awaiting_confirm

Statuses with no rule render unstyled. .badge.stopped was dead — no code
writes that status — and its muted grey is what interrupted wants, so the
rule is effectively renamed to a status that exists. cancelled and
awaiting_confirm were unstyled too, in the same block."
```

---

### Task 5: Update the backlog

**Files:**
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Edit the backlog entry**

In `docs/TODO.md`, under "Not started at all (potential future scope)", replace:

```markdown
- [ ] Resume-after-crash logic actually re-driving an interrupted task (state persists, but nothing
  re-runs it on restart yet).
```

with:

```markdown
- [ ] Resume-after-crash logic actually re-driving an interrupted task. The foundation is in:
  `Store.sweep_interrupted()` retires `running` / `awaiting_confirm` / `queued` tasks (and their
  live steps) to `interrupted` on startup, and `recovery.group_digests` notifies each chat once.
  `interrupted` is terminal — nothing re-runs it yet.
- [ ] Make a stale confirm-button tap respond. `bridge.pending` is in-memory, so after a restart
  the inline buttons are dead: `resolve_confirm` returns `False` into a caller that discards it,
  and the tap does nothing with no feedback. The startup digest tells the user to resubmit, but
  the button itself is still silent.
```

- [ ] **Step 2: Commit**

```bash
git add docs/TODO.md
git commit -m "docs: record startup recovery, and the stale-button gap it exposed"
```

---

## Verification

- [ ] Full suite green: `.venv/Scripts/python.exe -m pytest -q`
- [ ] Real zombies retired. The live `E:\Hermes\hermes.db` currently holds one `queued` and one `running` zombie, so this is directly observable:
  1. Before: `python -c "import sqlite3; print(sqlite3.connect(r'E:\Hermes\hermes.db').execute('SELECT status, COUNT(*) FROM tasks GROUP BY status').fetchall())"` -> shows `queued` and `running`.
  2. Start Hermes. Console prints `Startup recovery: retired 2 interrupted task(s).`
  3. After: the same query shows `interrupted` and no `queued` / `running`.
  4. The dashboard shows muted grey `INTERRUPTED` badges.
- [ ] Idempotent: restart Hermes again. No further notification is sent, and nothing changes in the database.
- [ ] Token-less path: temporarily blank `TELEGRAM_BOT_TOKEN` in `config/.env`, start Hermes. The sweep still runs and the dashboard is still correct; no crash.
