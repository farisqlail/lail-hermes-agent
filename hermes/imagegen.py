"""Generate an image through the OpenAI-compatible gateway (9Router).

The gateway has no `/v1/images` backend; its image model (e.g.
`ag/gemini-3.1-flash-image`) is a chat model that returns the picture inline in
the assistant message as a `data:image/...;base64,...` markdown link. So this
calls plain chat/completions, pulls the first data URI out of the reply, and
writes the bytes to a file the web UI can serve.

Kept off the openai client on purpose: a stdlib call is trivial to point at the
same base_url/key and trivial to fake in a test, and this needs neither
streaming nor tools.
"""
from __future__ import annotations

import base64
import json
import re
import urllib.request
import uuid
from pathlib import Path

# data:image/png;base64,AAAA...  — the shape Gemini's image model returns inside
# the chat message. Extension normalised to what the file should be named.
_DATA_URI = re.compile(
    r"data:image/(?P<ext>[a-zA-Z0-9.+-]+);base64,(?P<b64>[A-Za-z0-9+/=\s]+)")


def extract_image(content: str) -> tuple[str, bytes] | None:
    """(extension, raw bytes) for the first inline image in a reply, or None."""
    m = _DATA_URI.search(content or "")
    if not m:
        return None
    ext = m.group("ext").lower()
    ext = {"jpeg": "jpg", "svg+xml": "svg"}.get(ext, ext)
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", m.group("b64")), validate=False)
    except (ValueError, base64.binascii.Error):
        return None
    return ext, raw


def _post(base_url: str, key: str, model: str, prompt: str, timeout: int) -> dict:
    body = json.dumps({"model": model,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def generate(prompt: str, *, base_url: str, key: str, model: str,
             out_dir: Path, timeout: int = 120) -> dict:
    """Generate one image and save it. Never raises.

    Returns {"status": "generated", "path": <file>} on success, else
    {"status": "error", "error": <why>} — the shape the chat dispatch reports
    back to the model.
    """
    if not (prompt or "").strip():
        return {"status": "error", "error": "prompt kosong"}
    try:
        data = _post(base_url, key, model, prompt, timeout)
        content = data["choices"][0]["message"]["content"]
    except Exception as e:  # network, auth, shape — all reported, never raised
        return {"status": "error", "error": str(e)}
    img = extract_image(content)
    if img is None:
        return {"status": "error",
                "error": "model tidak mengembalikan gambar",
                "text": (content or "")[:200]}
    ext, raw = img
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{uuid.uuid4().hex}.{ext}"
    path.write_bytes(raw)
    return {"status": "generated", "path": str(path)}
