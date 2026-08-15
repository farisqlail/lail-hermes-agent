"""Figma Web Browser Automation Engine for Hermes Agent.

Drives Figma Web (https://www.figma.com/design/...) directly in Playwright Chromium
by operating the real editor UI (draw tools + the right-hand properties panel) —
not `window.figma`, which is the Plugin API and is never exposed to a page script
on the live site. Frame/rectangle/ellipse/text are created with tool shortcuts and
mouse drags, then sized/colored precisely through the panel's real DOM inputs.
Nesting relies on Figma's own Auto Layout (Shift+A) to stack children, so this
code never has to compute on-canvas pixel positions.
"""
from __future__ import annotations
import asyncio
import logging
import re
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import paths

UNSPLASH_API_URL = "https://api.unsplash.com/photos/random"

logger = logging.getLogger(__name__)


def _looks_logged_in(url: str) -> bool:
    u = (url or "").lower()
    return "figma.com" in u and "login" not in u and "accounts.google.com" not in u


# --- Real Figma Web UI automation primitives ---------------------------------
# The properties panel's scrubbable numeric fields (W/H/corner-radius/padding/gap)
# are <input> tags wrapped in a <label data-onboarding-key="scrubbable-control-*">
# — that key is stable across sessions, unlike the panel's obfuscated CSS classes.

async def _canvas_center(page) -> tuple[float, float]:
    box = await page.locator("canvas").first.bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


async def _set_number(page, onboarding_key: str, value: float, last: bool = False) -> None:
    """`last=True`: some onboarding-keys are NOT unique to one control — e.g.
    `scrubbable-control-opacity` matches the layer's own Appearance opacity,
    its Fill's opacity, AND (once a shadow effect is added) the shadow's own
    opacity, 3 elements sharing one key, `.first` always grabbing the
    layer's — confirmed live: editing a shadow's opacity via `.first`
    silently set the whole LAYER's opacity instead, making it nearly
    invisible. `.last` is the shadow's own field, added latest to the DOM.
    Every other onboarding-key used in this file is confirmed unique
    (count()==1) even with an effect open — this only matters for opacity.
    """
    base = page.locator(f'[data-onboarding-key="{onboarding_key}"] input')
    loc = base.last if last else base.first
    await loc.click(timeout=8000)
    await page.keyboard.press("Control+A")
    await loc.type(str(round(value)))
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(150)


async def _set_position(page, x: float, y: float) -> None:
    """Set the currently-selected top-level node's absolute page position.

    The Position panel's X/Y fields share ONE `data-onboarding-key`
    ("properties-panel") with several unrelated fields (rotation, etc.) —
    `_set_number`'s key-based lookup can't disambiguate them, so this uses
    their own `aria-label` ("X-position"/"Y-position") instead. Live-
    confirmed this actually repositions the node (not just cosmetic) — used
    to lay out multiple root frames as page siblings without needing to
    read back an on-screen pixel edge (see `design_multi_frame_web`).
    """
    x_field = page.locator('input[aria-label="X-position"]')
    await x_field.click(timeout=8000)
    await page.keyboard.press("Control+A")
    await x_field.type(str(round(x)))
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(150)
    y_field = page.locator('input[aria-label="Y-position"]')
    await y_field.click(timeout=8000)
    await page.keyboard.press("Control+A")
    await y_field.type(str(round(y)))
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(150)


async def _lock_fixed_size(page, width: float, height: float) -> None:
    """Force an auto-layout frame's own sizing back to Fixed.

    `Shift+A` resets BOTH axes of a frame to "Hug contents" the moment it
    has (or gains) at least one child — the numeric field at
    `scrubbable-control-width/height` disappears entirely, replaced by a
    "Horizontal/Vertical resizing" combobox showing "Hug". This applies to
    the ROOT frame too, not just nested composites: an empty root shows
    plain Width/Height fields, but once its first child lands, it can
    silently collapse to hug that one child (e.g. 300x300 shrinking to
    86x63) — every later top-level item then gets drawn relative to a
    tiny, wrong-sized frame and ends up outside it entirely.

    Typing a value into the "resizing" combobox switches the mode to Fixed
    and restores real dimensions. Without this, a Hug frame shrinks to
    exactly its content's bounding box — leaving zero slack to click "past"
    existing children when appending a second, third, etc. (the click lands
    ON the last child instead, nesting the next item inside it, or in the
    root's case, drawing the next item as a stray new top-level frame).

    A frame that's already in Fixed/Dimensions mode has no such combobox at
    all (`count() == 0`) — nothing to do there, so this is safe to call
    unconditionally after every `_apply_auto_layout`.
    """
    for label, value in (("Horizontal resizing", width), ("Vertical resizing", height)):
        combo = page.get_by_role("combobox", name=label)
        if await combo.count() == 0:
            continue
        await combo.click(timeout=8000)
        await page.wait_for_timeout(100)
        await page.keyboard.press("Control+A")
        await combo.type(str(round(value)))
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(150)


async def _set_fill_hex(page, hex_color: str | None) -> None:
    """Set the selected node's solid fill. Adds a fill first if it has none —
    new frames are created with an empty fill list (invisible), and a shape
    with no fill can't be clicked into (clicks hit-test through it to
    whatever's behind), which breaks nesting children into it later.
    """
    color = (hex_color or "#FFFFFF").lstrip("#").upper() or "FFFFFF"
    color_input = page.locator('input[aria-label="Color"]').first
    if await color_input.count() == 0:
        add_fill = page.get_by_role("button", name="Add fill")
        if await add_fill.count() > 0:
            await add_fill.click()
            await page.wait_for_timeout(200)
    await color_input.click(timeout=8000)
    await page.keyboard.press("Control+A")
    await color_input.type(color)
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(150)


async def _draw(page, tool_key: str, cx: float, cy: float, w: float = 40, h: float = 30) -> None:
    """Select a tool and drag a small box centered at (cx, cy).

    The exact drawn size doesn't matter — callers correct it via _set_number
    right after. What matters is the box lands inside the parent frame's
    visible on-screen area so Figma auto-parents the new shape into it.
    """
    await page.keyboard.press(tool_key)
    # The frame tool (at least) pops up a "Dimension Presets" side panel on
    # select; a drag started before it settles doesn't register at all.
    await page.wait_for_timeout(300)
    await page.mouse.move(cx - w / 2, cy - h / 2)
    await page.mouse.down()
    await page.mouse.move(cx + w / 2, cy + h / 2, steps=10)
    await page.mouse.up()
    await page.wait_for_timeout(350)


async def _zoom_to_selection(page, horizontal_bias: float = 0.5, vertical_bias: float = 0.5) -> tuple[float, float]:
    """Shift+2 (not Shift+1, which zooms to fit the whole page) centers and
    scales the view on whatever is currently selected. Since the canvas
    element's own screen rect never moves, a point at (`horizontal_bias`,
    `vertical_bias`) across that fixed rect always lands inside the selected
    node afterward — a reliable click target without ever computing
    on-canvas pixel math.

    Default (0.5, 0.5) — dead center — is fine for small, mostly-empty
    composites. For a container accumulating stacked children, the click
    point needs to stay past all existing content along the stack's growth
    axis, or Figma inserts the next item mid-stack instead of appending it:
    a vertical stack needs the bias pushed toward the bottom (high
    `vertical_bias`), a horizontal one (e.g. a ROW) toward the right (high
    `horizontal_bias`).

    This function's own opening claim is not quite true: "zoom to fit" does
    NOT fill the canvas element edge-to-edge — it leaves a margin around the
    fitted node, confirmed live: a 472px-tall STACK zoomed to only ~757 of
    the viewport's 900px height, not 900. A bias too close to 1.0 can miss
    that margin and land just past the node's real rendered edge — the
    click then hits the raw page behind it instead of the frame, and Figma
    creates the new element as a stray top-level object instead of nesting
    it (with no error — this fails silently). Confirmed live: an 812-tall
    ROOT frame (already filling most of the 900px viewport, so a small
    margin either way) tolerated 0.85 fine, but a smaller nested STACK did
    not; 0.7 was safe there.

    But a HIGH bias is also a hard *lower* bound, for the opposite reason:
    it needs to land past whatever's already been placed, and a fixed
    fraction can't track that — a STACK accumulating children fills a
    growing share of its own height as more get added. Confirmed live: by
    the 6th child in a 472-tall STACK (avatar+heading+subtitle+2 inputs
    already using ~340px, 72% of the height), a 0.7 bias (330px) landed
    BEFORE that used content instead of past it, nesting the next child
    INSIDE the previous one's frame instead of appending it as a sibling —
    and even 0.78 (tried next) only pushed the failure further out, not
    away, for an 8-child STACK.

    These two constraints (margin ceiling, content-fill floor) can close
    entirely for a dense-enough composite — no SINGLE fixed fraction is
    safe across a container's whole fill. `_place_items` no longer tries:
    it tracks actual used space via `_item_size`'s per-type extent estimate
    and computes each item's bias fresh with `_append_bias`, clamped to
    [`_MIN_APPEND_BIAS`, `_MAX_APPEND_BIAS`] (0.5–0.8) rather than trusting
    one constant. This function's own `horizontal_bias`/`vertical_bias`
    params stay dumb on purpose — `_append_bias` is the one place that
    understands fill; everything else just asks for a point.
    """
    await page.keyboard.press("Shift+2")
    await page.wait_for_timeout(450)
    box = await page.locator("canvas").first.bounding_box()
    return box["x"] + box["width"] * horizontal_bias, box["y"] + box["height"] * vertical_bias


async def _apply_auto_layout(
    page, direction: str, pad_lr: float, pad_tb: float, gap: float, centered: bool,
    align_start: bool = False,
) -> None:
    await page.keyboard.press("Shift+A")
    await page.wait_for_timeout(350)
    # Shift+A's own default direction isn't reliably "Vertical" — it follows
    # the drawn frame's aspect ratio (a wider-than-tall frame, e.g. a STACK
    # sized 327x300, can land on Horizontal by default). Relying on that
    # default meant a VERTICAL composite whose w/h happened to come out wider
    # than tall would apply auto-layout in the wrong axis, then hang forever
    # on `_set_number` looking for a "vertical-gap" field that doesn't exist
    # in Horizontal mode. Click the matching radio explicitly either way.
    radio = page.get_by_role("radio", name="Horizontal" if direction == "HORIZONTAL" else "Vertical")
    if await radio.count():
        await radio.click()
        await page.wait_for_timeout(200)
    await _set_number(page, "scrubbable-control-horizontal-padding", pad_lr)
    await _set_number(page, "scrubbable-control-vertical-padding", pad_tb)
    gap_key = (
        "scrubbable-control-horizontal-gap between objects"
        if direction == "HORIZONTAL"
        else "scrubbable-control-vertical-gap between objects"
    )
    await _set_number(page, gap_key, gap)
    if centered:
        # Figma's alignment control is a single 3x3 grid combining BOTH the
        # growth-axis packing and the cross-axis alignment in one click (9
        # literal positions: "Align top left" .. "Align bottom right") --
        # not two independent controls. The dead-center cell ("Align
        # center") packs children from the CONTAINER's center on the
        # GROWTH axis too, not just the cross axis.
        #
        # That's exactly right for a composite that places ONE thing meant
        # to look centered as a block (a BUTTON/INPUT label, sized to the
        # full box width) -- `align_start` stays False for those, same
        # "Align center" as always.
        #
        # But it corrupts append-one-child-at-a-time construction (ROW/
        # STACK, via `_place_items`'s `_append_bias` machinery): with only
        # 1 of N siblings placed, that lone child renders centered in the
        # whole (eventually-larger) container instead of flush against the
        # start edge, so `_append_bias`'s click point (which assumes
        # content starts at padding=0 and grows outward) lands on top of
        # or past existing content unpredictably. Confirmed live: a ROW's
        # first of 2 STACK cards rendered centered in the full row width,
        # so the 2nd card's start-relative click landed INSIDE card 1
        # instead of beside it (nested instead of sibling). `align_start`
        # picks the grid cell that packs the GROWTH axis at its start edge
        # and only centers the CROSS axis instead -- "Align left" for a
        # HORIZONTAL row (packs left-to-right, vertically centered),
        # "Align top center" for a VERTICAL stack (packs top-to-bottom,
        # horizontally centered). Callers pass `align_start=True` only for
        # ROW/STACK's own composite (see `_place_items`) -- BUTTON/INPUT/
        # CHECKBOX keep true centering, confirmed live that `align_start`
        # there mis-packs a button/input label flush-left instead of
        # centered in the box.
        align_name = (
            ("Align left" if direction == "HORIZONTAL" else "Align top center")
            if align_start else "Align center"
        )
        radio = page.get_by_role("radio", name=align_name, exact=True)
        if await radio.count():
            await radio.click()
            await page.wait_for_timeout(150)


async def _set_bold(page) -> None:
    combo = page.get_by_role("combobox", name="Font style")
    await combo.click()
    await page.wait_for_timeout(300)
    await page.get_by_role("option", name="Bold", exact=True).click()
    await page.wait_for_timeout(200)
    # Belt and suspenders: force the dropdown closed and focus off it. Left
    # open (or focus stuck in it), the NEXT item's tool-shortcut keypresses
    # ('t', 'f') can land in this combobox instead of the canvas, silently
    # corrupting everything placed after a bold text item.
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(200)


async def _set_stroke(page, hex_color: str, weight: float | None = None) -> None:
    """Add (or update) a solid stroke on the currently-selected node.

    The Stroke section's own "Color" combobox is a second match for the
    same selector Fill uses — `.nth(1)` picks it, valid only right after
    "Add stroke" has created that section (so Fill's row is always first).
    """
    add_stroke = page.get_by_role("button", name="Add stroke")
    if await add_stroke.count() > 0:
        await add_stroke.click()
        await page.wait_for_timeout(300)
    color_input = page.locator('input[aria-label="Color"]').nth(1)
    await color_input.click(timeout=8000)
    await page.keyboard.press("Control+A")
    await color_input.type((hex_color or "000000").lstrip("#").upper())
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(150)
    if weight:
        weight_field = page.get_by_role("textbox", name="Stroke weight")
        await weight_field.click()
        await page.keyboard.press("Control+A")
        await weight_field.type(str(weight))
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(150)


# Elevation tiers, not just an on/off shadow — a resting card and a
# floating modal/dropdown read as different depth in any real design system,
# and Figma's own default (Y4/Blur4/25%) is one fixed point, not a scale.
# Live-confirmed selectors (`scrubbable-control-position-y`, `-blur-radius`,
# `-spread`, `-opacity`) come from the flyout that auto-opens right after
# picking "Drop shadow" from the Effects "Add effect" menu — same
# `[data-onboarding-key=...] input` pattern `_set_number` already uses for
# every other numeric field, so no new interaction primitive was needed,
# just the field names.
_SHADOW_ELEVATIONS = {
    # (Y offset, blur radius, spread, opacity%) — soft, low-contrast: a card
    # resting flush on its own background (the common case: list rows,
    # product cards, most "this is a card" signals).
    "subtle": (2, 8, 0, 8),
    # A card that's meant to stand out from busy/colored content behind it,
    # or a dropdown/popover — noticeably more separated than "subtle".
    "medium": (8, 20, 0, 14),
    # Reserve for the ONE most-elevated thing on a screen (a modal, an FAB) —
    # a negative spread keeps the shadow from bleeding past rounded corners
    # at this size.
    "strong": (16, 32, -2, 20),
}


async def _add_shadow(page, elevation: str = "subtle") -> None:
    await page.get_by_role("button", name="Add effect").click()
    await page.wait_for_timeout(300)
    await page.get_by_text("Drop shadow", exact=True).click()
    await page.wait_for_timeout(300)
    y, blur, spread, opacity = _SHADOW_ELEVATIONS.get(elevation, _SHADOW_ELEVATIONS["subtle"])
    await _set_number(page, "scrubbable-control-position-y", y)
    await _set_number(page, "scrubbable-control-blur-radius", blur)
    if spread:
        await _set_number(page, "scrubbable-control-spread", spread)
    await _set_number(page, "scrubbable-control-opacity", opacity, last=True)
    # Deliberately NO trailing Escape here, unlike `_set_fill_hex`/
    # `_set_stroke`'s callers. `_add_shadow` is called from BOTH `_add_shape`
    # (a leaf — safe to deselect, its own trailing Escape already covers
    # this) AND `_add_composite`, which calls this BEFORE its own required
    # `_zoom_to_selection(page)` — that needs the just-built composite to
    # STILL be the current selection. Escape here risked deselecting it
    # first, confirmed live: a STACK's 2nd+ child escaped to the page root
    # every time the STACK itself had `shadow=True` — exactly the mistake
    # `_set_fill_hex` avoided (see its own comment) but this one repeated.


async def _add_text(
    page, cx: float, cy: float, content: str,
    font_size: float | None = None, color: str | None = None, bold: bool = False,
) -> None:
    await page.keyboard.press("t")
    await page.wait_for_timeout(150)
    await page.mouse.click(cx, cy)
    await page.wait_for_timeout(250)
    await page.keyboard.type(content or "")
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(300)
    if font_size:
        size_field = page.get_by_role("combobox", name=re.compile("Font size"))
        if await size_field.count():
            await size_field.first.click()
            await page.keyboard.press("Control+A")
            await size_field.first.type(str(int(font_size)))
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(150)
    if color:
        await _set_fill_hex(page, color)
    if bold:
        await _set_bold(page)
    # `_set_fill_hex`'s Enter commits the hex value but does not close the
    # color-picker popover it opened (unlike `_set_bold`, which already
    # presses Escape for the same reason). Left open, the NEXT item's
    # tool-shortcut keypress ('t' for TEXT, 'f' for a shape/composite) can
    # land in that popover instead of arming a canvas tool — so the next
    # element is never drawn, and whatever gets typed lands on the stale
    # selection instead. A plain (non-bold) TEXT item with a `color` is
    # exactly that case, and it's the common one — most text sets a color.
    # Safe to do unconditionally here (not inside `_set_fill_hex` itself):
    # `_add_shape`/`_add_composite` callers already re-select their own
    # parent explicitly afterward rather than relying on this node staying
    # selected, but `_add_composite` uses `_set_fill_hex` INTERNALLY and
    # then immediately zooms to what MUST still be the current selection —
    # closing the popover there instead would deselect the very composite
    # being built.
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(150)


async def _add_shape(
    page, tool_key: str, cx: float, cy: float, w: float, h: float,
    color: str | None = None, corner_radius: float | None = None,
    border_color: str | None = None, border_width: float | None = None,
    shadow: bool = False, elevation: str = "subtle",
    rename: str | None = None,
) -> None:
    await _draw(page, tool_key, cx, cy)
    await _set_number(page, "scrubbable-control-width", w)
    await _set_number(page, "scrubbable-control-height", h)
    if corner_radius:
        await _set_number(page, "scrubbable-control-corner-radius", corner_radius)
    if color:
        await _set_fill_hex(page, color)
    if border_color:
        await _set_stroke(page, border_color, border_width)
    if shadow:
        await _add_shadow(page, elevation)
    if rename:
        # Must happen before the trailing Escape below — that deselects the
        # shape, and `_rename_layer` needs it to still be the live
        # selection (see its own docstring for why a stable name matters).
        await _rename_layer(page, rename)
    # Same hazard as `_add_text`'s trailing Escape: `_set_stroke`'s stroke-
    # weight textbox (and `_set_fill_hex`'s color popover) don't reliably
    # release focus on their own after Enter. Left stuck, the NEXT item's
    # tool-shortcut keypress can land there instead of the canvas — safe to
    # force here unconditionally because `_add_shape` is only ever called
    # for a LEAF shape, whose caller (`_place_items`) always re-selects the
    # parent explicitly afterward rather than relying on this node staying
    # selected (unlike `_add_composite`, which needs its own selection
    # intact for the `_zoom_to_selection` right after it sets these same
    # properties).
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(150)


# See `_zoom_to_selection`'s docstring: a single fixed click-bias fraction
# can't be safe for both an empty container (needs a LOW bias) and a nearly-
# full one (needs a HIGH bias, close to its real edge) at the same time.
# These bound the dynamic bias `_place_items` computes per item instead of
# trusting one constant throughout a whole composite's fill.
#
# The floor is deliberately low, NOT 0.5 (a first cut at this used 0.5,
# reasoning it should match `_add_composite`'s own safe (0.5, 0.5) zoom for
# entering a brand-new composite — wrong: that's a one-time "first item"
# case, unrelated to this per-item running fraction). `used` grows
# monotonically as items are placed, so the raw fraction (start_padding +
# used) / parent_extent ALREADY increases correctly on its own; clamping it
# UP to 0.5 for every item whose true fraction is still below that undid
# the whole point — confirmed live: it collapsed 2-3 early items onto the
# SAME click point (all floored to 0.5 alike), and Figma's click-to-insert
# picks a tree position by proximity to existing siblings, not always "at
# the end" — so those items landed out of order (a heading created 2nd
# ended up rendered 5th). 0.15 only guards the truly degenerate case (a
# fraction near/at 0, which would click right at the frame's top padding
# edge) without flattening the natural progression for every early item.
_MIN_APPEND_BIAS = 0.15
_MAX_APPEND_BIAS = 0.8


def _text_extent(item: dict, available_w: float) -> float:
    """Rough estimate of a TEXT/FOOTER_LINK node's rendered HEIGHT once
    wrapped to `available_w`. There's no real layout engine here — Figma's
    actual line-wrapping isn't queryable without reading the node back —
    so this is a deliberately crude character-count wrap estimate. It only
    needs to be in the right ballpark: it feeds `_place_items`'s running
    `used` tally, which itself only sets a *bias fraction* clamped to a
    safe range, not an exact pixel target — but it needs to err on the
    generous side, not just "average", since UNDERestimating shrinks the
    margin `_append_bias` tries to keep and can put the NEXT item's click
    ambiguously close to this one. Confirmed live: 1.35x line-height
    (roughly right for body copy) underestimated a bold 28px heading enough
    that the following item's click landed on top of it, merging their
    text into one node instead of creating two. 1.6x has more headroom.
    """
    font_size = float(item.get("fontSize") or 16)
    content = str(item.get("content") or item.get("text") or "")
    if not content:
        return font_size * 1.6
    avg_char_w = font_size * 0.55
    chars_per_line = max(int(available_w / avg_char_w), 1) if available_w else len(content)
    lines = max(1, -(-len(content) // chars_per_line))  # ceil division
    return font_size * 1.6 * lines


def _item_size(
    item: dict, itype: str, content_w: float, box_size: tuple[float, float] | None = None,
) -> tuple[float, float]:
    """(width, height) Figma will actually draw this item at — mirrors the
    same defaults each `_place_items` branch below applies, kept alongside
    them so the running `used` tally (see `_place_items`) stays consistent
    with what's really on screen. `box_size` is the `(box_w, box_h)` a
    ROW/STACK branch already computed for itself — not worth re-deriving.
    """
    if itype in ("TEXT", "FOOTER_LINK"):
        font_size = float(item.get("fontSize") or 16)
        content = str(item.get("content") or item.get("text") or "")
        w = min(len(content) * font_size * 0.55, content_w) if content else font_size
        return w, _text_extent(item, content_w)
    if itype in ("HEADER_IMAGE", "HEADER"):
        return float(item.get("width") or content_w), float(item.get("height") or 220)
    if itype in ("AVATAR", "ELLIPSE", "CIRCLE"):
        size = float(item.get("size") or item.get("width") or 56)
        return size, size
    if itype in ("INPUT", "BUTTON"):
        return float(item.get("width") or content_w), float(item.get("height") or 50)
    if itype == "CHECKBOX":
        return float(item.get("width") or content_w), float(item.get("height") or 28)
    if itype in ("ROW", "STACK"):
        if box_size is not None:
            return box_size
        return float(item.get("width") or content_w), float(item.get("height") or 140)
    return float(item.get("width") or 100), float(item.get("height") or 40)


# The Playwright browser here always runs at a fixed 1440x900 viewport (see
# every `launch_kwargs` in this file) — the canvas element's own box has
# been exactly {x:290, y:0, w:909, h:900} across every live test this
# session, so hardcoding it is safe as long as that viewport size holds.
_CANVAS_W = 909.0
_CANVAS_H = 900.0


def _append_bias(
    used: float, start_padding: float, parent_extent: float | None,
    cross_extent: float | None = None, horizontal: bool = False,
) -> float:
    """Fraction of the parent's growth-axis extent to click at for the NEXT
    item, given `used` px already filled by prior siblings (plus their
    gaps) and `start_padding` px consumed before the first one.

    Deliberately does NOT click right at the `used` line itself — first cut
    at this did, and it scrambled insertion order across 5+ items live: a
    small underestimate in `_item_size`'s height guess (it's a heuristic,
    not real layout) puts the click ambiguously close to the last-placed
    sibling, and Figma's click-to-insert then sometimes places the new item
    BEFORE that sibling instead of after — no error, just wrong order.
    Instead this aims for the MIDPOINT between the used line and the safe
    ceiling: a comfortable, unambiguous margin past existing content that
    still narrows (never fully closes) as the container fills, and stays
    strictly increasing in `used` — so insertion order is preserved by
    construction, not just by hoping the estimate was close enough.

    `cross_extent` (the parent's OTHER dimension — width, for a vertical
    growth axis) is needed for a second correction: `_zoom_to_selection`'s
    whole premise is a fraction of CANVAS extent lands at the same fraction
    of the NODE's extent — true only when the node, zoomed to fit, actually
    occupies close to the full canvas along that axis. A short-but-wide
    composite (confirmed live: a 327x100 stat card) hits its zoom scale
    from the WIDTH constraint, not height — it only occupied ~30% of the
    canvas's height once fit, not ~85% like a near-viewport-filling ROOT
    or STACK. A bias meant for "85% down a mostly-filled canvas" then
    landed far below the node's actual (small, centered) on-screen box.
    Recomputing the zoom-to-fit scale and remapping the bias into the
    band the node actually occupies (zoom-to-fit centers its result) fixes
    this without needing to observe the real render.
    """
    if not parent_extent:
        return 0.7  # unsized parent shouldn't normally happen; a safe mid-range fallback
    used_frac = min((start_padding + used) / parent_extent, _MAX_APPEND_BIAS)
    target = used_frac + (_MAX_APPEND_BIAS - used_frac) * 0.5
    target = max(_MIN_APPEND_BIAS, min(_MAX_APPEND_BIAS, target))
    if cross_extent:
        canvas_growth = _CANVAS_W if horizontal else _CANVAS_H
        canvas_cross = _CANVAS_H if horizontal else _CANVAS_W
        scale = min(canvas_cross / cross_extent, canvas_growth / parent_extent)
        # The 0.85 factor: pure geometric fit (scale * extent / canvas)
        # over-predicts how much of the canvas a fitted node occupies —
        # Figma's "zoom to fit" reserves its own margin beyond the math,
        # confirmed live: a 472-tall STACK (this formula's pure math says
        # it should fill ~100% of the canvas height) actually measured at
        # ~84%. 0.85 matches that without a second free parameter.
        occupied_frac = min((parent_extent * scale * 0.85) / canvas_growth, 1.0)
        target = 0.5 - occupied_frac / 2 + target * occupied_frac
    return target


async def _fetch_stock_photo(query: str, api_key: str, orientation: str = "landscape") -> bytes | None:
    """Fetch a real photo's bytes from Unsplash for the given search query.

    Returns None (never raises) on any failure — missing/invalid key, no
    results, network error — so the caller's colored-rectangle placeholder
    is always a safe fallback rather than the whole design build aborting
    over one missing photo.
    """
    if not api_key or not query:
        return None
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                UNSPLASH_API_URL,
                params={"query": query, "orientation": orientation, "content_filter": "high"},
                headers={"Authorization": f"Client-ID {api_key}"},
            )
            resp.raise_for_status()
            photo_url = resp.json()["urls"]["regular"]
            img_resp = await client.get(photo_url)
            img_resp.raise_for_status()
            return img_resp.content
    except Exception:
        logger.exception("Failed to fetch Unsplash photo for query %r", query)
        return None


async def _place_image_fill(page, cx: float, cy: float, photo_bytes: bytes) -> bool:
    """Replace the shape at (cx, cy) with a real photo fill.

    Ctrl+Shift+K ("Place image") attaches an image to the cursor for manual
    placement; clicking directly on an EXISTING shape while in that mode
    replaces that shape's fill with the photo (same node, same position and
    size) rather than creating a new separate image layer — exactly what's
    needed to turn an already-sized-and-positioned placeholder rectangle
    into a real photo without touching layout.
    """
    try:
        async with page.expect_file_chooser(timeout=6000) as fc_waiter:
            await page.keyboard.press("Control+Shift+K")
        fc = await fc_waiter.value
        await fc.set_files({"name": "photo.jpg", "mimeType": "image/jpeg", "buffer": photo_bytes})
        await page.wait_for_timeout(800)
        await page.mouse.click(cx, cy)
        await page.wait_for_timeout(500)
        return True
    except Exception:
        logger.exception("Failed to place stock photo onto shape")
        await page.keyboard.press("Escape")
        return False


async def _add_composite(
    page, cx: float, cy: float, w: float, h: float,
    color: str, direction: str, gap: float, padding: float,
    fill_children: Callable[[float, float], Awaitable[None]],
    corner_radius: float | None = None,
    border_color: str | None = None, border_width: float | None = None,
    shadow: bool = False, elevation: str = "subtle",
    align_start: bool = False,
) -> None:
    """Create a nested auto-layout sub-frame (button/input/checkbox row) and
    fill it via `fill_children(inner_cx, inner_cy)`. Always sets a real fill
    (even if just white) since an empty-fill frame can't be clicked into.

    `align_start`: True only for a ROW/STACK's own composite (see
    `_apply_auto_layout`'s docstring) -- every other caller (BUTTON, INPUT,
    CHECKBOX) wants its single/paired child block visually centered, not
    packed from the start edge.
    """
    await _draw(page, "f", cx, cy)
    await _set_number(page, "scrubbable-control-width", w)
    await _set_number(page, "scrubbable-control-height", h)
    if corner_radius:
        await _set_number(page, "scrubbable-control-corner-radius", corner_radius)
    await _apply_auto_layout(page, direction, padding, padding, gap, centered=True, align_start=align_start)
    await _lock_fixed_size(page, w, h)
    await _set_fill_hex(page, color)
    if border_color:
        await _set_stroke(page, border_color, border_width)
    if shadow:
        await _add_shadow(page, elevation)
    inner_cx, inner_cy = await _zoom_to_selection(page)
    await fill_children(inner_cx, inner_cy)


async def _current_row_selector(page) -> str:
    """Stable data-testid selector for whichever Layers panel row is
    currently selected.

    `data-fpl-tree-active="true"` marks the live selection, but that
    attribute moves as soon as selection changes — it can't be reused later.
    Resolving it once to the row's own data-testid (which encodes Figma's
    internal node id and never changes) gives a selector that still finds
    the same node after selection has long since moved elsewhere.
    """
    row = page.locator('[data-fpl-tree-active="true"] [data-testid$="-layers-panel-row"]').first
    testid = await row.get_attribute("data-testid")
    return f'[data-testid="{testid}"]'


async def _rename_layer(page, name: str) -> None:
    """Rename the currently-selected node's Layers-panel row.

    Double-click arms the row's inline rename input (same interaction as a
    human renaming a layer). Live-confirmed the new name persists across a
    full page reload in a FRESH browser session/profile-reuse — this is
    what makes `fix_figma_photo` possible: a node renamed to something
    predictable (`hermes:photo:{index}:{kind}`) at build time can be found
    again later by a plain `page.get_by_text(name, exact=True)`, with no
    live selector carried over from the original session.
    """
    # Resolve the OUTER row (stable testid) via `_current_row_selector`
    # rather than double-clicking `[data-fpl-tree-active="true"]` directly
    # — that attribute lives on an INNER gridcell div, one level down from
    # the actual row; double-clicking it worked for a root-level frame but
    # not reliably for a freshly-drawn child shape (confirmed live: it
    # silently missed rename-input mode, and the stray `Control+A` +
    # typed name were then interpreted as canvas shortcuts instead of text
    # — `Control+A` selected everything on the page, and letters in the
    # name matching tool shortcuts, e.g. 'r' for Rectangle, drew a stray
    # extra shape). Double-clicking the outer row (matching the selector
    # this file already uses everywhere else to target a specific row) is
    # the same interaction proven to work for a root-level frame.
    row = page.locator(await _current_row_selector(page))
    await row.dblclick(force=True)
    await page.wait_for_timeout(250)
    await page.keyboard.press("Control+A")
    await page.keyboard.type(name)
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(200)


async def _return_to_parent(
    page, parent_row_selector: str, direction: str = "VERTICAL", bias: float = 0.7,
) -> tuple[float, float]:
    """Reselect a parent frame and re-zoom to it, restoring a valid click
    point for its remaining children.

    Escape does NOT climb to the parent in Figma — it just deselects — so
    after finishing a nested composite's children, the only reliable way
    back is clicking the parent's own row in the Layers panel, by its
    exact captured data-testid (not "the first row" — that only means the
    root; a ROW's own children need to return to the ROW, not the root).

    `direction` must match the PARENT's own stacking axis (not the child
    that was just finished) — a HORIZONTAL parent (a ROW) needs the click
    point biased right, past its existing children; a VERTICAL one biased
    down. Getting this wrong doesn't error, it silently inserts the next
    item mid-stack (or drops it outside the parent entirely).

    `bias` should be `_append_bias`'s output (how full the parent already
    is), not a blind constant — see that function and `_zoom_to_selection`'s
    docstring for why a single fixed fraction isn't safe across a
    composite's whole fill. The default here is only a fallback for the
    rare direct caller that doesn't track fill.
    """
    # `force=True`: the Layers panel reveals a lock/visibility toggle
    # checkbox on row hover, positioned over part of the row — for a deeply
    # indented row (a ROW nested inside a STACK inside the root), Playwright's
    # actionability check treats that hover-revealed checkbox as "obscuring"
    # the row and retries the click for its full timeout instead of ever
    # landing (confirmed live: a footer ROW 3 levels deep hung the full 30s
    # here before failing). The checkbox intercepting the click is a hover
    # artifact of Playwright's own pointer, not a real interaction hazard —
    # forcing the click (skip the actionability/visibility check, dispatch
    # directly) selects the row exactly as a real click would.
    await page.locator(parent_row_selector).click(force=True)
    await page.wait_for_timeout(150)
    if direction == "HORIZONTAL":
        return await _zoom_to_selection(page, horizontal_bias=bias)
    return await _zoom_to_selection(page, vertical_bias=bias)


async def _place_items(
    page, cx: float, cy: float, items: list[dict], content_w: float, parent_row_selector: str,
    parent_direction: str = "VERTICAL", unsplash_key: str | None = None,
    parent_w: float | None = None, parent_h: float | None = None,
    gap: float = 16.0, start_padding: float = 0.0,
    photo_registry: dict | None = None,
) -> tuple[float, float, int]:
    """Place a list of items into whatever frame is currently selected
    (`parent_row_selector` is that frame's own row, used to return to it
    between composites; `parent_direction` is that frame's OWN stacking
    axis — VERTICAL for a root frame's direct children or a STACK's own
    children, HORIZONTAL for a ROW's own children — so returning to it
    biases the click point along the right axis). Used both for a root
    frame's direct children and — recursively, via the ROW/STACK types —
    for a box's own children, so a BUTTON can nest inside a ROW inside a
    STACK inside the root frame, to whatever depth the caller's schema
    allows.

    `parent_w`/`parent_h` are the parent's own intended fixed size (root's
    `width`/`height`, or a ROW/STACK's own `box_w`/`box_h`) — re-asserted via
    `_lock_fixed_size` after every child, because a parent frame can
    silently flip to "Hug contents" mode the moment it gains its FIRST
    child, not just once up front. Left uncorrected, it then shrinks to
    that one child's bounding box and every later sibling gets drawn
    relative to a tiny, wrong-sized frame — landing outside it entirely.

    `gap`/`start_padding` are the parent's own AutoLayout spacing/padding
    along its growth axis — used only to keep a running `used` tally (see
    below) of how much of the parent is already filled, so each item's
    click-point bias can be computed fresh via `_append_bias` instead of
    reusing one fixed fraction for a container's entire fill (see
    `_zoom_to_selection`'s docstring for why that's unsafe both when the
    container is nearly empty and when it's nearly full).

    `photo_registry` (`{"n": int, "nodes": [...]}`) tracks every HEADER_IMAGE/
    AVATAR node encountered across the WHOLE build (shared by reference
    through every recursive call, not re-created per composite) so
    `_build_frame_via_ui` can report a stable, predictable name
    (`hermes:photo:{n}:{kind}`) for each one in its result — the mechanism
    `fix_figma_photo` (Phase 3 Step 2) needs to reselect a specific node in
    a LATER, separate browser session and fix a missing/wrong photo without
    rebuilding the whole frame. Defaults to a fresh registry when the
    top-level caller doesn't pass one (single-frame builds don't need to
    read it back); recursive calls always pass the same instance along.
    """
    if photo_registry is None:
        photo_registry = {"n": 0, "nodes": []}
    created = 0
    used = 0.0
    parent_extent = parent_w if parent_direction == "HORIZONTAL" else parent_h
    for item in items:
        itype = str(item.get("type") or "").upper()
        try:
            if itype in ("TEXT", "FOOTER_LINK"):
                await _add_text(
                    page, cx, cy, item.get("content") or item.get("text") or "",
                    font_size=item.get("fontSize"), color=item.get("color"),
                    bold=bool(item.get("bold")),
                )
            elif itype in ("HEADER_IMAGE", "HEADER"):
                photo_name = f"hermes:photo:{photo_registry['n']}:header"
                photo_registry["n"] += 1
                await _add_shape(
                    page, "r", cx, cy,
                    item.get("width") or content_w, item.get("height") or 220,
                    color=item.get("color") or "#E2E8F0",
                    corner_radius=item.get("borderRadius"),
                    border_color=item.get("borderColor"), border_width=item.get("borderWidth"),
                    shadow=bool(item.get("shadow")), elevation=item.get("elevation") or "subtle",
                    rename=photo_name,
                )
                photo_query = item.get("photoQuery")
                placed = False
                if photo_query and unsplash_key:
                    photo = await _fetch_stock_photo(photo_query, unsplash_key, orientation="landscape")
                    if photo:
                        placed = await _place_image_fill(page, cx, cy, photo)
                photo_registry["nodes"].append({
                    "node_name": photo_name, "type": "HEADER_IMAGE",
                    "photo_query": photo_query, "photo_placed": placed,
                })
            elif itype in ("AVATAR", "ELLIPSE", "CIRCLE"):
                size = item.get("size") or item.get("width") or 56
                is_avatar = itype == "AVATAR"
                photo_name = f"hermes:photo:{photo_registry['n']}:avatar" if is_avatar else None
                if is_avatar:
                    photo_registry["n"] += 1
                await _add_shape(
                    page, "o", cx, cy, size, size, color=item.get("color") or "#0070F3",
                    border_color=item.get("borderColor"), border_width=item.get("borderWidth"),
                    shadow=bool(item.get("shadow")), elevation=item.get("elevation") or "subtle",
                    rename=photo_name,
                )
                photo_query = item.get("photoQuery")
                placed = False
                if photo_query and unsplash_key:
                    photo = await _fetch_stock_photo(photo_query, unsplash_key, orientation="squarish")
                    if photo:
                        placed = await _place_image_fill(page, cx, cy, photo)
                if is_avatar:
                    photo_registry["nodes"].append({
                        "node_name": photo_name, "type": "AVATAR",
                        "photo_query": photo_query, "photo_placed": placed,
                    })
            elif itype == "INPUT":
                async def _fill_input(icx: float, icy: float, _item=item) -> None:
                    await _add_text(
                        page, icx, icy, _item.get("placeholder") or _item.get("content") or "",
                        font_size=_item.get("fontSize") or 14, color=_item.get("color") or "#94A3B8",
                    )
                await _add_composite(
                    page, cx, cy, item.get("width") or content_w, item.get("height") or 50,
                    color=item.get("backgroundColor") or "#F8FAFC",
                    corner_radius=item.get("borderRadius", 50),
                    # Real inputs almost always have a visible border — default
                    # to a light gray one rather than requiring the model to
                    # ask for what every mockup already implies.
                    border_color=item.get("borderColor") or "#E2E8F0",
                    border_width=item.get("borderWidth"),
                    shadow=bool(item.get("shadow")), elevation=item.get("elevation") or "subtle",
                    direction="HORIZONTAL", gap=8, padding=20, fill_children=_fill_input,
                )
            elif itype == "BUTTON":
                # `backgroundColor`, when present, is unambiguously the button's
                # own fill. `color` is ambiguous — models often use it for the
                # label's text color instead (ignoring `textColor`) once
                # `backgroundColor` is already carrying the fill, so it's read
                # here only as a fallback for BOTH fill and label color.
                fill = item.get("backgroundColor") or item.get("color") or item.get("fill") or "#0070F3"
                label_color = item.get("textColor") or (item.get("color") if item.get("backgroundColor") else None) or "#FFFFFF"

                async def _fill_button(icx: float, icy: float, _item=item, _label_color=label_color) -> None:
                    await _add_text(
                        page, icx, icy, _item.get("text") or _item.get("content") or "Create account",
                        font_size=_item.get("fontSize") or 16, color=_label_color,
                        bold=bool(_item.get("bold")),
                    )
                await _add_composite(
                    page, cx, cy, item.get("width") or content_w, item.get("height") or 50,
                    color=fill, corner_radius=item.get("borderRadius", 50),
                    border_color=item.get("borderColor"), border_width=item.get("borderWidth"),
                    shadow=bool(item.get("shadow")), elevation=item.get("elevation") or "subtle",
                    direction="HORIZONTAL", gap=8, padding=16, fill_children=_fill_button,
                )
            elif itype == "CHECKBOX":
                async def _fill_checkbox(icx: float, icy: float, _item=item) -> None:
                    await _add_shape(page, "r", icx, icy, 20, 20, color="#FFFFFF", corner_radius=4)
                    await _add_text(
                        page, icx, icy, _item.get("content") or _item.get("text") or "Accept Terms and Conditions",
                        font_size=13, color="#475569",
                    )
                await _add_composite(
                    page, cx, cy, item.get("width") or content_w, item.get("height") or 28,
                    color="#FFFFFF", direction="HORIZONTAL", gap=10, padding=0,
                    fill_children=_fill_checkbox,
                )
            elif itype in ("ROW", "STACK"):
                # ROW and STACK share one composite pattern — only the
                # stacking axis and the child default-sizing rule differ.
                # ROW's children sit side by side, so they default to an
                # equal share of the box's inner WIDTH (e.g. 3 buttons
                # evenly spaced). STACK's children sit one above another,
                # so dividing height the same way would make no sense for
                # mixed-height children (icon + title + subtitle) — each
                # instead defaults to the box's full inner width and keeps
                # its own type-specific natural height.
                is_row = itype == "ROW"
                box_direction = "HORIZONTAL" if is_row else "VERTICAL"
                sub_items = item.get("children") or []
                n = max(len(sub_items), 1)
                box_gap = float(item.get("itemSpacing") or 12)
                box_padding = float(item.get("padding") or 0)
                box_w = item.get("width") or content_w
                box_h = item.get("height") or (50 if is_row else 140)
                box_content_w = max(box_w - 2 * box_padding, 20)
                if is_row:
                    default_child_w = max((box_content_w - box_gap * (n - 1)) / n, 20)
                else:
                    default_child_w = box_content_w
                normalized = [{**c, "width": c.get("width") or default_child_w} for c in sub_items]

                async def _fill_box(
                    icx: float, icy: float, _items=normalized, _child_w=default_child_w,
                    _direction=box_direction, _w=box_w, _h=box_h,
                    _gap=box_gap, _pad=box_padding,
                ) -> None:
                    box_selector = await _current_row_selector(page)
                    await _place_items(
                        page, icx, icy, _items, _child_w, box_selector,
                        parent_direction=_direction, unsplash_key=unsplash_key,
                        parent_w=_w, parent_h=_h, gap=_gap, start_padding=_pad,
                        photo_registry=photo_registry,
                    )

                await _add_composite(
                    page, cx, cy, box_w, box_h,
                    color=item.get("backgroundColor") or item.get("color") or "#FFFFFF",
                    corner_radius=item.get("borderRadius"),
                    border_color=item.get("borderColor"), border_width=item.get("borderWidth"),
                    shadow=bool(item.get("shadow")), elevation=item.get("elevation") or "subtle",
                    direction=box_direction, gap=box_gap, padding=box_padding,
                    fill_children=_fill_box, align_start=True,
                )
            else:
                await _add_shape(
                    page, "r", cx, cy, item.get("width") or 100, item.get("height") or 40,
                    color=item.get("backgroundColor") or item.get("color") or item.get("fill"),
                    corner_radius=item.get("borderRadius"),
                    border_color=item.get("borderColor"), border_width=item.get("borderWidth"),
                    shadow=bool(item.get("shadow")), elevation=item.get("elevation") or "subtle",
                )
            created += 1
            item_w, item_h = _item_size(
                item, itype, content_w,
                box_size=(box_w, box_h) if itype in ("ROW", "STACK") else None,
            )
            # +15 flat slack on top of the estimate itself: `_item_size` is a
            # heuristic (exact for fixed-size shapes/composites, a guess for
            # auto-height TEXT), and any underestimate directly shrinks
            # `_append_bias`'s margin — this is cheap insurance against that
            # for every type, not just text.
            used += (item_w if parent_direction == "HORIZONTAL" else item_h) + gap + 15.0
            cross_extent = parent_h if parent_direction == "HORIZONTAL" else parent_w
            bias = _append_bias(used, start_padding, parent_extent,
                               cross_extent=cross_extent, horizontal=(parent_direction == "HORIZONTAL"))
            # Refresh the click point for EVERY item, not just composites —
            # a second plain TEXT reusing a stale point can land on top of
            # the first (Figma then merges the keystrokes into it instead of
            # creating a separate node) once the container has real slack
            # instead of hugging exactly around a single child. `bias` tracks
            # how full the container actually is instead of trusting one
            # fixed fraction for its whole fill — see `_append_bias`.
            cx, cy = await _return_to_parent(page, parent_row_selector, parent_direction, bias=bias)
            if parent_w and parent_h:
                await _lock_fixed_size(page, parent_w, parent_h)
                cx, cy = await _zoom_to_selection(
                    page,
                    horizontal_bias=bias if parent_direction == "HORIZONTAL" else 0.5,
                    vertical_bias=bias if parent_direction != "HORIZONTAL" else 0.5,
                )
        except Exception:
            logger.exception("Failed to create Figma element via UI automation: %r", item)
    return cx, cy, created


async def _build_frame_via_ui(page, spec: dict[str, Any], unsplash_key: str | None = None) -> dict[str, Any]:
    width = float(spec.get("width") or 390)
    height = float(spec.get("height") or 844)
    direction = str(spec.get("layoutMode") or "VERTICAL").upper()
    padding = spec.get("padding", 24)
    if isinstance(padding, dict):
        pad_lr = float(padding.get("left", padding.get("right", 24)) or 24)
        pad_tb = float(padding.get("top", padding.get("bottom", 24)) or 24)
    else:
        pad_lr = pad_tb = float(padding or 24)
    gap = float(spec.get("itemSpacing") or 16)
    bg = spec.get("backgroundColor") or spec.get("fill") or "#FFFFFF"
    content_w = max(width - 2 * pad_lr, 40)

    canvas = page.locator("canvas").first
    await canvas.wait_for(state="visible", timeout=30000)
    width_field = page.locator('[data-onboarding-key="scrubbable-control-width"] input').first
    for attempt in range(4):
        canvas_box = await canvas.bounding_box()
        anchor_x, anchor_y = canvas_box["x"] + 80, canvas_box["y"] + 60
        await _draw(page, "f", anchor_x, anchor_y, w=120, h=120)
        try:
            await width_field.wait_for(state="visible", timeout=6000)
            break
        except Exception:
            if attempt == 3:
                raise
            logger.warning("Root frame draw attempt %d didn't register, retrying", attempt + 1)
            # Pressing 'f' again while the frame tool's "Dimension Presets"
            # side panel is already open (from the failed attempt) doesn't
            # reliably re-arm the tool — Escape closes that panel first so
            # the retry starts from a clean state instead of compounding.
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(1500)
    await _set_number(page, "scrubbable-control-width", width)
    await _set_number(page, "scrubbable-control-height", height)
    await _set_fill_hex(page, bg)
    await _apply_auto_layout(page, direction, pad_lr, pad_tb, gap, centered=False)
    # First click point, nothing placed yet: bias off `_append_bias` with
    # used=0 rather than jumping straight to a high fixed fraction — an
    # empty root frame only needs the click past its own leading padding.
    start_pad = pad_lr if direction == "HORIZONTAL" else pad_tb
    first_bias = _append_bias(
        0.0, start_pad, width if direction == "HORIZONTAL" else height,
        cross_extent=height if direction == "HORIZONTAL" else width,
        horizontal=(direction == "HORIZONTAL"),
    )
    if direction == "HORIZONTAL":
        cx, cy = await _zoom_to_selection(page, horizontal_bias=first_bias)
    else:
        cx, cy = await _zoom_to_selection(page, vertical_bias=first_bias)
    root_row_selector = await _current_row_selector(page)

    children = spec.get("children") or []
    photo_registry = {"n": 0, "nodes": []}
    cx, cy, created = await _place_items(
        page, cx, cy, children, content_w, root_row_selector,
        parent_direction=direction, unsplash_key=unsplash_key,
        parent_w=width, parent_h=height, gap=gap, start_padding=start_pad,
        photo_registry=photo_registry,
    )

    await page.keyboard.press("Escape")
    await page.wait_for_timeout(150)
    await page.keyboard.press("Shift+2")
    await page.wait_for_timeout(500)

    return {
        "ok": True,
        "mode": "ui_automation",
        "children_created": created,
        "children_requested": len(children),
        # The root frame's own Layers-panel row selector, resolved while it
        # was still the live selection right after being drawn — needed by
        # `design_multi_frame_web` to reselect THIS frame later (Escape at
        # the end of this function deselects everything, so "currently
        # selected" can't be relied on by then) and set its page position.
        "root_row_selector": root_row_selector,
        # Every HEADER_IMAGE/AVATAR node built, each given a stable,
        # predictable name (`hermes:photo:{n}:{kind}`) — Phase 3 Step 2's
        # `fix_figma_photo` reselects one of these BY NAME in a fresh,
        # separate browser session (live-confirmed a rename survives a full
        # reload) to patch a missing/wrong photo without rebuilding the
        # whole frame.
        "photo_nodes": photo_registry["nodes"],
    }


async def open_figma_login_session(timeout_s: int = 300) -> dict[str, Any]:
    """Launch a visible Chrome/Edge browser for the user to log into Figma.

    Keeps the browser open for up to timeout_s (default 5 minutes) or until
    the user lands on a Figma dashboard/file. Saves session to paths.figma_profile_dir().
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {
            "ok": False,
            "error": "Playwright is not installed.",
        }

    profile_dir = paths.figma_profile_dir()
    launch_kwargs: dict[str, Any] = {
        "user_data_dir": str(profile_dir),
        "headless": False,
        "viewport": {"width": 1440, "height": 900},
        "ignore_default_args": ["--enable-automation"],
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--start-maximized",
        ],
    }

    logger.info(f"Opening Figma Sign-In session in profile {profile_dir}")

    try:
        async with async_playwright() as p:
            try:
                context = await p.chromium.launch_persistent_context(**launch_kwargs, channel="chrome")
            except Exception:
                try:
                    context = await p.chromium.launch_persistent_context(**launch_kwargs, channel="msedge")
                except Exception:
                    context = await p.chromium.launch_persistent_context(**launch_kwargs)

            page = await context.new_page()
            await page.goto("https://www.figma.com/login", wait_until="commit", timeout=60000)
            try:
                await page.bring_to_front()
            except Exception:
                pass

            # Wait up to timeout_s for user to complete login
            poll_interval = 2
            max_polls = timeout_s // poll_interval
            logged_in = False

            for _ in range(max_polls):
                await asyncio.sleep(poll_interval)
                if not context.pages:
                    break  # user closed the browser window
                try:
                    if any(_looks_logged_in(p.url) for p in context.pages):
                        logged_in = True
                        break
                except Exception:
                    # Transient error reading page.url mid-navigation (common
                    # during Google OAuth redirects) — keep waiting, don't
                    # treat it as a fatal login failure.
                    continue

            await context.close()
            if logged_in:
                return {
                    "ok": True,
                    "message": f"Login Figma berhasil! Sesi login Anda telah tersimpan di {profile_dir}.",
                }
            return {
                "ok": False,
                "error": "Waktu login (5 menit) habis sebelum login selesai.",
            }
    except Exception as e:
        logger.exception("Error during Figma login session")
        return {"ok": False, "error": str(e)}


async def _open_figma_session(p, target_url: str, headless: bool) -> tuple[Any, Any] | dict[str, Any]:
    """Launch persistent-profile Chrome (falling back to Edge, then plain
    Chromium), navigate to `target_url`, wait through login if needed, and
    dismiss onboarding popups. Returns `(context, page)` on success, or an
    error dict the caller should return as-is on failure (login timeout).

    Extracted from `design_figma_frame_web` so `design_multi_frame_web` can
    reuse the exact same session-open behavior for a single browser session
    that then builds several frames in a row, instead of duplicating it.
    """
    profile_dir = paths.figma_profile_dir()
    logger.info(f"Opening Figma Web session at {target_url} using profile {profile_dir}")

    launch_kwargs: dict[str, Any] = {
        "user_data_dir": str(profile_dir),
        "headless": headless,
        "viewport": {"width": 1440, "height": 900},
        "ignore_default_args": ["--enable-automation"],
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--start-maximized",
        ],
    }

    try:
        context = await p.chromium.launch_persistent_context(**launch_kwargs, channel="chrome")
    except Exception:
        try:
            context = await p.chromium.launch_persistent_context(**launch_kwargs, channel="msedge")
        except Exception:
            context = await p.chromium.launch_persistent_context(**launch_kwargs)

    page = await context.new_page()
    # Use wait_until="commit" so redirects to SSO/Google/Figma login don't cause premature timeouts
    try:
        await page.goto(target_url, wait_until="commit", timeout=60000)
    except Exception as goto_err:
        logger.warning(f"Initial page.goto commit notice: {goto_err}")

    # Check if login is required. If so, bring browser window to front and wait up to 300s
    page_url = page.url
    if "login" in page_url.lower() or "accounts.google.com" in page_url.lower():
        try:
            await page.bring_to_front()
        except Exception:
            pass
        logger.info("Figma login page detected. Waiting up to 300s for user to complete login in the opened browser...")
        login_success = False
        for _ in range(150):  # poll every 2s up to 300s (5 minutes)
            await asyncio.sleep(2)
            if not context.pages:
                break  # user closed the browser window
            try:
                if any(_looks_logged_in(pg.url) for pg in context.pages):
                    login_success = True
                    logger.info(f"User login completed! Current URL: {page.url}")
                    # Navigate to target_url if we were redirected away to dashboard
                    if target_url not in page.url and "design/new" in target_url:
                        await page.goto(target_url, wait_until="commit", timeout=60000)
                    break
            except Exception:
                # Transient error reading page.url mid-navigation (common
                # during Google OAuth redirects) — keep waiting, don't
                # treat it as a fatal login failure.
                continue

        if not login_success:
            await context.close()
            return {
                "ok": False,
                "requires_login": True,
                "error": (
                    "Waktu login di Figma habis (300 detik). Silakan jalankan perintah lagi "
                    "dan selesaikan login di jendela browser yang terbuka."
                ),
                "url": target_url,
            }

    # Dismiss any popup dialogs or overlays blocking the canvas
    try:
        await page.evaluate("""
            () => {
                const buttons = document.querySelectorAll('button, [role="button"], [aria-label="Close"]');
                buttons.forEach(b => {
                    const txt = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
                    if (txt.includes('got it') || txt.includes('dismiss') || txt.includes('close') || txt.includes('accept')) {
                        try { b.click(); } catch(e) {}
                    }
                });
            }
        """)
    except Exception:
        pass

    await page.wait_for_timeout(4000)
    return context, page


async def design_figma_frame_web(
    file_url: str | None,
    spec: dict[str, Any],
    out_dir: Path | None = None,
    headless: bool = False,
    timeout_s: int = 180,
    unsplash_key: str | None = None,
) -> dict[str, Any]:
    """Design a Figma frame in Figma Web via Playwright Chromium.

    Args:
        file_url: Optional URL to an open Figma file (e.g. https://www.figma.com/design/xxx/yyy).
                  If None, defaults to https://www.figma.com/design/new
        spec: Structured UI design schema dictionary.
        out_dir: Path to save preview screenshot.
        headless: If True, runs browser in headless mode. Default False so operator can watch or log in.
        timeout_s: Maximum execution timeout in seconds (default 180s = 3 minutes).
        unsplash_key: Unsplash API access key. When given, HEADER_IMAGE/AVATAR
                      children with a `photoQuery` get a real downloaded photo
                      instead of a plain colored placeholder rectangle.

    Returns:
        Dictionary with status, screenshot_path, markdown, and details.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {
            "ok": False,
            "error": "Playwright is not installed. Run `pip install playwright` and `playwright install chromium`.",
        }

    target_url = file_url or "https://www.figma.com/design/new"
    out_dir = out_dir or paths.artifacts_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    shot_filename = f"figma_frame_{uuid.uuid4().hex[:8]}.png"
    shot_path = out_dir / shot_filename

    try:
        async with async_playwright() as p:
            session = await _open_figma_session(p, target_url, headless)
            if isinstance(session, dict):
                return session
            context, page = session

            result = await _build_frame_via_ui(page, spec, unsplash_key=unsplash_key)

            # Figma redirects "design/new" to a real, reopenable file URL
            # (e.g. .../design/<fileKey>/Untitled) the moment it creates the
            # draft — `target_url` below is still the ORIGINAL literal
            # string passed in (e.g. "design/new" itself), which is USELESS
            # for reopening this exact file later. `page.url` at this point
            # is the real one — live-confirmed reopening it in a completely
            # separate browser session loads the same draft with all its
            # content intact. Needed so `fix_figma_photo` (Phase 3 Step 2)
            # can navigate back to THIS file in a later, separate tool call.
            real_file_url = page.url

            await page.wait_for_timeout(1000)
            await page.screenshot(path=str(shot_path), full_page=False)

            await context.close()

            md_image = f"![Figma Frame Preview](file:///{shot_path.as_posix()})"
            created, requested = result["children_created"], result["children_requested"]
            ok = created == requested
            detail = (
                f"Frame '{spec.get('name')}' ({int(spec.get('width') or 390)}x{int(spec.get('height') or 844)}px) "
                f"dibuat di Figma Web — {created}/{requested} elemen berhasil ditambahkan."
            )
            return {
                "ok": ok,
                "frame_name": spec.get("name", "Hermes Frame"),
                "screenshot_path": str(shot_path),
                "markdown": md_image,
                "detail": detail,
                "url": target_url,
                "file_url": real_file_url,
                "result": result,
            }

    except Exception as e:
        logger.exception("Error executing Figma Web design in browser")
        return {
            "ok": False,
            "error": f"Figma Web browser error: {e}",
            "url": target_url,
        }


async def design_multi_frame_web(
    file_url: str | None,
    frames: list[dict[str, Any]],
    out_dir: Path | None = None,
    headless: bool = False,
    timeout_s: int = 300,
    unsplash_key: str | None = None,
    frame_gap: float = 120.0,
) -> dict[str, Any]:
    """Design several Figma frames in ONE Figma Web session, laid out as
    same-page siblings left-to-right (frame 2 starts at frame 1's right
    edge + `frame_gap`, etc.) — the common "multi-screen flow" pattern
    (onboarding steps, a wizard). Reuses `_build_frame_via_ui` per frame
    completely unchanged; the only new work is:

    1. Panning the canvas to a guaranteed-blank spot before each frame
       (after the first) is drawn. `_build_frame_via_ui` always draws at a
       fixed on-screen anchor near the canvas's top-left — after the
       PREVIOUS frame's own zoom-to-fit, that anchor can be sitting right
       on top of it, and Figma auto-parents a frame drawn overlapping an
       existing one instead of creating a page sibling (confirmed live:
       this is exactly the mechanism nested composites in this file rely
       on deliberately — it's a hazard here, not there). Panning first
       (`page.mouse.wheel` with a large negative dx, live-confirmed to pan
       the canvas rather than zoom) guarantees blank space at that anchor.
       Two easy-to-miss requirements, both confirmed live the hard way: the
       zoom level must be reset to a KNOWN value (`Shift+0` = 100%) BEFORE
       panning, since a fixed wheel delta covers a different Figma-space
       distance at different zoom levels — skipping this once left a new
       frame Figma-space-close enough to the previous one that a tight
       zoom-to-fit while building one of ITS OWN nested composites (e.g. an
       INPUT) brought the previous frame back into the shared viewport, and
       a child's text landed on the previous frame's existing text node
       instead of the new one. And the mouse must be explicitly moved onto
       the canvas first — Figma's wheel-to-pan handling is canvas-scoped,
       so a wheel event fired with the pointer still wherever the last
       panel click left it (e.g. the Position fields from step 2 below)
       silently does nothing.
    2. Setting the frame's exact page position via `_set_position` right
       after it's built, instead of trying to read back an on-screen pixel
       edge (the roadmap's original idea) — live-confirmed settable the
       same deterministic way width/height already are, and avoids ever
       needing to convert between screen pixels and Figma's page space.

    Frame 1 is NOT panned before drawing (matches `design_figma_frame_web`'s
    existing single-frame behavior) — safe when `file_url` is None (a fresh
    "design/new" file has an empty canvas already); an existing file with
    content already near the default anchor is a pre-existing risk shared
    with the single-frame tool, not something this phase changes.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {
            "ok": False,
            "error": "Playwright is not installed. Run `pip install playwright` and `playwright install chromium`.",
        }

    if not frames:
        return {"ok": False, "error": "frames tidak boleh kosong"}

    target_url = file_url or "https://www.figma.com/design/new"
    out_dir = out_dir or paths.artifacts_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    shot_filename = f"figma_flow_{uuid.uuid4().hex[:8]}.png"
    shot_path = out_dir / shot_filename

    try:
        async with async_playwright() as p:
            session = await _open_figma_session(p, target_url, headless)
            if isinstance(session, dict):
                return session
            context, page = session

            results = []
            cumulative_x = 0.0
            for i, spec in enumerate(frames):
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(150)
                if i > 0:
                    # Reset zoom to a KNOWN level (Shift+0 = 100%) before
                    # panning — otherwise a fixed wheel delta translates to
                    # a different Figma-space distance depending on
                    # whatever zoom the previous frame's own build ended
                    # at, and can leave the new frame Figma-space-CLOSE to
                    # the previous one even though it looked clear on
                    # screen at draw time. Confirmed live: at the previous
                    # frame's ~190% zoom-to-fit level, this pan left the
                    # frames close enough that a later tight zoom-to-fit
                    # INSIDE the new frame (building one of its own nested
                    # composites, e.g. an INPUT) brought the previous frame
                    # back into view, and text meant for the new frame's
                    # child got typed into the previous frame's existing
                    # text node instead (selection/click-point contaminated
                    # by the other frame's content sitting under the click).
                    # The mouse must also be explicitly over the canvas
                    # first — Figma's wheel-to-pan handling is canvas-
                    # scoped, and without this the pan silently no-ops if
                    # the pointer is still wherever the last panel click
                    # left it.
                    await page.keyboard.press("Shift+0")
                    await page.wait_for_timeout(300)
                    canvas = page.locator("canvas").first
                    cbox = await canvas.bounding_box()
                    await page.mouse.move(cbox["x"] + cbox["width"] / 2, cbox["y"] + cbox["height"] / 2)
                    for _ in range(8):
                        await page.mouse.wheel(-1500, 0)
                        await page.wait_for_timeout(60)
                r = await _build_frame_via_ui(page, spec, unsplash_key=unsplash_key)
                await page.locator(r["root_row_selector"]).click(force=True)
                await page.wait_for_timeout(200)
                await _set_position(page, cumulative_x, 0)
                cumulative_x += float(spec.get("width") or 390) + frame_gap
                results.append({
                    "frame_name": spec.get("name"),
                    "children_created": r["children_created"],
                    "children_requested": r["children_requested"],
                    "photo_nodes": r["photo_nodes"],
                })

            real_file_url = page.url

            await page.keyboard.press("Escape")
            await page.wait_for_timeout(150)
            await page.keyboard.press("Shift+1")  # zoom to fit ALL frames on the page
            await page.wait_for_timeout(600)
            await page.screenshot(path=str(shot_path), full_page=False)

            await context.close()

            md_image = f"![Figma Flow Preview](file:///{shot_path.as_posix()})"
            total_created = sum(r["children_created"] for r in results)
            total_requested = sum(r["children_requested"] for r in results)
            ok = total_created == total_requested
            names = ", ".join(str(r["frame_name"]) for r in results)
            detail = (
                f"{len(results)} frame dibuat di Figma Web ({names}) — "
                f"{total_created}/{total_requested} elemen berhasil ditambahkan."
            )
            return {
                "ok": ok,
                "frame_names": [r["frame_name"] for r in results],
                "screenshot_path": str(shot_path),
                "markdown": md_image,
                "detail": detail,
                "url": target_url,
                "file_url": real_file_url,
                "results": results,
            }

    except Exception as e:
        logger.exception("Error executing Figma Web multi-frame design in browser")
        return {
            "ok": False,
            "error": f"Figma Web browser error: {e}",
            "url": target_url,
        }


async def fix_figma_photo(
    file_url: str,
    node_name: str,
    photo_query: str,
    unsplash_key: str | None,
    out_dir: Path | None = None,
    headless: bool = False,
    timeout_s: int = 120,
) -> dict[str, Any]:
    """Phase 3 Step 2 of docs/figma-uiux-roadmap.md, narrow first cut:
    patch ONE missing/wrong photo on an already-built frame, in a fresh
    browser session, instead of rebuilding the whole thing from scratch.

    `file_url` must be a REAL file URL (`design_figma_frame_web`/
    `design_multi_frame_web`'s `file_url` result field, NOT their `url`
    field — the latter is just the original "design/new" string, useless
    for reopening a specific draft). `node_name` must be one of the
    `node_name` values in that build's `photo_nodes` result list
    (`hermes:photo:{n}:{kind}`, assigned to every HEADER_IMAGE/AVATAR node
    at build time specifically so it survives being found again here).

    Mechanism, every step live-confirmed against a real Figma session
    before this was written: reopening a file via its real URL in a
    completely separate browser session/context shows the SAME renamed
    layer, still findable by exact text match in the Layers panel — no
    live selector from the original session is needed or available.
    Clicking that text actually selects the underlying node (confirmed via
    the Position panel reading back real coordinates), and
    `_zoom_to_selection` behaves exactly as it does mid-build, so the
    existing `_fetch_stock_photo` + `_place_image_fill` pair (unchanged,
    the same ones every original HEADER_IMAGE/AVATAR photo goes through)
    works without modification.

    Orientation for the fetch is read off `node_name`'s own `:kind` suffix
    (`header` → landscape, `avatar` → squarish) rather than needing the
    caller to specify it — the name already encodes what it is.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {
            "ok": False,
            "error": "Playwright is not installed. Run `pip install playwright` and `playwright install chromium`.",
        }

    if not unsplash_key:
        return {
            "ok": False,
            "error": "Unsplash API key belum diset — tidak bisa mengambil foto asli. "
                     "Minta pengguna set Unsplash access key di Settings dulu.",
        }

    out_dir = out_dir or paths.artifacts_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    shot_filename = f"figma_fix_{uuid.uuid4().hex[:8]}.png"
    shot_path = out_dir / shot_filename
    orientation = "squarish" if node_name.endswith(":avatar") else "landscape"

    try:
        async with async_playwright() as p:
            session = await _open_figma_session(p, file_url, headless)
            if isinstance(session, dict):
                return session
            context, page = session

            # The Layers panel reopens fully COLLAPSED — a renamed child
            # node isn't in the DOM at all yet, not just visually hidden,
            # so `get_by_text` can't find it until the tree is expanded.
            # `layers-panel-expand-caret` is the disclosure control's own
            # stable testid (live-confirmed via DOM dump; the row's
            # `data-fpl-tree-active` attribute lives on a DIFFERENT inner
            # element and isn't itself clickable for this). Click every
            # visible caret, repeatedly — each round can reveal further
            # nested carets — until the target shows up or nothing new
            # expands.
            row = page.get_by_text(node_name, exact=True)
            for _ in range(5):
                if await row.count() > 0:
                    break
                carets = page.locator('[data-testid="layers-panel-expand-caret"]')
                n = await carets.count()
                if n == 0:
                    break
                for i in range(n):
                    await carets.nth(i).click(force=True)
                    await page.wait_for_timeout(150)
            if await row.count() == 0:
                await context.close()
                return {
                    "ok": False,
                    "error": f"Node '{node_name}' tidak ditemukan di file ini — mungkin sudah "
                             f"diganti nama atau dihapus.",
                    "url": file_url,
                }
            await row.first.click()
            await page.wait_for_timeout(200)
            cx, cy = await _zoom_to_selection(page)

            photo = await _fetch_stock_photo(photo_query, unsplash_key, orientation=orientation)
            if not photo:
                await context.close()
                return {
                    "ok": False,
                    "error": f"Gagal mengambil foto Unsplash untuk query '{photo_query}'.",
                    "url": file_url,
                }
            placed = await _place_image_fill(page, cx, cy, photo)

            await page.keyboard.press("Escape")
            await page.wait_for_timeout(150)
            await page.keyboard.press("Shift+2")
            await page.wait_for_timeout(500)
            await page.screenshot(path=str(shot_path), full_page=False)

            await context.close()

            md_image = f"![Figma Fix Preview](file:///{shot_path.as_posix()})"
            detail = (
                f"Foto '{photo_query}' {'berhasil' if placed else 'GAGAL'} dipasang ke node "
                f"'{node_name}'."
            )
            return {
                "ok": placed,
                "node_name": node_name,
                "screenshot_path": str(shot_path),
                "markdown": md_image,
                "detail": detail,
                "url": file_url,
            }

    except Exception as e:
        logger.exception("Error fixing Figma photo in browser")
        return {
            "ok": False,
            "error": f"Figma Web browser error: {e}",
            "url": file_url,
        }
