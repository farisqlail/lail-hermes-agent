"""Voice output: edge-tts synthesis and the LLM summariser behind /api/tts*.

Split out of web_ui.py, which had grown to hold every endpoint in one factory.
None of these routes needs the session Store, the Telegram bridge or the ask
registry, so they live on a module-level APIRouter the app includes rather than
inside create_app's closure.

edge_tts and AsyncOpenAI are imported at module scope on purpose: both are hard
dependencies, and module-level names are what tests monkeypatch — a
function-local import can only be faked by mutating sys.modules.
"""
from __future__ import annotations
import re
from datetime import datetime
from typing import Literal

import edge_tts
from fastapi import APIRouter, HTTPException, Response
from openai import AsyncOpenAI
from pydantic import BaseModel

from . import config

# edge-tts voices offered in the UI. Indonesian first: the agent answers in
# Bahasa, and an English voice reads Indonesian text with English phonetics.
# id-ID-* are the only two native Indonesian neural voices edge-tts ships —
# jv-ID (Javanese), su-ID (Sundanese) and ms-MY (Malay) are separate languages
# and mispronounce Bahasa, so they are deliberately left out.
TTS_VOICES = [
    {"id": "id-ID-ArdiNeural", "name": "Ardi (Pria ID - Natural)"},
    {"id": "id-ID-GadisNeural", "name": "Gadis (Wanita ID - Natural)"},
    {"id": "en-GB-RyanNeural", "name": "Ryan (Male UK - Jarvis Style)"},
    {"id": "en-US-GuyNeural", "name": "Guy (Male US - Professional)"},
    {"id": "en-US-JennyNeural", "name": "Jenny (Female US - Soft)"},
]
TTS_VOICE_DEFAULT = TTS_VOICES[0]["id"]


class TtsRequest(BaseModel):
    text: str
    voice: str = TTS_VOICE_DEFAULT


class SmartTtsRequest(BaseModel):
    """A spoken-output request.

    `intent` says what kind of utterance this is; the server owns the
    instruction wording for each. Every other field is CONTENT — never
    instructions. Sending a prompt through `text` used to work by accident,
    and broke loudly on the fallback path, which spoke the instruction itself.
    """
    intent: Literal["summary", "greeting", "notify"] = "summary"
    text: str = ""                       # summary: the reply to condense
    task_text: str = ""                  # notify: the task's own description
    task_status: Literal["", "done", "failed"] = ""   # notify
    voice: str = TTS_VOICE_DEFAULT
    agent_name: str = ""
    max_words: int = 40
    personality: Literal["professional", "friendly", "jarvis"] = "professional"


def clean_for_speech(text: str) -> str:
    """Strip markdown so the synthesiser reads prose, not punctuation.

    One cleaner for both routes: /api/tts used to miss fenced code and links,
    the smart fallback used to miss tables and blockquotes, and each bug was
    only audible on the route that lacked the rule.
    """
    t = re.sub(r"```[\s\S]*?```", " ", text)
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"^\|.*\|$", "", t, flags=re.MULTILINE)      # table rows
    t = re.sub(r"^---+$", "", t, flags=re.MULTILINE)        # horizontal rules
    t = re.sub(r"^#{1,6}\s*", "", t, flags=re.MULTILINE)    # headings
    t = re.sub(r"^>\s+", "", t, flags=re.MULTILINE)         # blockquotes
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)        # links/images
    t = t.replace("**", "")
    return "\n".join(line.strip() for line in t.split("\n") if line.strip())


async def synthesize(text: str, voice: str) -> bytes:
    """Render text to MP3 bytes. Empty bytes means edge-tts produced no audio."""
    communicate = edge_tts.Communicate(text, voice)
    mp3 = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3 += chunk["data"]
    return mp3


PERSONALITY_LINES = {
    "professional": "Nada bicara: formal, ringkas, to-the-point. Seperti asisten eksekutif.",
    "friendly": "Nada bicara: santai, hangat, supportive. Seperti teman kerja yang ramah.",
    "jarvis": "Tone: formal British, elegant and composed. Speak in English like a gentleman's valet.",
}

_STATUS_LABELS = {"done": "berhasil", "failed": "gagal"}

_SUMMARY_RULES = (
    "TUGASMU: Rangkum respons berikut menjadi kalimat lisan SINGKAT "
    "(maksimal 2 kalimat, maksimal {max_words} kata) "
    "yang akan diucapkan oleh text-to-speech.\n\n"
    "ATURAN:\n"
    '1. Bicara sebagai orang pertama ("Saya sudah...", "Ini hasilnya...")\n'
    "2. JANGAN sebut simbol markdown, tabel, atau format teknis\n"
    "3. JANGAN ulangi seluruh isi — sampaikan INTI dan KESIMPULAN saja\n"
    "4. Gunakan bahasa yang sama dengan respons asli (Indonesia/Inggris)\n"
    "5. Jika respons berisi daftar/perbandingan → sebutkan rekomendasi utama saja\n"
    "6. Jika respons berisi konfirmasi aksi → konfirmasi singkat apa yang sudah dilakukan\n"
    "7. Jika respons berisi error → jelaskan masalah dan solusi singkat\n"
)

_GREETING_RULES = (
    "TUGASMU: Sapa operator satu kali. Maksimal 1 kalimat.\n\n"
    "ATURAN:\n"
    "1. Perkenalkan diri dengan namamu\n"
    "2. Sesuaikan sapaan dengan waktu yang diberikan di konteks\n"
    "3. Tanyakan apa yang bisa dibantu\n"
    "4. JANGAN membaca ulang data konteks apa adanya\n"
)

_NOTIFY_RULES = (
    "TUGASMU: Umumkan hasil sebuah task. Maksimal 1 kalimat.\n\n"
    "ATURAN:\n"
    "1. Sebut inti task-nya, bukan seluruh teksnya\n"
    "2. Sebut statusnya dengan jelas (berhasil / gagal)\n"
    "3. Jika gagal, nada serius dan solutif\n"
)

_INTENT_RULES = {
    "summary": _SUMMARY_RULES,
    "greeting": _GREETING_RULES,
    "notify": _NOTIFY_RULES,
}


def time_of_day(now: datetime | None = None) -> str:
    """Indonesian time-of-day bucket. Server-side on purpose: the wake-word and
    Telegram paths that will reuse this have no browser clock to ask."""
    h = (now or datetime.now()).hour
    return "pagi" if h < 11 else "siang" if h < 15 else "sore" if h < 18 else "malam"


def build_system_prompt(intent: str, agent: str, max_words: int,
                        personality: str) -> str:
    rules = _INTENT_RULES.get(intent, _SUMMARY_RULES).format(max_words=max_words)
    line = PERSONALITY_LINES.get(personality, PERSONALITY_LINES["professional"])
    return (
        f"Kamu adalah {agent}, asisten AI yang cerdas dan natural.\n\n"
        f"{rules}\n"
        f"GAYA: {line}\n"
    )


def build_user_content(body: SmartTtsRequest, now: datetime | None = None) -> str:
    """The content slot. Data only — every verb belongs in the system prompt."""
    if body.intent == "greeting":
        clock = (now or datetime.now()).strftime("%H:%M")
        return f"waktu: {clock} ({time_of_day(now)})"
    if body.intent == "notify":
        label = _STATUS_LABELS.get(body.task_status, body.task_status or "selesai")
        return f"task: {clean_for_speech(body.task_text)}\nstatus: {label}"
    return body.text


def fallback_text(body: SmartTtsRequest, agent: str,
                  now: datetime | None = None) -> str:
    """What to speak when the summariser call fails — a missing API key is the
    normal first-run state, so this path is not exceptional."""
    if body.intent == "greeting":
        return f"Selamat {time_of_day(now)}. Saya {agent}. Ada yang bisa saya bantu?"
    if body.intent == "notify":
        label = _STATUS_LABELS.get(body.task_status, body.task_status or "selesai")
        task = clean_for_speech(body.task_text) or "Task"
        return f"{task} sudah {label}."
    cleaned = clean_for_speech(body.text)
    return cleaned[:200] if cleaned else "Tidak ada yang bisa dirangkum."


# ── the <voice> fast path ──
# The chat model opens its reply with one spoken sentence wrapped in this tag.
# The client pulls it out of the token stream and starts synthesis while the
# rest of the answer is still arriving — one LLM call instead of two, and first
# audio in about a second instead of after the whole reply plus a summariser
# round trip. The grammar is mirrored in app/web/src/voicetag.ts; a test pins
# the two together.
VOICE_TAG_OPEN = "<voice>"
VOICE_TAG_CLOSE = "</voice>"

#: Longer than this and the model ignored "one sentence" — the line is shown
#: rather than spoken, because reading a paragraph aloud is the behaviour this
#: whole path exists to avoid.
MAX_VOICE_CHARS = 300

_VOICE_TAG_RE = re.compile(
    re.escape(VOICE_TAG_OPEN) + r"(.*?)" + re.escape(VOICE_TAG_CLOSE),
    re.DOTALL)


def strip_voice_tag(text: str) -> tuple[str, str]:
    """Split a reply into what is displayed and the one line to speak.

    Returns ``(display_text, voice_line)``. ``voice_line`` is empty when there
    is no tag, when it was never closed, or when it is too long to be the one
    sentence the instruction asked for — in every one of those cases the caller
    falls back to /api/tts/smart, which still works, just slower.
    """
    matches = _VOICE_TAG_RE.findall(text)
    
    # Clean up the tag and surrounding newlines if the tag is on its own line
    temp_text = text
    for m in _VOICE_TAG_RE.finditer(text):
        tag_str = m.group(0)
        idx = temp_text.find(tag_str)
        if idx > 0 and temp_text[idx - 1] == "\n" and idx + len(tag_str) < len(temp_text) and temp_text[idx + len(tag_str)] == "\n":
            temp_text = temp_text[:idx] + temp_text[idx + len(tag_str) + 1:]
        else:
            temp_text = temp_text.replace(tag_str, "")
    display = temp_text

    if not matches:
        # An opened-but-never-closed tag would otherwise leave "<voice>" in the
        # displayed answer. Drop the marker, keep the words.
        if VOICE_TAG_OPEN in display:
            display = display.replace(VOICE_TAG_OPEN, "")
        return display.strip(), ""

    spoken = matches[0].strip()
    if len(spoken) > MAX_VOICE_CHARS:
        # The model dumped the answer into the tag. Show it, do not speak it.
        return (display + "\n" + spoken).strip(), ""
    return display.strip(), spoken


def voice_tag_instruction(settings) -> str:
    """The prompt fragment that asks for the tag, or "" when nothing would
    listen to it.

    Gated because it costs roughly 90 prompt tokens on every chat turn.
    Verbatim mode is excluded too: it already speaks sentence by sentence as
    the reply streams, so a summary line on top would duplicate the opening.
    """
    if not getattr(settings, "tts_enabled", False):
        return ""
    if getattr(settings, "tts_mode", "smart") != "smart":
        return ""
    return (
        "\n\nSUARA: Awali SETIAP jawaban dengan SATU kalimat lisan yang "
        f"dibungkus {VOICE_TAG_OPEN}...{VOICE_TAG_CLOSE}, lalu tulis jawaban "
        "lengkapnya seperti biasa.\n"
        "Aturan kalimat di dalam tag:\n"
        "1. Maksimal satu kalimat, maksimal 25 kata\n"
        "2. Sampaikan INTI jawaban, bukan basa-basi seperti 'baik, saya jelaskan'\n"
        "3. Tanpa markdown, tanpa simbol, tanpa nama file atau ID\n"
        "4. Bahasa sama dengan jawaban\n"
        f"Contoh: {VOICE_TAG_OPEN}Semua pengujian lulus, tidak ada yang perlu "
        f"diperbaiki.{VOICE_TAG_CLOSE}\n"
        "## Hasil Pengujian\n"
        "...isi lengkap...\n"
        f"JANGAN menulis {VOICE_TAG_OPEN} di tempat lain, dan jangan "
        "menyebut tag ini kepada pengguna."
    )


router = APIRouter()


@router.get("/api/tts/voices")
def get_tts_voices():
    return TTS_VOICES


@router.post("/api/tts")
async def post_tts(body: TtsRequest):
    clean_text = clean_for_speech(body.text)
    if not clean_text:
        return Response(status_code=204)
    try:
        return Response(content=await synthesize(clean_text, body.voice),
                        media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/tts/smart")
async def post_tts_smart(body: SmartTtsRequest):
    """Voice output for one utterance. `intent` picks the instruction; the
    request body only ever carries content. Any summariser failure degrades to
    intent-appropriate fallback text so the operator always hears something
    sensible — never the prompt we would have sent."""
    agent = body.agent_name or config.load_settings().agent_name

    summary_text = ""
    try:
        secrets = config.load_secrets()
        if not secrets.nvidia_api_key:
            raise ValueError("no API key")
        settings = config.load_settings()
        client = AsyncOpenAI(
            base_url=settings.nvidia_base_url,
            api_key=secrets.nvidia_api_key,
            timeout=15,
        )
        resp = await client.chat.completions.create(
            model=settings.chat_model or settings.model,
            messages=[
                {"role": "system", "content": build_system_prompt(
                    body.intent, agent, body.max_words, body.personality)},
                {"role": "user", "content": build_user_content(body)},
            ],
            temperature=settings.chat_temperature,
            max_tokens=120,
        )
        summary_text = (resp.choices[0].message.content or "").strip()
    except Exception:
        # Missing key, outage, timeout, malformed response — all the same here.
        pass

    if not summary_text:
        summary_text = fallback_text(body, agent)

    try:
        mp3 = await synthesize(summary_text, body.voice)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not mp3:
        return Response(status_code=204)
    return Response(content=mp3, media_type="audio/mpeg")
