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
