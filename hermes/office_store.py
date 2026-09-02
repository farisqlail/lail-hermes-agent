"""Persistence for Office mode: dynamically-created AI "employee" personas,
the teams they're grouped into, and the real work they produce.

Shares the same SQLite file as `session_store.Store` (own connections, same
db path — SQLite serializes writers by file locking, so this is safe) rather
than folding into that already-large class: Office is a distinct domain
(roster/org data + an append-only work log + live simulation state), the
same reasoning that gave skills their own module instead of bloating
config.py. `main_store` is only held onto so mutations can ride the existing
SSE pub/sub bus (`Store.publish`/`subscribe`) — no second event system.
"""
from __future__ import annotations
import json, sqlite3, time
from pathlib import Path
from contextlib import contextmanager


class OfficeStore:

    def __init__(self, db: Path, main_store):
        self.db = str(db)
        self.main_store = main_store

    def publish(self, event: dict) -> None:
        self.main_store.publish(event)

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
                CREATE TABLE IF NOT EXISTS employees(
                  employee_id TEXT PRIMARY KEY,
                  name TEXT, role TEXT, avatar TEXT, personality TEXT,
                  model TEXT, engine TEXT, skill_ids TEXT,
                  team_id TEXT,
                  energy REAL DEFAULT 100,
                  status TEXT DEFAULT 'idle',
                  pos_x REAL DEFAULT 0, pos_y REAL DEFAULT 0,
                  active INTEGER DEFAULT 1,
                  is_lead INTEGER DEFAULT 0,
                  created REAL, updated REAL);
                CREATE TABLE IF NOT EXISTS teams(
                  team_id TEXT PRIMARY KEY,
                  name TEXT, description TEXT, created REAL);
                CREATE TABLE IF NOT EXISTS work_items(
                  work_id TEXT PRIMARY KEY,
                  employee_id TEXT, team_id TEXT, kind TEXT, task_id TEXT,
                  prompt TEXT, output_text TEXT, status TEXT,
                  cost_usd REAL DEFAULT 0,
                  parent_work_id TEXT,
                  created REAL, updated REAL);
                CREATE TABLE IF NOT EXISTS meetings(
                  meeting_id TEXT PRIMARY KEY,
                  team_id TEXT, participant_ids TEXT, topic TEXT,
                  transcript TEXT, triggered_by TEXT, created REAL);
                CREATE TABLE IF NOT EXISTS office_sessions(
                  session_id TEXT PRIMARY KEY,
                  employee_id TEXT, title TEXT,
                  project TEXT, model TEXT, engine TEXT,
                  created REAL, updated REAL);
                """
            )
            try:
                c.execute("ALTER TABLE work_items ADD COLUMN session_id TEXT")
            except sqlite3.OperationalError:
                pass
            try:
                c.execute("ALTER TABLE work_items ADD COLUMN parent_work_id TEXT")
            except sqlite3.OperationalError:
                pass
            try:
                c.execute("ALTER TABLE employees ADD COLUMN is_lead INTEGER DEFAULT 0")
            except sqlite3.OperationalError:
                pass
            try:
                # Distinct from the existing `model` column: that one picks
                # the claude_model/agy_model override for a project-bound
                # session's background CLI task. This one picks which model
                # answers casual (project-less) chat — a plain OpenAI-
                # compatible completion, unrelated to either CLI.
                c.execute("ALTER TABLE office_sessions ADD COLUMN chat_model TEXT")
            except sqlite3.OperationalError:
                pass

    # --- employees ---

    def create_employee(self, employee_id, name, role="", avatar="", personality="",
                        model="", engine="", skill_ids=None, team_id=None,
                        is_lead=False) -> dict:
        now = time.time()
        with self._conn() as c:
            c.execute(
                "INSERT INTO employees(employee_id,name,role,avatar,personality,model,"
                "engine,skill_ids,team_id,energy,status,pos_x,pos_y,active,is_lead,created,updated) "
                "VALUES(?,?,?,?,?,?,?,?,?,100,'idle',0,0,1,?,?,?)",
                (employee_id, name, role, avatar, personality, model, engine,
                 json.dumps(skill_ids or []), team_id, int(bool(is_lead)), now, now))
        row = self.get_employee(employee_id)
        self.publish({"type": "office_employee_updated", "employee_id": employee_id})
        return row

    def update_employee(self, employee_id, publish: bool = True, **fields) -> dict | None:
        allowed = {"name", "role", "avatar", "personality", "model", "engine",
                   "skill_ids", "team_id", "energy", "status", "pos_x", "pos_y", "active",
                   "is_lead"}
        sets, vals = [], []
        for k, v in fields.items():
            if k not in allowed:
                continue
            if k == "skill_ids":
                v = json.dumps(v) if v is not None else None
            sets.append(f"{k}=?")
            vals.append(v)
        if not sets:
            return self.get_employee(employee_id)
        sets.append("updated=?")
        vals.append(time.time())
        vals.append(employee_id)
        with self._conn() as c:
            c.execute(f"UPDATE employees SET {', '.join(sets)} WHERE employee_id=?", vals)
        row = self.get_employee(employee_id)
        # publish=False lets a caller that's about to update many rows in one
        # pass (office.py's simulation tick) send a single batched event
        # instead of one SSE message per employee.
        if publish:
            self.publish({"type": "office_employee_updated", "employee_id": employee_id})
        return row

    def apply_energy_tick(self, employee_id: str, from_status: str, delta: float,
                          cross_status: str, cross_when_delta_positive: bool,
                          threshold: float) -> bool:
        """Atomically applies one simulation tick's energy delta to a single
        employee, computed against the row's CURRENT `energy` (not a
        Python-side value read earlier by office.py's tick() snapshot loop)
        and gated on `status` still being `from_status` at the moment this
        UPDATE executes. A regular request thread (FastAPI runs sync routes
        like PUT /employees off the event loop, in a real OS thread) can
        change status concurrently with tick() reading its snapshot and
        writing moments later; without this guard tick's stale-based
        write can stomp that concurrent change. Returns True if the row
        matched and was updated, False if `from_status` no longer matched
        (employee moved on already — tick just skips them this round)."""
        new_energy = "MIN(100.0, energy + :delta)" if delta >= 0 else "MAX(0.0, energy + :delta)"
        crossed = f"{new_energy} {'>=' if cross_when_delta_positive else '<='} :threshold"
        with self._conn() as c:
            cur = c.execute(
                f"UPDATE employees SET energy = {new_energy}, "
                f"status = CASE WHEN {crossed} THEN :cross_status ELSE status END, "
                f"updated = :now "
                f"WHERE employee_id = :employee_id AND status = :from_status",
                {"delta": delta, "threshold": threshold, "cross_status": cross_status,
                 "now": time.time(), "employee_id": employee_id, "from_status": from_status},
            )
            changed = cur.rowcount > 0
        return changed

    def delete_employee(self, employee_id) -> bool:
        """Soft delete — work_items/tasks keep pointing at a real (inactive)
        employee instead of dangling."""
        with self._conn() as c:
            cur = c.execute("UPDATE employees SET active=0, updated=? WHERE employee_id=?",
                            (time.time(), employee_id))
            deleted = cur.rowcount > 0
        if deleted:
            self.publish({"type": "office_employee_deleted", "employee_id": employee_id})
        return deleted

    def get_employee(self, employee_id) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM employees WHERE employee_id=?", (employee_id,)).fetchone()
            return _row_to_employee(r) if r else None

    def list_employees(self, team_id: str | None = None, active_only: bool = True) -> list[dict]:
        q = "SELECT * FROM employees WHERE 1=1"
        args = []
        if active_only:
            q += " AND active=1"
        if team_id is not None:
            q += " AND team_id=?"
            args.append(team_id)
        q += " ORDER BY created ASC"
        with self._conn() as c:
            rows = c.execute(q, args).fetchall()
            return [_row_to_employee(r) for r in rows]

    # --- teams ---

    def create_team(self, team_id, name, description="") -> dict:
        now = time.time()
        with self._conn() as c:
            c.execute("INSERT INTO teams(team_id,name,description,created) VALUES(?,?,?,?)",
                      (team_id, name, description, now))
        row = self.get_team(team_id)
        self.publish({"type": "office_team_updated", "team_id": team_id})
        return row

    def update_team(self, team_id, **fields) -> dict | None:
        allowed = {"name", "description"}
        sets, vals = [], []
        for k, v in fields.items():
            if k not in allowed:
                continue
            sets.append(f"{k}=?")
            vals.append(v)
        if not sets:
            return self.get_team(team_id)
        vals.append(team_id)
        with self._conn() as c:
            c.execute(f"UPDATE teams SET {', '.join(sets)} WHERE team_id=?", vals)
        row = self.get_team(team_id)
        self.publish({"type": "office_team_updated", "team_id": team_id})
        return row

    def delete_team(self, team_id) -> bool:
        """Un-assigns member employees (team_id -> NULL) rather than deleting
        them, then removes the team row."""
        with self._conn() as c:
            c.execute("UPDATE employees SET team_id=NULL, updated=? WHERE team_id=?",
                      (time.time(), team_id))
            cur = c.execute("DELETE FROM teams WHERE team_id=?", (team_id,))
            deleted = cur.rowcount > 0
        if deleted:
            self.publish({"type": "office_team_deleted", "team_id": team_id})
        return deleted

    def get_team(self, team_id) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM teams WHERE team_id=?", (team_id,)).fetchone()
            return dict(r) if r else None

    def list_teams(self) -> list[dict]:
        with self._conn() as c:
            teams = [dict(r) for r in c.execute("SELECT * FROM teams ORDER BY created ASC").fetchall()]
            counts = c.execute(
                "SELECT team_id, COUNT(*) n FROM employees WHERE active=1 AND team_id IS NOT NULL "
                "GROUP BY team_id").fetchall()
            by_id = {r["team_id"]: r["n"] for r in counts}
        for t in teams:
            t["member_count"] = by_id.get(t["team_id"], 0)
        return teams

    # --- work items ---

    def create_work_item(self, work_id, employee_id, kind, prompt, team_id=None,
                         task_id=None, status="queued", session_id=None,
                         parent_work_id=None) -> dict:
        now = time.time()
        with self._conn() as c:
            c.execute(
                "INSERT INTO work_items(work_id,employee_id,team_id,kind,task_id,prompt,"
                "output_text,status,cost_usd,session_id,parent_work_id,created,updated) "
                "VALUES(?,?,?,?,?,?,'',?,0,?,?,?,?)",
                (work_id, employee_id, team_id, kind, task_id, prompt, status, session_id,
                 parent_work_id, now, now))
        row = self.get_work_item(work_id)
        self.publish({"type": "office_work_item_updated", "work_id": work_id})
        return row

    def update_work_item(self, work_id, **fields) -> dict | None:
        allowed = {"output_text", "status", "cost_usd", "task_id"}
        sets, vals = [], []
        for k, v in fields.items():
            if k not in allowed or v is None:
                continue
            sets.append(f"{k}=?")
            vals.append(v)
        if not sets:
            return self.get_work_item(work_id)
        sets.append("updated=?")
        vals.append(time.time())
        vals.append(work_id)
        with self._conn() as c:
            c.execute(f"UPDATE work_items SET {', '.join(sets)} WHERE work_id=?", vals)
        row = self.get_work_item(work_id)
        self.publish({"type": "office_work_item_updated", "work_id": work_id})
        return row

    def get_work_item(self, work_id) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM work_items WHERE work_id=?", (work_id,)).fetchone()
            return dict(r) if r else None

    def find_work_item_by_task(self, task_id) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM work_items WHERE task_id=?", (task_id,)).fetchone()
            return dict(r) if r else None

    def list_work_items(self, employee_id=None, team_id=None, parent_work_id=None,
                        limit=50) -> list[dict]:
        q = "SELECT * FROM work_items WHERE 1=1"
        args = []
        if employee_id is not None:
            q += " AND employee_id=?"
            args.append(employee_id)
        if team_id is not None:
            q += " AND team_id=?"
            args.append(team_id)
        if parent_work_id is not None:
            q += " AND parent_work_id=?"
            args.append(parent_work_id)
        q += " ORDER BY created DESC LIMIT ?"
        args.append(limit)
        with self._conn() as c:
            rows = c.execute(q, args).fetchall()
            return [dict(r) for r in rows]

    # --- meetings ---

    def create_meeting(self, meeting_id, team_id, participant_ids, topic, transcript,
                       triggered_by="manual") -> dict:
        with self._conn() as c:
            c.execute(
                "INSERT INTO meetings(meeting_id,team_id,participant_ids,topic,transcript,"
                "triggered_by,created) VALUES(?,?,?,?,?,?,?)",
                (meeting_id, team_id, json.dumps(participant_ids), topic, transcript,
                 triggered_by, time.time()))
        row = self.get_meeting(meeting_id)
        self.publish({"type": "office_meeting_done", "meeting_id": meeting_id,
                      "team_id": team_id, "topic": topic})
        return row

    def get_meeting(self, meeting_id) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM meetings WHERE meeting_id=?", (meeting_id,)).fetchone()
            return _row_to_meeting(r) if r else None

    def list_meetings(self, team_id=None, triggered_by=None, limit=50) -> list[dict]:
        q = "SELECT * FROM meetings WHERE 1=1"
        args = []
        if team_id is not None:
            q += " AND team_id=?"
            args.append(team_id)
        if triggered_by is not None:
            q += " AND triggered_by=?"
            args.append(triggered_by)
        q += " ORDER BY created DESC LIMIT ?"
        args.append(limit)
        with self._conn() as c:
            rows = c.execute(q, args).fetchall()
            return [_row_to_meeting(r) for r in rows]


    # --- sessions ---
    # A session is a chat thread bound to one employee. The conversation
    # transcript itself lives in the *main* Store's `messages` table, keyed
    # by session_id as the conv_id — same table the operator's own web chat
    # uses, just a different conv_id per session. This table only holds the
    # session's own settings (title, and the project/model/engine that make
    # a message in this thread run as a real continuing task vs. a persona
    # chat reply — see OfficeManager.send_session_message).

    def create_session(self, session_id, employee_id, title="", project=None,
                       model="", engine="") -> dict:
        now = time.time()
        with self._conn() as c:
            c.execute(
                "INSERT INTO office_sessions(session_id,employee_id,title,project,model,"
                "engine,created,updated) VALUES(?,?,?,?,?,?,?,?)",
                (session_id, employee_id, title, project, model, engine, now, now))
        row = self.get_session(session_id)
        self.publish({"type": "office_session_updated", "session_id": session_id,
                      "employee_id": employee_id})
        return row

    def update_session(self, session_id, **fields) -> dict | None:
        allowed = {"title", "project", "model", "engine", "chat_model"}
        sets, vals = [], []
        for k, v in fields.items():
            if k not in allowed:
                continue
            sets.append(f"{k}=?")
            vals.append(v)
        if not sets:
            return self.get_session(session_id)
        sets.append("updated=?")
        vals.append(time.time())
        vals.append(session_id)
        with self._conn() as c:
            c.execute(f"UPDATE office_sessions SET {', '.join(sets)} WHERE session_id=?", vals)
        row = self.get_session(session_id)
        if row:
            self.publish({"type": "office_session_updated", "session_id": session_id,
                          "employee_id": row["employee_id"]})
        return row

    def touch_session(self, session_id) -> None:
        """Bumps `updated` with no other field change — called whenever a
        message lands, so the session list sorts most-recently-active first,
        same as the main app's session list."""
        with self._conn() as c:
            c.execute("UPDATE office_sessions SET updated=? WHERE session_id=?",
                      (time.time(), session_id))

    def delete_session(self, session_id) -> bool:
        with self._conn() as c:
            cur = c.execute("DELETE FROM office_sessions WHERE session_id=?", (session_id,))
            deleted = cur.rowcount > 0
        if deleted:
            self.main_store.clear_messages(session_id)
            self.publish({"type": "office_session_deleted", "session_id": session_id})
        return deleted

    def get_session(self, session_id) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM office_sessions WHERE session_id=?", (session_id,)).fetchone()
            return dict(r) if r else None

    def list_sessions(self, employee_id=None) -> list[dict]:
        q = "SELECT * FROM office_sessions WHERE 1=1"
        args = []
        if employee_id is not None:
            q += " AND employee_id=?"
            args.append(employee_id)
        q += " ORDER BY updated DESC"
        with self._conn() as c:
            rows = c.execute(q, args).fetchall()
            return [dict(r) for r in rows]


def _row_to_employee(r: sqlite3.Row) -> dict:
    d = dict(r)
    try:
        d["skill_ids"] = json.loads(d.get("skill_ids") or "[]")
    except (TypeError, ValueError):
        d["skill_ids"] = []
    d["active"] = bool(d.get("active", 1))
    d["is_lead"] = bool(d.get("is_lead", 0))
    return d


def _row_to_meeting(r: sqlite3.Row) -> dict:
    d = dict(r)
    try:
        d["participant_ids"] = json.loads(d.get("participant_ids") or "[]")
    except (TypeError, ValueError):
        d["participant_ids"] = []
    return d
