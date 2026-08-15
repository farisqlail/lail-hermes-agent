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

## Phase 2 — Layout complexity — ✅ DONE (STACK + nesting; Grid still open)

**`STACK` type** (vertical sibling of `ROW`) and **deeper nesting** (2
levels of ROW/STACK containing ROW/STACK, via `_figma_child_item_schema`'s
`container_depth` in `chat_engine.py`) are both shipped — `_place_items` in
`hermes/figma_browser.py` handles `ROW`/`STACK` through the same composite
path, and the schema generates nesting explicitly (no true JSON-Schema
self-reference) 2 levels deep.

### Bugs found live-testing a real STACK-heavy reproduction (2026-08-15)

A live reproduction of an actual community Figma file (a "Create account"
onboarding screen: photo header + a white STACK card holding an avatar,
heading, subtitle, 2 inputs, a checkbox, a button, and a footer ROW) exposed
three real bugs — none caught by the 800+ unit tests, none visible against
Phase 1's simpler test cases, all requiring live browser reproduction to
find:

1. **`_apply_auto_layout` didn't explicitly select "Vertical"** — Shift+A's
   default direction follows the drawn frame's *aspect ratio*, not a fixed
   default. A `STACK` whose w/h happens to come out wider than tall (e.g.
   327×300) can silently land on Horizontal, then hang for 8s on
   `_set_number` looking for a `vertical-gap` field that doesn't exist in
   that mode. Fixed: click the matching radio explicitly either way, never
   rely on Shift+A's default.
2. **`_zoom_to_selection`'s bias was a single fixed fraction (0.85), unsafe
   in both directions — since fixed as a DYNAMIC per-item bias (see below),
   not just a re-tuned constant.** Live-confirmed root cause of "STACK
   children escape as stray top-level objects, sometimes merging keystrokes
   into an already-escaped sibling": Figma's "zoom to fit" leaves a margin
   around the fitted node rather than filling the canvas edge-to-edge, so a
   bias too close to 1.0 (0.85) can click just past the node's real
   rendered edge (worked fine for a near-viewport-filling ROOT frame, broke
   for a smaller nested STACK). But a bias too *low* fails the opposite
   way: a STACK filling most of its own height needs a bias past that fill
   line, or the click lands ON the last child instead of past it — and a
   single fixed value can't satisfy both a nearly-empty and a nearly-full
   container at once.

   **Fix, in three iterations (each live-tested, two of them wrong before
   the third held):**
   - *0.7, then 0.78* — re-tuning the SAME single constant. Fixed the
     escape/corruption case; broke again on a denser 6-item STACK (click
     landing on the last child, not past it) — confirmed a fixed fraction
     fundamentally cannot track a growing fill.
   - *Dynamic, hugging the `used` line* — `_place_items` now tracks a
     running `used` estimate (`_item_size` gives each item's approximate
     w/h; `_append_bias` turns `used` into a bias fraction). First attempt
     computed bias AT the used line (clamped to a [0.5, 0.8] range). Made
     ordering WORSE: clamping several early items up to the same 0.5 floor
     put their clicks at an identical point, and Figma's click-to-insert
     places a new item by proximity to existing siblings, not always at
     the end — so items landed out of visual order (a heading created 2nd
     rendered 5th).
   - *Dynamic, aiming at the midpoint* (final) — `_append_bias` now targets
     the midpoint between `used`'s fraction and the safe ceiling
     (`target = used_frac + (ceiling - used_frac) * 0.5`), strictly
     increasing in `used` (preserves order by construction) with a real,
     shrinking-but-never-zero margin past existing content (avoids the
     ambiguous-proximity problem). Floor dropped to 0.15 (only guards
     literal near-zero fill; the old 0.5 floor was the ordering bug's
     cause). `_text_extent`'s line-height bumped 1.35x→1.6x and a flat
     +15px slack added to every item's `used` contribution — first live
     re-test at this bias formula was clean on structure/order but merged
     a heading+subtitle pair again (heading's real height was under-
     estimated), and both changes together resolved it.

   Live-verified end to end: the login-screen case (5 flat items) and a
   6-item STACK (avatar/heading/subtitle/2 inputs/checkbox) both build
   clean; the full 8-item onboarding STACK (adding a button + footer ROW)
   builds clean **when the STACK is sized with real room for its content**
   (650px for 8 items) — see the residual note below for what happens when
   it isn't. See `_zoom_to_selection` and `_append_bias`'s docstrings for
   the full mechanism.
3. **`_return_to_parent`'s Layers-panel row click had no `force=True`** —
   a deeply-indented row (a ROW nested inside a STACK inside root) reveals a
   lock/visibility toggle checkbox on hover that Playwright's actionability
   check treats as obscuring the row, hanging for the full 30s timeout
   before failing. Fixed: `force=True` skips that check (safe here — it's a
   hover-rendering artifact, not a real interaction hazard).

**Residual, understood but not fixed:** an UNDERSIZED container (content
that genuinely doesn't fit — the 8-item onboarding STACK forced into 472px
when it needs ~600+) still breaks: `used`'s running estimate exceeds the
container's real height partway through, `_append_bias` clamps every
remaining item to the same 0.8 ceiling, and the ordering/nesting problem
this whole fix targets comes back for just those tail items (confirmed
live: BUTTON's label escaped to the page root, ROW gained an extra nesting
level — while the preceding 6 items stayed perfect). This is not a bug to
chase further with tuning; it's the honest limit of estimating fit without
reading Figma's real layout back — `_item_size` is a heuristic, not ground
truth, and no bias formula fixes a container that's actually too small for
its content. Two real ways out, neither started: (a) give `figma_web_design`
sizing guidance/validation so specs don't hand STACK a `height` its own
children can't fit in, or (b) read the parent's real remaining space back
from Figma (Position/Layout panel) between items instead of estimating —
bigger scope, see `_zoom_to_selection`'s docstring for why that's more
robust than any heuristic. Solid and live-reverified for correctly-sized
containers up to 8 children; the constraint is fit, not count.

### Shadow elevation + card/color/layout guide, and two more bias bugs (2026-08-15, same day)

Extended `shadow` from boolean-only to elevation tiers (`elevation`:
`subtle`/`medium`/`strong` — `_SHADOW_ELEVATIONS` in `figma_browser.py`,
each a (Y offset, blur, spread, opacity%) tuple), and expanded
`chat_engine.py`'s `_FIGMA_DESIGN_SYSTEM_GUIDE` with concrete neutral-palette
hex values, when to use which shadow tier, a CARD pattern (surface + radius
+ ONE of border-or-shadow), and a LAYOUT rule telling the model to size a
STACK/ROW with real room for its content — directly targeting the
undersized-container gap the STACK-nesting work above had just documented.

Live-testing this (a dashboard: 2 stat cards, a shadow'd promo card, a
button, a badge) found two MORE bugs, neither in the nesting-order fix
above — both about the shadow feature and about `_append_bias`'s own
geometric assumption:

1. **`scrubbable-control-opacity` is not a unique selector** — it matches
   THREE inputs once a shadow effect exists: the layer's own Appearance
   opacity, its Fill's opacity, and the shadow's own opacity, in that DOM
   order. `_set_number`'s `.first` (used everywhere else in this file,
   always safe — every other onboarding-key here is confirmed unique)
   grabbed the layer's, so setting a card's shadow opacity to e.g. 8% set
   the WHOLE CARD's opacity to 8% instead — confirmed live as a washed-out,
   nearly-invisible card. Fixed: `_set_number` gained a `last: bool` param;
   the shadow's opacity call uses `last=True` (the shadow's own field is
   added latest to the DOM, so `.last` reaches it; every other shadow field
   — Y, blur, spread — is already unique, confirmed via live count()).
2. **`_append_bias`'s geometry assumption breaks for short-but-wide
   composites.** The function assumes a fraction of the PARENT's own
   extent maps to the same fraction of canvas extent once zoomed-to-fit —
   true only when the parent, fit to the canvas, actually occupies most of
   it along that axis. A 327×100 stat card's zoom-to-fit is WIDTH-bound
   (909/327 ≈ 2.78x) not height-bound, so it only occupied ~30% of the
   canvas's height, not the ~85% the formula implicitly assumed (matching
   the earlier STACK/ROOT cases, which were both much taller relative to
   their width) — a bias computed for "mostly-full canvas" landed far below
   the card's small, centered on-screen box, and its 2nd child escaped.
   Fixed: `_append_bias` gained `cross_extent`/`horizontal` params, computes
   the actual zoom-to-fit scale from both of the parent's dimensions, and
   remaps the bias into the canvas band the parent actually occupies
   (centered, per Figma's own centering behavior) instead of the whole
   canvas. A `0.85` correction factor accounts for Figma's zoom-to-fit
   reserving its own margin beyond pure geometric fit (measured live: a
   472-tall STACK's pure-math prediction was ~100% canvas-height occupied,
   real was ~84%). Live-verified: two standalone shadow'd stat cards
   (327×100 each, previously both losing their 2nd child) now build with
   both children in each, correctly.

**ROW-of-cards bug — ✅ FIXED (2026-08-16).** Root cause found via live
reconnaissance (screenshot-per-item + a DOM dump of the Auto Layout panel's
alignment control): `_add_composite`'s call to `_apply_auto_layout` hardcoded
`centered=True` for every composite — ROW/STACK included — which clicks
Figma's alignment grid at the dead-center cell ("Align center"). That grid is
a single 3x3 control combining BOTH the growth-axis packing and the
cross-axis alignment in one click (9 literal positions, "Align top left"
through "Align bottom right") — not two independent controls. The
dead-center cell packs children from the CONTAINER's center on the GROWTH
axis too, not just the cross axis. With only 1 of N siblings placed, that
lone child renders centered in the whole (eventually-larger) container
instead of flush against the start edge — confirmed live via DOM dump: a
lone STACK card in a 652-wide ROW sat at x=169 (centered), not x=0. Every
click-point mechanism in this file (`_append_bias`, `_return_to_parent`)
assumes content starts at padding=0 and grows outward from there; centering
breaks that assumption, and the 2nd card's start-relative click landed
INSIDE card 1 instead of beside it.

Fix: `_apply_auto_layout` gained an `align_start: bool` param. When True, it
clicks the grid cell that packs the GROWTH axis at its start edge and only
centers the CROSS axis — "Align left" for a HORIZONTAL row (packs
left-to-right, vertically centered), "Align top center" for a VERTICAL stack
(packs top-to-bottom, horizontally centered) — instead of "Align center".
`_add_composite` threads this through; `_place_items`'s ROW/STACK branch is
the only caller that passes `align_start=True`, since it's the only path that
accumulates children one at a time via the `_append_bias` machinery whose
start-packed assumption this fixes. BUTTON/INPUT/CHECKBOX keep the old
`align_start=False` (true "Align center") deliberately — live-tested and
confirmed `align_start=True` there mis-packs a button/input label flush-left
instead of centered in the box (those composites place one label meant to
read as centered in the full box width, not a growing list).

Live-verified all three shapes of this fix: (1) the ROW-of-2-STACK-cards
repro now builds both cards as correct siblings, each fully and correctly
filled; (2) a standalone 6-item onboarding STACK (avatar/heading/subtitle/2
inputs/button) still builds clean under the new top-start packing — and
reads BETTER than before (content now sits flush at the top with slack
collecting at the bottom, instead of split top-and-bottom by centering); (3)
BUTTON/INPUT labels are still visually centered, CHECKBOX's icon+label still
read left-to-right as a pair. 806 unit tests still green (none exercise live
Figma).

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

**Step 1 — ✅ DONE.** `hermes/main.py`'s `chat()` and `stream()` tool-call
loops now call `_figma_selfcheck_message()` after every `figma_web_design`
result: on a successful build (`ok` + `screenshot_path` on disk), it wraps
the screenshot as an inline image content part (`uploads.as_content_parts`,
same pattern as a human's uploaded mockup) in a followup `user` message
appended before the next round, with `_FIGMA_SELFCHECK_PROMPT` asking the
model to compare against the original mockup/request and report concrete
mismatches rather than assuming success from the JSON summary alone.
Applies uniformly on both the web chat and Telegram paths (one `chat()` /
`stream()` shared by both). Also strengthened alongside this: a design-token
guide (`_FIGMA_DESIGN_SYSTEM_GUIDE` in `chat_engine.py` — 8pt spacing scale,
fixed type scale, one accent color, consistent radius/shadow rules) is now
prepended to `figma_web_design`'s tool description so a from-scratch build
(no mockup to copy fidelity from) still lands on a coherent system instead
of free-handed numbers.

**Step 2 (bigger, do only if Step 1 proves the comparison quality is good
enough to act on):** let the model issue a *delta* follow-up call — not a
full rebuild, but targeted fixes (e.g. "the header wasn't a photo,
`photoQuery` was missing") — which needs new fine-grained editing tools
(reselect an existing node by name and change one property) since
`_build_frame_via_ui` currently only knows how to build a frame from
scratch, not patch an existing one. Scope this as its own follow-up plan
once Step 1's comparison quality is validated — don't build the editing
tools speculatively before knowing the comparisons are even accurate.

Files touched (Step 1): `hermes/chat_engine.py` (`_FIGMA_DESIGN_SYSTEM_GUIDE`,
tool description), `hermes/main.py` (`_figma_selfcheck_message`, wired into
both `chat()` and `stream()` tool-call rounds). Step 2 would touch
`hermes/figma_browser.py` significantly (new node-selection/edit primitives)
but is explicitly out of scope until Step 1's comparison quality is
evaluated against real usage.

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

After each change: `pytest tests/ -q` (806 tests must keep passing — none of
them exercise live Figma, so a green suite only proves nothing else broke,
not that the new UI mechanism works), then a live build via
`figma_browser.design_figma_frame_web(file_url=None, spec=...)` against a
throwaway spec exercising the new field, screenshot-inspected before calling
anything done. No phase ships on "should work" — every claim in this roadmap
gets a live screenshot before being called finished, exactly as Phase 1's
bugs (click-point bias, Hug-mode sizing on the root frame, text-overlap)
were only found and fixed by insisting on that.

## Suggested order

Phase 1 (done) → Phase 2 (done, Grid spike still skipped) → Phase 3 Step 1
(done) → Phase 4 → Phase 3 Step 2 (only if Step 1's comparisons prove
reliable in real usage) → Grid spike (if still wanted). Each phase is
independently shippable and testable — no phase blocks starting the next
except in the order listed (fidelity before layout before self-check, since
self-check's comparisons are only useful once the builder can actually hit
what a mockup asks for).
