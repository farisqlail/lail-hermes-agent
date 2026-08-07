# Chat Auto-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A code request typed into the Hermes chat pane edits the project by itself when the project is named, its repository is clean, and the work is not risky — instead of coming back as a patch the operator has to paste.

**Architecture:** Three seams, no new subsystems. The confirm gate in `Bridge.handle_task` stops injecting a synthetic reason for chat-initiated tasks, so the `reasons` list it already computes (`detect_risky` plus the git-undo probe) decides alone. `handle_task` gains an `on_decision` callback so the `start_task` tool can report the decision it actually made instead of a hardcoded string. The chat system prompt is rewritten to route code requests into `start_task` and to forbid answering them with an inline patch.

**Tech Stack:** Python 3.11+, asyncio, pytest with `asyncio_mode = "auto"` (configured in `pyproject.toml`), FastAPI + `starlette.testclient` for the web layer.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-hermes-chat-implements-code-design.md`. Read it before Task 1.
- Branch: `feat/chat-auto-run` (already created, holds the spec commit).
- Risky work (`git push`, deploy, delete, paths outside the project) must hold for confirmation **even when `Settings.confirm_risky` is `False`**. No task may weaken this.
- The Telegram `/task` path calls `handle_task` with `force_confirm=False` and must keep its current behavior. Every change in Task 1 and Task 2 sits behind `force_confirm`.
- Prompt text is never asserted against string literals in tests. Behavior is tested; wording is not.
- Comments explain *why*, matching the density already in `hermes/telegram_bridge.py`. Do not add narration comments to obvious lines.
- Run tests with `python -m pytest` from the repository root (`E:\lail-hermes-agent`).

---

### Task 1: Gate — a chat task runs when there is nothing to weigh

**Files:**
- Modify: `hermes/telegram_bridge.py:166-186`
- Test: `tests/test_telegram_bridge.py` (rewrite 2 tests, add 5)

**Interfaces:**
- Consumes: `Bridge.handle_task(user_id, chat_id, text, task_id=None, trusted=False, force_confirm=False, session_id=None)`, `detect_risky(text) -> list[str]`, `Bridge.git_dirty(path) -> bool | None`, `Bridge.ask_confirm(chat_id, task_id, reasons)`.
- Produces: no signature change. Task 2 depends on the branch structure this task leaves behind — specifically that there are exactly three terminal outcomes for a `force_confirm` task: cancelled (no confirm channel for a flagged task), held (`awaiting_confirm`), run.

- [ ] **Step 1: Read the current gate**

Read `hermes/telegram_bridge.py:119-198` end to end. The block that matters:

```python
        reasons = detect_risky(text)
        gate_live = bool(settings.confirm_risky and self.ask_confirm)
        # The git probe runs even when the gate is off: ...
        if proj is not None and self.git_dirty is not None:
            ...
        if force_confirm and not self.ask_confirm:
            await self.sender(
                chat_id, f"Task {task_id} tidak dijalankan: tidak ada kanal konfirmasi.")
            self.store.set_task_status(task_id, "cancelled")
            return task_id
        must_confirm = force_confirm and bool(self.ask_confirm)
        if must_confirm and not reasons:
            reasons = ["dimulai oleh asisten chat — konfirmasi sebelum menjalankan"]

        if reasons and (gate_live or must_confirm):
```

The last two lines before the blank are what makes a chat task unable to reach the run branch.

- [ ] **Step 2: Rewrite the two tests that lock in the old behavior**

In `tests/test_telegram_bridge.py`, replace `test_force_confirm_holds_a_nonrisky_task` (line 172) and `test_force_confirm_refuses_without_a_confirm_channel` (line 196) with these three:

```python
async def test_force_confirm_runs_a_clean_nonrisky_task(hermes_home):
    """A chat-initiated task naming a project whose repository is clean, with no
    risky verb, runs on its own. This is the whole point of the auto-run path."""
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    ran, asked = [], []
    async def sender(chat, text, html=False): pass
    async def ask_confirm(chat, task_id, reasons): asked.append((task_id, reasons))
    async def git_dirty(path): return False
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm,
               git_dirty=git_dirty)

    tid = await b.handle_task(user_id=0, chat_id=5, text="@myprofit tambah endpoint",
                              trusted=True, force_confirm=True)
    assert ran == [tid]
    assert asked == []
    assert tid not in b.pending


async def test_force_confirm_refuses_a_flagged_task_without_a_confirm_channel(hermes_home):
    """A reason with nobody to ask must refuse, never run silently."""
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    ran = []
    async def sender(chat, text, html=False): pass
    async def git_dirty(path): return False
    class FakeOrch:
        async def run_task(self, *a, **k): ran.append(1)
    b = Bridge(settings, store, FakeOrch(), sender, git_dirty=git_dirty)  # no ask_confirm

    tid = await b.handle_task(user_id=0, chat_id=5, text="@myprofit git push it",
                              trusted=True, force_confirm=True)
    assert ran == []
    assert store.get_task(tid)["status"] == "cancelled"


async def test_force_confirm_runs_without_a_confirm_channel_when_nothing_is_flagged(hermes_home):
    """No reasons means no question, so a missing confirm channel is not a
    reason to cancel — the old code cancelled here."""
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    ran = []
    async def sender(chat, text, html=False): pass
    async def git_dirty(path): return False
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, git_dirty=git_dirty)  # no ask_confirm

    tid = await b.handle_task(user_id=0, chat_id=5, text="@myprofit tambah endpoint",
                              trusted=True, force_confirm=True)
    assert ran == [tid]
```

- [ ] **Step 3: Add the four tests for the branches that must still hold**

Append to `tests/test_telegram_bridge.py`, above the `_store` helper at the bottom:

```python
async def test_force_confirm_holds_a_dirty_project(hermes_home):
    """Uncommitted work is the one thing that makes an engine run unrecoverable,
    so it downgrades auto-run to a confirm rather than cancelling it."""
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    ran, asked = [], []
    async def sender(chat, text, html=False): pass
    async def ask_confirm(chat, task_id, reasons): asked.append((task_id, reasons))
    async def git_dirty(path): return True
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm,
               git_dirty=git_dirty)

    tid = await b.handle_task(user_id=0, chat_id=5, text="@myprofit tambah endpoint",
                              trusted=True, force_confirm=True)
    assert ran == []
    assert store.get_task(tid)["status"] == "awaiting_confirm"
    assert any("uncommitted" in r for r in b.confirm_reasons[tid])
    assert asked and asked[0][0] == tid

    assert await b.resolve_confirm(user_id=0, task_id=tid, approved=True, trusted=True)
    assert ran == [tid]


async def test_force_confirm_holds_when_there_is_no_git_undo(hermes_home):
    """git_dirty returning None means 'cannot tell' — not a repo, ignored, or no
    git. Auto-run must read that as a stop, not a yes."""
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    ran = []
    async def sender(chat, text, html=False): pass
    async def ask_confirm(chat, task_id, reasons): pass
    async def git_dirty(path): return None
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm,
               git_dirty=git_dirty)

    tid = await b.handle_task(user_id=0, chat_id=5, text="@myprofit tambah endpoint",
                              trusted=True, force_confirm=True)
    assert ran == []
    assert store.get_task(tid)["status"] == "awaiting_confirm"


async def test_force_confirm_holds_risky_text_even_with_the_gate_off(hermes_home):
    """confirm_risky=False turns the gate off for /task. A chat-initiated push
    must still be confirmed: must_confirm does not consult that setting."""
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], confirm_risky=False,
                        projects={"myprofit": str(proj)})
    ran = []
    async def sender(chat, text, html=False): pass
    async def ask_confirm(chat, task_id, reasons): pass
    async def git_dirty(path): return False
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm,
               git_dirty=git_dirty)

    tid = await b.handle_task(user_id=0, chat_id=5, text="@myprofit git push it",
                              trusted=True, force_confirm=True)
    assert ran == []
    assert store.get_task(tid)["status"] == "awaiting_confirm"


async def test_force_confirm_holds_a_task_that_names_no_project(hermes_home):
    """Without a project, orchestrator.run_task invents a throwaway workspace
    under projects/<task_id>. Auto-running into it burns an engine session on
    work nobody asked for."""
    store = _store(hermes_home)
    settings = Settings(allowed_user_ids=[1])
    ran = []
    async def sender(chat, text, html=False): pass
    async def ask_confirm(chat, task_id, reasons): pass
    async def git_dirty(path): return False
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm,
               git_dirty=git_dirty)

    tid = await b.handle_task(user_id=0, chat_id=5, text="tambah endpoint",
                              trusted=True, force_confirm=True)
    assert ran == []
    assert store.get_task(tid)["status"] == "awaiting_confirm"
    assert any("proyek" in r for r in b.confirm_reasons[tid])


async def test_force_confirm_holds_when_the_git_probe_is_not_wired(hermes_home):
    """Bridge treats a missing git_dirty as 'skip the dirty-tree check' —
    main._build_bridge's docstring warns that a dropped injection would disable
    the gate with every test still green. For auto-run that silence must be a
    stop, because there is then no evidence the run can be undone."""
    store = _store(hermes_home)
    proj = hermes_home / "myprofit"; proj.mkdir()
    settings = Settings(allowed_user_ids=[1], projects={"myprofit": str(proj)})
    ran = []
    async def sender(chat, text, html=False): pass
    async def ask_confirm(chat, task_id, reasons): pass
    class FakeOrch:
        async def run_task(self, task_id, chat_id, text, report, proj=None):
            ran.append(task_id)
    b = Bridge(settings, store, FakeOrch(), sender, ask_confirm=ask_confirm)

    tid = await b.handle_task(user_id=0, chat_id=5, text="@myprofit tambah endpoint",
                              trusted=True, force_confirm=True)
    assert ran == []
    assert store.get_task(tid)["status"] == "awaiting_confirm"
```

- [ ] **Step 4: Run the new tests and watch them fail**

Run: `python -m pytest tests/test_telegram_bridge.py -v`

Expected: the four `holds_*` tests PASS already (the synthetic reason holds everything), and these three FAIL:
- `test_force_confirm_runs_a_clean_nonrisky_task` — `assert ran == [tid]` fails, `ran` is `[]`
- `test_force_confirm_runs_without_a_confirm_channel_when_nothing_is_flagged` — same
- `test_force_confirm_refuses_a_flagged_task_without_a_confirm_channel` — passes already; that is fine, it pins behavior the next step must not break

A `holds_*` test that fails here means the fixture is wrong, not the code. Fix the test before moving on.

- [ ] **Step 5: Replace the gate**

In `hermes/telegram_bridge.py`, replace lines 166-181 — from the `# A chat-initiated task ...` comment down to and including the `if reasons and (gate_live or must_confirm):` line — with:

```python
        # A chat-initiated task (the conversational agent's start_task tool)
        # runs on its own only when the gate found nothing to weigh: a named
        # project, a repository that can undo the run, and no risky verb. That
        # is the same `reasons` list /task is judged by — deliberately, so the
        # two paths cannot drift. Anything in it is a reason to stop and ask.
        if force_confirm:
            if proj is None:
                reasons.append("tidak ada proyek yang disebut — kerja akan "
                               "jatuh ke workspace kosong")
            elif self.git_dirty is None:
                # _build_bridge's docstring warns that a dropped git_dirty
                # injection disables the dirty-tree check silently. An
                # unverifiable repo is not an undoable one.
                reasons.append("status git tidak bisa diperiksa — tidak ada "
                               "bukti run ini bisa dibatalkan")
        must_confirm = force_confirm and bool(self.ask_confirm)
        # Refuse rather than run a flagged task with nobody to ask. With no
        # reasons there is no question, so there is nothing to refuse.
        if force_confirm and reasons and not self.ask_confirm:
            await self.sender(
                chat_id, f"Task {task_id} tidak dijalankan: tidak ada kanal konfirmasi.")
            self.store.set_task_status(task_id, "cancelled")
            return task_id

        if reasons and (gate_live or must_confirm):
```

Note the ordering: the `proj is None` and `git_dirty is None` reasons are appended **before** the no-channel refusal, so a chat task that names no project and has no confirm channel is cancelled rather than run.

- [ ] **Step 6: Run the whole bridge suite**

Run: `python -m pytest tests/test_telegram_bridge.py -v`

Expected: PASS, all of them. `test_confirm_gate_disabled_runs_directly`, `test_gate_disabled_risky_text_still_warns`, and the two `test_gate_disabled_*_project_*` tests use `force_confirm=False` and must be untouched — if any of them changed, the new code leaked outside the `force_confirm` branch.

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest`

Expected: PASS. `tests/test_web_ui.py` is not touched by this task — its `FakeBridge` sets `awaiting_confirm` itself and the dispatch still returns a hardcoded status, so it stays green until Task 2.

- [ ] **Step 8: Commit**

```bash
git add hermes/telegram_bridge.py tests/test_telegram_bridge.py
git commit -m "feat: let a clean, non-risky chat task run without a confirm tap

handle_task injected a synthetic confirm reason for every force_confirm task,
so the auto-run branch was unreachable. Drop it and judge chat tasks by the
same reasons list /task uses, plus two conditions only auto-run cares about: a
project must be named, and the git probe must actually be wired, because
neither absence leaves any evidence the run can be undone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Report the decision the gate actually made

**Files:**
- Modify: `hermes/telegram_bridge.py` — `handle_task` signature and its four terminal branches
- Modify: `hermes/web_ui.py:396-417` (the `start_task` dispatch branch), plus a module-level timeout constant near `CHAT_HISTORY_LIMIT` at line 64
- Test: `tests/test_web_ui.py:507-569` (update `FakeBridge` and its assertions), plus one new test

**Interfaces:**
- Consumes: the three terminal outcomes Task 1 left in `handle_task`.
- Produces: `handle_task(..., on_decision=None)` where `on_decision` is a **plain (non-async) callable** `(status: str, reasons: list[str]) -> None`, invoked exactly once per call with `status` in `{"running", "awaiting_confirm", "cancelled", "rejected"}`. The `start_task` tool result becomes `{"task_id": str, "status": str, "reasons": list[str]}`, with `"note": str` added only on decision timeout.

- [ ] **Step 1: Write the failing tests**

In `tests/test_web_ui.py`, update `FakeBridge` inside `test_chat_tools_query_state_and_propose_task` (line 521) to accept and fire the callback:

```python
    class FakeBridge:
        def __init__(self):
            self.confirm_reasons = {}
            self.calls = []
        async def handle_task(self, user_id, chat_id, text, task_id=None,
                              trusted=False, force_confirm=False, on_decision=None):
            self.calls.append((text, trusted, force_confirm))
            store.create_task(task_id, chat_id, text)
            if force_confirm:
                self.confirm_reasons[task_id] = ["chat"]
                store.set_task_status(task_id, "awaiting_confirm")
                if on_decision:
                    on_decision("awaiting_confirm", ["chat"])
```

Then replace the assertion at line 560 with:

```python
    # start_task reports the decision the bridge made, not a constant
    assert out["start"]["status"] == "awaiting_confirm"
    assert out["start"]["reasons"] == ["chat"]
```

Add this new test directly after it:

```python
async def test_start_task_reports_a_run_that_started_on_its_own(hermes_home):
    """The tool result is what the chat model tells the operator. When the gate
    let the task run, saying 'menunggu Run' would be a lie — and that lie is
    the bug this whole change exists to fix."""
    import json as _json
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    proj_dir = hermes_home / "myprofit"; proj_dir.mkdir()
    config.save_settings(config.Settings(projects={"myprofit": str(proj_dir)}))

    class RunningBridge:
        def __init__(self):
            self.confirm_reasons = {}
        async def handle_task(self, user_id, chat_id, text, task_id=None,
                              trusted=False, force_confirm=False, on_decision=None):
            store.create_task(task_id, chat_id, text)
            store.set_task_status(task_id, "running")
            if on_decision:
                on_decision("running", [])

    out = {}
    async def tool_chat(history, tools=None, dispatch=None):
        out["start"] = _json.loads(
            await dispatch("start_task", {"description": "@myprofit tambah endpoint"}))
        return "Sudah saya kerjakan."

    client = TestClient(create_app(store, bridge=RunningBridge(), chat=tool_chat))
    r = client.post("/api/tasks", json={"text": "@myprofit tambah endpoint"})
    assert r.status_code == 200
    assert out["start"]["status"] == "running"
    assert out["start"]["reasons"] == []


async def test_start_task_says_so_when_the_gate_never_decides(hermes_home):
    """A bridge that never calls back must not be reported as anything. Guessing
    here would reintroduce the hardcoded status this task removes."""
    import json as _json
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()

    class SilentBridge:
        def __init__(self):
            self.confirm_reasons = {}
        async def handle_task(self, user_id, chat_id, text, task_id=None,
                              trusted=False, force_confirm=False, on_decision=None):
            store.create_task(task_id, chat_id, text)

    out = {}
    async def tool_chat(history, tools=None, dispatch=None):
        out["start"] = _json.loads(await dispatch("start_task", {"description": "apa saja"}))
        return "ok"

    from hermes import web_ui as _web_ui
    original = _web_ui.START_TASK_DECISION_TIMEOUT_S
    _web_ui.START_TASK_DECISION_TIMEOUT_S = 0.01
    try:
        client = TestClient(create_app(store, bridge=SilentBridge(), chat=tool_chat))
        r = client.post("/api/tasks", json={"text": "apa saja"})
        assert r.status_code == 200
    finally:
        _web_ui.START_TASK_DECISION_TIMEOUT_S = original

    assert out["start"]["status"] == "queued"
    assert "note" in out["start"]
```

- [ ] **Step 2: Run them and watch them fail**

Run: `python -m pytest tests/test_web_ui.py -k "start_task or chat_tools" -v`

Expected: FAIL.
- `test_chat_tools_query_state_and_propose_task` — `KeyError: 'reasons'`, because the dispatch returns a `note` key and no `reasons`
- `test_start_task_reports_a_run_that_started_on_its_own` — `assert 'awaiting_confirm' == 'running'`
- `test_start_task_says_so_when_the_gate_never_decides` — `AttributeError: module 'hermes.web_ui' has no attribute 'START_TASK_DECISION_TIMEOUT_S'`

- [ ] **Step 3: Thread `on_decision` through `handle_task`**

In `hermes/telegram_bridge.py`, add the parameter:

```python
    async def handle_task(self, user_id: int, chat_id: int, text: str,
                          task_id: str | None = None, trusted: bool = False,
                          force_confirm: bool = False, session_id: str | None = None,
                          on_decision=None):
```

Add this docstring paragraph under the existing `trusted` comment at the top of the body:

```python
        # on_decision is a plain callable (status, reasons) fired once, the
        # moment the gate settles and before any engine work starts. It exists
        # because handle_task does not return until the whole task finishes, so
        # a caller that backgrounds it — the start_task tool — otherwise has no
        # way to learn whether the task was held or started.
```

Define the helper immediately after the authorization check (the `if not trusted and not is_allowed(...)` block, line 128-130) and **before** the project-resolution block, because one of its call sites is inside that block's exception handler:

```python
        def decided(status: str, why: list[str] | None = None):
            if on_decision:
                on_decision(status, list(why or []))
```

Then fire it at each terminal branch:

- In the `except (ProjectNotFound, ProjectPathMissing)` handler, before `return None`: `decided("rejected", [str(e)])`
- In the no-confirm-channel refusal, before `return task_id`: `decided("cancelled", reasons)`
- In the hold branch, after `self.store.set_task_status(task_id, "awaiting_confirm")`: `decided("awaiting_confirm", reasons)`
- Immediately before `await self._run(task_id, chat_id, text, proj)` at the end of `handle_task` (the run branch, after the queued/warning `sender` call): `decided("running", reasons)`

Do **not** fire it inside `resolve_confirm`; that path already has the operator watching the card.

- [ ] **Step 4: Rewrite the `start_task` dispatch**

In `hermes/web_ui.py`, add near `CHAT_HISTORY_LIMIT` (line 64):

```python
# How long the start_task tool waits for handle_task to settle its gate before
# answering the model. The slow part is one `git status` subprocess, so this is
# generous; the task itself keeps running in the background either way.
START_TASK_DECISION_TIMEOUT_S = 5.0
```

Replace the body of the `if name == "start_task":` branch (lines 396-417) with:

```python
                if name == "start_task":
                    bridge = getattr(app.state, "bridge", None)
                    if not bridge:
                        return json.dumps({"error": "bridge tidak tersedia — tidak bisa antre task"},
                                          ensure_ascii=False)
                    desc = str(args.get("description") or "").strip()
                    if not desc:
                        return json.dumps({"error": "deskripsi task kosong"}, ensure_ascii=False)
                    new_id = new_task_id()
                    import inspect
                    sig = inspect.signature(bridge.handle_task)
                    def accepts(param: str) -> bool:
                        return param in sig.parameters or any(
                            p.kind == p.VAR_KEYWORD for p in sig.parameters.values())
                    # The gate settles long before the task does, but handle_task
                    # only returns when the whole task is over. A future filled by
                    # its callback is the only way to answer the model with what
                    # actually happened instead of a guess.
                    settled = asyncio.get_running_loop().create_future()
                    def on_decision(status: str, reasons: list):
                        if not settled.done():
                            settled.set_result({"status": status, "reasons": reasons})
                    kwargs = {}
                    if accepts("session_id"):
                        kwargs["session_id"] = session_id
                    if accepts("on_decision"):
                        kwargs["on_decision"] = on_decision
                    t = asyncio.create_task(bridge.handle_task(
                        user_id=0, chat_id=0, text=desc, task_id=new_id,
                        trusted=True, force_confirm=True, **kwargs))
                    t.add_done_callback(_bg_crash_cb(store, new_id))
                    try:
                        outcome = await asyncio.wait_for(
                            settled, START_TASK_DECISION_TIMEOUT_S)
                    except asyncio.TimeoutError:
                        outcome = {"status": "queued", "reasons": [],
                                   "note": "gate belum memutuskan; lihat kartu task"}
                    return json.dumps({"task_id": new_id, **outcome},
                                      ensure_ascii=False)
```

`accepts("on_decision")` keeps every existing test fake that does not declare the parameter working unchanged.

- [ ] **Step 5: Run the web tests**

Run: `python -m pytest tests/test_web_ui.py -v`

Expected: PASS, including the two new tests.

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add hermes/telegram_bridge.py hermes/web_ui.py tests/test_web_ui.py
git commit -m "feat: start_task reports the gate's real decision

The tool returned a hardcoded awaiting_confirm while handle_task was still a
freshly spawned background task that had decided nothing. Now that a chat task
can start on its own, that constant is wrong half the time, and the chat model
repeats it to the operator. handle_task fires an on_decision callback the
moment the gate settles; the tool waits for it and answers with the truth.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Route code requests into the task, out of the chat reply

**Files:**
- Modify: `hermes/main.py:312-318` (`_NO_CONFIRM_NOTE`), `:325-334` (docstring), `:355-360` (the `start_task` rules), `:395-412` (the canned answer)
- Modify: `hermes/web_ui.py:93-100` (the `start_task` tool description)

**Interfaces:**
- Consumes: the `{"task_id", "status", "reasons"}` shape Task 2 produces, and the `status` vocabulary `{"running", "awaiting_confirm", "cancelled", "rejected", "queued"}`.
- Produces: nothing other tasks consume. This is the last task.

- [ ] **Step 1: Replace the `start_task` rules in the system prompt**

In `hermes/main.py`, replace lines 355-360 (the block beginning `"PENTING soal \`start_task\`: ..."`) with:

```python
        "MENGERJAKAN KODE: bila permintaan menyebut sebuah proyek dengan "
        "`@nama-proyek` DAN menyangkut kode atau berkas (menambah, mengubah, "
        "memperbaiki, refactor, menghapus), kamu WAJIB memanggil `start_task` "
        "dengan permintaan itu apa adanya, termasuk `@nama-proyek`-nya. Dalam "
        "hal itu kamu DILARANG menulis patch, diff, atau blok kode "
        "implementasi di dalam jawaban chat: yang mengerjakan kodenya adalah "
        "task, bukan kamu, dan kode yang cuma ditempel di chat tidak pernah "
        "sampai ke proyek.\n"
        "Bila permintaan TIDAK menyebut `@nama-proyek`, itu diskusi — jawab "
        "saja, jangan panggil `start_task`.\n"
        "Baca `status` dari hasil `start_task` dan sampaikan apa adanya: "
        "`running` berarti task sudah mulai berjalan sendiri; "
        "`awaiting_confirm` berarti task ditahan sampai operator menekan Run, "
        "dan kamu harus menyebutkan isi `reasons`; `cancelled` atau `rejected` "
        "berarti task tidak jadi jalan. Jangan mengarang status. `running` "
        "berarti dimulai, BUKAN selesai — jangan mengaku pekerjaannya sudah "
        "beres atau mengarang hasil eksekusi.\n"
```

- [ ] **Step 2: Delete the canned answer**

Delete `hermes/main.py:395-412` entirely — from `"Bila pengguna bertanya tentang cara mengantre task ..."` through `"Mau coba antrekan task sekarang? 😊"`. It teaches the old contract ("Saya hanya mengantrekan task — task TIDAK langsung jalan") word for word, and Step 1 already replaces what it was for. Do not write a replacement.

After deleting, the last element of the `system_template` tuple is the `"MEMBUKA APLIKASI / URL: ..."` block ending `"...sebut app yang tersedia.\n\n"`. Leave its trailing newlines as they are.

- [ ] **Step 3: Fix the docstring that states the old contract**

In `hermes/main.py`, replace the last sentence of `build_nim_chat`'s docstring (lines 332-334, `"It also never executes work — running a task stays an explicit /task command, so the agent cannot silently spend money or touch a repo, and cannot invent a result it never produced."`) with:

```
    It executes work only through `start_task`, and only within that tool's own
    gate: a named project with a clean repository and no risky verb starts
    immediately, anything else is held for the operator's Run. The agent never
    touches a repo directly and cannot invent a result it never produced.
```

- [ ] **Step 4: Carve `start_task` out of the no-confirm override**

`_NO_CONFIRM_NOTE` (line 312) tells the model to "abaikan instruksi sebelumnya soal aksi ditahan/menunggu persetujuan". It is about MCP write tools, but with `confirm_risky=False` it now also tells the model to ignore a real `awaiting_confirm` from `start_task` — which Task 1 keeps returning for risky work regardless of that setting. Append one sentence:

```python
    "laporkan hasil nyatanya. Ini TIDAK berlaku untuk `start_task`: status "
    "`awaiting_confirm` dari alat itu tetap berarti task ditahan menunggu Run, "
    "dan tetap harus kamu sampaikan apa adanya."
```

(replacing the existing final `"laporkan hasil nyatanya."`)

- [ ] **Step 5: Update the tool description**

In `hermes/web_ui.py`, replace the `start_task` `description` (lines 95-96) with:

```python
        "description": ("Antre lalu jalankan task orkestrasi. Bila permintaan menyebut "
                        "@nama-proyek, repositorinya bersih, dan pekerjaannya tidak "
                        "berisiko (push/deploy/hapus), task LANGSUNG berjalan; selain "
                        "itu task ditahan sampai operator menekan Run. Hasil pemanggilan "
                        "berisi status sebenarnya beserta alasannya — pakai itu, jangan "
                        "menebak."),
```

- [ ] **Step 6: Verify the old contract is gone from the prompts**

Run: `python -m pytest tests/test_web_ui.py::test_chat_tools_query_state_and_propose_task -v`

Expected: PASS — the tool-name list assertion at line 548 is unchanged, which confirms no tool was added or dropped.

Then run:

```bash
git grep -n "TIDAK berjalan sampai operator" hermes/
git grep -n "hanya MENGANTRE" hermes/
git grep -n "Mau coba antrekan task sekarang" hermes/
```

Expected: no output from any of the three. A hit means an edit was missed.

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add hermes/main.py hermes/web_ui.py
git commit -m "feat: route chat code requests into start_task

The prompt only asked for start_task when the user 'clearly asks to run
something', so a request to change a file read as a question and came back as
a patch nobody applied. Naming a project now makes the call mandatory and
writing an implementation patch into the chat reply forbidden, and the
reporting rules are rewritten around the real status the tool returns.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Manual verification

Automated tests cover the gate and the tool result. They cannot cover whether the model actually calls the tool — that is the prompt, and the plan deliberately does not assert prompt text. Do this once by hand after Task 3:

1. Start Hermes, open the chat pane.
2. Register a project pointing at a clean git repository.
3. Type a code request naming it, e.g. `@myprofit-v3 tambahkan parameter nota_offline di sync transaksi offline`.
4. Expect: the reply contains **no patch**, names a task id, and says the task is running. The task card appears without a Run button.
5. Make the repository dirty (`echo x >> README.md`), repeat step 3.
6. Expect: the reply says the task is held and states the uncommitted-changes reason. The card shows Run/Cancel.
7. Type a question with no `@project`, e.g. `bagaimana cara kerja sync offline?`.
8. Expect: a plain answer, no task queued.
