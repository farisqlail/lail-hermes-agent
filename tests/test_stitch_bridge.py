import asyncio
import base64
import json
from pathlib import Path

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from hermes import stitch_bridge


class FakeHub:
    """Mimics `hermes.mcp_hub.McpHub.call`'s `(name, args) -> str` shape."""

    def __init__(self, responses):
        # responses: dict tool_name -> value | list-of-values (popped in order) | Exception
        self.responses = responses
        self.calls = []

    async def call(self, name, args):
        self.calls.append((name, args))
        tool = name.split("__", 1)[1]
        val = self.responses[tool]
        if isinstance(val, list):
            val = val.pop(0)
        if isinstance(val, BaseException):
            raise val
        return json.dumps(val, ensure_ascii=False)


def _screenshot_b64_response(screen_id="scr1", b64="aGVsbG8="):
    return {
        "name": f"projects/proj1/screens/{screen_id}",
        "screenshot": {"fileContentBase64": b64, "mimeType": "image/png"},
    }


@pytest.mark.asyncio
async def test_generate_screen_image_happy_path_base64():
    hub = FakeHub({
        "create_project": {"name": "projects/proj1"},
        "generate_screen_from_text": {
            "outputComponents": [{"design": {"screens": [{"id": "scr1"}]}}],
        },
        "get_screen": _screenshot_b64_response(),
    })

    out = await stitch_bridge.generate_screen_image(hub, "a login page")

    assert out == base64.b64decode("aGVsbG8=")
    called_tools = [c[0] for c in hub.calls]
    assert called_tools == [
        "stitch__create_project", "stitch__generate_screen_from_text", "stitch__get_screen",
    ]
    gen_args = hub.calls[1][1]
    assert gen_args["projectId"] == "proj1"
    assert gen_args["prompt"] == "a login page"


@pytest.mark.asyncio
async def test_generate_screen_image_downloads_url_when_no_inline_base64():
    hub = FakeHub({
        "create_project": {"name": "projects/proj1"},
        "generate_screen_from_text": {
            "outputComponents": [{"design": {"screens": [{"id": "scr1"}]}}],
        },
        "get_screen": {
            "name": "projects/proj1/screens/scr1",
            "screenshot": {"downloadUrl": "https://example.com/shot.png"},
        },
    })

    fake_resp = MagicMock()
    fake_resp.content = b"raw-image-bytes"
    fake_resp.raise_for_status = MagicMock()
    fake_client = AsyncMock()
    fake_client.get = AsyncMock(return_value=fake_resp)
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)

    with patch("hermes.stitch_bridge.httpx.AsyncClient", return_value=fake_client):
        out = await stitch_bridge.generate_screen_image(hub, "a dashboard")

    assert out == b"raw-image-bytes"
    fake_client.get.assert_awaited_once_with("https://example.com/shot.png")


@pytest.mark.asyncio
async def test_generate_screen_image_falls_back_to_polling_on_timeout():
    hub = FakeHub({
        "create_project": {"name": "projects/proj1"},
        "generate_screen_from_text": asyncio.TimeoutError(),
        "list_screens": [
            {"screens": []},                       # not ready yet
            {"screens": [{"id": "scr1"}]},          # ready
        ],
        "get_screen": _screenshot_b64_response(),
    })

    with patch("hermes.stitch_bridge.POLL_INTERVAL_S", 0):
        out = await stitch_bridge.generate_screen_image(hub, "slow screen")

    assert out == base64.b64decode("aGVsbG8=")
    called_tools = [c[0] for c in hub.calls]
    assert called_tools.count("stitch__list_screens") == 2


@pytest.mark.asyncio
async def test_generate_screen_image_skips_get_screen_when_already_embedded():
    """Live-confirmed 2026-08-18: `generate_screen_from_text`'s own response
    already carries the full screen incl. screenshot -- no follow-up
    `get_screen` round trip needed in the common case."""
    hub = FakeHub({
        "create_project": {"name": "projects/proj1"},
        "generate_screen_from_text": {
            "outputComponents": [{"design": {"screens": [{
                "id": "scr1",
                "screenshot": {"fileContentBase64": "aGVsbG8="},
            }]}}],
        },
    })

    out = await stitch_bridge.generate_screen_image(hub, "a login page")

    assert out == base64.b64decode("aGVsbG8=")
    called_tools = [c[0] for c in hub.calls]
    assert called_tools == ["stitch__create_project", "stitch__generate_screen_from_text"]
    assert "stitch__get_screen" not in called_tools


@pytest.mark.asyncio
async def test_generate_screen_image_retries_get_screen_on_transient_empty_screenshot():
    """Live-observed 2026-08-18: `get_screen` can answer with no `screenshot`
    field on the call right after generation finishes, then have it on a
    retry a few seconds later. One retry should recover, not fail outright."""
    hub = FakeHub({
        "create_project": {"name": "projects/proj1"},
        "generate_screen_from_text": {
            "outputComponents": [{"design": {"screens": [{"id": "scr1"}]}}],
        },
        "get_screen": [
            {"name": "projects/proj1/screens/scr1"},   # no screenshot yet
            _screenshot_b64_response(),                # ready now
        ],
    })

    with patch("hermes.stitch_bridge.asyncio.sleep", AsyncMock()):
        out = await stitch_bridge.generate_screen_image(hub, "a login page")

    assert out == base64.b64decode("aGVsbG8=")
    called_tools = [c[0] for c in hub.calls]
    assert called_tools.count("stitch__get_screen") == 2


@pytest.mark.asyncio
async def test_generate_screen_image_raises_stitch_error_on_tool_error_payload():
    hub = FakeHub({
        "create_project": {"error": "invalid API key"},
    })

    with pytest.raises(stitch_bridge.StitchError, match="invalid API key"):
        await stitch_bridge.generate_screen_image(hub, "anything")


@pytest.mark.asyncio
async def test_generate_screen_image_raises_after_exhausting_polling():
    hub = FakeHub({
        "create_project": {"name": "projects/proj1"},
        "generate_screen_from_text": asyncio.TimeoutError(),
        "list_screens": {"screens": []},  # never becomes ready
    })

    with patch("hermes.stitch_bridge.POLL_INTERVAL_S", 0), \
         patch("hermes.stitch_bridge.POLL_ATTEMPTS", 2):
        with pytest.raises(stitch_bridge.StitchError, match="belum siap"):
            await stitch_bridge.generate_screen_image(hub, "anything")


@pytest.mark.asyncio
async def test_image_to_figma_children_forces_structured_tool_call():
    png_bytes = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")

    fake_call = MagicMock()
    fake_call.function.arguments = json.dumps({"children": [{"type": "TEXT", "content": "Hi"}]})
    fake_message = MagicMock(tool_calls=[fake_call])
    fake_choice = MagicMock(message=fake_message)
    fake_resp = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(return_value=fake_resp)

    with patch("hermes.stitch_bridge.AsyncOpenAI", return_value=fake_client) as ctor:
        children = await stitch_bridge.image_to_figma_children(
            png_bytes, base_url="https://api.example/v1", key="k", model="m",
            child_schema={"type": "object", "properties": {}},
        )

    assert children == [{"type": "TEXT", "content": "Hi"}]
    ctor.assert_called_once_with(base_url="https://api.example/v1", api_key="k")
    kwargs = fake_client.chat.completions.create.call_args.kwargs
    assert kwargs["model"] == "m"
    assert kwargs["tool_choice"]["function"]["name"] == stitch_bridge._SPEC_TOOL_NAME
    image_part = kwargs["messages"][0]["content"][1]
    assert image_part["type"] == "image_url"
    assert image_part["image_url"]["url"].startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_generate_and_save_screen(tmp_path):
    hub = FakeHub({
        "create_project": {"name": "projects/proj1"},
        "generate_screen_from_text": {
            "outputComponents": [{"design": {"screens": [{
                "id": "scr1",
                "screenshot": {"fileContentBase64": "aGVsbG8="},
            }]}}],
        },
    })
    res = await stitch_bridge.generate_and_save_screen(
        hub, "modern login", device_type="MOBILE", title="Login Page", out_dir=tmp_path
    )
    assert res["ok"] is True
    assert res["title"] == "Login Page"
    assert res["device_type"] == "MOBILE"
    assert res["project_id"] == "proj1"
    assert res["screen_id"] == "scr1"
    assert res["stitch_url"] == "https://stitch.withgoogle.com/projects/proj1"
    saved = Path(res["screenshot_path"])
    assert saved.is_file()
    assert saved.read_bytes() == base64.b64decode("aGVsbG8=")


@pytest.mark.asyncio
async def test_generate_and_save_screen_existing_project(tmp_path):
    hub = FakeHub({
        "generate_screen_from_text": {
            "outputComponents": [{"design": {"screens": [{
                "id": "scr2",
                "screenshot": {"fileContentBase64": "aGVsbG8="},
            }]}}],
        },
    })
    res = await stitch_bridge.generate_and_save_screen(
        hub, "dashboard screen", project_id="existing_proj_123", device_type="DESKTOP",
        title="Dashboard", out_dir=tmp_path
    )
    assert res["ok"] is True
    assert res["project_id"] == "existing_proj_123"
    assert res["screen_id"] == "scr2"
    assert res["stitch_url"] == "https://stitch.withgoogle.com/projects/existing_proj_123"
    called_tools = [c[0] for c in hub.calls]
    assert "stitch__create_project" not in called_tools
    assert called_tools == ["stitch__generate_screen_from_text"]


@pytest.mark.asyncio
async def test_generate_and_save_screen_edit_screen(tmp_path):
    hub = FakeHub({
        "edit_screens": {
            "outputComponents": [{"design": {"screens": [{
                "id": "scr1",
                "screenshot": {"fileContentBase64": "aGVsbG8="},
            }]}}],
        },
    })
    res = await stitch_bridge.generate_and_save_screen(
        hub, "change button to green", project_id="proj99", edit_screen_id="scr1",
        out_dir=tmp_path
    )
    assert res["ok"] is True
    assert res["project_id"] == "proj99"
    assert res["screen_id"] == "scr1"
    called_tools = [c[0] for c in hub.calls]
    assert called_tools == ["stitch__edit_screens"]


