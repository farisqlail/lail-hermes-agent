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
    page.locator = MagicMock(return_value=loc)
    page.keyboard.press = AsyncMock()
    page.wait_for_timeout = AsyncMock()
    
    with patch("hermes.figma_browser._current_row_selector", AsyncMock(return_value="[data-testid='row-1']")), \
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
    page.locator = MagicMock(return_value=loc)
    page.keyboard.press = AsyncMock()
    page.wait_for_timeout = AsyncMock()
    
    with patch("hermes.figma_browser._select_node_by_display_name", AsyncMock(return_value=True)), \
         patch("hermes.figma_browser._current_row_selector", AsyncMock(return_value="[data-testid='row-login']")), \
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


