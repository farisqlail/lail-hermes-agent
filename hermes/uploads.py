"""Images the operator hands to a chat turn.

Deliberately short-lived. The model looks at the image once, answers, and the
file is deleted — so nothing is stored that a later turn would have to re-send,
and the prompt never carries the same picture twice. `hermes/cleanup.py` is the
safety net for the case this path cannot cover: a process that dies between the
upload and the answer.

Type is decided by the leading bytes, never by the filename. An `.png` that is
really an SVG would be served back into the dashboard's own origin, where its
embedded script runs with the operator's session — so the allowed formats are
the raster ones the vision models accept, and everything else is refused.
"""
from __future__ import annotations
import base64, uuid
from pathlib import Path

#: Per file. A phone photo is 2-5 MB; the base64 the model call carries is a
#: third larger again, and that rides in the prompt.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class UnsupportedImage(ValueError):
    """The bytes are not one of the accepted raster formats."""


# (leading bytes, extension, mime). WebP is checked separately: its signature
# is split across the RIFF header.
_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"GIF87a", "gif", "image/gif"),
    (b"GIF89a", "gif", "image/gif"),
)


def sniff(data: bytes) -> tuple[str, str]:
    """(extension, mime) for supported image bytes, else raise.

    Content sniffing, not extension trust: the filename comes from the browser
    and decides nothing.
    """
    for magic, ext, mime in _SIGNATURES:
        if data.startswith(magic):
            return ext, mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    raise UnsupportedImage(
        "Format tidak didukung. Kirim PNG, JPEG, GIF, atau WebP — "
        "SVG dan berkas non-gambar ditolak.")


def _conv_dir(base: Path, conv_id: str) -> Path | None:
    """`base/conv_id`, or None when conv_id tries to leave `base`.

    Same guard, same reason as `cleanup.purge`: conv_id arrives from the
    client, so it is never joined blindly.
    """
    if not conv_id or conv_id in (".", ".."):
        return None
    try:
        resolved = (base / conv_id).resolve()
        resolved.relative_to(base.resolve())
    except (OSError, ValueError):
        return None
    return resolved


def save(base: Path, conv_id: str, data: bytes) -> tuple[str, str]:
    """Write one image, returning (stored name, mime).

    The stored name is generated here, never taken from the client: a browser
    filename can collide, can carry a path, and is the one field an attacker
    fully controls.
    """
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(
            f"Gambar terlalu besar (maksimal {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    ext, mime = sniff(data)
    d = _conv_dir(base, conv_id)
    if d is None:
        raise ValueError("id percakapan tidak sah")
    d.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    (d / name).write_bytes(data)
    return name, mime


def resolve(base: Path, conv_id: str, name: str) -> Path | None:
    """The stored file for a name the client sent back, or None.

    None covers every way this can be wrong at once — traversal, a file from
    another conversation, one already discarded — because the caller treats
    them identically: the image is simply not attached.
    """
    d = _conv_dir(base, conv_id)
    if d is None or not name or "/" in name or "\\" in name:
        return None
    p = d / name
    return p if p.is_file() else None


def data_url(path: Path) -> str:
    """The inline form the chat completions API takes. Providers cannot reach
    a path on this machine, so the bytes travel in the request."""
    _, mime = sniff(path.read_bytes()[:16])
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def as_content_parts(text: str, images: list[Path]) -> list[dict]:
    """One user message carrying text plus images, in OpenAI's parts form."""
    parts: list[dict] = [{"type": "text", "text": text}]
    parts += [{"type": "image_url", "image_url": {"url": data_url(p)}}
              for p in images]
    return parts


def discard(paths: list[Path]) -> None:
    """Delete images the turn has finished with. Never raises: the answer is
    already on its way to the operator, and a file that outlives its turn is
    swept at the next start."""
    for p in paths:
        try:
            p.unlink(missing_ok=True)
        except OSError as e:
            print(f"Could not discard upload {p}: {e}")
