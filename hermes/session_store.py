from __future__ import annotations
import sqlite3, time
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager

# Terminal statuses that get a markdown archive note written to the vault. A
# repeated "failed" just overwrites the same note, so the write is idempotent.
_ARCHIVE_STATUSES = ("done", "failed")
_FACT_FOOTER = "\n\nTerkait: [[operator]]\n"


def _safe_name(name: str) -> str:
    """A filesystem-safe note stem. Fact keys are already slugs and task ids are
    tame, but a stray `@`, slash or space must never escape the vault folder."""
    out = "".join(c if (c.isalnum() or c in "-_") else "_" for c in name.strip())
    return out.strip("_") or "untitled"


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Split a `--- ... ---` YAML-ish header from the body. Hand-parsed (only
    flat `key: value` lines) so the store carries no YAML dependency."""
    meta: dict[str, str] = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            for line in text[3:end].strip().splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip()
            return meta, text[end + 4:].lstrip("\n")
    return meta, text

# Statuses that only a live in-process task can advance. Nothing else ever
# moves them, so after a restart they are lies. "interrupted" is deliberately
# absent: it is terminal, which is what makes the sweep idempotent and keeps
# start.bat's auto-restart loop from re-notifying on every pass.
INTERRUPTIBLE = ("running", "awaiting_confirm", "queued")
# Derived from INTERRUPTIBLE so the sweep queries can never drift to a stale
# hardcoded placeholder count when a status is added or removed.
_IN_INTERRUPTIBLE = f"({','.join('?' * len(INTERRUPTIBLE))})"

class Store:
    def __init__(self, db: Path, vault_dir: Path | str | None = None):
        self.db = str(db)
        # The vault holds knowledge, not operational state: operator facts and a
        # per-task archive note, as markdown the obsidian MCP server also reads.
        # Defaults beside the db (home/vault at runtime) so existing callers that
        # pass only a db path land on the right place with no change.
        self.vault_dir = Path(vault_dir) if vault_dir else Path(db).parent / "vault"
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

    def delete_session(self, session_id) -> list[str]:
        """Drop a conversation and everything it owns. Returns its task ids.

        The ids are the caller's only handle on what the tasks left on disk:
        this deletes the `artifacts` rows, but the APKs, screenshots and engine
        transcripts they point at live under `artifacts/<task-id>/` and are not
        SQLite's to remove. See `hermes/cleanup.py`.
        """
        with self._conn() as c:
            c.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
            c.execute("DELETE FROM messages WHERE conv_id=?", (session_id,))
            tasks = c.execute("SELECT task_id FROM tasks WHERE session_id=?", (session_id,)).fetchall()
            task_ids = [t["task_id"] for t in tasks]
            for tid in task_ids:
                c.execute("DELETE FROM steps WHERE task_id=?", (tid,))
                c.execute("DELETE FROM logs WHERE task_id=?", (tid,))
                c.execute("DELETE FROM artifacts WHERE task_id=?", (tid,))
            c.execute("DELETE FROM tasks WHERE session_id=?", (session_id,))
        self.publish({"type": "session_deleted", "session_id": session_id})
        return task_ids

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
        if status in _ARCHIVE_STATUSES:
            self._archive_task(task_id)

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

    def conversation_ids(self) -> set[str]:
        """Every conv_id that still holds messages.

        Not the same question as `list_sessions`: the default web conversation
        ("web") has messages but no `sessions` row, so a disk sweep keyed on
        sessions alone would treat its files as orphans and delete them.
        """
        with self._conn() as c:
            return {r["conv_id"] for r in
                    c.execute("SELECT DISTINCT conv_id FROM messages")}

    def clear_messages(self, conv_id):
        with self._conn() as c:
            c.execute("DELETE FROM messages WHERE conv_id=?", (conv_id,))

    # --- what Hermes remembers about the operator ---
    # Keyed, not appended: "deploy_day" learned twice is one fact with a newer
    # value, not two contradictory lines in the prompt. The key is also the
    # handle the operator deletes by, which an autoincrement id would not be.
    #
    # Facts live in the vault, one markdown note per key under facts/, not in
    # SQLite: this is durable knowledge the human browses and links in Obsidian,
    # and the obsidian MCP server exposes the same files to the chat agent as
    # tools. Read/written here by direct file I/O (same process, same disk) so
    # the per-turn context read stays synchronous and fast — the MCP round-trip
    # is for the agent, not for this hot path.

    def _facts_dir(self) -> Path:
        return self.vault_dir / "facts"

    def set_fact(self, key, value):
        d = self._facts_dir()
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{_safe_name(key)}.md").write_text(
            f"---\nkey: {key}\nts: {time.time()}\n---\n{value}{_FACT_FOOTER}",
            encoding="utf-8")

    def list_facts(self, limit=50):
        """Newest first, so a `limit` that bites drops the stalest facts."""
        d = self._facts_dir()
        if not d.is_dir():
            return []
        rows = []
        for p in d.glob("*.md"):
            try:
                meta, body = _parse_frontmatter(p.read_text(encoding="utf-8"))
            except OSError:
                continue
            try:
                ts = float(meta.get("ts", "0"))
            except ValueError:
                ts = 0.0
            rows.append({"key": meta.get("key") or p.stem,
                         "value": body.split("\n\nTerkait:")[0].strip(),
                         "ts": ts})
        rows.sort(key=lambda r: r["ts"], reverse=True)
        return rows[:limit]

    def delete_fact(self, key):
        (self._facts_dir() / f"{_safe_name(key)}.md").unlink(missing_ok=True)

    # --- per-task archive ---
    # Written when a task reaches a terminal status: a human-readable record of
    # what ran, in the same vault as the facts, linked to [[operator]] and the
    # project. Best-effort by construction — a failed note write must never turn
    # a finished task into a failed status update.

    def _archive_task(self, task_id) -> None:
        try:
            t = self.get_task(task_id)
            if not t:
                return
            from .project_resolve import parse_project_ref
            name, _ = parse_project_ref(t.get("text") or "")
            created = t.get("created")
            when = (datetime.fromtimestamp(created).isoformat(timespec="seconds")
                    if created else "")
            arts = self.get_artifacts(task_id)
            lines = [f"---\ntype: task\ntask_id: {task_id}\n"
                     f"status: {t.get('status', '')}\ncreated: {when}\n---",
                     f"# Task {task_id}", "",
                     (t.get("text") or "").strip(), "",
                     f"- Status: {t.get('status', '')}"]
            if when:
                lines.append(f"- Dibuat: {when}")
            if name:
                lines.append(f"- Proyek: [[proyek-{name}]]")
            for a in arts:
                lines.append(f"- {a['kind']}: `{a['path']}`")
            lines.append("\nTerkait: [[operator]]")
            d = self.vault_dir / "tasks"
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{_safe_name(str(task_id))}.md").write_text(
                "\n".join(lines) + "\n", encoding="utf-8")
        except Exception:
            pass
