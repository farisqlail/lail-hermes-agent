from __future__ import annotations
import sqlite3, time
from pathlib import Path
from contextlib import contextmanager

# Statuses that only a live in-process task can advance. Nothing else ever
# moves them, so after a restart they are lies. "interrupted" is deliberately
# absent: it is terminal, which is what makes the sweep idempotent and keeps
# start.bat's auto-restart loop from re-notifying on every pass.
INTERRUPTIBLE = ("running", "awaiting_confirm", "queued")
# Derived from INTERRUPTIBLE so the sweep queries can never drift to a stale
# hardcoded placeholder count when a status is added or removed.
_IN_INTERRUPTIBLE = f"({','.join('?' * len(INTERRUPTIBLE))})"

class Store:
    def __init__(self, db: Path):
        self.db = str(db)
        self.listeners = set()

    def subscribe(self, listener):
        self.listeners.add(listener)

    def unsubscribe(self, listener):
        self.listeners.discard(listener)

    def publish(self, event):
        for listener in list(self.listeners):
            try:
                listener(event)
            except Exception:
                pass

    @contextmanager
    def _conn(self):
        c = sqlite3.connect(self.db)
        c.row_factory = sqlite3.Row
        try:
            with c:
                yield c
        finally:
            c.close()

    def init_schema(self):
        with self._conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS tasks(
                  task_id TEXT PRIMARY KEY, chat_id INTEGER, text TEXT,
                  status TEXT, created REAL, session_id TEXT);
                CREATE TABLE IF NOT EXISTS sessions(
                  session_id TEXT PRIMARY KEY, title TEXT, created REAL);
                CREATE TABLE IF NOT EXISTS steps(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  idx INTEGER, kind TEXT, detail TEXT, status TEXT);
                CREATE TABLE IF NOT EXISTS logs(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  ts REAL, line TEXT);
                CREATE TABLE IF NOT EXISTS artifacts(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  kind TEXT, path TEXT);
                CREATE TABLE IF NOT EXISTS messages(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id TEXT,
                  role TEXT, content TEXT, ts REAL);
                CREATE TABLE IF NOT EXISTS user_facts(
                  key TEXT PRIMARY KEY, value TEXT, ts REAL);
                """
            )
            try:
                c.execute("ALTER TABLE tasks ADD COLUMN session_id TEXT")
            except sqlite3.OperationalError:
                pass

    def create_session(self, session_id, title):
        with self._conn() as c:
            c.execute("INSERT OR REPLACE INTO sessions(session_id, title, created) VALUES(?,?,?)",
                      (session_id, title, time.time()))
        self.publish({"type": "session_created", "session_id": session_id, "title": title})

    def rename_session(self, session_id, title):
        with self._conn() as c:
            c.execute("UPDATE sessions SET title=? WHERE session_id=?", (title, session_id))
        self.publish({"type": "session_renamed", "session_id": session_id, "title": title})

    def delete_session(self, session_id):
        with self._conn() as c:
            c.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
            c.execute("DELETE FROM messages WHERE conv_id=?", (session_id,))
            tasks = c.execute("SELECT task_id FROM tasks WHERE session_id=?", (session_id,)).fetchall()
            for t in tasks:
                tid = t["task_id"]
                c.execute("DELETE FROM steps WHERE task_id=?", (tid,))
                c.execute("DELETE FROM logs WHERE task_id=?", (tid,))
                c.execute("DELETE FROM artifacts WHERE task_id=?", (tid,))
            c.execute("DELETE FROM tasks WHERE session_id=?", (session_id,))
        self.publish({"type": "session_deleted", "session_id": session_id})

    def list_sessions(self):
        with self._conn() as c:
            rows = c.execute("SELECT * FROM sessions ORDER BY created DESC").fetchall()
            return [dict(r) for r in rows]

    def create_task(self, task_id, chat_id, text, session_id=None):
        with self._conn() as c:
            c.execute("INSERT INTO tasks(task_id, chat_id, text, status, created, session_id) VALUES(?,?,?,?,?,?)",
                      (task_id, chat_id, text, "queued", time.time(), session_id))
        self.publish({"type": "task_created", "task_id": task_id, "session_id": session_id})

    def set_task_status(self, task_id, status):
        with self._conn() as c:
            c.execute("UPDATE tasks SET status=? WHERE task_id=?", (status, task_id))
        self.publish({"type": "task_status", "task_id": task_id, "status": status})

    def sweep_interrupted(self) -> list[dict]:
        """Retire tasks that only look alive. Returns the swept rows, each
        carrying the status it held before the sweep."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT task_id, chat_id, text, status FROM tasks "
                f"WHERE status IN {_IN_INTERRUPTIBLE}", INTERRUPTIBLE).fetchall()
            swept = [dict(r) for r in rows]
            # Steps first: this subquery reads the pre-sweep task status.
            c.execute(
                "UPDATE steps SET status='interrupted' "
                "WHERE status IN ('running','queued') "
                "AND task_id IN (SELECT task_id FROM tasks "
                f"WHERE status IN {_IN_INTERRUPTIBLE})",
                INTERRUPTIBLE)
            c.execute("UPDATE tasks SET status='interrupted' "
                      f"WHERE status IN {_IN_INTERRUPTIBLE}", INTERRUPTIBLE)
            return swept

    def add_step(self, task_id, index, kind, detail) -> int:
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO steps(task_id,idx,kind,detail,status) VALUES(?,?,?,?,?)",
                (task_id, index, kind, detail, "queued"))
            last_id = cur.lastrowid
        self.publish({"type": "step_added", "task_id": task_id, "step_id": last_id, "idx": index, "kind": kind, "detail": detail})
        return last_id

    def set_step_status(self, step_id, status):
        with self._conn() as c:
            c.execute("UPDATE steps SET status=? WHERE id=?", (status, step_id))
            r = c.execute("SELECT task_id, kind FROM steps WHERE id=?", (step_id,)).fetchone()
            task_id = r["task_id"] if r else None
            # `kind` rides along so a subscriber can say what is starting
            # ("build") without a second query. The step row is right here.
            kind = r["kind"] if r else None
        self.publish({"type": "step_status", "task_id": task_id, "step_id": step_id,
                      "status": status, "kind": kind})

    def append_log(self, task_id, line):
        with self._conn() as c:
            c.execute("INSERT INTO logs(task_id,ts,line) VALUES(?,?,?)",
                      (task_id, time.time(), line))
        self.publish({"type": "log_appended", "task_id": task_id, "line": line})

    def add_artifact(self, task_id, kind, path):
        with self._conn() as c:
            c.execute("INSERT INTO artifacts(task_id,kind,path) VALUES(?,?,?)",
                      (task_id, kind, path))
        self.publish({"type": "artifact_added", "task_id": task_id, "kind": kind, "path": path})

    def get_task(self, task_id):
        with self._conn() as c:
            r = c.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
            return dict(r) if r else None

    def list_tasks(self, limit=50):
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM tasks ORDER BY created DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]

    def get_logs(self, task_id):
        with self._conn() as c:
            rows = c.execute(
                "SELECT line FROM logs WHERE task_id=? ORDER BY id", (task_id,)).fetchall()
            return [r["line"] for r in rows]

    def get_artifacts(self, task_id):
        with self._conn() as c:
            rows = c.execute(
                "SELECT kind,path FROM artifacts WHERE task_id=? ORDER BY id", (task_id,)).fetchall()
            return [dict(r) for r in rows]

    # --- conversational chat (web UI chat pane) ---
    # A conversation is a flat, ordered message log keyed by conv_id, separate
    # from tasks: the operator holds one continuous thread, while each task is a
    # discrete unit of work. The chat agent is fed the tail of this log so it
    # remembers the exchange across turns.

    def add_message(self, conv_id, role, content):
        with self._conn() as c:
            c.execute("INSERT INTO messages(conv_id,role,content,ts) VALUES(?,?,?,?)",
                      (conv_id, role, content, time.time()))

    def get_messages(self, conv_id, limit=20):
        """The last `limit` messages for a conversation, oldest-first.

        Fetched newest-first so the LIMIT keeps the *recent* tail, then
        reversed back into reading order for the model.
        """
        with self._conn() as c:
            rows = c.execute(
                "SELECT role, content FROM messages WHERE conv_id=? "
                "ORDER BY id DESC LIMIT ?", (conv_id, limit)).fetchall()
            return [dict(r) for r in reversed(rows)]

    def clear_messages(self, conv_id):
        with self._conn() as c:
            c.execute("DELETE FROM messages WHERE conv_id=?", (conv_id,))

    # --- what Hermes remembers about the operator ---
    # Keyed, not appended: "deploy_day" learned twice is one fact with a newer
    # value, not two contradictory lines in the prompt. The key is also the
    # handle the operator deletes by, which an autoincrement id would not be.

    def set_fact(self, key, value):
        with self._conn() as c:
            c.execute("INSERT INTO user_facts(key,value,ts) VALUES(?,?,?) "
                      "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
                      "ts=excluded.ts", (key, value, time.time()))

    def list_facts(self, limit=50):
        """Newest first, so a `limit` that bites drops the stalest facts."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT key, value, ts FROM user_facts ORDER BY ts DESC LIMIT ?",
                (limit,)).fetchall()
            return [dict(r) for r in rows]

    def delete_fact(self, key):
        with self._conn() as c:
            c.execute("DELETE FROM user_facts WHERE key=?", (key,))
