from __future__ import annotations
import os, re, sqlite3, time
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager

# Terminal statuses that get a markdown archive note written to the vault. A
# repeated "failed" just overwrites the same note, so the write is idempotent.
_ARCHIVE_STATUSES = ("done", "failed")
_FACT_FOOTER = "\n\nTerkait: [[operator]]\n"


def _atomic_write(path: Path, text: str) -> None:
    """Write via a temp file and rename, so a reader (or a second Hermes process)
    never sees a half-written note. os.replace is atomic within a directory."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


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


def _fact_value(body: str) -> str:
    """The fact text out of a note body, tolerant of how it was written.

    A fact note may be written by Hermes (value, then a `Terkait:` footer) or
    edited by the operator or the agent through the obsidian MCP server, which
    need not keep that exact shape. So the value is everything up to the first
    `Terkait:` line rather than a fixed split — an edit that moved a blank line
    no longer swallows the footer into the value or loses the value entirely.
    """
    out = []
    for ln in body.splitlines():
        if ln.strip().startswith("Terkait:"):
            break
        out.append(ln)
    return "\n".join(out).strip()


def _body_field(body: str, label: str) -> str:
    """The value of a `- <label>: ...` line in a note body, or ""."""
    prefix = f"- {label}:"
    for ln in body.splitlines():
        s = ln.strip()
        if s.startswith(prefix):
            return s[len(prefix):].strip()
    return ""


def _task_request(body: str) -> str:
    """The original request text out of an archived task note: the lines between
    the `# Task` heading and the first `- ` metadata bullet."""
    out = []
    for ln in body.splitlines():
        s = ln.strip()
        if s.startswith("# Task"):
            continue
        if s.startswith("- ") or s.startswith("Terkait:"):
            break
        if s:
            out.append(s)
    return " ".join(out)[:300]

# Statuses that only a live in-process task can advance. Nothing else ever
# moves them, so after a restart they are lies. "interrupted" is deliberately
# absent: it is terminal, which is what makes the sweep idempotent and keeps
# start.bat's auto-restart loop from re-notifying on every pass.
INTERRUPTIBLE = ("running", "awaiting_confirm", "queued")
_IN_INTERRUPTIBLE = f"({','.join('?' * len(INTERRUPTIBLE))})"

def _score_relevance(tokens: set[str], text: str) -> float:
    if not tokens:
        return 1.0
    text_lower = text.lower()
    score = 0.0
    for tok in tokens:
        if tok in text_lower:
            score += 2.0 if re.search(rf"\b{re.escape(tok)}\b", text_lower) else 1.0
    return score



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
                CREATE TABLE IF NOT EXISTS scheduled_jobs(
                  job_id TEXT PRIMARY KEY, description TEXT,
                  interval_s INTEGER, next_run_ts REAL,
                  last_run_ts REAL, enabled INTEGER DEFAULT 1,
                  chat_id INTEGER, created REAL);
                CREATE TABLE IF NOT EXISTS conv_context(
                  conv_id TEXT PRIMARY KEY, summary TEXT DEFAULT '',
                  through_id INTEGER DEFAULT 0);
                """
            )
            try:
                c.execute("ALTER TABLE tasks ADD COLUMN session_id TEXT")
            except sqlite3.OperationalError:
                pass
            try:
                c.execute("ALTER TABLE sessions ADD COLUMN project TEXT")
            except sqlite3.OperationalError:
                pass
            try:
                c.execute("ALTER TABLE sessions ADD COLUMN engine TEXT")
            except sqlite3.OperationalError:
                pass
            try:
                c.execute("CREATE TABLE IF NOT EXISTS scheduled_jobs(job_id TEXT PRIMARY KEY, description TEXT, interval_s INTEGER, next_run_ts REAL, last_run_ts REAL, enabled INTEGER DEFAULT 1, chat_id INTEGER, created REAL)")
            except sqlite3.OperationalError:
                pass

    def create_session(self, session_id, title, project=None, engine=None):
        with self._conn() as c:
            c.execute(
                "INSERT INTO sessions(session_id, title, created, project, engine) "
                "VALUES(?,?,?,?,?) "
                "ON CONFLICT(session_id) DO UPDATE SET "
                "title=excluded.title, project=COALESCE(excluded.project, sessions.project), "
                "engine=COALESCE(excluded.engine, sessions.engine)",
                (session_id, title, time.time(), project, engine))
        self.publish({"type": "session_created", "session_id": session_id, "title": title, "project": project, "engine": engine})

    def ensure_session(self, session_id, title, project=None, engine=None):
        """Create the session only if it does not exist yet, and say whether it
        did. Unlike create_session this never overwrites the title — a caller
        that runs on every message (the Telegram bridge) must not rename a
        conversation the operator has already renamed."""
        with self._conn() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO sessions(session_id, title, created, project, engine) VALUES(?,?,?,?,?)",
                (session_id, title, time.time(), project, engine))
            created = cur.rowcount > 0
        if created:
            self.publish({"type": "session_created", "session_id": session_id, "title": title, "project": project, "engine": engine})
        return created

    def rename_session(self, session_id, title):
        with self._conn() as c:
            c.execute("UPDATE sessions SET title=? WHERE session_id=?", (title, session_id))
        self.publish({"type": "session_renamed", "session_id": session_id, "title": title})

    def update_session_settings(self, session_id, project=None, engine=None, title=None):
        with self._conn() as c:
            row = c.execute("SELECT title, project, engine FROM sessions WHERE session_id=?", (session_id,)).fetchone()
            if not row:
                return False
            new_title = title if title is not None else row["title"]
            new_project = project if project is not None else row["project"]
            new_engine = engine if engine is not None else row["engine"]
            c.execute(
                "UPDATE sessions SET title=?, project=?, engine=? WHERE session_id=?",
                (new_title, new_project, new_engine, session_id))
        self.publish({"type": "session_updated", "session_id": session_id, "title": new_title, "project": new_project, "engine": new_engine})
        return True

    def get_session(self, session_id):
        with self._conn() as c:
            r = c.execute("SELECT * FROM sessions WHERE session_id=?", (session_id,)).fetchone()
            return dict(r) if r else None

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
        self._purge_task_notes(task_ids)
        self.publish({"type": "session_deleted", "session_id": session_id})
        return task_ids

    def _purge_task_notes(self, task_ids) -> None:
        """Remove the vault archive notes for deleted tasks, and rebuild the
        project notes that referenced them so no `[[task]]` link dangles. The
        knowledge store must not outlive the tasks its notes describe."""
        tdir = self.vault_dir / "tasks"
        projects = set()
        for tid in task_ids:
            p = tdir / f"{_safe_name(str(tid))}.md"
            try:
                if p.exists():
                    meta, _ = _parse_frontmatter(p.read_text(encoding="utf-8"))
                    if meta.get("project"):
                        projects.add(meta["project"])
                    p.unlink()
            except OSError:
                pass
        for name in projects:
            try:
                self._upsert_project_note(name)
            except Exception:
                pass
        if task_ids:
            from . import vault_git
            vault_git.autocommit(self.vault_dir, "vault: purge deleted tasks")

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

    # --- rolling context-compression state (see chat_engine.maybe_compress) ---
    # The raw transcript in `messages` is never trimmed or deleted — the UI
    # thread stays complete. This table only tracks how far a summary has
    # folded older turns in, so the model's live window can stay short
    # without the operator losing anything the model forgot.

    def get_context_summary(self, conv_id) -> tuple[str, int]:
        with self._conn() as c:
            row = c.execute(
                "SELECT summary, through_id FROM conv_context WHERE conv_id=?",
                (conv_id,)).fetchone()
            return (row["summary"], row["through_id"]) if row else ("", 0)

    def save_context_summary(self, conv_id, summary: str, through_id: int) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT INTO conv_context(conv_id, summary, through_id) VALUES(?,?,?) "
                "ON CONFLICT(conv_id) DO UPDATE SET "
                "summary=excluded.summary, through_id=excluded.through_id",
                (conv_id, summary, through_id))

    def get_messages_for_compression(self, conv_id, keep_last: int, already_through: int):
        """Messages older than the live `keep_last` window and not yet folded
        into the summary (id > already_through) — the tail about to fall out
        of context. Returns ([{"id","role","content"}], new_boundary_id); an
        empty list means nothing eligible yet, and new_boundary_id echoes
        already_through unchanged."""
        with self._conn() as c:
            total = c.execute(
                "SELECT COUNT(*) n FROM messages WHERE conv_id=?", (conv_id,)).fetchone()["n"]
            if total <= keep_last:
                return [], already_through
            boundary_row = c.execute(
                "SELECT id FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 1 OFFSET ?",
                (conv_id, keep_last - 1)).fetchone()
            boundary = boundary_row["id"]
            rows = c.execute(
                "SELECT id, role, content FROM messages "
                "WHERE conv_id=? AND id>? AND id<? ORDER BY id",
                (conv_id, already_through, boundary)).fetchall()
            return [dict(r) for r in rows], boundary

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
        _atomic_write(d / f"{_safe_name(key)}.md",
                      f"---\nkey: {key}\nts: {time.time()}\n---\n{value}{_FACT_FOOTER}")

    def _fact_files(self):
        """The notes list_facts reads: every note under facts/, plus any note at
        the vault root explicitly marked `type: fact` in its frontmatter.

        facts/ is the canonical home and the only place set_fact writes. The root
        allowance is a safety net for the future tier where the chat agent edits
        memory through obsidian tools: `create-note` drops a note at the root by
        default, so a fact the agent files there stays visible instead of being
        silently lost. The root scan is non-recursive and marker-gated, so it
        never walks tasks/ or projects/ or slurps the hub notes (INDEX, operator).
        """
        d = self._facts_dir()
        if d.is_dir():
            yield from ((p, False) for p in d.glob("*.md"))
        if self.vault_dir.is_dir():
            yield from ((p, True) for p in self.vault_dir.glob("*.md"))

    def list_facts(self, limit=50):
        """Newest first, so a `limit` that bites drops the stalest facts."""
        rows, seen = [], set()
        for p, is_root in self._fact_files():
            try:
                meta, body = _parse_frontmatter(p.read_text(encoding="utf-8"))
            except OSError:
                continue
            if is_root and meta.get("type") != "fact":
                continue        # an unmarked root note is not a fact
            key = meta.get("key") or p.stem
            if key in seen:
                continue        # facts/ wins over a root note of the same key
            seen.add(key)
            # ts orders the facts and decides which survive the limit. A note the
            # agent created through obsidian MCP has no `ts` frontmatter, so fall
            # back to the file's own mtime rather than 0 — a 0 would banish every
            # agent-written fact to the bottom and quietly drop it past the cap.
            ts = None
            raw_ts = meta.get("ts")
            if raw_ts:
                try:
                    ts = float(raw_ts)
                except ValueError:
                    ts = None
            if ts is None:
                try:
                    ts = p.stat().st_mtime
                except OSError:
                    ts = 0.0
            rows.append({"key": key, "value": _fact_value(body), "ts": ts})
        rows.sort(key=lambda r: r["ts"], reverse=True)
        return rows[:limit]

    def recall_facts(self, query: str | None = None, limit: int = 10) -> list[dict]:
        facts = self.list_facts(limit=100)
        q = (query or "").strip().lower()
        if not q:
            return facts[:limit]
        terms = set(re.findall(r"\w+", q))
        scored = []
        for f in facts:
            score = _score_relevance(terms, f["key"] + " " + f["value"])
            if score > 0 or q in f["value"].lower():
                scored.append((score, f))
        scored.sort(key=lambda x: (x[0], x[1]["ts"] or 0.0), reverse=True)
        return [f for _, f in scored[:limit]]

    def delete_fact(self, key):
        (self._facts_dir() / f"{_safe_name(key)}.md").unlink(missing_ok=True)

    # --- per-task archive ---
    # Written when a task reaches a terminal status: a human-readable record of
    # what ran, in the same vault as the facts, linked to [[operator]] and the
    # project. Best-effort by construction — a failed note write must never turn
    # a finished task into a failed status update. The outcome line and the
    # `project` frontmatter are what makes an archive worth reading back: they
    # let recall_tasks feed a project's past results into the next plan.

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
            # The last log entry is the task's own verdict — "task complete", a
            # failure message, or the step that stopped it. Only its first
            # physical line is the verdict: a done task appends the change summary
            # (a git table) under it, which is noise in a recall prompt, so take
            # the headline and drop the rest.
            outcome = ""
            for line in reversed(self.get_logs(task_id)):
                if line and line.strip():
                    outcome = line.strip().splitlines()[0].strip()[:200]
                    break
            fm = ["type: task", f"task_id: {task_id}",
                  f"status: {t.get('status', '')}", f"created: {when}"]
            if name:
                fm.append(f"project: {name}")
            lines = ["---", *fm, "---",
                     f"# Task {task_id}", "",
                     (t.get("text") or "").strip(), "",
                     f"- Status: {t.get('status', '')}"]
            if when:
                lines.append(f"- Dibuat: {when}")
            if name:
                lines.append(f"- Proyek: [[proyek-{name}]]")
            if outcome:
                lines.append(f"- Hasil: {outcome}")
            for a in arts:
                lines.append(f"- {a['kind']}: `{a['path']}`")
            lines.append("\nTerkait: [[operator]]")
            d = self.vault_dir / "tasks"
            d.mkdir(parents=True, exist_ok=True)
            _atomic_write(d / f"{_safe_name(str(task_id))}.md",
                          "\n".join(lines) + "\n")
            if name:
                self._upsert_project_note(name)
            # A finished task is a natural checkpoint: commit the new archive note
            # and any facts learned since the last one. Best-effort by import too,
            # so a store built in a test without git in scope stays unaffected.
            from . import vault_git
            vault_git.autocommit(self.vault_dir, f"vault: task {task_id} {t.get('status', '')}")
        except Exception:
            pass

    def recall_tasks(self, project: str | None = None, query: str | None = None,
                     limit: int = 5) -> list[dict]:
        """Past task archives, ranked by relevance and recency, for feeding back into a plan.

        Filtered by `project` when given (the strong signal: what happened last
        time this repo was touched); otherwise ranked by keyword `query` against the
        request text and body.
        """
        d = self.vault_dir / "tasks"
        if not d.is_dir():
            return []
        q = (query or "").strip().lower()
        terms = set(re.findall(r"\w+", q)) if q else set()
        candidates = []
        for p in d.glob("*.md"):
            try:
                meta, body = _parse_frontmatter(p.read_text(encoding="utf-8"))
            except OSError:
                continue
            proj = meta.get("project") or ""
            request = _task_request(body)
            if project is not None and proj != project:
                continue
            content = (request + " " + body).lower()
            if terms:
                score = _score_relevance(terms, content)
                if score <= 0 and q not in content:
                    continue
            else:
                score = 1.0
            candidates.append({
                "task_id": meta.get("task_id") or p.stem,
                "status": meta.get("status", ""),
                "project": proj,
                "text": request,
                "outcome": _body_field(body, "Hasil"),
                "score": score,
                "stem": p.stem,
            })
        if terms:
            candidates.sort(key=lambda x: (x["score"], x["stem"]), reverse=True)
        else:
            candidates.sort(key=lambda x: x["stem"], reverse=True)
        return [{"task_id": c["task_id"], "status": c["status"], "project": c["project"],
                 "text": c["text"], "outcome": c["outcome"]} for c in candidates[:limit]]


    # --- project notes ---
    # One note per project, regenerated from the task archive whenever a task
    # for it finishes. It both resolves the [[proyek-x]] links the task notes
    # emit (an un-backed wikilink is a dead node in the graph) and gives the
    # operator — and the planner, via recall_tasks — a single place that lists
    # every task run against that project.

    def _upsert_project_note(self, name: str) -> None:
        tasks = self.recall_tasks(project=name, limit=1000)
        lines = ["---", "type: project", f"name: {name}", "---",
                 f"# Proyek {name}", "", "## Riwayat task", ""]
        if tasks:
            for t in tasks:
                first = (t["text"].splitlines()[0][:80] if t["text"] else "")
                entry = f"- [[{t['task_id']}]] [{t['status']}] {first}".rstrip()
                if t["outcome"]:
                    entry += f" — {t['outcome']}"
                lines.append(entry)
        else:
            lines.append("(belum ada task)")
        lines.append("\nTerkait: [[operator]]")
        d = self.vault_dir / "projects"
        d.mkdir(parents=True, exist_ok=True)
        _atomic_write(d / f"proyek-{_safe_name(name)}.md",
                      "\n".join(lines) + "\n")

    # --- scheduled jobs ---
    def create_scheduled_job(self, job_id: str, description: str, interval_s: int,
                             next_run_ts: float, chat_id: int = 0):
        with self._conn() as c:
            c.execute(
                "INSERT INTO scheduled_jobs(job_id, description, interval_s, next_run_ts, last_run_ts, enabled, chat_id, created) "
                "VALUES(?,?,?,?,?,1,?,?) "
                "ON CONFLICT(job_id) DO UPDATE SET "
                "description=excluded.description, interval_s=excluded.interval_s, "
                "next_run_ts=excluded.next_run_ts, enabled=1, chat_id=excluded.chat_id",
                (job_id, description, interval_s, next_run_ts, 0.0, chat_id, time.time()))
        self.publish({"type": "scheduled_job_created", "job_id": job_id, "description": description})

    def list_scheduled_jobs(self, enabled_only: bool = False) -> list[dict]:
        with self._conn() as c:
            query = "SELECT * FROM scheduled_jobs"
            if enabled_only:
                query += " WHERE enabled=1"
            query += " ORDER BY next_run_ts ASC"
            rows = c.execute(query).fetchall()
            return [dict(r) for r in rows]

    def get_scheduled_job(self, job_id: str) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM scheduled_jobs WHERE job_id=?", (job_id,)).fetchone()
            return dict(r) if r else None

    def update_scheduled_job_run(self, job_id: str, last_run_ts: float, next_run_ts: float,
                                 enabled: bool = True):
        with self._conn() as c:
            c.execute(
                "UPDATE scheduled_jobs SET last_run_ts=?, next_run_ts=?, enabled=? WHERE job_id=?",
                (last_run_ts, next_run_ts, 1 if enabled else 0, job_id))
        self.publish({"type": "scheduled_job_updated", "job_id": job_id, "next_run_ts": next_run_ts})

    def delete_scheduled_job(self, job_id: str) -> bool:
        with self._conn() as c:
            cur = c.execute("DELETE FROM scheduled_jobs WHERE job_id=?", (job_id,))
            deleted = cur.rowcount > 0
        if deleted:
            self.publish({"type": "scheduled_job_deleted", "job_id": job_id})
        return deleted
