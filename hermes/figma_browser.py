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


async def _set_number(page, onboarding_key: str, value: float) -> None:
    loc = page.locator(f'[data-onboarding-key="{onboarding_key}"] input').first
    await loc.click(timeout=8000)
    await page.keyboard.press("Control+A")
    await loc.type(str(round(value)))
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(150)


async def _lock_fixed_size(page, width: float, height: float) -> None:
    """Force a nested auto-layout frame's own sizing back to Fixed.

    `Shift+A` resets BOTH axes of a nested frame to "Hug contents" — the
    numeric field at `scrubbable-control-width/height` disappears entirely
    (replaced by a "Horizontal/Vertical resizing" combobox showing "Hug").
    Typing a value into THAT combobox switches the mode to Fixed and gives
    the frame real dimensions again. Without this, a Hug frame shrinks to
    exactly its content's bounding box — leaving zero slack to click "past"
    existing children when appending a second, third, etc. (the click lands
    ON the last child instead, nesting the next item inside it).
    """
    for label, value in (("Horizontal resizing", width), ("Vertical resizing", height)):
        combo = page.get_by_role("combobox", name=label)
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
    """
    await page.keyboard.press("Shift+2")
    await page.wait_for_timeout(450)
    box = await page.locator("canvas").first.bounding_box()
    return box["x"] + box["width"] * horizontal_bias, box["y"] + box["height"] * vertical_bias


async def _apply_auto_layout(
    page, direction: str, pad_lr: float, pad_tb: float, gap: float, centered: bool
) -> None:
    await page.keyboard.press("Shift+A")
    await page.wait_for_timeout(350)
    if direction == "HORIZONTAL":
        radio = page.get_by_role("radio", name="Horizontal")
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
        radio = page.get_by_role("radio", name="Align center", exact=True)
        if await radio.count():
            await radio.click()
            await page.wait_for_timeout(150)


async def _add_text(
    page, cx: float, cy: float, content: str,
    font_size: float | None = None, color: str | None = None,
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


async def _add_shape(
    page, tool_key: str, cx: float, cy: float, w: float, h: float,
    color: str | None = None, corner_radius: float | None = None,
) -> None:
    await _draw(page, tool_key, cx, cy)
    await _set_number(page, "scrubbable-control-width", w)
    await _set_number(page, "scrubbable-control-height", h)
    if corner_radius:
        await _set_number(page, "scrubbable-control-corner-radius", corner_radius)
    if color:
        await _set_fill_hex(page, color)


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
) -> None:
    """Create a nested auto-layout sub-frame (button/input/checkbox row) and
    fill it via `fill_children(inner_cx, inner_cy)`. Always sets a real fill
    (even if just white) since an empty-fill frame can't be clicked into.
    """
    await _draw(page, "f", cx, cy)
    await _set_number(page, "scrubbable-control-width", w)
    await _set_number(page, "scrubbable-control-height", h)
    if corner_radius:
        await _set_number(page, "scrubbable-control-corner-radius", corner_radius)
    await _apply_auto_layout(page, direction, padding, padding, gap, centered=True)
    await _lock_fixed_size(page, w, h)
    await _set_fill_hex(page, color)
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


async def _return_to_parent(page, parent_row_selector: str, direction: str = "VERTICAL") -> tuple[float, float]:
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
    """
    await page.locator(parent_row_selector).click()
    await page.wait_for_timeout(150)
    if direction == "HORIZONTAL":
        return await _zoom_to_selection(page, horizontal_bias=0.85)
    return await _zoom_to_selection(page, vertical_bias=0.85)


async def _place_items(
    page, cx: float, cy: float, items: list[dict], content_w: float, parent_row_selector: str,
    parent_direction: str = "VERTICAL", unsplash_key: str | None = None,
) -> tuple[float, float, int]:
    """Place a list of items into whatever frame is currently selected
    (`parent_row_selector` is that frame's own row, used to return to it
    between composites; `parent_direction` is that frame's OWN stacking
    axis — VERTICAL for a root frame's direct children, HORIZONTAL for a
    ROW's own children — so returning to it biases the click point along
    the right axis). Used both for a root frame's direct children and —
    recursively, via the ROW type — for a horizontal row's own children, so
    a BUTTON can nest inside a ROW inside the root frame.
    """
    created = 0
    for item in items:
        itype = str(item.get("type") or "").upper()
        try:
            if itype in ("TEXT", "FOOTER_LINK"):
                await _add_text(
                    page, cx, cy, item.get("content") or item.get("text") or "",
                    font_size=item.get("fontSize"), color=item.get("color"),
                )
            elif itype in ("HEADER_IMAGE", "HEADER"):
                await _add_shape(
                    page, "r", cx, cy,
                    item.get("width") or content_w, item.get("height") or 220,
                    color=item.get("color") or "#E2E8F0",
                    corner_radius=item.get("borderRadius"),
                )
                photo_query = item.get("photoQuery")
                if photo_query and unsplash_key:
                    photo = await _fetch_stock_photo(photo_query, unsplash_key, orientation="landscape")
                    if photo:
                        await _place_image_fill(page, cx, cy, photo)
            elif itype in ("AVATAR", "ELLIPSE", "CIRCLE"):
                size = item.get("size") or item.get("width") or 56
                await _add_shape(page, "o", cx, cy, size, size, color=item.get("color") or "#0070F3")
                photo_query = item.get("photoQuery")
                if photo_query and unsplash_key:
                    photo = await _fetch_stock_photo(photo_query, unsplash_key, orientation="squarish")
                    if photo:
                        await _place_image_fill(page, cx, cy, photo)
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
                    )
                await _add_composite(
                    page, cx, cy, item.get("width") or content_w, item.get("height") or 50,
                    color=fill, corner_radius=item.get("borderRadius", 50),
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
            elif itype == "ROW":
                sub_items = item.get("children") or []
                n = max(len(sub_items), 1)
                row_gap = float(item.get("itemSpacing") or 12)
                row_padding = float(item.get("padding") or 0)
                row_w = item.get("width") or content_w
                row_content_w = max(row_w - 2 * row_padding, 20)
                # Children default to an equal share of the row's inner width
                # so e.g. 3 buttons in a ROW sit side by side, evenly spaced —
                # any child with an explicit width keeps it.
                default_child_w = max((row_content_w - row_gap * (n - 1)) / n, 20)
                normalized = [{**c, "width": c.get("width") or default_child_w} for c in sub_items]

                async def _fill_row(icx: float, icy: float, _items=normalized, _child_w=default_child_w) -> None:
                    row_selector = await _current_row_selector(page)
                    await _place_items(
                        page, icx, icy, _items, _child_w, row_selector,
                        parent_direction="HORIZONTAL", unsplash_key=unsplash_key,
                    )

                await _add_composite(
                    page, cx, cy, row_w, item.get("height") or 50,
                    color=item.get("backgroundColor") or item.get("color") or "#FFFFFF",
                    corner_radius=item.get("borderRadius"),
                    direction="HORIZONTAL", gap=row_gap, padding=row_padding,
                    fill_children=_fill_row,
                )
            else:
                await _add_shape(
                    page, "r", cx, cy, item.get("width") or 100, item.get("height") or 40,
                    color=item.get("backgroundColor") or item.get("color") or item.get("fill"),
                    corner_radius=item.get("borderRadius"),
                )
            created += 1
            # Refresh the click point for EVERY item, not just composites —
            # a second plain TEXT reusing a stale point can land on top of
            # the first (Figma then merges the keystrokes into it instead of
            # creating a separate node) once the container has real slack
            # instead of hugging exactly around a single child.
            cx, cy = await _return_to_parent(page, parent_row_selector, parent_direction)
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
    if direction == "HORIZONTAL":
        cx, cy = await _zoom_to_selection(page, horizontal_bias=0.85)
    else:
        cx, cy = await _zoom_to_selection(page, vertical_bias=0.85)
    root_row_selector = await _current_row_selector(page)

    children = spec.get("children") or []
    cx, cy, created = await _place_items(
        page, cx, cy, children, content_w, root_row_selector,
        parent_direction=direction, unsplash_key=unsplash_key,
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
        async with async_playwright() as p:
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
                        if any(_looks_logged_in(p.url) for p in context.pages):
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

            result = await _build_frame_via_ui(page, spec, unsplash_key=unsplash_key)

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
                "result": result,
            }

    except Exception as e:
        logger.exception("Error executing Figma Web design in browser")
        return {
            "ok": False,
            "error": f"Figma Web browser error: {e}",
            "url": target_url,
        }
