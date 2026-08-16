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

**Residual — ✅ FIXED (2026-08-16, follow-up session).** An UNDERSIZED
container (content that genuinely doesn't fit — the 8-item onboarding
STACK forced into 472px when it needs ~600+) used to break: `used`'s
running estimate exceeds the container's real height partway through,
`_append_bias` clamps every remaining item to the same 0.8 ceiling, and
the ordering/nesting problem this whole fix targets comes back for just
those tail items (confirmed live: BUTTON's label escaped to the page
root, ROW gained an extra nesting level — while the preceding 6 items
stayed perfect).

Took option (a) from this section's own list of two ways out — auto-
correct the container instead of reading Figma's real layout back
mid-build (option (b); after this same session's Grid work showed that
kind of live re-measurement can itself destabilize placement when done
repeatedly, (a) was the lower-risk path). `_place_items`' ROW/STACK branch
now computes a minimum required extent — summing each child's own
`_item_size` estimate + gap + the same +15 flat slack the bias math
itself already applies, for consistency — and clamps `box_h` (STACK) or
`box_w` (ROW) up to at least that minimum, BEFORE the frame is ever drawn,
regardless of what height/width the spec (or a default) declared. A
container can still end up TALLER/WIDER than a human would have chosen,
but never smaller than its own children need, which is what was actually
breaking placement.

Live-verified against the exact documented repro (8-item onboarding
STACK — avatar, heading, subtitle, 2 inputs, checkbox, button, footer ROW
of 2 links — forced to `height: 472`): all 17 nodes (including the
nested INPUT/CHECKBOX/BUTTON/ROW composites' own children) built and
nested correctly, in correct visual order, no escapes, no stray nesting
— the exact failure this residual described did not reproduce. Solid for
containers that were previously undersized; still governed by
`_item_size`'s heuristics (a guess, not ground truth) for exactly how
much bigger to make the container, but "somewhat more generous than
strictly needed" was already established elsewhere in this file as the
safe direction to err.

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

**Grid layout — ⚠️ SHIPPED, core mechanism live-verified, reliability not
fully proven (2026-08-16).** The spike ran: live recon found Grid's real
field set (`radio "Grid"`, `spinbutton "Number of columns"` — hidden until
a collapsed "N x Auto" summary control is clicked open — `rows` left on
"Auto", separate `scrubbable-control-gap-between columns`/`-rows`). New
`GRID` type shipped in both files, with `columns`/`rowSpacing` schema
fields and a `_grid_column_major_order` reindex (Figma fills a Grid
column-major — down column 1 first, not row-major reading order — so
children must be re-sequenced before creation to *read* in the order the
model specified them).

Three real, distinct bugs found and fixed live, each exposing a different
wrong assumption than the last:

1. **`_apply_auto_layout`'s direction radio was page-wide, not scoped** —
   unrelated to Grid's own mechanism but only surfaced once a STACK was
   built *inside* a GRID cell: the GRID's own alignment section stays in
   the DOM alongside the nested STACK's panel, and its "Align vertical
   centers" button ALSO exposes accessible name "Vertical", so
   `get_by_role("radio", name="Vertical")` matched 2 elements and raised a
   strict-mode violation. Fixed: scoped to Figma's own
   `[data-test-id="stack_panel"]` container. Independent, real bug, safe
   on its own regardless of Grid's outcome.
2. **Click position was assumed to not matter for Grid at all** — first
   recon (a sparse 4-item/400x400 box, plain dead-center click every time)
   looked clean, but was actually luck: a denser real 6-item/3-column grid
   broke two different ways depending on box size (texts merging into one
   when the reused point landed on existing content; the last several
   children escaping as stray page-level objects when it drifted past the
   frame's real edge as the frame grew). Two fraction-of-height bias
   formulas (assuming the requested height held; re-reading the live
   height but still guessing `used` from a row-count heuristic) BOTH
   failed for the same underlying reason: a Grid frame's real height grows
   roughly in step with its own content, which silently cancels out any
   fraction-based estimate — row 1 and row 2 computed to nearly the same
   bias either way.
3. **The real fix: measure, don't estimate.** After each child, reselect
   it via the Layers panel (its lingering "selection" isn't reliable to
   read directly — e.g. a `color` fill leaves a picker popover open that
   masks the Position panel) and read its REAL Y-position + height back
   from Figma (live-confirmed both are frame-relative, not absolute page
   coordinates) instead of estimating either number. `used` tracks the
   deepest bottom edge seen across every child placed so far. This is the
   same "read the parent's real remaining space back from Figma instead of
   estimating" escape hatch this doc already flagged for STACK's
   undersized-container residual (see above) — turned out necessary here,
   not just theoretically more robust.
4. **A Grid-mode frame has no Fixed/Hug lock at all via the mechanism
   every other composite in this file uses** — `_lock_fixed_size`'s
   `get_by_role("combobox", name="Vertical resizing")` matches nothing for
   Grid (`count()==0`), so it silently never locked anything; the frame
   collapses to Hug (17px, one text line) the instant it gains its first
   child — the same "any frame can flip to Hug on its first child" bug
   Phase 1 already fixed for ROOT/STACK, recurring because Grid's control
   is a differently-shaped `<label>`, not a `role="combobox"`. New
   `_lock_grid_height` targets it directly
   (`scrubbable-control-vertical-resizing`) and fixed the Hug-collapse.
   Live-verified this took the failure from "most children escape/merge"
   to "6 of 6 children correctly nested, in the right cells, in the right
   reading order" on at least one clean run.

**Residual, NOT resolved:** even once Fixed, a Grid frame with `rows` on
"Auto" keeps growing its own height as rows fill (measured 420→860→1300
across a 6-item/3-column build) — cosmetic (the outer parent's `Clip
content` can cut off later rows if it wasn't sized generously), not
corruption, and a same-session attempt to also fight this via a second
selector was tried and reverted (see `_lock_grid_height`'s own docstring).

**Reliability confirmed (2026-08-16, same day, follow-up session) — the
"missing elements" scare WAS the cluttered test file, not a real bug.**
Re-verified via a NEW PAGE in the same existing file (not a new file —
Figma's own new-file rate limit was still active; not the same cluttered
page — ~13 leftover frames from the earlier debugging session had made
`_current_row_selector`'s active-row detection unreliable there) — a
genuinely clean canvas. Result: all 7 elements (the heading + 6 grid
children) correctly nested, zero escapes, confirmed via both the
`_build_frame_via_ui` result and a direct layers-panel dump. This settles
it: the Grid placement mechanism itself is solid; the earlier missing-
element observations were the shared file's own clutter, not a code bug.
See `[[figma-testing-no-new-files]]` (agent memory) for the reusable
lesson — new Page in an existing file, never a new file, for repeated live
verification within one session.

**Height-residual fix attempted and reverted (2026-08-16, same day) — the
per-item height lock is load-bearing for correctness, not just cosmetic,
and can't be safely removed or replaced without a deeper rework.** Two
follow-up attempts, in order:

1. Read `_place_items`' own `used` tracker after all grid children were
   placed and lock the frame to `used + padding` as a "final settle."
   Live result: settled to 580px for a 6-item/3-column text grid that
   should need well under 100px — `used`'s value is itself a mid-
   construction snapshot (contaminated by the same row-eager-growth this
   whole section is about), not a clean final measurement, so locking to
   it just baked in whatever inflation existed at that moment.
2. Stopped re-locking height on every item during construction entirely
   (only reading it, for the click-bias math) and instead measured +
   locked once at the very end, theorizing the per-item lock might itself
   be *causing* Figma to reshuffle the grid's row/column assignment via
   repeated forced resizes. Live result, in TWO different ways depending
   on exact form: the grid became a sparse, non-contiguous 3x3 layout for
   6 items (3 empty gaps, not a tight 2x3) when height was still being
   read-and-relocked per item just without the forced Hug→Fixed switch;
   and when the per-item lock was removed OUTRIGHT, 5 of 6 children
   escaped back to being ROOT-level siblings instead of nesting in the
   grid at all — the exact original escape bug the per-item lock was
   built to fix in the first place.

Conclusion: the per-item `_lock_grid_height` call, despite ALSO being the
proximate cause of the height inflating past what's needed, is what keeps
the frame's real on-screen bounds stable enough for the click-bias math to
land inside it reliably. Removing or replacing it destabilizes placement
correctness faster than it fixes the cosmetic height issue — this isn't a
free-standing cosmetic residual, it's entangled with the actual placement
mechanism. **Reverted to the last known-good version** (this section's own
"Residual, NOT resolved" paragraph above, and commit `d0066cf`/`3ffc4e8`)
rather than ship a regression chasing a cosmetic fix. A real fix here
likely needs a fundamentally different mechanism — e.g. pre-computing and
setting the EXACT correct height once, before any children are added
(requires knowing real per-row content height in advance, which isn't
known until items are actually rendered), or reading back each existing
child's position between placements instead of relying on the frame's own
reported height at all (the same "read Figma's real state back instead of
estimating" pattern this whole Grid section already needed once) — not
attempted; flag for a dedicated session, not a quick follow-up.

Files touched: `hermes/figma_browser.py` (`_apply_grid_layout`,
`_grid_column_major_order`, `_lock_grid_height`, `_read_number`,
`_read_position_y`, `_place_items`'s `grid_mode`/`grid_columns` params and
GRID dispatch branch, `_add_composite`'s GRID path,
`_apply_auto_layout`'s scoped radio fix), `hermes/chat_engine.py` (`GRID`
enum value, `columns`/`rowSpacing` schema fields).

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

**Step 1 validated against real usage (2026-08-16), before starting Step 2**
— per this section's own gate. Built a deliberate-mismatch case (a
HEADER_IMAGE with `photoQuery` set but no Unsplash key configured, so the
build falls back to a plain color rectangle) and ran the EXACT message-
assembly path `chat()`/`stream()` use (`_figma_selfcheck_message`, same
client/model config) end to end against the real chat model. Result: "Ada
yang meleset: Header belum pakai FOTO PANTAI asli — yang terlihat masih
blok warna biru polos, bukan gambar pantai" — concrete, correctly
identified, no generic praise over the real gap. A negative-control run
(a correctly-built frame with no mismatch) got a clean "Sudah sesuai"
with no hallucinated complaints. Comparison quality cleared the bar to
proceed.

**Step 2, narrow first cut — ✅ DONE (2026-08-16).** Scoped to exactly one
delta-edit case per the user's own choice: fix a missing/wrong photo on
an already-built frame without rebuilding it. New tool
`figma_web_fix_photo` + `figma_browser.fix_figma_photo`. Needed solving a
prerequisite gap and two new UI mechanisms, each live-recon'd before
being written (per this roadmap's own rule) — the mechanism ended up
different, and more general-purpose, than the roadmap's own placeholder
description ("reselect an existing node by name") made it sound:

- **Prerequisite gap: no real file URL was ever captured.**
  `design_figma_frame_web`/`design_multi_frame_web` returned the literal
  `"design/new"` string as `url` — Figma redirects that to a real,
  reopenable file URL (`.../design/<fileKey>/Untitled`) the moment it
  creates the draft, but nothing captured it. Both functions now also
  return `file_url` (`page.url` read right after the build) — live-
  confirmed reopening it in a completely separate browser session loads
  the same draft with all content intact.
- **Mechanism: rename at build time, find by name later.** Every
  HEADER_IMAGE/AVATAR node gets a stable, predictable name
  (`hermes:photo:{n}:{kind}`, new `_rename_layer` — double-click the
  Layers-panel row via `_current_row_selector`, type, Enter) right after
  it's drawn. `_build_frame_via_ui`'s result gained a `photo_nodes` list
  (name/type/query/whether a real photo was actually placed) reported
  back up through both single- and multi-frame builds, so a later
  `figma_web_fix_photo` call always knows exactly what it can target —
  the model never has to guess a name.
- **Bug found live: renaming a freshly-drawn CHILD shape (not a root
  frame) is less reliable than renaming a root.** Double-clicking
  `[data-fpl-tree-active="true"]` (an INNER gridcell div, one level below
  the actual row) worked for a root-level frame but silently missed
  rename-input mode for a child shape — the stray `Control+A` and typed
  name were then interpreted as canvas shortcuts instead of text
  (`Control+A` selected everything on the page; a letter matching a tool
  shortcut, e.g. 'r' for Rectangle, drew a stray extra shape). Fixed:
  `_rename_layer` resolves the OUTER row via `_current_row_selector`
  first (the same selector this file already uses everywhere else to
  target a specific row) instead of the inner active-state div.
- **Bug found live: a reopened file's Layers panel is fully COLLAPSED.**
  A renamed child node isn't just visually hidden — it's not in the DOM
  at all until the tree is expanded, so `page.get_by_text` can't find it
  no matter how it's queried. The disclosure control turned out to have
  its own stable testid (`layers-panel-expand-caret`, found via DOM dump
  — not visible in a plain `outerHTML` capture of the row itself, only
  appears once real mouse hover is simulated). `fix_figma_photo` clicks
  every visible caret, repeatedly (further nesting can reveal more
  carets), until the target node appears or nothing new expands.

Live-verified end to end through the real, unmodified functions (only
`_fetch_stock_photo`'s network call was stubbed with a locally-generated
JPEG, since no real Unsplash key is available in this environment — every
other step ran for real): built a frame with a HEADER_IMAGE and an
AVATAR, both correctly renamed and reported in `photo_nodes`; reopened
the captured `file_url` in a totally separate browser session; found and
fixed only the header's photo — the Layers panel afterward showed both
nodes correctly named, the header's icon changed to an image fill, the
avatar completely untouched, and no stray shapes. 806 unit tests still
green throughout (one new tool added to `tests/test_web_ui.py`'s
tool-registry assertion). `_figma_selfcheck_message` (Step 1) now also
fires after `figma_web_fix_photo`, so a fix gets the same close-the-loop
verification as an original build — otherwise the model would report
"sudah diperbaiki" on faith, the exact blind confidence Step 1 exists to
prevent.

**Not done — deliberately out of scope for this narrow cut:** editing any
property other than a photo (color, text, size, ...). A natural next
slice if a broader delta-edit tool is wanted later, now that the harder
groundwork (real file URL, rename-and-refind, collapsed-tree handling) is
proven.

**Broadened to text content + text color — ✅ DONE (2026-08-16, follow-up
session).** New tool `figma_web_fix_text` + `figma_browser.fix_figma_text`
patches a TEXT node's content and/or fill color on an already-built
frame, same shape as `fix_figma_photo` (real file URL, collapsed-tree
handling reused as-is) but with a genuinely simpler find-by-name story: a
plain TEXT node auto-names its own Layers-panel row after its CURRENT
CONTENT (live-confirmed), so `current_text` — content the model already
knows from the original spec or a self-check screenshot — works as the
find key directly, no build-time rename/registry step needed the way
HEADER_IMAGE/AVATAR require. New fix mechanism, live-confirmed: with the
node reselected, `Enter` arms Figma's real text-EDIT mode (distinct from
`_add_text`'s draw-a-new-node path), `Control+A` selects the node's
EXISTING content (not "select all on page"), typing replaces it, `Escape`
exits back to node-selected (font/weight/other color untouched) — the
node stays selected afterward, so a `color` change chains directly onto
the existing `_set_fill_hex` helper with no re-find needed.

Live-verified end to end through the real, unmodified function in two
separate cases: (1) a deliberate typo ("Craete your account" → "Create
your account") in a freshly reopened session — fixed correctly, the
frame's other text untouched, no stray shapes; (2) a color-only change
(`color` given, `new_text` omitted) — text stayed exactly "Status:
Pending", fill went from gray to green. 807 unit tests still green
throughout (no new unit test for the browser-automation logic itself,
matching the established precedent that `fix_figma_photo` also has none
— this class of function is proven live, not unit-tested).

**Broadened further to size + non-TEXT color — ✅ DONE (2026-08-16, same
follow-up session).** New tool `figma_web_fix_property` +
`figma_browser.fix_figma_property` patches a BUTTON/INPUT/CHECKBOX/
RECTANGLE node's fill color, width, or height — the node types that
DON'T auto-name from their own content the way TEXT does, so this needed
exactly the stable-rename extension flagged as the real next slice: every
`_add_composite` call for BUTTON/INPUT/CHECKBOX (a new `rename` param,
applied BEFORE `fill_children` runs since that call moves the live
selection away from the composite) and every `_add_shape` call for a
plain RECTANGLE now gets a stable `hermes:node:{n}:{kind}` name the same
way `photo_nodes` already does for HEADER_IMAGE/AVATAR — threaded through
the SAME `photo_registry` object (two new keys, `node_n`/`fixable_nodes`,
alongside the existing photo-specific ones, so no new parameter needed
through the whole recursive `_place_items`/`_fill_box`/`_fill_grid`
call chain) and returned as a new `fixable_nodes` list in
`_build_frame_via_ui`'s result, alongside (not replacing) `photo_nodes`.
The fix mechanism itself needed nothing new: `_set_fill_hex` and
`_set_number` are the exact same helpers every original build already
uses for these fields, just re-targeted at a reselected existing node.

Live-verified end to end: built a frame with a BUTTON and a RECTANGLE,
fixed the BUTTON's color (blue → green) and the RECTANGLE's width
(100px → 200px) as two chained fixes in the same reopened session — both
applied correctly, visually confirmed via screenshot, no corruption to
the other node. 807 unit tests still green throughout (same "proven live,
not unit-tested" precedent as every other fix-in-place tool in this
file).

**Multi-frame self-check — ✅ DONE (2026-08-16, follow-up session).**
`figma_web_design_flow` gets the same close-the-loop treatment as a single
build now — the mechanical wiring turned out trivial (`design_multi_frame_web`
already returned a `screenshot_path` for its own `Shift+1`
zoom-to-fit-ALL-frames screenshot, unused until now), but the actual
concern this section flagged (a multi-frame screenshot is genuinely a
different shape to check — several frames side by side in one image,
against a request describing several screens) needed its own prompt, not
just reusing the single-frame one: `_FIGMA_SELFCHECK_FLOW_PROMPT` in
`hermes/main.py` explicitly tells the model to check EVERY frame against
its corresponding part of the request, not just the first one.

Validated with the same methodology Step 1 used: built a real 3-frame flow
(Welcome → Add Photo → Done) with a deliberate mismatch (frame 2's
HEADER_IMAGE, no Unsplash key configured, falls back to a plain color
box) and ran the exact `_figma_selfcheck_message` assembly against the
real chat model. Result: it correctly named frame 2 specifically —
"`Frame 2`... isi fotonya belum benar-benar berupa foto/preview – masih
kotak placeholder polos biru muda" — not just "something's wrong
somewhere." It also flagged two more real visual defects the run
happened to have (white text invisible on a white background in frames 1
and 3, traced back to the validation script itself calling
`design_multi_frame_web` directly with the tool-schema's snake_case keys
instead of going through `chat_engine.py`'s dispatch translation to
camelCase — confirmed live that dispatch handler already does this
translation correctly, so not a real bug, just a test-script artifact) —
concrete, per-frame, no generic praise, clearing the same bar Step 1's own
validation did.

Files touched (Step 1): `hermes/chat_engine.py` (`_FIGMA_DESIGN_SYSTEM_GUIDE`,
tool description), `hermes/main.py` (`_figma_selfcheck_message`, wired into
both `chat()` and `stream()` tool-call rounds). Files touched (Step 2):
`hermes/figma_browser.py` (`_rename_layer`, `_add_shape`'s `rename` param,
`_place_items`'s `photo_registry` threading, `_build_frame_via_ui`'s
`photo_nodes` result, `design_figma_frame_web`/`design_multi_frame_web`'s
`file_url` result, new `fix_figma_photo`), `hermes/chat_engine.py` (new
`figma_web_fix_photo` tool schema + dispatch), `hermes/main.py`
(`_figma_selfcheck_message` extended to include it), `tests/test_web_ui.py`
(tool-registry list updated). Files touched (multi-frame self-check):
`hermes/main.py` (`_FIGMA_SELFCHECK_FLOW_PROMPT`, `_figma_selfcheck_message`
extended to `figma_web_design_flow` with the variant prompt),
`tests/test_main_smoke.py` (new wiring test). Files touched (text
broadening): `hermes/figma_browser.py` (new `fix_figma_text`),
`hermes/chat_engine.py` (new `figma_web_fix_text` tool schema + dispatch),
`hermes/main.py` (`_figma_selfcheck_message` extended to include it),
`tests/test_web_ui.py` (tool-registry list updated). Files touched
(size + non-TEXT color broadening): `hermes/figma_browser.py`
(`_add_composite`'s `rename` param, `photo_registry`'s `node_n`/
`fixable_nodes` keys, BUTTON/INPUT/CHECKBOX/RECTANGLE dispatch branches
in `_place_items` renaming their own node, `_build_frame_via_ui`'s
`fixable_nodes` result, new `fix_figma_property`), `hermes/chat_engine.py`
(new `figma_web_fix_property` tool schema + dispatch), `hermes/main.py`
(`_figma_selfcheck_message` extended to include it), `tests/test_web_ui.py`
(tool-registry list updated).

## Phase 4 — Multi-frame output — ✅ DONE (2026-08-16)

Shipped as a second tool, `figma_web_design_flow` (`frames: [...]`, each
item the same shape as `figma_web_design`'s params minus `file_url`, plus
an optional `frame_gap`), backed by a new `design_multi_frame_web` in
`hermes/figma_browser.py`. Reuses `_build_frame_via_ui` per frame
completely unchanged, as planned — but the actual anchoring mechanism
ended up different from this section's original plan, and needed its own
live-reconnaissance round (per this roadmap's own rule: every new UI
mechanism is unverified until proven live) that found two real bugs the
plan hadn't anticipated:

- **Original plan (reading back the previous frame's on-screen right
  edge) was replaced before writing any code**, once recon found something
  more robust: the Position panel's X/Y fields (`aria-label="X-position"`/
  `"Y-position"`, sharing a non-unique `data-onboarding-key` with other
  fields so `_set_number` can't target them — new `_set_position` helper
  selects by `aria-label` instead) are directly settable, live-confirmed
  to actually move the node. Setting each frame's exact Figma-space
  position after building it sidesteps ever converting between screen
  pixels and page space, which the original plan would have needed.
- **Bug 1 — drawing frame N+1 at the default anchor risks nesting it
  inside frame N.** `_build_frame_via_ui` always draws at a fixed
  on-screen point near the canvas's top-left; after the previous frame's
  own zoom-to-fit, that point can sit right on top of it, and Figma
  auto-parents a frame drawn overlapping an existing one instead of
  making a page sibling. Fixed: pan the canvas away (`page.mouse.wheel`,
  live-confirmed to pan rather than zoom) before drawing frame N+1, then
  reposition it to its real layout slot via `_set_position` afterward —
  where it lands mid-draw doesn't matter once that runs.
- **Bug 2 — the pan itself silently failed twice, in ways that only
  showed up as corrupted TEXT, not a visible layout error.** (a) A fixed
  wheel delta pans a different FIGMA-SPACE distance depending on the
  current zoom level; without resetting zoom to a known value first
  (`Shift+0` = 100%) via panning at the previous frame's own ~190%
  zoom-to-fit level, frame N+1 landed Figma-space-close enough to frame N
  that a LATER tight zoom-to-fit while building one of frame N+1's own
  nested composites (e.g. its INPUT, zooming to ~330%) brought frame N
  back into the shared viewport. (b) Figma's wheel-to-pan handling is
  canvas-scoped, and the mouse pointer was never explicitly moved onto
  the canvas before the wheel call — left wherever the last panel
  interaction (`_set_position`'s own field clicks) put it, so the pan
  silently no-opped. Combined, a click meant to create a new text node
  inside frame N+1 landed on frame N's EXISTING text node instead —
  confirmed live: `INPUT`'s "Email" placeholder, meant for frame 2, was
  typed mid-string into frame 1's second text ("Let's get you set up" →
  "Let's getEmail set up") — no exception, `children_created` still
  matched `children_requested`, silently wrong. Both fixed: reset zoom via
  `Shift+0` and explicitly `page.mouse.move` onto the canvas center before
  every pan.

Live-verified end to end (real Chrome, real Figma, unpatched production
code): a 3-frame onboarding flow (dark Welcome screen → Create Account
with INPUT+BUTTON → green success screen) built as 3 correct page
siblings, each with its own correctly-nested, correctly-labeled children,
no cross-frame contamination, positioned left-to-right with the expected
gap. 806 unit tests still green throughout (added one new tool to the
tool-registry assertion in `tests/test_web_ui.py`).

`design_figma_frame_web` (single-frame) was refactored alongside this to
extract its session-open/login/popup-dismiss boilerplate into a new
`_open_figma_session` helper shared with `design_multi_frame_web`, instead
of duplicating ~130 lines — re-verified live afterward that the
single-frame path is unchanged in behavior. `_build_frame_via_ui`'s return
dict gained one additive key, `root_row_selector` (the root frame's own
Layers-panel row selector, needed to reselect a specific frame after
`Escape` deselects everything at the end of each build) — safe for the
existing single-frame caller, which just ignores the extra key.

Files touched: `hermes/figma_browser.py` (`_set_position`,
`_open_figma_session`, `design_multi_frame_web`, `_build_frame_via_ui`'s
return dict, `design_figma_frame_web` refactored to use the shared
helper), `hermes/chat_engine.py` (new `figma_web_design_flow` tool schema
+ dispatch handler), `tests/test_web_ui.py` (tool-registry list updated).

## Phase 5 — Color & typography variety (gradient fills, font family) — ✅ DONE (2026-08-16)

New user-facing request, not on this roadmap before now: gradient color
fills and font-family choice beyond the fixed "Inter" default. Both
needed live reconnaissance from scratch (this roadmap's own standing
rule) — neither had ever been touched by any prior phase.

**Font family — straightforward, worked first try.** Figma's Typography
panel has a `button[data-onboarding-key="text-panel-font-picker-button"]`
(shows the current family, "Inter" by default) that opens a searchable
list; a "Search fonts" input is already focused on open, so typing
directly (no separate click into the search field) filters it, and the
matching entry is a plain `role="option"` clickable by exact name. New
`_set_font_family` helper, wired into `_add_text` via a new
`font_family` param, itself wired to a new `fontFamily` schema field
(TEXT/FOOTER_LINK only, narrow first cut). Live-verified: a TEXT node
requesting `fontFamily: "Playfair Display"` rendered visibly in that
serif face, panel correctly showing "Playfair Display" instead of
"Inter".

**Gradient fills — three real dead ends before the working mechanism.**
1. First attempt: click the Fill swatch to open its picker, then click
   one of the small fill-TYPE tab icons (Solid/Linear/Radial/...) by
   on-screen PIXEL COORDINATE (estimated from one screenshot). Wrong
   almost immediately — a coordinate that hit "Linear" in one session hit
   "Check color contrast" (the LAST icon in the row) in another, because
   the popover's own screen position isn't fixed (shifts with which Fill
   row triggered it). Nearly shipped this before noticing the
   inconsistency across repeated recon runs.
2. Second attempt: broad DOM dumps trying to find a stable `aria-label`
   or `role="tab"` on the icons — they have neither; they're plain
   `<div>`-wrapped radio `<input>`s with no accessible name of their own.
3. **What worked:** walking up from a KNOWN, uniquely-findable anchor
   (`data-testid="color-contrast-button"`, the one icon in that row that
   DOES have a stable aria-label) to its container, then searching for
   sibling elements sharing Figma's own BEM-style CSS class prefix
   (`color_picker_v2--...`) revealed the real structure: a
   `<fieldset role="radiogroup" class="paint_type_group_tabs--container-...">`
   whose child `<input>`s have literal, meaningful `value`s —
   `"SOLID"`, `"GRADIENT_LINEAR"`, `"PATTERN"`, `"IMAGE"`, `"VIDEO"`,
   `"CUSTOM"`. `page.locator('[class*="paint_type_group_tabs--container"]
   input[value="GRADIENT_LINEAR"]').click(force=True)` reliably switches
   to Linear gradient regardless of the popover's screen position — DOM
   structure, not pixel geometry. New `_set_gradient_fill` helper
   switches the tab, then overwrites the 2 default gradient stops
   Figma auto-creates (`input[aria-label="Gradient Stop Color"]`,
   `.nth(0)`/`.nth(1)`) with the caller's own start/end hex colors.
4. **A fourth bug, order-dependent, found only in the full pipeline (not
   in isolated testing):** a composite (BUTTON) reaching this call for
   the FIRST time has no fill yet at all (`_add_composite` skips its
   normal `_set_fill_hex` call when `gradient` is given, and a
   freshly-drawn frame starts with an empty fill list) — the Fill
   swatch button doesn't exist until "Add fill" is clicked first, same
   gap `_set_fill_hex` already handles for solid colors. Handling that
   ALONE still intermittently failed live (no exception, but the Fill
   row ended up a plain white solid — exactly what "Add fill" alone
   produces — with no picker popover ever appearing): the swatch's FIRST
   click right after "Add fill" doesn't always register as opening the
   popover, a rendering/animation race on the panel's fill-count
   transitioning 0→1. Fixed with a bounded retry (re-click the swatch,
   re-check for the radiogroup, up to 3 times) rather than a longer fixed
   wait, since the flake wasn't reliably timing-bound in testing.

Only a 2-stop LINEAR gradient is supported — deliberately narrow, same
scoping `fix_figma_photo`/`fix_figma_text` used for their own first cuts.
NOT covered: Radial/Angular/Diamond (Figma's own "Linear" text next to
the gradient bar is a SEPARATE in-editor dropdown for that, not explored
this session), 3+ stops (Figma's "Add gradient stop" inserts by its own
position logic, not necessarily DOM-appended at the end — untested, so
not attempted rather than guessed at), and gradient angle (only "Flip
gradient"/"Rotate gradient" quick-action buttons were found, no numeric
degree field — default is Figma's own top-to-bottom vertical). Wired into
RECTANGLE and BUTTON only (the two most common places a UI gradient
appears — a card/hero background or a CTA button) via a new
`gradientColors` schema field (`[start, end]`, exactly 2 hex strings);
`_add_shape`/`_add_composite` both gained a `gradient` param that, when
given, replaces the ordinary `_set_fill_hex` call.

Live-verified end to end: a frame with a Playfair-Display heading, an
orange→red gradient RECTANGLE, and a blue→cyan gradient BUTTON with a
label — all three built correctly together in one pass, screenshot-
confirmed (serif heading visibly different from Inter, both gradients
rendering as smooth 2-color transitions, BUTTON's label correctly
nested). 807 unit tests still green throughout (no new unit test for the
browser-automation logic itself — same "proven live, not unit-tested"
precedent as every other UI-mechanism helper in this file).

Files touched: `hermes/figma_browser.py` (`_set_gradient_fill`,
`_set_font_family`, `_add_text`'s `font_family` param, `_add_shape`'s
`gradient` param, `_add_composite`'s `gradient` param, BUTTON/RECTANGLE
dispatch branches in `_place_items`), `hermes/chat_engine.py`
(`fontFamily`/`gradientColors` schema fields in `_FIGMA_CHILD_LEAF_PROPS`).

**Follow-up (2026-08-16, same day) — Radial gradient + BUTTON label font
— ✅ DONE.** Two of the four open items above shipped same-day:

- **Radial gradient.** There's only ONE outer radio value for gradients
  (`GRADIENT_LINEAR` — no separate `GRADIENT_RADIAL`); Radial/Angular/
  Diamond turn out to be a SEPARATE in-editor dropdown next to the
  gradient bar, found via its own stable class prefix
  (`gradient_editor--paintTypeSelect-...`, distinct from the Fill row's
  own "Linear" text label sitting OUTSIDE the popover — `get_by_text
  ("Linear")` matches both, and clicking the wrong one does nothing
  useful). Opening it reveals plain `role="option"` entries "Linear"/
  "Radial"/"Angular"/"Diamond". `_set_gradient_fill` gained a
  `gradient_type` param (`"LINEAR"` default or `"RADIAL"`), threaded
  through `_add_shape`/`_add_composite` and a new `gradientType` schema
  field. Live-verified: a RECTANGLE with `gradientType: "RADIAL"`
  rendered as a genuine center-out radial glow, visually distinct from
  linear.
- **Font family on BUTTON labels.** Nearly free — `_fill_button`'s own
  `_add_text` call just needed `font_family=_item.get("fontFamily")`
  threaded through (the same `_set_font_family` mechanism Phase 5 already
  proved for TEXT). Live-verified: a BUTTON labeled "Get Started" with
  `fontFamily: "Montserrat"` rendered in that geometric sans, visibly
  different from Inter.

Both live-verified together in one build (radial-glow RECTANGLE +
Montserrat-labeled BUTTON, screenshot-confirmed). 807 unit tests still
green.

**Follow-up (2026-08-16, same day) — Angular + Diamond gradient — ✅
DONE.** Both reuse the exact SAME `gradient_editor--paintTypeSelect`
dropdown Radial already proved — `_set_gradient_fill`'s `if gradient_type
!= "LINEAR"` branch generalized from a Radial-only check to any of the
three (`gradient_type.capitalize()` maps directly onto the dropdown's
own option text: "Angular", "Diamond"), no new mechanism needed. Schema
`gradientType` enum extended to `["LINEAR", "RADIAL", "ANGULAR",
"DIAMOND"]`.

Live-verified: two RECTANGLEs in one build, `gradientType: "ANGULAR"`
rendering a genuine conic/sweep gradient (color rotating around the
center, not radiating from it) and `gradientType: "DIAMOND"` rendering a
correct rhombus-shaped radiation pattern — both visually distinct from
Radial's circular glow and from each other, confirming the shared
dropdown mechanism picks the right option every time, not just for
Radial. 807 unit tests still green.

**Still open:** gradient on other node types (HEADER_IMAGE/INPUT/AVATAR/
ROW/STACK/GRID backgrounds), 3+ gradient stops, gradient angle control,
and font family on INPUT/CHECKBOX labels.

## Phase 6 — Design system (Color & Text Styles) — ✅ DONE (2026-08-16)

New request: reusable, NAMED Figma Styles (Color styles, Text styles) —
define a color/typography once, apply it to many elements, and editing
the style later would propagate everywhere it's used (not exercised this
session, but that's the whole point of a Style vs. a hardcoded hex/font).
Genuinely new territory — this roadmap's own standing rule (live recon
before any code) applied in full; nothing here existed in any prior
phase.

**Mechanism, both found via the same shape of investigation as
gradient's own dead-ends earlier — accessible-name dumps first, DOM
structure only when those came up empty:**

- **Color style — create:** select a node with a Fill, click its swatch
  (`paint-panel-row-paint-1-0`, the same one `_set_fill_hex`/
  `_set_gradient_fill` already use), click `button[aria-label="New style
  or variable"]` — opens a small "Style"/"Variable" tabbed form that
  DEFAULTS to the Variable tab (Style must be clicked explicitly), type a
  name into `placeholder="New color style"`, click the form's own
  "Create style" submit button. That button shares its accessible name
  with the ICON that opened the form — two elements match
  `get_by_role("button", name="Create style")`, the submit one is the
  LAST.
- **Color style — apply:** a SEPARATE button next to the Fill row,
  `button[aria-label="Fill, Apply styles and variables"]` (not the swatch
  itself), opens a styles/variables browser defaulting to the "Libraries"
  tab. Its `placeholder="Search"` box (needs `exact=True` — a bare
  substring match also catches an unrelated font-picker's leftover
  "Search fonts" field if one's still in the DOM) filters across every
  source, LOCAL styles included, with no separate "Custom" tab click
  needed. A hierarchical name like `"Brand/Primary"` renders with the
  group ("Brand") as a non-clickable section header and only the leaf
  ("Primary") as the actual clickable row — matching is done on the leaf
  segment.
- **Text style — create/apply:** same two-button shape
  (`button[aria-label="Typography, Apply styles"]` next to the Typography
  section), but a DIFFERENTLY-SHAPED popover than Fill's (a "Text styles"
  panel — Text styles have no Variable concept in Figma, so no tab
  choice) with its own `button[aria-label="Create style"]` ("+" icon)
  opening a "Create new text style" form — `placeholder="New text
  style"` name field, submit button sharing the SAME "Create style" name
  collision as the color-style form (again, take the LAST match).

**A real, load-bearing bug found only once verifying the full
create-then-apply round trip through the ACTUAL production functions (not
the narrower recon scripts):** every `fix_figma_*`/`fix_figma_property`
function's existing collapsed-tree-search loop gives up immediately the
FIRST time zero expand-carets exist, assuming that means "nothing left to
expand." True for a small, fast-loading file — false once a file (a real
design system tends to accumulate pages/styles/components over time, and
this session's own shared test file had grown past 100 pages from
`[[figma-testing-no-new-files]]`'s reuse-a-page strategy) takes longer
than `_open_figma_session`'s fixed internal wait to even finish showing
Figma's OWN loading spinner — confirmed live: a 1s post-open check found
zero carets and zero matching text; a 10s wait found both. New
`_select_node_by_display_name` (shared by both new style functions, NOT
yet backported to the older `fix_figma_*` functions — narrower fix,
flagged as a possible follow-up) waits for the canvas to actually be
visible first, then retries the caret-search loop across pauses instead
of giving up on the first empty check.

Live-verified end to end through the real, unmodified functions:
`create_figma_style` on a RECTANGLE's fill (named "Brand/Accent"), then
`apply_figma_style` to a SECOND rectangle (previously red, correctly
turned the same purple); `create_figma_style` on a TEXT node's typography
(named "Display/Large"), then `apply_figma_style` to a second, originally
small-and-gray TEXT node (correctly picked up the full font/size/weight).
Screenshot-confirmed both pairs visually matching, and the page-level
Styles panel showing both new styles under "Color styles"/"Text styles".
807 unit tests still green throughout.

Files touched: `hermes/figma_browser.py` (`_select_node_by_display_name`,
`_create_color_style`, `_apply_color_style`, `_create_text_style`,
`_apply_text_style`, new `create_figma_style`/`apply_figma_style`),
`hermes/chat_engine.py` (new `figma_web_create_style`/
`figma_web_apply_style` tool schemas + dispatch), `hermes/main.py`
(`_figma_selfcheck_message` extended to include both), `tests/
test_web_ui.py` (tool-registry list updated).

**Not started:** Variables (design tokens with light/dark modes — this
phase only covers Styles), Effect styles (shadows), applying a style to
MULTIPLE nodes in one call, and reading back which styles already exist
in a file (a caller currently has to remember the exact name it used at
create time).

## Phase 7 — Senior UI/UX reference study (Gojek Asphalt) — ✅ DONE (2026-08-16)

User asked to study `https://asphalt.gojek.io/` (Gojek's public design-system
site, framed as a "how to be a senior UI/UX" guide) and apply the learnings
to this agent's skills. Researched the site's Principles page and 5
Foundations sub-pages (colors, typography, motion, spacing, shadows) via
`WebFetch` (real paths are under `pages/*.html`, e.g. `pages/foundations.html`
— clean URLs like `/foundations` 404, it's a static-export SPA).

**Findings that were genuinely new/actionable vs. what this repo's guide
already had:**
- 4 named principles (Consistency, Usability, Accessibility, Aesthetics) —
  Asphalt states these as prose philosophy, not enforceable rules on their
  own.
- WCAG 2.0 AA numeric contrast targets: 4.5:1 for normal text, 3:1 for large
  text (≥18px, or ≥14px bold) — Asphalt's own accessibility page cites this
  standard directly.
- Proximity as an explicit spacing heuristic: near = related, far = distinct
  group — stated as a design principle, not a numeric rule.
- Type scale via a fixed ratio (Asphalt: 1.3x per step off a 12pt base) and
  line-height = fontSize × 1.3 rounded to nearest 4px — this repo's own type
  scale (12/14/16/20/24/28/32-40) is already a fixed, non-arbitrary scale
  (roughly 1.15-1.3x per step), so no change needed there; line-height is
  not a settable field in `figma_browser.py` today (Figma defaults TEXT
  nodes to "Auto"), so the ratio itself isn't actionable yet — noted as a
  possible future field, not built this pass.
- Only 2 shadow elevation tiers (High/Low) vs. this repo's existing 3
  (subtle/medium/strong) — repo's system is already more granular than
  Asphalt's public docs show (Asphalt's own "Implementation" sections are
  placeholder/"coming soon" everywhere), so kept as-is, no downgrade.
- Motion (3 named qualities, no numeric specs) — not applicable, this agent
  builds static frames only, no animation/prototyping capability exists.

**Applied to `hermes/chat_engine.py`'s `_FIGMA_DESIGN_SYSTEM_GUIDE`** (the
system prompt text prepended to every `figma_web_design` call — pure prompt
change, no new browser automation, so no live Playwright recon needed for
this phase):
1. Opening line now states the 4 principles as an explicit decision
   framework (Consistency/Usability/Accessibility/Aesthetics) instead of
   diving straight into numeric rules with no "why".
2. WARNA section's existing vague "kontras wajib terbaca" replaced with the
   concrete WCAG AA ratios (4.5:1 / 3:1) plus a concrete tie-breaker
   (pick from the already-specified neutral palette instead of guessing two
   arbitrary mid-tones).
3. WHITESPACE section gained the proximity heuristic explicitly: gap size
   should communicate grouping (small gap = related items, larger gap =
   separate groups), not just "space to look neat".

`pytest tests/ -q` — 807 passed (prompt-text-only change, no schema/behavior
change, so no test updates needed).

**Not applied / explicitly deferred:** line-height control (would need new
`figma_browser.py` automation + live recon to find and verify Figma's
"Line height" field — a real new mechanism, not requested this pass and
skipped per this session's pattern of not self-directing into new scope
without the user picking it), a live automation around Figma's own
"Check color contrast" UI (incidentally discovered during earlier gradient
recon, still unused) — flagged as a candidate future phase, not started.

## Phase 8 — Line-height control — ✅ DONE (2026-08-16)

Follow-up from Phase 7's Asphalt research: `figma_browser.py` never set
TEXT line-height, leaving every node on Figma's own per-font "Auto" value
(~1.2x, not controlled by this codebase). Live recon (new Page on the
shared test file) found the field: `input[aria-label="Line height"]`, no
`data-onboarding-key` wrapper (same bare-aria-label pattern as X/Y-position,
not `_set_number`'s pattern). Its `value` starts as the literal string
`"Auto"`, `placeholder` shows Figma's own live-computed auto px (confirmed:
12px font → placeholder "15"; 20px font → placeholder "24"); typing a
number via Ctrl+A+type+Enter switches it to Fixed px (confirmed: typed
"32" → `value` becomes "32", placeholder clears).

New `_set_line_height(page, value)` (same click/Ctrl+A/type/Enter shape as
`_set_number`, just a bare-aria-label locator instead of an
onboarding-key one) and `_line_height_for(font_size)` implementing the
Asphalt formula from Phase 7 (`fontSize * 1.3`, rounded to nearest 4px, min
4) — wired unconditionally into `_add_text` (the single choke point for
ALL text-bearing node types: TEXT, BUTTON label, INPUT placeholder,
CHECKBOX label, FOOTER_LINK — one edit covers all of them). No new schema
field added — this mirrors the existing spacing/type-scale rules, which
are also enforced as a fixed formula/scale rather than left to the model to
pick per element, for the same consistency reason.

Live-verified end-to-end via `design_figma_frame_web` (24px bold title +
14px body + BUTTON in one frame), reopening the built file and reading the
Line height field back via `_select_node_by_display_name`: 24px title read
back as 32 (24×1.3=31.2→32), 14px body read back as 20 (14×1.3=18.2→20) —
matches the formula exactly, and the screenshot shows correctly-spaced
lines. 807 unit tests still pass.

**Noticed but out of scope, not fixed this pass:** the same live-build
screenshot showed the body TEXT node inheriting "Bold" font style from the
previously-drawn bold title (Figma's text tool remembers the last-used
style for newly drawn text; `_add_text` only calls `_set_bold` when
`bold=True`, it never explicitly resets to Regular when `bold=False`), and
long TEXT content overflowing its frame width instead of wrapping (no
Fixed-width-with-wrap is set on TEXT nodes today, only Hug). Both are
pre-existing gaps unrelated to line-height — flagged for a future phase if
the user asks, not started.

## Phase 9 — Bold-carryover + TEXT wrap fix — ✅ DONE (2026-08-16)

Follow-up to Phase 8's 2 noticed-but-deferred gaps, requested next by the
user.

**Bold carryover:** `_set_bold` changed to accept `bold: bool` and always
run (was: only called when `bold=True`), picking target option "Bold" or
"Regular" from the Font style combobox either way instead of silently
leaving whatever weight Figma's text tool remembered from the last-drawn
node. `_add_text` now calls `await _set_bold(page, bold)` unconditionally
instead of `if bold: await _set_bold(page)`.

**TEXT wrap:** new `_set_text_wrap_width(page, width)`, wired into
`_add_text` via a new `max_width` param (only TEXT/FOOTER_LINK dispatch in
`_place_items` passes it, as `item.get("width") or content_w`) — only
switches modes when a rough single-line-width estimate
(`len(content) * font_size * 0.55`) actually exceeds `max_width`, so short
text stays Auto-width instead of being force-stretched to a fixed box.

Live recon found the resize-mode control: a `role="radiogroup"` of 3
`input[type=radio]` distinguished by `data-tooltip` ("Auto width"/"Auto
height"/"Fixed size", no `data-onboarding-key`) — clicking "Auto height"
switches a TEXT node to fixed-width/auto-height (i.e. wraps). **The real
trap, found only by reproducing the crash inside the actual build pipeline
after an isolated standalone repro passed clean:** a bare page-level TEXT
node exposes the width field as the plain `scrubbable-control-width` input
`_set_number` already handles — but every REAL call site places TEXT as a
child of an auto-layout frame (`_add_text` only ever runs inside
`_place_items`), and an auto-layout CHILD's width control is a completely
different DOM shape: a combobox-styled "Fixed width (N)" label under
`data-onboarding-key="transform-width"` that turns into a plain editable
field on click (no dropdown opens). `scrubbable-control-width` simply isn't
in the DOM for an auto-layout child at all, which is what made the first
version of this fix hang until Playwright's own 8s actionability timeout
instead of doing anything. Fixed by trying `transform-width` first (the
path every real call actually takes) with a fallback to the plain input.

Live-verified against the same 24px-bold-title + 14px-body + BUTTON spec
that surfaced both bugs in Phase 8: reopening the built file, the body node
now reads back as Regular weight (not carried-over Bold) and `W 342 × H 40
Hug` — wrapped to 2 lines inside the frame's content width instead of
overflowing past it. 807 unit tests pass.

## Phase 10 — Live contrast-checker automation — ✅ DONE (2026-08-16)

Last open item from Phase 7's Asphalt research: back the numeric WCAG AA
guidance already in `_FIGMA_DESIGN_SYSTEM_GUIDE` with a REAL measurement
instead of trusting the model's own color choice — Figma has a built-in
contrast checker, incidentally spotted during Phase 5's gradient recon
(mentioned in `_set_gradient_fill`'s own docstring as a tab landed on by
accident), never wired up until now.

Live recon: opening the Fill swatch's FULL color-picker popover
(`button[aria-label^="Solid color hex"]` — clicking the swatch button
itself, not the hex text input `_set_fill_hex` types into) shows a "Color
Contrast Menu" group at the top UNCONDITIONALLY, no extra click needed —
`[aria-label^="Color contrast ratio"]` (e.g. "Color contrast ratio:
2.35:1. View details") and `[data-testid="contrast-standard-wrapper"]`
(aria-label "AA Contrast standard not met..." vs "...standard met."). This
is Figma's OWN computed value, confirmed live to reflect the REAL
composited background — not just page canvas color: a text node placed
inside a dark `#0F172A` auto-layout frame reported its ratio against that
frame's actual fill (1.72:1 for a too-dark gray-on-navy pair, 17.85:1 for
white-on-navy), not against Figma's white page background.

New `check_figma_contrast(file_url, node_name, ...)` in `figma_browser.py`
— reuses `_select_node_by_display_name` (same node-finding as every
`fix_figma_*`/style function), returns `{ok, ratio, meets_aa, detail,
screenshot_path}`. Only supports a solid Fill (a gradient/image fill's
swatch has a different `aria-label` prefix, not handled). New
`figma_web_check_contrast` tool in `chat_engine.py` (schema + dispatch,
same file_url/node_name pattern as the style tools) — deliberately NOT
added to `_figma_selfcheck_message`'s tuple in `main.py`: that flow asks
the model to compare a screenshot against the user's original mockup/
request, which doesn't apply to a read-only contrast report (its own
`detail` string already states the verdict).

Live-verified via 3 cases against a real build (dark `#0F172A` frame, one
low-contrast gray text, one high-contrast white text): low-contrast node
→ `1.72:1`, `meets_aa=False`; high-contrast node → `17.85:1`,
`meets_aa=True`; a nonexistent node name → clean `ok=False` error instead
of a crash. `tests/test_web_ui.py`'s tool-registry list updated. 807 unit
tests pass.

**Not built:** batch-checking multiple nodes in one call, checking a
gradient/image fill's effective contrast (no single "color" to compare),
and switching the standard from AA to AAA (the checker's own "Contrast
settings" button, seen in recon but not used — always reads whatever
standard Figma has selected, which defaults to AA).

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

Phase 1 (done) → Phase 2 (done; Grid spike shipped 2026-08-16, core
mechanism live-verified AND reliability confirmed via a clean-page
re-test — see its own section above) → Phase 3 Step 1 (done) → Phase 4
(done) → Phase 3 Step 2 (done, narrow: photo-only fix). Each phase is
independently shippable and testable — no phase blocks starting the next
except in the order listed (fidelity before layout before self-check,
since self-check's comparisons are only useful once the builder can
actually hit what a mockup asks for). Remaining open items: the Grid
height-keeps-growing cosmetic residual (own section above — content
nests correctly, but a Grid frame with `rows` on "Auto" keeps growing
taller than requested, which an unsized-generously outer parent's `Clip
content` can cut off; a same-session fix attempt was tried and reverted,
see that section) and the ROW-of-cards-of-STACKs-inside-another-composite
depth beyond what's been live-tested. Multi-frame self-check for
`figma_web_design_flow`, the undersized-container residual (Phase 2), and
Phase 3 Step 2 broadened to text content/color AND to size + non-TEXT
color (`figma_web_fix_property`) are now all fixed — see their own
sections above. Phase 3 Step 2's delta-fix family now covers photo, text
content/color, and BUTTON/INPUT/CHECKBOX/RECTANGLE color/width/height —
the main remaining gap is deeper properties (border, shadow, corner
radius) if ever wanted, not started. Phase 5 (gradient fills + font
family) is done too — see its own section above; Angular/Diamond gradient
and font family on BUTTON labels have since shipped too (own sections
above) — open items there are gradient on more node types, 3+ stops,
gradient angle, and font family on INPUT/CHECKBOX labels. Phase 6 (design
system: Color & Text Styles) is done too — see its own section above;
open items there are Variables, Effect styles, multi-node style apply,
and reading back existing style names from a file. Phase 7 (Asphalt
design-system study applied to `_FIGMA_DESIGN_SYSTEM_GUIDE`) is done too —
see its own section above. Phase 8 (line-height control) is done too — see
its own section above. Phase 9 (bold-carryover fix + TEXT wrap) is done
too — see its own section above. Phase 10 (live contrast-checker
automation) is done too — see its own section above; open items there
(batch-check, gradient/image fill contrast, AAA standard) are not started.
