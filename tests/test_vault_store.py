"""Vault-backed facts, task archive, project notes, and planner recall."""
from hermes import plan_context
from hermes.session_store import Store


def _store(tmp_path):
    s = Store(tmp_path / "t.db", vault_dir=tmp_path / "vault")
    s.init_schema()
    return s


# --- #4: tolerant fact parsing ---

def test_list_facts_reads_note_without_our_frontmatter(tmp_path):
    """A fact note the agent wrote via obsidian MCP has no key/ts frontmatter;
    it must still be read, keyed by filename and ordered by mtime, not dropped."""
    s = _store(tmp_path)
    fd = tmp_path / "vault" / "facts"
    fd.mkdir(parents=True)
    (fd / "editor.md").write_text("VS Code\n", encoding="utf-8")
    facts = {f["key"]: f["value"] for f in s.list_facts()}
    assert facts["editor"] == "VS Code"
    assert next(f for f in s.list_facts() if f["key"] == "editor")["ts"] > 0


def test_fact_value_stops_at_footer(tmp_path):
    s = _store(tmp_path)
    s.set_fact("hari_deploy", "Jumat")
    facts = {f["key"]: f["value"] for f in s.list_facts()}
    assert facts["hari_deploy"] == "Jumat"  # no "Terkait:" footer leaks in


# --- #2: archive + project note ---

def test_terminal_status_writes_enriched_archive(tmp_path):
    s = _store(tmp_path)
    s.create_task("t1", 1, "@demo bikin fitur login")
    s.append_log("t1", "task complete")
    s.set_task_status("t1", "done")
    note = (tmp_path / "vault" / "tasks" / "t1.md").read_text(encoding="utf-8")
    assert "project: demo" in note
    assert "- Hasil: task complete" in note
    assert "[[proyek-demo]]" in note


def test_archive_backs_the_project_note(tmp_path):
    s = _store(tmp_path)
    s.create_task("t1", 1, "@demo tambah search")
    s.set_task_status("t1", "done")
    proj = (tmp_path / "vault" / "projects" / "proyek-demo.md").read_text(encoding="utf-8")
    assert "[[t1]]" in proj
    assert "type: project" in proj


# --- #1: recall for the planner ---

def test_recall_tasks_by_project(tmp_path):
    s = _store(tmp_path)
    s.create_task("t1", 1, "@demo tambah search")
    s.append_log("t1", "gagal: Google API key kosong")
    s.set_task_status("t1", "failed")
    s.create_task("t2", 1, "@lain sesuatu")
    s.set_task_status("t2", "done")
    r = s.recall_tasks(project="demo")
    assert [t["task_id"] for t in r] == ["t1"]
    assert r[0]["status"] == "failed"
    assert "API key" in r[0]["outcome"]


def test_recall_tasks_by_query_when_no_project(tmp_path):
    s = _store(tmp_path)
    s.create_task("t1", 1, "bikin counter flutter")
    s.set_task_status("t1", "done")
    assert s.recall_tasks(query="counter")
    assert s.recall_tasks(query="tidak-ada-kata-ini") == []


def test_recall_block_renders_outcomes_and_is_empty_when_none():
    assert plan_context.recall_block([]) == ""
    block = plan_context.recall_block(
        [{"status": "failed", "text": "tambah search", "outcome": "API key kosong"}])
    assert "tambah search" in block and "API key kosong" in block and "failed" in block
