from hermes import voice

def test_clean_for_speech_strips_every_markdown_form():
    # each of these used to be handled by only one of the two cleaners
    assert voice.clean_for_speech("**Halo** tuan") == "Halo tuan"
    assert voice.clean_for_speech("| a | b |\n| - | - |") == ""
    assert voice.clean_for_speech("```py\nprint(1)\n```") == ""
    assert voice.clean_for_speech("lihat [dokumen](http://x/y)") == "lihat dokumen"
    assert voice.clean_for_speech("# Judul\n> kutipan") == "Judul\nkutipan"
    assert voice.clean_for_speech("---\n**`  `**") == ""

def test_voices_list_is_multilingual_first():
    ids = [v["id"] for v in voice.TTS_VOICES]
    # multilingual voices lead, and the first is the default: replies mix Bahasa
    # with English terms, so an omitted voice must land on one that speaks both
    assert ids[0] == "en-US-AndrewMultilingualNeural"
    assert voice.TTS_VOICE_DEFAULT == ids[0]
    assert all("Multilingual" in i for i in ids[:4])
    # the native id-ID voices are still offered for pure-Bahasa output
    assert "id-ID-ArdiNeural" in ids and "id-ID-GadisNeural" in ids
    # Javanese/Sundanese/Malay are different languages — never offered
    assert not any(i.startswith(("jv-", "su-", "ms-")) for i in ids)


from fastapi.testclient import TestClient
from hermes.web_ui import create_app
from hermes.session_store import Store
from hermes import paths

def install_fake_edge_tts(monkeypatch, recorder):
    """Stub edge_tts so the TTS routes never touch the network.

    Patches the name bound in hermes.voice, not sys.modules: voice.py imports
    edge_tts at module scope, so a sys.modules swap would come too late.
    """
    class FakeCommunicate:
        def __init__(self, text, voice):
            recorder["text"] = text
            recorder["voice"] = voice

        async def stream(self):
            yield {"type": "WordBoundary"}
            yield {"type": "audio", "data": b"ID3fake"}

    class FakeEdgeTts:
        Communicate = FakeCommunicate

    monkeypatch.setattr(voice, "edge_tts", FakeEdgeTts)

def _client(hermes_home):
    paths.ensure_dirs()
    store = Store(paths.db_path()); store.init_schema()
    return TestClient(create_app(store))

def test_tts_post_reads_json_body(hermes_home, monkeypatch):
    recorder = {}
    install_fake_edge_tts(monkeypatch, recorder)
    r = _client(hermes_home).post(
        "/api/tts", json={"text": "**Halo** tuan", "voice": "id-ID-ArdiNeural"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"ID3fake"
    assert recorder["text"] == "Halo tuan"
    assert recorder["voice"] == "id-ID-ArdiNeural"

def test_tts_post_defaults_voice_and_skips_empty_text(hermes_home, monkeypatch):
    recorder = {}
    install_fake_edge_tts(monkeypatch, recorder)
    client = _client(hermes_home)

    r = client.post("/api/tts", json={"text": "hello"})
    assert r.status_code == 200
    # an omitted voice falls back to the default voice (now multilingual)
    assert recorder["voice"] == "en-US-AndrewMultilingualNeural"

    # text that cleans down to nothing yields No Content, not audio
    r = client.post("/api/tts", json={"text": "---\n**`  `**"})
    assert r.status_code == 204

def test_tts_voices_endpoint_serves_the_module_list(hermes_home):
    r = _client(hermes_home).get("/api/tts/voices")
    assert r.status_code == 200
    assert [v["id"] for v in r.json()] == [v["id"] for v in voice.TTS_VOICES]
    assert all(v["name"] for v in r.json())


from datetime import datetime

def test_time_of_day_buckets():
    assert voice.time_of_day(datetime(2026, 7, 31, 8, 0)) == "pagi"
    assert voice.time_of_day(datetime(2026, 7, 31, 13, 0)) == "siang"
    assert voice.time_of_day(datetime(2026, 7, 31, 17, 0)) == "sore"
    assert voice.time_of_day(datetime(2026, 7, 31, 21, 0)) == "malam"

def test_greeting_content_carries_no_instructions():
    body = voice.SmartTtsRequest(intent="greeting")
    content = voice.build_user_content(body, now=datetime(2026, 7, 31, 9, 30))
    # the content slot is data only — the verbs live in the system prompt
    assert "09:30" in content
    assert "pagi" in content
    assert "Sapa" not in content
    assert "Rangkum" not in content

def test_notify_content_carries_task_data_only():
    body = voice.SmartTtsRequest(intent="notify", task_text="jalankan pengujian",
                                 task_status="failed")
    content = voice.build_user_content(body)
    assert "jalankan pengujian" in content
    assert "gagal" in content
    assert "Ringkas" not in content

def test_system_prompt_task_line_differs_per_intent():
    args = ("Lail Agent", 40, "professional")
    summary = voice.build_system_prompt("summary", *args)
    greeting = voice.build_system_prompt("greeting", *args)
    notify = voice.build_system_prompt("notify", *args)
    assert "Rangkum" in summary and "Sapa" not in summary
    assert "Sapa" in greeting and "Rangkum" not in greeting
    assert "Umumkan" in notify
    # personality and identity are shared by all three
    for p in (summary, greeting, notify):
        assert "Lail Agent" in p
        assert "asisten eksekutif" in p

def test_fallback_is_speakable_per_intent():
    now = datetime(2026, 7, 31, 9, 30)
    greet = voice.fallback_text(voice.SmartTtsRequest(intent="greeting"),
                                "Lail Agent", now=now)
    # never the instruction text, and never the generic "nothing to summarise"
    assert "Lail Agent" in greet and "pagi" in greet
    assert "Sapa" not in greet

    notify = voice.fallback_text(
        voice.SmartTtsRequest(intent="notify", task_text="build rilis",
                              task_status="done"), "Lail Agent")
    assert "build rilis" in notify and "berhasil" in notify

    summ = voice.fallback_text(
        voice.SmartTtsRequest(text="# Judul\nisi panjang"), "Lail Agent")
    assert summ.startswith("Judul")

    empty = voice.fallback_text(voice.SmartTtsRequest(text=""), "Lail Agent")
    assert empty == "Tidak ada yang bisa dirangkum."

def test_smart_rejects_unknown_intent(hermes_home):
    r = _client(hermes_home).post("/api/tts/smart",
                                  json={"text": "x", "intent": "sing"})
    assert r.status_code == 422

def test_smart_greeting_speaks_fallback_without_api_key(hermes_home, monkeypatch):
    """No API key is the common first-run state; the operator must still be
    greeted, and must never hear the prompt we would have sent the model."""
    recorder = {}
    install_fake_edge_tts(monkeypatch, recorder)
    r = _client(hermes_home).post("/api/tts/smart", json={"intent": "greeting"})
    assert r.status_code == 200, r.text
    assert "Lail Agent" in recorder["text"]
    assert "Sapa pengguna" not in recorder["text"]


def test_smart_summary_speaks_fallback_without_api_key(hermes_home, monkeypatch):
    recorder = {}
    install_fake_edge_tts(monkeypatch, recorder)
    r = _client(hermes_home).post("/api/tts/smart", json={"intent": "summary", "text": "# Judul\nIsi teks"})
    assert r.status_code == 200, r.text
    assert recorder["text"] == "Judul\nIsi teks"


def test_smart_notify_speaks_fallback_without_api_key(hermes_home, monkeypatch):
    recorder = {}
    install_fake_edge_tts(monkeypatch, recorder)
    r = _client(hermes_home).post(
        "/api/tts/smart",
        json={"intent": "notify", "task_text": "run test suite", "task_status": "done"}
    )
    assert r.status_code == 200, r.text
    assert recorder["text"] == "run test suite sudah berhasil."

def test_strip_voice_tag_splits_the_spoken_line_from_the_display_text():
    display, spoken = voice.strip_voice_tag(
        "<voice>Semua pengujian lulus.</voice>\n\n## Hasil\nDetail panjang.")
    assert spoken == "Semua pengujian lulus."
    assert display == "## Hasil\nDetail panjang."
    assert "<voice>" not in display

def test_strip_voice_tag_handles_a_tag_that_is_not_first():
    display, spoken = voice.strip_voice_tag("Halo.\n<voice>Ringkasnya begini.</voice>\nSisa.")
    assert spoken == "Ringkasnya begini."
    assert display == "Halo.\nSisa."

def test_strip_voice_tag_leaves_untagged_text_alone():
    assert voice.strip_voice_tag("Tidak ada tag di sini.") == ("Tidak ada tag di sini.", "")

def test_strip_voice_tag_recovers_an_unclosed_tag_as_display_text():
    # the model opened the tag and never closed it: better to show the answer
    # and fall back to the summariser than to lose the reply
    display, spoken = voice.strip_voice_tag("<voice>Ini seluruh jawaban tanpa penutup")
    assert spoken == ""
    assert display == "Ini seluruh jawaban tanpa penutup"

def test_strip_voice_tag_refuses_an_oversized_spoken_line():
    long = "x" * (voice.MAX_VOICE_CHARS + 1)
    display, spoken = voice.strip_voice_tag(f"<voice>{long}</voice>Sisa.")
    # the model ignored "one sentence" — show it, do not speak a paragraph
    assert spoken == ""
    assert long in display

def test_strip_voice_tag_removes_every_occurrence_but_speaks_the_first():
    display, spoken = voice.strip_voice_tag(
        "<voice>Satu.</voice>Isi.<voice>Dua.</voice>Lagi.")
    assert spoken == "Satu."
    assert "<voice>" not in display and "Dua." not in display

def test_voice_tag_instruction_is_gated_on_smart_tts(hermes_home):
    from hermes import config
    off = config.Settings(tts_enabled=False)
    verbatim = config.Settings(tts_enabled=True, tts_mode="verbatim")
    smart = config.Settings(tts_enabled=True, tts_mode="smart")
    # ~90 prompt tokens per turn is not free: only the mode that benefits pays
    assert voice.voice_tag_instruction(off) == ""
    assert voice.voice_tag_instruction(verbatim) == ""
    instruction = voice.voice_tag_instruction(smart)
    assert voice.VOICE_TAG_OPEN in instruction
    assert voice.VOICE_TAG_CLOSE in instruction

def test_voice_tag_instruction_round_trips_through_the_stripper(hermes_home):
    from hermes import config
    # whatever shape the instruction asks for, the stripper must understand it
    instruction = voice.voice_tag_instruction(
        config.Settings(tts_enabled=True, tts_mode="smart"))
    example = instruction[instruction.index(voice.VOICE_TAG_OPEN):]
    example = example[:example.index(voice.VOICE_TAG_CLOSE) + len(voice.VOICE_TAG_CLOSE)]
    _, spoken = voice.strip_voice_tag(example + " sisa jawaban")
    assert spoken

def test_voice_tag_grammar_matches_the_client():
    """The extractor in app/web/src/voicetag.ts and the stripper here must
    agree, or a tag written by one is invisible to the other."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "web" / "src" / "voicetag.ts")
    text = src.read_text(encoding="utf-8")
    assert f"VOICE_TAG_OPEN = '{voice.VOICE_TAG_OPEN}'" in text
    assert f"VOICE_TAG_CLOSE = '{voice.VOICE_TAG_CLOSE}'" in text
    assert f"MAX_VOICE_CHARS = {voice.MAX_VOICE_CHARS}" in text
