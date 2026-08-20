"""Google Stitch -> Figma bridge.

Stitch is a real MCP server (`stitch.googleapis.com/mcp`), not a REST API --
see `hermes/config.py`'s `stitch` McpServer template and
`docs/INTEGRATIONS.md` for how it gets connected. It generates a UI screen
from a text prompt and hands back a screenshot; there is no native Figma
output. This module drives that generation over an already-connected
`McpHub`, then feeds the screenshot to a vision-capable chat completion to
translate it into the same `children` spec shape `figma_web_design` already
consumes -- reusing `figma_browser.py`'s tested build path instead of a
second one.

Field names below (`create_project`'s `name`, `generate_screen_from_text`'s
`outputComponents[].design.screens[].id`, `get_screen`'s
`screenshot.downloadUrl` / `screenshot.fileContentBase64`) come from reading
the actual MCP tool schemas in `google-labs-code/stitch-sdk` on GitHub, not
from guessing -- but none of this has been exercised against a live Stitch
account yet (no API key available at the time this was written), so this is
best-effort or against the *documented* shape until someone runs it once.
"""
from __future__ import annotations
import asyncio
import base64
import json
import time
from pathlib import Path
from uuid import uuid4

import httpx
from openai import AsyncOpenAI

from . import paths, uploads


class StitchError(RuntimeError):
    """A Stitch MCP call failed, or returned a shape this bridge doesn't
    recognize -- surfaced verbatim rather than silently producing garbage."""


def _extract(result_text: str, tool_name: str) -> dict:
    try:
        data = json.loads(result_text)
    except (TypeError, ValueError) as e:
        raise StitchError(
            f"{tool_name}: respons bukan JSON valid: {result_text[:200]!r}") from e
    if isinstance(data, dict) and data.get("error"):
        raise StitchError(f"{tool_name}: {data['error']}")
    if not isinstance(data, dict):
        raise StitchError(
            f"{tool_name}: respons tak terduga (bukan objek): {result_text[:200]!r}")
    return data


async def _call(hub, tool: str, args: dict) -> dict:
    raw = await hub.call(f"stitch__{tool}", args)
    return _extract(raw, tool)


# `generate_screen_from_text`'s own tool description says it can take a
# couple of minutes and explicitly instructs: don't retry on timeout, poll
# `get_screen`/`list_screens` instead. mcp_hub.py's own per-call timeout
# (CALL_TIMEOUT_S = 120) can cut the generate call off before Stitch's
# server responds -- these numbers mirror that instruction, not invented.
POLL_INTERVAL_S = 20.0
POLL_ATTEMPTS = 10


async def generate_screen_raw(
    hub, prompt: str, *, project_id: str | None = None,
    edit_screen_id: str | None = None, device_type: str = "MOBILE",
    title: str | None = None,
) -> tuple[bytes, str, str]:
    """Core generator/editor: returns (image_bytes, project_id, screen_id)."""
    if not project_id:
        project = await _call(hub, "create_project", {"title": title or prompt[:60]})
        name = project.get("name") or ""
        project_id = name.rsplit("/", 1)[-1] if name else project.get("projectId")
        if not project_id:
            raise StitchError(f"create_project: tidak ada project id di respons: {project}")

    screen = None
    if edit_screen_id:
        try:
            gen = await _call(hub, "edit_screens", {
                "projectId": project_id, "screenId": edit_screen_id, "prompt": prompt,
            })
            screen = _first_screen(gen)
        except asyncio.TimeoutError:
            pass
        screen_id = edit_screen_id
    else:
        try:
            gen = await _call(hub, "generate_screen_from_text", {
                "projectId": project_id, "prompt": prompt, "deviceType": device_type,
            })
            screen = _first_screen(gen)
        except asyncio.TimeoutError:
            pass
        screen_id = screen.get("id") if screen else None
        if not screen_id:
            screen_id = await _poll_for_screen(hub, project_id)

    img = _screenshot_bytes(screen) if screen else None
    if img is None:
        url = _screenshot_url(screen) if screen else None
        if url:
            img = await _download(url)

    if img is None:
        for attempt in range(2):
            screen = await _call(hub, "get_screen", {
                "projectId": project_id, "screenId": screen_id,
                "name": f"projects/{project_id}/screens/{screen_id}",
            })
            img = _screenshot_bytes(screen)
            if img is not None:
                break
            url = _screenshot_url(screen)
            if url:
                img = await _download(url)
                break
            if attempt == 0:
                await asyncio.sleep(5)

    if img is None:
        raise StitchError(f"get_screen: tidak ada screenshot untuk layar {screen_id}: {screen}")

    return img, project_id, screen_id


async def generate_screen_image(
    hub, prompt: str, *, project_id: str | None = None,
    device_type: str = "MOBILE", title: str | None = None,
) -> bytes:
    """Generate one UI screen via Stitch and return its screenshot bytes."""
    img, _, _ = await generate_screen_raw(
        hub, prompt, project_id=project_id, device_type=device_type, title=title)
    return img


async def generate_and_save_screen(
    hub, prompt: str, *, project_id: str | None = None,
    edit_screen_id: str | None = None, device_type: str = "MOBILE",
    title: str | None = None, out_dir: Path | str | None = None,
) -> dict:
    """Generate or edit UI screen via Google Stitch MCP and save screenshot directly."""
    img, pid, sid = await generate_screen_raw(
        hub, prompt, project_id=project_id, edit_screen_id=edit_screen_id,
        device_type=device_type, title=title)
    target_dir = Path(out_dir) if out_dir else (paths.artifacts_dir() / "stitch")
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"stitch_{int(time.time())}_{uuid4().hex[:6]}.png"
    file_path = target_dir / filename
    file_path.write_bytes(img)
    return {
        "ok": True,
        "screenshot_path": str(file_path),
        "project_id": pid,
        "screen_id": sid,
        "stitch_url": f"https://stitch.withgoogle.com/projects/{pid}",
        "title": title or prompt[:60],
        "device_type": device_type,
    }


def _first_screen(gen: dict) -> dict | None:
    for comp in gen.get("outputComponents") or []:
        screens = ((comp.get("design") or {}).get("screens")) or []
        if screens:
            return screens[0]
    return None


def _screenshot_bytes(screen: dict) -> bytes | None:
    b64 = ((screen or {}).get("screenshot") or {}).get("fileContentBase64")
    return base64.b64decode(b64) if b64 else None


def _screenshot_url(screen: dict) -> str | None:
    return ((screen or {}).get("screenshot") or {}).get("downloadUrl")


async def _download(url: str) -> bytes:
    # download-handler.ts (the reference SDK) fetches this URL with no extra
    # auth header -- it's a pre-signed link, not a second API call.
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


async def _poll_for_screen(hub, project_id: str) -> str:
    for _ in range(POLL_ATTEMPTS):
        await asyncio.sleep(POLL_INTERVAL_S)
        listed = await _call(hub, "list_screens", {"projectId": project_id})
        screens = listed.get("screens") or []
        if screens:
            sid = screens[-1].get("id") or (screens[-1].get("name") or "").rsplit("/", 1)[-1]
            if sid:
                return sid
    raise StitchError(
        f"generate_screen_from_text: layar belum siap setelah "
        f"{POLL_ATTEMPTS * POLL_INTERVAL_S:.0f}s polling")


_SPEC_TOOL_NAME = "return_figma_children"


async def image_to_figma_children(
    image_bytes: bytes, *, base_url: str, key: str, model: str, child_schema: dict,
) -> list[dict]:
    """One-off vision completion: read a UI screenshot, return `children`
    matching `figma_web_design`'s own schema (`child_schema` is that
    function's `_figma_child_item_schema(...)`, passed in so this module
    doesn't duplicate it).

    Deliberately its own completion call, not routed through the main chat
    loop: that loop (`main.py`'s `chat`/`stream`) only carries text in
    `role: tool` messages, so there is no path to hand the model a freshly
    fetched image mid tool-call round without editing that loop itself.
    """
    _, mime = uploads.sniff(image_bytes[:16])
    data_url = f"data:{mime};base64," + base64.b64encode(image_bytes).decode()
    client = AsyncOpenAI(base_url=base_url, api_key=key)
    messages = [
        {"role": "user", "content": [
            {"type": "text", "text": (
                "Ini screenshot UI hasil generate AI. Jadi senior UI/UX: baca tata letak, "
                "urutan elemen dari atas ke bawah, warna (hex sedekat mungkin), teks persis, "
                "ukuran relatif tiap elemen -- lalu panggil tool untuk menuangkannya sebagai "
                "`children` sedetail mungkin. Reproduksi apa yang benar-benar terlihat, jangan "
                "menebak generik."
            )},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]},
    ]
    tool = {"type": "function", "function": {
        "name": _SPEC_TOOL_NAME,
        "description": "Kembalikan elemen UI yang terbaca dari gambar sebagai daftar children.",
        "parameters": {"type": "object", "properties": {
            "children": {"type": "array", "items": child_schema},
        }, "required": ["children"]},
    }}
    resp = await client.chat.completions.create(
        model=model, messages=messages, tools=[tool],
        tool_choice={"type": "function", "function": {"name": _SPEC_TOOL_NAME}},
    )
    call = resp.choices[0].message.tool_calls[0]
    args = json.loads(call.function.arguments)
    return args.get("children") or []
