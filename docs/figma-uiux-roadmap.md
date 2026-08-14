# Roadmap: Smarter Figma UI/UX Automation

## Context

`hermes/figma_browser.py` drives Figma Web via real UI automation (draw
tools + Figma's properties panel — `window.figma` is the Plugin API and is
never reachable from a page script), wired to `hermes/chat_engine.py`'s
`figma_web_design` tool. Confirmed working end-to-end against a real
uploaded mockup: correct nesting via Auto Layout, `ROW` type for
side-by-side elements (buttons, transaction rows), correct colors (with
model-tolerant fallback logic), and a validated mechanism for real Unsplash
photos (`Ctrl+Shift+K` + file-chooser + click-on-existing-shape replaces its
fill).

Live testing against a real mockup exposed the design vocabulary's ceiling:
no bold vs regular text, no borders, no shadows, only one level of `ROW`
nesting, no grid layout, no multi-frame output, and no closed-loop
verification that the built result actually matches what was asked for.
This roadmap stages fixing all of that by dependency and risk: **fidelity
first**, because layout and self-check are pointless to build on a
low-fidelity foundation; **self-check last**, because it needs a stable,
fidelity-complete builder to compare against, or every mismatch report just
lists gaps this roadmap already knows about.

Every new UI mechanism is unverified against live Figma until proven live —
Figma's UI behavior (canvas-injection being a dead end, click-point bias,
Hug-mode sizing, the frame-tool preset panel) is never safe to assume from
documentation or memory. Each phase's first task is a live reconnaissance
script before any `figma_browser.py` edit: launch the persistent-profile
browser, probe the target control's DOM/aria-role, confirm the interaction,
only then write the helper function and wire it into `_place_items`.

## Phase 1 — Visual fidelity — ✅ DONE

Shipped and live-verified: `bold`, `borderColor`/`borderWidth` (`INPUT` gets
a light gray border by default even without one specified), `shadow`. New
helpers `_set_bold`, `_set_stroke`, `_add_shadow` in `hermes/figma_browser.py`
wired into `_add_text`/`_add_shape`/`_add_composite` and every
`_place_items` branch (`TEXT`, `HEADER_IMAGE`, `AVATAR`, `INPUT`, `BUTTON`,
`RECTANGLE`, `ROW`). Schema fields added to `chat_engine.py`'s
`_FIGMA_CHILD_LEAF_PROPS`.

Mechanisms (for reference, all live-confirmed):
- **Bold**: click `combobox "Font style"` → click `option "Bold"`.
- **Border**: click `button "Add stroke"` → its `Color` combobox is the
  *second* match for that selector (`.nth(1)`, after Fill's) → set hex,
  then `textbox "Stroke weight"` for width.
- **Shadow**: click `button "Add effect"` → click menu item "Drop shadow".

**Bug found and fixed along the way, relevant to every later phase:** it
was never actually about bold/stroke/shadow — it was that **any** frame
(not just nested composites, the ROOT frame too) can silently flip to "Hug
contents" sizing the moment it gains its first child, not just once up
front. Previously only defended against for nested composites
(`_lock_fixed_size`, called once after `_apply_auto_layout`); the fix now
calls `_lock_fixed_size` again after **every** child is placed — for the
root frame and for `ROW`, via new `parent_w`/`parent_h` params threaded
through `_place_items`. Left uncorrected, the frame silently shrinks to its
one child's bounding box and every later sibling gets drawn relative to a
tiny, wrong-sized frame — landing as a stray new top-level frame instead of
nesting. **Phase 2's `STACK` type inherits this fix for free** (same
`_place_items`/`_add_composite` machinery) — no need to rediscover it, but
worth remembering if a *new* composite type is ever added outside that
machinery.

## Phase 2 — Layout complexity

**`STACK` type** (vertical sibling of `ROW`): same composite pattern as
`ROW` in `_place_items`, `direction="VERTICAL"` instead of `"HORIZONTAL"`.
Needed for e.g. an icon+title+subtitle group nested inside a card, which
`ROW` (horizontal) can't express. Almost free — `_add_composite` and
`_place_items`'s recursion already support any direction; this is mostly a
schema addition plus copy-adjust of the existing `ROW` branch.

**Deeper nesting** (a `ROW`/`STACK` containing another `ROW`/`STACK`, not
just leaf items). `_place_items` is already recursive and would support this
today — the limit is purely in `chat_engine.py`'s schema, which stops
`_FIGMA_CHILD_LEAF_PROPS` at one level to stay JSON-serializable (no true
self-reference). Fix: generate the leaf-props dict 2–3 levels deep
explicitly (a small loop building nested `children` schemas) rather than
true recursion — caps complexity but covers realistic cases (a card grid row
containing cards, each containing a stack).

**Grid layout** — Figma's auto-layout has a `radio "Grid"` option (seen,
never explored) alongside Vertical/Horizontal. Flag as a **spike**: its
field set (row/column count? fixed cell size?) is unknown and needs a
dedicated live-reconnaissance session before any implementation estimate is
real. Lowest-confidence item in this roadmap — do it last within this
phase, and only after the rest of Phase 2 is proven solid.

Files touched: `hermes/figma_browser.py` (`_place_items`'s `ROW` branch
generalized or duplicated for `STACK`), `hermes/chat_engine.py` (schema
nesting depth, new `STACK` enum value).

## Phase 3 — Self-check / correction loop

Today the model never actually *sees* its own result — `figma_web_design`
returns a screenshot path/markdown link in the tool's JSON response, but
that's text, not an image content block the model visually reasons over.

**Step 1 (do this, cheap, no new UI automation):** in `chat_engine.py`'s
dispatch, after a successful build, attach the result screenshot as an
inline image (`uploads.data_url` pattern already used for user uploads) in
the next message back to the model, and prompt it to compare against the
original uploaded mockup still in context, reporting concrete mismatches
(wrong color, missing element, wrong order) in its reply. This alone gets
"self-aware of gaps" without touching Figma again.

**Step 2 (bigger, do only if Step 1 proves the comparison quality is good
enough to act on):** let the model issue a *delta* follow-up call — not a
full rebuild, but targeted fixes (e.g. "the header wasn't a photo,
`photoQuery` was missing") — which needs new fine-grained editing tools
(reselect an existing node by name and change one property) since
`_build_frame_via_ui` currently only knows how to build a frame from
scratch, not patch an existing one. Scope this as its own follow-up plan
once Step 1's comparison quality is validated — don't build the editing
tools speculatively before knowing the comparisons are even accurate.

Files touched: `hermes/chat_engine.py` (dispatch for `figma_web_design`,
system prompt instruction for post-build comparison). Step 2 would touch
`hermes/figma_browser.py` significantly (new node-selection/edit primitives)
but is explicitly out of scope until Step 1 ships and is evaluated.

## Phase 4 — Multi-frame output

Add a `frames: [...]` array as an alternative to the current single flat
`figma_web_design` args (or a second tool, `figma_web_design_flow`) that
calls `_build_frame_via_ui` once per frame, anchoring each subsequent frame
to the right of the previous one on the same page — Figma's canvas already
supports multiple sibling frames; the only new work is computing each new
frame's screen anchor (previous frame's on-screen right edge + a fixed gap,
read via the same `canvas.bounding_box()` + `_current_row_selector` pattern
already used for the single-frame case) and re-running the existing
per-frame pipeline unchanged. Lowest-risk phase precisely because it reuses
`_build_frame_via_ui` as-is rather than modifying it.

Files touched: `hermes/figma_browser.py` (new `design_multi_frame_web` or
loop inside `design_figma_frame_web`), `hermes/chat_engine.py` (new/extended
tool schema for a `frames` array).

## Verification (every phase)

After each change: `pytest tests/ -q` (798 tests must keep passing — none of
them exercise live Figma, so a green suite only proves nothing else broke,
not that the new UI mechanism works), then a live build via
`figma_browser.design_figma_frame_web(file_url=None, spec=...)` against a
throwaway spec exercising the new field, screenshot-inspected before calling
anything done. No phase ships on "should work" — every claim in this roadmap
gets a live screenshot before being called finished, exactly as Phase 1's
bugs (click-point bias, Hug-mode sizing on the root frame, text-overlap)
were only found and fixed by insisting on that.

## Suggested order

Phase 1 (done) → Phase 2 (skip Grid spike until asked) → Phase 3 Step 1 →
Phase 4 → Phase 3 Step 2 (only if Step 1's comparisons prove reliable) →
Grid spike (if still wanted). Each phase is independently shippable and
testable — no phase blocks starting the next except in the order listed
(fidelity before layout before self-check, since self-check's comparisons
are only useful once the builder can actually hit what a mockup asks for).
