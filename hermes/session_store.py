from __future__ import annotations
import sqlite3, time
from pathlib import Path
from contextlib import contextmanager

class Store:
    def __init__(self, db: Path):
        self.db = str(db)

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
                  status TEXT, created REAL);
                CREATE TABLE IF NOT EXISTS steps(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  idx INTEGER, kind TEXT, detail TEXT, status TEXT);
                CREATE TABLE IF NOT EXISTS logs(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  ts REAL, line TEXT);
                CREATE TABLE IF NOT EXISTS artifacts(
                  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
                  kind TEXT, path TEXT);
                """
            )

    def create_task(self, task_id, chat_id, text):
        with self._conn() as c:
            c.execute("INSERT INTO tasks VALUES(?,?,?,?,?)",
                      (task_id, chat_id, text, "queued", time.time()))

    def set_task_status(self, task_id, status):
        with self._conn() as c:
            c.execute("UPDATE tasks SET status=? WHERE task_id=?", (status, task_id))

    def add_step(self, task_id, index, kind, detail) -> int:
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO steps(task_id,idx,kind,detail,status) VALUES(?,?,?,?,?)",
                (task_id, index, kind, detail, "queued"))
            return cur.lastrowid

    def set_step_status(self, step_id, status):
        with self._conn() as c:
            c.execute("UPDATE steps SET status=? WHERE id=?", (status, step_id))

    def append_log(self, task_id, line):
        with self._conn() as c:
            c.execute("INSERT INTO logs(task_id,ts,line) VALUES(?,?,?)",
                      (task_id, time.time(), line))

    def add_artifact(self, task_id, kind, path):
        with self._conn() as c:
            c.execute("INSERT INTO artifacts(task_id,kind,path) VALUES(?,?,?)",
                      (task_id, kind, path))

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
