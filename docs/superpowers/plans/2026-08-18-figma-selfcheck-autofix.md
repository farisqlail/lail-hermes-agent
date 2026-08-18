# Figma Self-Check Auto-Fix Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the model actually CALL a `figma_web_fix_*` tool when its own post-build self-check finds a mismatch it can fix, instead of only describing the mismatch in prose and stopping.

**Architecture:** No new mechanism. `hermes/main.py`'s `chat()`/`stream()` tool loop already appends the self-check screenshot as a followup `user` message and keeps `tools` available for the NEXT round (`docs/figma-uiux-roadmap.md` Phase 3 Step 1) — the model is technically free to call `figma_web_fix_photo`/`figma_web_fix_text`/`figma_web_fix_property` right then, and every fix tool's own schema description already says "pakai ini bila hasil self-check menunjukkan X". The actual gap is `_FIGMA_SELFCHECK_PROMPT`/`_FIGMA_SELFCHECK_FLOW_PROMPT` themselves: they only instruct the model to *describe* a mismatch ("Sebutkan SECARA KONKRET..."), never to act on it. This plan rewords those two prompt constants to explicitly tell the model to call the matching fix tool now (using `file_url`/`node_name`/`current_text` already sitting in the conversation from the earlier build result) and only fall back to a plain description when no fix tool covers the mismatch (border/shadow/radius/layout/nesting/order) or a fix was already attempted for the same issue and it's still wrong. The existing round budget (`MAX_TOOL_ROUNDS = 8`) and exact-args dedup (`_call_tool_once`) already bound how long this can loop — no new guard code needed.

**Tech Stack:** Python, pytest, OpenAI-compatible chat-completions tool-calling, Playwright-driven Figma automation (`hermes/figma_browser.py`, untouched by this plan).

**Spec:** `docs/figma-uiux-roadmap.md` (Phase 3 — self-check/correction loop; this plan is the next increment: closing the loop from "report" to "report-then-fix"). No separate spec doc exists beyond that roadmap file, which this plan's own Task 4 extends with a new phase entry.

## Global Constraints

- Do not touch `hermes/figma_browser.py` — the fix tools' underlying browser mechanisms are already live-verified (Phase 3 Step 2 and its broadenings); this plan is prompt-level only.
- Every `figma_web_fix_*` tool call the model makes MUST use `file_url`/`node_name`/`current_text` values that already appear earlier in the conversation (from the original build's result or a prior self-check screenshot) — never invented/guessed values. Preserve this rule; it already exists in each tool's schema description in `hermes/chat_engine.py`.
- Keep both prompt constants in Bahasa Indonesia, matching the existing tone/register of every other user-facing prompt string in `hermes/main.py`.
- `pytest tests/ -q` must stay fully green (807+ tests) after every task.
- Per `docs/figma-uiux-roadmap.md`'s own standing rule, a prompt-wording change that's meant to steer real model behavior is NOT considered proven by a mocked unit test alone (a scripted `FakeCompletions` doesn't reason about prompt content) — it needs one live run against the real chat model before being called done, same methodology as Phase 3 Step 1's own validation.

---

## File Structure

- Modify `hermes/main.py`: reword `_FIGMA_SELFCHECK_PROMPT` and `_FIGMA_SELFCHECK_FLOW_PROMPT` (lines ~135-164). No other code in this file changes — the loop, `_figma_selfcheck_message`, `_call_tool_once`, and both `chat()`/`stream()` already do everything structurally needed.
- Modify `tests/test_main_smoke.py`: add one mechanical regression test (proves a fix-tool call survives the loop end-to-end, mocked model) and content-lock assertions on the two prompt constants (proves the new instruction text is actually present, protects against a future edit silently dropping it).
- Modify `docs/figma-uiux-roadmap.md`: append a new phase documenting this change and its live-verification result, matching every prior phase's own documentation shape.

## Task 1: Regression test — a fix-tool call chains correctly through the self-check loop

This is a characterization test of EXISTING behavior (the mechanical wiring already works; only the prompt wording changes in Task 2). Writing it first, and confirming it passes before Task 2 touches the prompts, proves Task 2 can't be the thing that breaks this chain — a prompt-only change should never affect a mocked model that ignores prompt content anyway, but this pins it down explicitly.

**Files:**
- Modify: `tests/test_main_smoke.py` (add after `test_chat_shows_the_model_its_own_figma_screenshot_next_round`, currently ending at line 914)

**Interfaces:**
- Consumes: `main.build_nim_chat`, `main._figma_selfcheck_message` (unchanged signatures), `config.Settings`/`config.Secrets`, `_fake_png` (existing helper, line 781)
- Produces: nothing new consumed by later tasks — this is a standalone regression test

- [ ] **Step 1: Write the test**

```python
class _NamedToolCall:
    def __init__(self, call_id, name, args):
        self.id = call_id
        self.type = "function"
        self.function = type("F", (), {"name": name, "arguments": args})()


async def test_chat_lets_the_model_call_a_fix_tool_after_selfcheck(hermes_home, monkeypatch, tmp_path):
    """End-to-end through main.build_nim_chat's tool loop: if round 2 (the
    round that sees the self-check screenshot) responds with a
    figma_web_fix_property tool call instead of prose, the loop must
    dispatch it, feed its own result back, fire a second self-check for
    it, and still reach a final prose answer on round 3 — proving the
    self-check screenshot round does not have to end the turn."""
    from hermes import config, main

    build_shot = _fake_png(tmp_path / "build.png")
    fix_shot = _fake_png(tmp_path / "fix.png")
    build_result = main.json.dumps({
        "ok": True, "screenshot_path": str(build_shot),
        "file_url": "https://figma.com/design/abc123/Untitled",
        "fixable_nodes": [{"node_name": "hermes:node:0:button", "type": "BUTTON"}],
    })
    fix_result = main.json.dumps({"ok": True, "screenshot_path": str(fix_shot)})

    build_call = _NamedToolCall("call_1", "figma_web_design", "{}")
    fix_call = _NamedToolCall(
        "call_2", "figma_web_fix_property",
        main.json.dumps({"file_url": "https://figma.com/design/abc123/Untitled",
                         "node_name": "hermes:node:0:button",
                         "property": "color", "value": "#16A34A"}))

    dispatched: list[tuple[str, dict]] = []

    class FakeCompletions:
        def __init__(self):
            self._round = 0

        async def create(self, **kwargs):
            self._round += 1
            if self._round == 1:
                msg = _FigmaRoundMessage(tool_calls=[build_call])
            elif self._round == 2:
                msg = _FigmaRoundMessage(tool_calls=[fix_call])
            else:
                msg = _FigmaRoundMessage(content="Sudah diperbaiki: tombol sekarang hijau.")
            return type("R", (), {"choices": [type("C", (), {"message": msg})()]})()

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    async def dispatch(name, args):
        dispatched.append((name, args))
        return build_result if name == "figma_web_design" else fix_result

    monkeypatch.setattr(main, "AsyncOpenAI", FakeClient)
    config.save_settings(config.Settings(tts_enabled=False))
    chat = main.build_nim_chat(config.load_settings(),
                               config.Secrets(nvidia_api_key="nvapi-test"))
    out = await chat([{"role": "user", "content": "desain tombol hijau"}],
                     tools=[{"type": "function", "function": {"name": "figma_web_design", "parameters": {}}},
                            {"type": "function", "function": {"name": "figma_web_fix_property", "parameters": {}}}],
                     dispatch=dispatch)

    assert out == "Sudah diperbaiki: tombol sekarang hijau."
    assert [name for name, _ in dispatched] == ["figma_web_design", "figma_web_fix_property"]
```

- [ ] **Step 2: Run it**

Run: `pytest tests/test_main_smoke.py -k test_chat_lets_the_model_call_a_fix_tool_after_selfcheck -v`
Expected: PASS immediately (no production code changed yet — this proves the loop already supports the chain).

- [ ] **Step 3: Commit**

```bash
git add tests/test_main_smoke.py
git commit -m "test: characterize fix-tool chaining through the figma self-check loop"
```

## Task 2: Reword the self-check prompts to instruct auto-fix

**Files:**
- Modify: `hermes/main.py:135-164`
- Test: `tests/test_main_smoke.py` (new content-lock assertions)

**Interfaces:**
- Consumes: nothing new
- Produces: `main._FIGMA_SELFCHECK_PROMPT`, `main._FIGMA_SELFCHECK_FLOW_PROMPT` (same names/type — `str` — as before; only their content changes). Every existing test that compares `parts[0]["text"] == main._FIGMA_SELFCHECK_PROMPT` (self-referential) keeps passing unchanged.

- [ ] **Step 1: Write the failing content-lock tests**

Add to `tests/test_main_smoke.py`, near the other `_figma_selfcheck_message` tests (after line 847):

```python
def test_figma_selfcheck_prompt_tells_the_model_to_call_fix_tools():
    from hermes import main
    p = main._FIGMA_SELFCHECK_PROMPT
    assert "figma_web_fix_photo" in p
    assert "figma_web_fix_text" in p
    assert "figma_web_fix_property" in p
    assert "PANGGIL" in p and "SEKARANG" in p


def test_figma_selfcheck_flow_prompt_tells_the_model_to_call_fix_tools():
    from hermes import main
    p = main._FIGMA_SELFCHECK_FLOW_PROMPT
    assert "figma_web_fix_photo" in p
    assert "figma_web_fix_text" in p
    assert "figma_web_fix_property" in p
    assert "PANGGIL" in p and "SEKARANG" in p
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_main_smoke.py -k "tells_the_model_to_call_fix_tools" -v`
Expected: FAIL — `AssertionError: assert 'figma_web_fix_photo' in "Ini screenshot hasil desain Figma..."` (current prompt text never names any tool).

- [ ] **Step 3: Reword the prompts**

Replace `hermes/main.py:135-164`:

```python
_FIGMA_SELFCHECK_PROMPT = (
    "Ini screenshot hasil desain Figma yang baru saja kamu buat. Bandingkan "
    "dengan mockup/referensi yang diberikan pengguna (kalau ada gambar "
    "terlampir sebelumnya di percakapan ini) atau dengan permintaan "
    "pengguna. Sebutkan SECARA KONKRET kalau ada yang meleset — warna, "
    "elemen hilang/salah urutan, teks salah, ukuran/spacing janggal. Jangan "
    "memuji generik kalau sebenarnya ada yang salah. Kalau sudah sesuai, "
    "cukup katakan singkat sudah sesuai."
)

_FIGMA_SELFCHECK_FLOW_PROMPT = (
    "Ini screenshot BEBERAPA frame Figma yang baru saja kamu buat sekaligus "
    "(disusun berjejer ke kanan dalam satu gambar). Periksa SETIAP frame "
    "satu per satu terhadap bagian permintaan pengguna yang sesuai (mis. "
    "frame pertama = layar/langkah pertama yang diminta, dst) — jangan "
    "cuma cek frame pertama lalu anggap sisanya juga benar. Sebutkan "
    "SECARA KONKRET kalau ada yang meleset di frame MANA PUN — warna, "
    "elemen hilang/salah urutan, teks salah, ukuran/spacing janggal, atau "
    "urutan alur yang tertukar. Jangan memuji generik kalau sebenarnya ada "
    "yang salah. Kalau semua frame sudah sesuai, cukup katakan singkat "
    "semua sudah sesuai."
)
```

with:

```python
_FIGMA_SELFCHECK_PROMPT = (
    "Ini screenshot hasil desain Figma yang baru saja kamu buat. Bandingkan "
    "dengan mockup/referensi yang diberikan pengguna (kalau ada gambar "
    "terlampir sebelumnya di percakapan ini) atau dengan permintaan "
    "pengguna. Kalau ada yang meleset DAN cocok dengan salah satu tool "
    "perbaikan berikut — foto hilang/salah (figma_web_fix_photo, `node_name` "
    "dari `photo_nodes` hasil build), isi/warna teks salah "
    "(figma_web_fix_text, `current_text` persis seperti yang tampil "
    "sekarang), atau warna/lebar/tinggi BUTTON/INPUT/CHECKBOX/RECTANGLE "
    "salah (figma_web_fix_property, `node_name` dari `fixable_nodes`) — "
    "PANGGIL tool itu SEKARANG juga pakai `file_url` dari hasil build "
    "sebelumnya di percakapan ini, jangan cuma menyebutkan masalahnya di "
    "teks. Kalau masalah yang SAMA sudah pernah dicoba diperbaiki dan masih "
    "meleset, atau masalahnya di luar cakupan ketiga tool itu (border, "
    "shadow, radius, layout/spacing/urutan nesting), baru sebutkan SECARA "
    "KONKRET di teks jawabanmu. Jangan memuji generik kalau sebenarnya ada "
    "yang salah. Kalau sudah sesuai, cukup katakan singkat sudah sesuai."
)

_FIGMA_SELFCHECK_FLOW_PROMPT = (
    "Ini screenshot BEBERAPA frame Figma yang baru saja kamu buat sekaligus "
    "(disusun berjejer ke kanan dalam satu gambar). Periksa SETIAP frame "
    "satu per satu terhadap bagian permintaan pengguna yang sesuai (mis. "
    "frame pertama = layar/langkah pertama yang diminta, dst) — jangan "
    "cuma cek frame pertama lalu anggap sisanya juga benar. Kalau ada yang "
    "meleset di frame MANA PUN DAN cocok dengan salah satu tool perbaikan "
    "berikut — foto hilang/salah (figma_web_fix_photo, `node_name` dari "
    "`photo_nodes` hasil build), isi/warna teks salah (figma_web_fix_text, "
    "`current_text` persis seperti yang tampil sekarang), atau "
    "warna/lebar/tinggi BUTTON/INPUT/CHECKBOX/RECTANGLE salah "
    "(figma_web_fix_property, `node_name` dari `fixable_nodes`) — PANGGIL "
    "tool itu SEKARANG juga pakai `file_url` dari hasil build sebelumnya "
    "(node_name unik di seluruh file, tidak perlu sebut nama frame ke "
    "tool-nya), jangan cuma menyebutkan masalahnya di teks. Kalau masalah "
    "yang SAMA sudah pernah dicoba diperbaiki dan masih meleset, atau "
    "masalahnya di luar cakupan ketiga tool itu (border, shadow, radius, "
    "layout/spacing/urutan nesting/alur), baru sebutkan SECARA KONKRET di "
    "teks jawabanmu — sebutkan frame yang mana. Jangan memuji generik kalau "
    "sebenarnya ada yang salah. Kalau semua frame sudah sesuai, cukup "
    "katakan singkat semua sudah sesuai."
)
```

- [ ] **Step 4: Run the full suite**

Run: `pytest tests/ -q`
Expected: PASS, 807 + 3 new = 810 passed (Task 1's regression test + this task's 2 content-lock tests).

- [ ] **Step 5: Commit**

```bash
git add hermes/main.py tests/test_main_smoke.py
git commit -m "feat: tell figma self-check to call fix tools instead of only reporting"
```

## Task 3: Live verification against the real model (per the roadmap's own standing rule)

A mocked `FakeCompletions` cannot judge whether the REAL chat model actually acts on the new prompt wording — Task 1's test proves the plumbing carries a fix call if the model makes one, not that the model will make one. This must be validated the same way Phase 3 Step 1 validated its own self-check prompt: run the real message-assembly path against the real configured chat model with a deliberate, known mismatch.

**Files:**
- None modified — this is a manual/scripted live run, not a committed test (matching the existing precedent that every `fix_figma_*`/self-check prompt validation in `docs/figma-uiux-roadmap.md` is "proven live, not unit-tested").

- [ ] **Step 1: Build a deliberate-mismatch case**

Use `hermes/figma_browser.design_figma_frame_web` (or a shared existing test file, per `[[figma-testing-no-new-files]]` — reuse a Page, never a new file, to dodge Figma's new-file rate limit) to build a small frame with one BUTTON whose `color` is deliberately wrong relative to what a paired prompt asks for — e.g. spec says "tombol merah" but build with `color: "#16A34A"` (green) so the mismatch is unambiguous and falls squarely inside `figma_web_fix_property`'s scope.

- [ ] **Step 2: Run the exact chat()/stream() assembly against the real model**

Reuse the harness `docs/figma-uiux-roadmap.md`'s Phase 3 Step 1 validation already used: call `main._figma_selfcheck_message("figma_web_design", <real build result JSON>)` to get the real followup message, append it to a history containing the original "tombol merah" request and the build's own tool-call/tool-result turns, and run it through `main.build_nim_chat(...)` with the real `figma_web_fix_property` tool included and a real `dispatch` wired to `hermes/figma_browser.fix_figma_property`.

- [ ] **Step 3: Confirm the model calls the fix tool, not just describes**

Expected: the model's second-round response is a `figma_web_fix_property` tool call (color → the correct red hex), not prose. Confirm via a screenshot after the fix that the button is now the correct color. If the model still only describes the mismatch in prose instead of calling the tool, the prompt wording needs a stronger nudge (e.g. move the instruction to the front of the prompt, or add a one-line example) — iterate Task 2's wording and re-run this step before considering the plan done, same iterate-until-it-clears-the-bar approach Phase 3 Step 1 itself used.

- [ ] **Step 4: Negative control**

Repeat with a build that has NO mismatch (color already correct). Expected: the model replies "sudah sesuai" (or equivalent) and does NOT call any fix tool — confirms the new wording didn't make the model fix things that aren't broken.

## Task 4: Document the change in the roadmap

**Files:**
- Modify: `docs/figma-uiux-roadmap.md` (append after Phase 20, currently ending at line 1589, before the "## Verification (every phase)" section at line 1591)

- [ ] **Step 1: Append a new phase entry**

Insert before line 1591 (`## Verification (every phase)`):

```markdown
## Phase 21 — Self-check auto-fix: report becomes act (2026-08-18)

Closed the loop Phase 3 Step 1 left open: the self-check message already
put the build's own screenshot back in front of the model with `tools`
still available next round, but `_FIGMA_SELFCHECK_PROMPT`/
`_FIGMA_SELFCHECK_FLOW_PROMPT` only ever asked the model to *describe* a
mismatch ("Sebutkan SECARA KONKRET..."), never to act on it — so a model
that found a fixable mismatch (wrong photo, wrong text, wrong
BUTTON/INPUT/CHECKBOX/RECTANGLE color/width/height) would report it as a
final answer and stop, even though `figma_web_fix_photo`/
`figma_web_fix_text`/`figma_web_fix_property` were sitting right there in
its own tool list. No new mechanism needed — `hermes/main.py`'s `chat()`/
`stream()` loop, `_call_tool_once`'s exact-args dedup, and
`MAX_TOOL_ROUNDS = 8`'s round budget already fully support a model calling
a fix tool off the back of a self-check message; this was purely a prompt
wording gap.

Both prompt constants reworded to explicitly instruct: call the matching
fix tool now (using `file_url`/`node_name`/`current_text` already in the
conversation from the earlier build result — never guessed) when a
mismatch falls in one of the three fix tools' scope, and only fall back to
a plain text description when the mismatch is outside that scope (border,
shadow, radius, layout/spacing/nesting/order) or a fix for the exact same
issue was already tried and it's still wrong (avoids an endless
retry-the-same-fix loop; bounded anyway by the existing round budget and
dedup).

[Fill in after Task 3's live run: PASS/FAIL, what the model actually did,
any wording iteration needed to clear the bar.]

Files touched: `hermes/main.py` (`_FIGMA_SELFCHECK_PROMPT`,
`_FIGMA_SELFCHECK_FLOW_PROMPT`), `tests/test_main_smoke.py` (fix-tool-
chaining regression test + content-lock tests for both prompts).
```

- [ ] **Step 2: Fill in the live-verification result**

Replace the `[Fill in after Task 3's live run: ...]` placeholder with the actual outcome from Task 3 (pass/fail, screenshot evidence description, any wording iteration that was needed) — this file's own convention (every phase above it) never ships a placeholder, only a real recorded result.

- [ ] **Step 3: Commit**

```bash
git add docs/figma-uiux-roadmap.md
git commit -m "docs: record phase 21 (self-check auto-fix) and its live-verification result"
```

---

## Self-Review

**Spec coverage:** The spec (this plan's own architecture section, grounded in `docs/figma-uiux-roadmap.md` Phase 3) asks for exactly one thing — self-check findings should trigger a fix call, not just a report. Task 1 pins the existing plumbing that makes this possible. Task 2 is the actual wiring (prompt wording). Task 3 is the roadmap's own mandatory live-proof step (a prompt change is unverified until proven live, same as every UI mechanism in this file). Task 4 documents it in the place every other phase is documented. No gaps.

**Placeholder scan:** Task 4's `[Fill in after Task 3's live run: ...]` is an explicit, temporary placeholder for a result that can only exist after Task 3 runs — Step 2 of Task 4 requires replacing it with the real recorded outcome before commit, matching this doc's own zero-placeholder convention. No other placeholders in this plan.

**Type consistency:** `_FIGMA_SELFCHECK_PROMPT`/`_FIGMA_SELFCHECK_FLOW_PROMPT` stay plain `str` constants throughout, same as before. Fix tool names (`figma_web_fix_photo`/`figma_web_fix_text`/`figma_web_fix_property`) and their param names (`file_url`, `node_name`, `current_text`, `photo_nodes`, `fixable_nodes`) match exactly what `hermes/chat_engine.py`'s existing tool schemas already define — no new names invented.
