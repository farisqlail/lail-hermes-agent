import pytest
from unittest.mock import AsyncMock, patch
from hermes import figma_browser, paths

def test_figma_profile_dir():
    p = paths.figma_profile_dir()
    assert p.name == "figma_browser_profile"

@pytest.mark.asyncio
async def test_design_figma_frame_web_missing_playwright():
    with patch.dict("sys.modules", {"playwright.async_api": None}):
        res = await figma_browser.design_figma_frame_web(
            file_url=None,
            spec={"name": "Test Frame", "width": 375, "height": 812}
        )
        # Should handle import error or missing playwright gracefully if mocked out
        assert "ok" in res


@pytest.mark.asyncio
async def test_build_frame_via_ui_edit_existing_node_id():
    """Verify that when target_url contains node-id, _build_frame_via_ui edits existing frame."""
    from unittest.mock import MagicMock
    page = AsyncMock()
    canvas = MagicMock()
    canvas.wait_for = AsyncMock()
    canvas.bounding_box = AsyncMock(return_value={"x": 100, "y": 100, "width": 800, "height": 600})
    
    loc = MagicMock()
    loc.first = canvas
    loc.click = AsyncMock()
    page.locator = MagicMock(return_value=loc)
    page.keyboard.press = AsyncMock()
    page.wait_for_timeout = AsyncMock()

    with patch("hermes.figma_browser._current_row_selector", AsyncMock(return_value="[data-testid='row-1']")), \
         patch("hermes.figma_browser._read_position_x", AsyncMock(return_value=42.0)), \
         patch("hermes.figma_browser._read_position_y", AsyncMock(return_value=17.0)), \
         patch("hermes.figma_browser._set_position", AsyncMock()) as mock_set_position, \
         patch("hermes.figma_browser._draw", AsyncMock()), \
         patch("hermes.figma_browser._rename_layer", AsyncMock()), \
         patch("hermes.figma_browser._set_number", AsyncMock()), \
         patch("hermes.figma_browser._set_fill_hex", AsyncMock()), \
         patch("hermes.figma_browser._apply_auto_layout", AsyncMock()), \
         patch("hermes.figma_browser._zoom_to_selection", AsyncMock(return_value=(100, 100))), \
         patch("hermes.figma_browser._place_items", AsyncMock(return_value=(100, 200, 2))):
        
        spec = {
            "name": "Updated Frame",
            "width": 375,
            "height": 812,
            "children": [{"type": "BUTTON", "text": "Click Me"}]
        }
        res = await figma_browser._build_frame_via_ui(
            page, spec, target_url="https://www.figma.com/design/abc123xyz/MyFile?node-id=10-25"
        )
        
        assert res["ok"] is True
        assert res["mode"] == "edit_existing"
        assert res["children_created"] == 2
        # The old frame's position must be captured and restored on the
        # replacement -- not left wherever the fresh frame happened to be
        # drawn.
        mock_set_position.assert_awaited_once_with(page, 42.0, 17.0)


@pytest.mark.asyncio
async def test_build_frame_via_ui_edit_existing_by_name():
    """Verify that when frame name exists in file, _build_frame_via_ui edits existing frame."""
    from unittest.mock import MagicMock
    page = AsyncMock()
    canvas = MagicMock()
    canvas.wait_for = AsyncMock()
    canvas.bounding_box = AsyncMock(return_value={"x": 100, "y": 100, "width": 800, "height": 600})
    
    loc = MagicMock()
    loc.first = canvas
    loc.click = AsyncMock()
    page.locator = MagicMock(return_value=loc)
    page.keyboard.press = AsyncMock()
    page.wait_for_timeout = AsyncMock()

    with patch("hermes.figma_browser._select_node_by_display_name", AsyncMock(return_value=True)), \
         patch("hermes.figma_browser._current_row_selector", AsyncMock(return_value="[data-testid='row-login']")), \
         patch("hermes.figma_browser._read_position_x", AsyncMock(return_value=42.0)), \
         patch("hermes.figma_browser._read_position_y", AsyncMock(return_value=17.0)), \
         patch("hermes.figma_browser._set_position", AsyncMock()) as mock_set_position, \
         patch("hermes.figma_browser._draw", AsyncMock()), \
         patch("hermes.figma_browser._rename_layer", AsyncMock()), \
         patch("hermes.figma_browser._set_number", AsyncMock()), \
         patch("hermes.figma_browser._set_fill_hex", AsyncMock()), \
         patch("hermes.figma_browser._apply_auto_layout", AsyncMock()), \
         patch("hermes.figma_browser._zoom_to_selection", AsyncMock(return_value=(100, 100))), \
         patch("hermes.figma_browser._place_items", AsyncMock(return_value=(100, 200, 3))):
        
        spec = {
            "name": "Login Screen",
            "width": 375,
            "height": 812,
            "children": [{"type": "BUTTON", "text": "Sign In"}]
        }
        res = await figma_browser._build_frame_via_ui(
            page, spec, target_url="https://www.figma.com/design/abc123xyz/MyFile"
        )
        
        assert res["ok"] is True
        assert res["mode"] == "edit_existing"
        assert res["children_created"] == 3
        mock_set_position.assert_awaited_once_with(page, 42.0, 17.0)


@pytest.mark.asyncio
async def test_fetch_stock_photo_any_uses_api_key_when_present():
    """An Unsplash API key, when configured, is used directly -- the
    plugin fallback is never touched."""
    page = AsyncMock()
    with patch("hermes.figma_browser._fetch_stock_photo",
               AsyncMock(return_value=b"api-bytes")) as mock_api, \
         patch("hermes.figma_browser._open_unsplash_plugin", AsyncMock()) as mock_open:
        photo = await figma_browser._fetch_stock_photo_any(page, "dog", "landscape", "fake-key")

    assert photo == b"api-bytes"
    mock_api.assert_awaited_once_with("dog", "fake-key", orientation="landscape")
    mock_open.assert_not_called()


@pytest.mark.asyncio
async def test_fetch_stock_photo_any_falls_back_to_plugin_when_no_key():
    """No API key -> the Unsplash Figma plugin is opened for exactly this
    one fetch and closed again afterward -- never left open across other
    work (see `_fetch_stock_photo_any`'s docstring for why: its panel sits
    on top of the canvas and would break everything else in a build)."""
    page = AsyncMock()
    fake_frame = object()
    with patch("hermes.figma_browser._fetch_stock_photo", AsyncMock()) as mock_api, \
         patch("hermes.figma_browser._open_unsplash_plugin",
               AsyncMock(return_value=fake_frame)) as mock_open, \
         patch("hermes.figma_browser._fetch_stock_photo_via_plugin",
               AsyncMock(return_value=b"plugin-bytes")) as mock_plugin_fetch, \
         patch("hermes.figma_browser._close_unsplash_plugin", AsyncMock()) as mock_close:
        photo = await figma_browser._fetch_stock_photo_any(page, "dog", "landscape", None)

    assert photo == b"plugin-bytes"
    mock_api.assert_not_called()
    mock_open.assert_awaited_once_with(page)
    mock_plugin_fetch.assert_awaited_once_with(fake_frame, "dog")
    mock_close.assert_awaited_once_with(page)


@pytest.mark.asyncio
async def test_fetch_stock_photo_any_returns_none_when_plugin_unavailable():
    """Plugin not installed/reachable -> None, not an exception -- same
    contract as a missing API key already had."""
    page = AsyncMock()
    with patch("hermes.figma_browser._open_unsplash_plugin", AsyncMock(return_value=None)), \
         patch("hermes.figma_browser._close_unsplash_plugin", AsyncMock()) as mock_close:
        photo = await figma_browser._fetch_stock_photo_any(page, "dog", "landscape", None)

    assert photo is None
    mock_close.assert_not_called()


@pytest.mark.asyncio
async def test_fetch_stock_photo_via_plugin_skips_premium_results():
    """Unsplash+ (paid, locked) results load from `plus.unsplash.com`;
    the first `images.unsplash.com` (free) result must be the one picked
    and downloaded, skipping any premium ones ahead of it."""
    from unittest.mock import MagicMock

    class FakeLocator:
        def __init__(self, srcs):
            self._srcs = srcs

        def nth(self, i):
            m = MagicMock()
            m.get_attribute = AsyncMock(return_value=self._srcs[i])
            return m

        async def count(self):
            return len(self._srcs)

    class FakeInput:
        click = AsyncMock()
        fill = AsyncMock()
        type = AsyncMock()
        press = AsyncMock()

    class FakeInputLocator:
        first = FakeInput()

    fake_page = AsyncMock()
    fake_page.wait_for_timeout = AsyncMock()

    fake_frame = MagicMock()
    fake_frame.page = fake_page
    srcs = [
        "https://plus.unsplash.com/premium_photo-1?x=1",
        "https://plus.unsplash.com/premium_photo-2?x=2",
        "https://images.unsplash.com/photo-free-one?x=3",
        "https://images.unsplash.com/photo-free-two?x=4",
    ]

    def locator(sel):
        if sel == "input":
            return FakeInputLocator()
        if sel == "img":
            return FakeLocator(srcs)
        raise AssertionError(f"unexpected selector {sel!r}")
    fake_frame.locator = locator

    fake_resp = MagicMock()
    fake_resp.content = b"downloaded-bytes"
    fake_resp.raise_for_status = MagicMock()
    fake_client = AsyncMock()
    fake_client.get = AsyncMock(return_value=fake_resp)
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=fake_client):
        photo = await figma_browser._fetch_stock_photo_via_plugin(fake_frame, "dog")

    assert photo == b"downloaded-bytes"
    fake_client.get.assert_awaited_once_with("https://images.unsplash.com/photo-free-one?x=3")


