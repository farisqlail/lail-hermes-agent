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
selector was tried and reverted (see `_lock_grid_height`'s own docstring)
after a subsequent run showed 2 missing elements — though that run was in
a test file so cluttered with ~13 leftover frames from repeated live
verification that Figma's own row-selection reliability is itself in
question there, so it's not proven the revert was the actual fix rather
than coincidence. **Run-to-run reliability beyond the one clean 6/6 result
is not proven** — later verification attempts, in an increasingly
cluttered shared test file (hit Figma's own "too many new files" rate
limit, blocking a from-scratch clean re-test), showed intermittent missing
elements (a root-level sibling, a grid child) that may be a real residual
bug or may be that file's own clutter confusing `_current_row_selector`'s
active-row detection — undetermined. Next session should re-verify with a
fresh file once the rate limit clears before trusting this beyond the
narrow case already confirmed.

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
property other than a photo (color, text, size, ...), and multi-frame
self-check (`figma_web_design_flow` doesn't get the Step 1 treatment yet
— comparing a multi-frame screenshot against a multi-part request is a
different, untested prompt shape). Both are natural next slices if a
broader delta-edit tool is wanted later, now that the harder groundwork
(real file URL, rename-and-refind, collapsed-tree handling) is proven.

Files touched (Step 1): `hermes/chat_engine.py` (`_FIGMA_DESIGN_SYSTEM_GUIDE`,
tool description), `hermes/main.py` (`_figma_selfcheck_message`, wired into
both `chat()` and `stream()` tool-call rounds). Files touched (Step 2):
`hermes/figma_browser.py` (`_rename_layer`, `_add_shape`'s `rename` param,
`_place_items`'s `photo_registry` threading, `_build_frame_via_ui`'s
`photo_nodes` result, `design_figma_frame_web`/`design_multi_frame_web`'s
`file_url` result, new `fix_figma_photo`), `hermes/chat_engine.py` (new
`figma_web_fix_photo` tool schema + dispatch), `hermes/main.py`
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
mechanism live-verified, run-to-run reliability not fully proven — see its
own section above) → Phase 3 Step 1 (done) → Phase 4 (done) → Phase 3 Step
2 (done, narrow: photo-only fix). Each phase is independently shippable and
testable — no phase blocks starting the next except in the order listed
(fidelity before layout before self-check, since self-check's comparisons
are only useful once the builder can actually hit what a mockup asks for).
Remaining open items: **a from-scratch clean-file re-verification of Grid**
(blocked on Figma's own "too many new files" rate limit as of this
writing — the shared test file used for the last few verification rounds
had accumulated ~13 leftover frames, muddying whether the last two
"missing element" observations were a real residual bug or that file's own
clutter), the Grid height-keeps-growing cosmetic residual (own section
above), Phase 3 Step 2 broadened to other properties (color, text, size)
if wanted, multi-frame self-check for `figma_web_design_flow`, the
ROW-of-cards-of-STACKs-inside-another-composite depth beyond what's been
live-tested, and the undersized-container residual noted in Phase 2.
