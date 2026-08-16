"""The conversational chat turn: MCP tool dispatch, start_task auto-routing,
the pending write-action gate, and fact learning.

Transport-agnostic on purpose. This used to live only inside
`hermes/web_ui.py`'s FastAPI closures; the Telegram bot's free-text messages
answered with a canned greeting instead of reaching any of it. Splitting the
same behavior into two copies for two transports is exactly the drift
`docs/TODO.md`'s "what went wrong three times" section warns about, except
for logic instead of prose — so there is one engine, and both `web_ui.py` and
`hermes/main.py`'s Telegram wiring call the same instance.
"""
from __future__ import annotations
import asyncio
import inspect
import json
import re
from pathlib import Path

from . import brain, config, figma_browser, ics, imagegen, launcher, mcp_hub, mcp_risk, paths, postmortem, uploads, ytclip
from .pending_actions import PendingAction, PendingStore
from .project_resolve import parse_project_ref
from .telegram_bridge import new_task_id

CHAT_HISTORY_LIMIT = 20   # turns fed back to the model — caps prompt cost
IMAGE_MARKER = "\n\n[gambar dilampirkan]"

# How long the start_task tool waits for handle_task to settle its gate before
# answering the model. The slow part is one `git status` subprocess, so this is
# generous; the task itself keeps running in the background either way.
START_TASK_DECISION_TIMEOUT_S = 5.0

# Code work aimed at a registered @project is routed into start_task by THIS
# code, not by the model's judgement. See wants_code_task below for the full
# rationale (moved verbatim from web_ui.py).
_QUESTION = re.compile(
    r"^\s*(apa\w*|kenapa|mengapa|gimana|bagaimana|berapa|kapan|siapa|mana|"
    r"why|what|how|when|where|which|who|is|are|does|do|can|should)\b", re.I)
_DISCUSSION = re.compile(
    r"^\s*(jelas\w*|terangkan|uraikan|ringkas\w*|rangkum\w*|analis\w*|"
    r"bandingkan|review|telaah|periksa|cek|baca|lihat|"
    r"explain|describe|summar\w*|compare|analyz\w*|analys\w*|show me)\b", re.I)


def wants_code_task(text: str, settings, session_project: str | None = None) -> bool:
    """True when this chat turn is code work on a registered project.

    Unregistered names are left alone on purpose: start_task would only reject
    them, and the model's own answer (which lists the registered names) is the
    more useful reply.
    """
    name, rest = parse_project_ref(text)
    if name is None and session_project:
        name = session_project
    if name is None or name not in settings.projects:
        return False
    if not rest.strip():
        return False               # the sigil alone asks for nothing
    if rest.rstrip().endswith("?") or _QUESTION.match(rest):
        return False
    return not _DISCUSSION.match(rest)


AUTO_TASK_NOTE = (
    "[SISTEM] Permintaan ini menyebut proyek terdaftar dan menyangkut kode, "
    "jadi `start_task` SUDAH dijalankan otomatis untuk teks itu apa adanya. "
    "Hasil alat: {result}\n"
    "Laporkan `status`, `reasons`, dan Task ID di atas apa adanya — `running` "
    "berarti task baru mulai, bukan selesai. JANGAN memanggil `start_task` "
    "lagi untuk permintaan ini dan JANGAN menulis patch/diff di chat: yang "
    "mengerjakan kodenya adalah task itu."
)

# Sent as the last user turn of a resume request, never stored. The retry
# policy lives here rather than in a server-side loop on purpose: re-calling
# a write tool blind can repeat its side effect, so the model — which can
# read the error and fix the arguments — decides whether a second attempt is
# safe, and it is told plainly that stopping quietly is not an option.
RESUME_NUDGE = (
    "Aksi yang tadi tertahan sudah dieksekusi dan hasilnya ada di pesan terakhir. "
    "Periksa hasil itu dulu: kalau berhasil, lanjutkan rencanamu ke langkah "
    "berikutnya tanpa menunggu perintah baru. Kalau hasilnya error atau kosong, "
    "JANGAN mengaku berhasil dan jangan berhenti — perbaiki argumennya lalu "
    "panggil tool-nya lagi, atau tempuh cara lain untuk tujuan yang sama. "
    "Kalau sudah dicoba ulang dan tetap gagal, sebutkan jelas apa yang gagal "
    "dan apa yang kamu butuhkan dari operator."
)

# Senior UI/UX design-token guide, prepended to figma_web_design's tool
# description. A from-scratch design has no mockup to copy fidelity from —
# without a concrete scale to pick numbers from, the model free-hands
# spacing/type/color and produces the classic "AI-generated UI" tell:
# inconsistent gaps, five different font sizes, low-contrast text. Giving it
# one fixed scale (not a range) means every element in one build actually
# shares a system instead of each being independently "close enough".
_FIGMA_DESIGN_SYSTEM_GUIDE = (
    "ATURAN DESAIN SENIOR UI/UX — pakai untuk SETIAP desain, termasuk yang "
    "dibuat dari nol (tanpa gambar referensi):\n"
    "- SPACING (8pt grid): semua padding/gap/itemSpacing HARUS salah satu "
    "dari 4/8/12/16/24/32/48/64px. Jangan pakai angka acak (mis. 18, 22, "
    "35) — itu ciri khas desain AI yang terlihat berantakan.\n"
    "- TYPE SCALE: caption 12, body kecil 14, body 16, subjudul 20, h3 24, "
    "h2 28, h1/hero 32-40. Maksimal 2-3 ukuran berbeda per layar; jangan "
    "campur banyak ukuran untuk elemen sejenis.\n"
    "- HIERARKI: HANYA SATU judul besar bold per layar/section. Body text "
    "selalu Regular (bold=false), kecuali label tombol/CTA.\n"
    "- RADIUS: kecil/input 8-12, card 16, pill/tombol/avatar 999 (penuh "
    "bulat). Konsisten dalam satu layar — jangan campur kotak tajam dan "
    "sangat bulat tanpa alasan.\n"
    "- WARNA — palet netral konkret, jangan menebak-nebak tiap kali: "
    "background layar #FFFFFF atau #F8FAFC; permukaan card #FFFFFF (kalau "
    "background layarnya abu) atau #F8FAFC/#F1F5F9 (kalau background "
    "layarnya putih) — card harus BEDA sedikit dari background di "
    "belakangnya, jangan sama persis; border/pembatas tipis #E2E8F0; teks "
    "utama #0F172A atau #1E293B; teks sekunder/caption #64748B atau "
    "#94A3B8. SATU warna aksen/primary dipakai KONSISTEN untuk SEMUA "
    "elemen interaktif utama (tombol CTA, link aktif, ikon terpilih) dalam "
    "satu layar — jangan ganti hue aksen di tengah layar. Kontras "
    "teks-latar WAJIB terbaca: teks gelap di latar terang, teks putih di "
    "latar gelap/jenuh — jangan taruh teks sekunder (#94A3B8 ke bawah) "
    "untuk teks yang penting dibaca, hanya untuk placeholder/caption yang "
    "memang boleh redup. Warna semantik (hijau=sukses, merah=bahaya, "
    "kuning=peringatan) HANYA untuk status/badge yang benar-benar makna "
    "itu — jangan dipakai sebagai dekorasi.\n"
    "- SHADOW/ELEVATION: field `shadow`+`elevation` ('subtle'/'medium'/"
    "'strong', default 'subtle'). 'subtle' = card biasa yang istirahat di "
    "atas background-nya sendiri (list item, product card — PALING SERING "
    "dipakai). 'medium' = card yang perlu menonjol dari background ramai/"
    "berwarna/foto, atau dropdown/popover. 'strong' = HANYA untuk SATU "
    "elemen paling mengambang di layar (modal, floating action button) — "
    "jangan pakai 'strong' untuk banyak elemen sekaligus, itu bikin semua "
    "kelihatan sama pentingnya (= tidak ada yang penting). Card FLAT tanpa "
    "shadow (cukup border tipis) untuk daftar/list yang statis dan tidak "
    "actionable.\n"
    "- CARD: kombinasi backgroundColor (surface, lihat WARNA) + "
    "borderRadius 16 + padding 16-24 + salah SATU dari borderColor tipis "
    "ATAU shadow (bukan dua-duanya sekaligus kecuali memang diminta). "
    "Beberapa card sejenis dikelompokkan lewat ROW (kalau muat sejajar, "
    "mis. 2-3 stat card) atau STACK (kalau berturutan vertikal, mis. "
    "daftar transaksi) — jangan taruh card langsung sebagai children "
    "campur-baur tanpa pembungkus kalau memang harusnya satu grup rapi.\n"
    "- LAYOUT: urutan visual atas→bawah mengikuti prioritas informasi — "
    "header/hero → judul → konten inti → aksi utama (tombol) → aksi "
    "sekunder (link kecil di bawah). ROW hanya kalau elemen sejenis MUAT "
    "sejajar dengan lebar wajar (2-3 item pas di layar mobile ~375px); "
    "kalau item terlalu banyak untuk sejajar (4+), susun VERTICAL (STACK) "
    "sebagai gantinya, jangan dipaksa sejajar sampai kegepengan. Untuk "
    "STACK/ROW yang isinya banyak elemen, beri `height` yang REALISTIS "
    "untuk isinya (perkirakan: jumlah total tinggi tiap anak + gap antar "
    "anak + padding atas-bawah, lalu tambah sedikit slack) — height yang "
    "kekecilan untuk isinya bikin proses pembuatannya gagal menata elemen "
    "dengan benar.\n"
    "- WHITESPACE konsisten: satu `itemSpacing` dan satu `padding` per "
    "frame/composite, bukan beda-beda tiap anak tanpa alasan visual."
)

# Leaf-level figma_web_design child item — the bottom of the nesting depth
# built by _figma_child_item_schema below. No `type` enum entries for
# ROW/STACK and no `children` field at this level.
_FIGMA_CHILD_LEAF_PROPS = {
    "type": {"type": "string", "enum": [
        "TEXT", "HEADER_IMAGE", "AVATAR", "INPUT", "BUTTON",
        "CHECKBOX", "FOOTER_LINK", "RECTANGLE",
    ], "description": (
        "TEXT=teks biasa (judul/label/paragraf). "
        "HEADER_IMAGE=area gambar/banner besar di atas — isi `photoQuery` "
        "dengan kata kunci foto (mis. 'golden retriever puppy') untuk foto "
        "asli, atau biarkan kosong untuk kotak placeholder berwarna. "
        "AVATAR=lingkaran foto profil/icon bulat — `photoQuery` juga "
        "berlaku (mis. 'woman portrait'). "
        "INPUT=kotak form dengan teks placeholder di dalamnya. "
        "BUTTON=tombol berwarna dengan label teks di tengah. "
        "CHECKBOX=kotak centang kecil + label di sampingnya. "
        "FOOTER_LINK=teks link kecil biasanya di bawah (mis. "
        "'Sudah punya akun? Masuk'). RECTANGLE=kotak/card polos "
        "generik kalau tidak cocok tipe lain."
    )},
    "content": {"type": "string", "description": "isi teks untuk TEXT/FOOTER_LINK/CHECKBOX (label)"},
    "photoQuery": {"type": "string", "description": "kata kunci pencarian foto asli (Unsplash) untuk HEADER_IMAGE/AVATAR, mis. 'golden retriever puppy'. Kosongkan untuk placeholder warna polos."},
    "text": {"type": "string", "description": "label tombol untuk BUTTON (mis. 'Create account')"},
    "placeholder": {"type": "string", "description": "teks placeholder untuk INPUT (mis. 'Your email')"},
    "fontSize": {"type": "integer", "description": "ukuran font teks, dalam px"},
    "color": {"type": "string", "description": "warna hex teks, atau warna isi (fill) untuk HEADER_IMAGE/AVATAR/BUTTON/RECTANGLE"},
    "textColor": {"type": "string", "description": "warna hex label teks di dalam BUTTON, default putih"},
    "backgroundColor": {"type": "string", "description": "warna hex latar/fill untuk INPUT atau BUTTON/RECTANGLE (alias dari `color`), default abu muda"},
    "size": {"type": "integer", "description": "diameter AVATAR dalam px (lingkaran)"},
    "width": {"type": "integer", "description": "lebar elemen dalam px (kosongkan untuk full-width otomatis, atau untuk pembagian rata di dalam ROW)"},
    "height": {"type": "integer", "description": "tinggi elemen dalam px"},
    "borderRadius": {"type": "integer", "description": "corner radius dalam px"},
    "bold": {"type": "boolean", "description": "true untuk teks tebal (judul/label penting) pada TEXT/BUTTON, default false (Regular)"},
    "borderColor": {"type": "string", "description": "warna hex garis pinggir (stroke). INPUT sudah otomatis dapat border abu muda meski field ini kosong; isi untuk tipe lain (BUTTON/RECTANGLE/AVATAR/HEADER_IMAGE/ROW) kalau di gambar terlihat ada garis pinggir"},
    "borderWidth": {"type": "integer", "description": "ketebalan border dalam px, default 1"},
    "shadow": {"type": "boolean", "description": "true kalau elemen di gambar terlihat 'mengambang' (drop shadow) — umum untuk card/button di atas latar polos"},
    "elevation": {"type": "string", "enum": ["subtle", "medium", "strong"], "description": "seberapa 'mengambang' shadow-nya (hanya berlaku kalau `shadow`=true), default 'subtle'. subtle=card biasa di atas background sendiri (paling umum). medium=card yang perlu menonjol dari background ramai/berwarna, atau dropdown. strong=HANYA untuk satu elemen paling mengambang di layar (modal/FAB) — jangan pakai untuk banyak elemen sekaligus."},
}


def _figma_child_item_schema(container_depth: int) -> dict:
    """Build a figma_web_design child-item schema, `container_depth` levels
    of ROW/STACK nesting deep (0 = leaf items only, no ROW/STACK type, no
    `children` field).

    Function-calling JSON Schema has no true self-reference, so nesting is
    capped by generating this many levels explicitly rather than recursing.
    The backend's `_place_items` is already fully recursive and would honor
    any depth — 2 levels here is a schema-complexity cap, not a backend
    limit — chosen to cover realistic cases (e.g. a ROW of cards, each card
    a STACK of icon+title+subtitle) without an unbounded schema.
    """
    if container_depth <= 0:
        return {"type": "object", "properties": dict(_FIGMA_CHILD_LEAF_PROPS)}
    type_with_containers = {**_FIGMA_CHILD_LEAF_PROPS["type"], "enum": [
        *_FIGMA_CHILD_LEAF_PROPS["type"]["enum"], "ROW", "STACK", "GRID",
    ], "description": (
        _FIGMA_CHILD_LEAF_PROPS["type"]["description"] +
        " ROW=beberapa elemen SEJAJAR HORIZONTAL dalam satu baris (mis. "
        "beberapa tombol aksi berdampingan) — isi lewat `children` di "
        "bawah, BUKAN lewat `text`/`content`. STACK=beberapa elemen "
        "bertumpuk VERTIKAL menyatu jadi satu grup (mis. icon+judul+"
        "subjudul di dalam satu card) — isi lewat `children`; tiap anak "
        "otomatis selebar STACK kecuali diisi `width` eksplisit. "
        "GRID=elemen sejenis tersusun dalam kolom×baris (mis. galeri foto, "
        "grid kategori/ikon, papan produk) — isi lewat `children` dalam "
        "urutan baca NORMAL (kiri-ke-kanan, atas-ke-bawah, seperti akan "
        "dibaca manusia); wajib isi `columns` (jumlah kolom, baris "
        "menyesuaikan otomatis). Pakai GRID, bukan beberapa ROW manual, "
        "kalau jumlah item konsisten per baris dan ≥2 baris (mis. 6 ikon "
        "kategori dalam grid 3 kolom) — ROW tetap untuk SATU baris saja."
    )}
    return {"type": "object", "properties": {
        **_FIGMA_CHILD_LEAF_PROPS,
        "type": type_with_containers,
        "itemSpacing": {"type": "integer", "description": "jarak antar elemen di dalam ROW/STACK, atau jarak antar KOLOM di dalam GRID, dalam px, default 12 (GRID: 16)"},
        "rowSpacing": {"type": "integer", "description": "khusus GRID: jarak antar BARIS, dalam px, default sama dengan itemSpacing"},
        "columns": {"type": "integer", "description": "khusus GRID (WAJIB): jumlah kolom, mis. 2 atau 3. Baris ditambah otomatis sesuai jumlah children."},
        "padding": {"type": "integer", "description": "padding dalam ROW/STACK/GRID (dipakai kalau juga berfungsi sebagai card berwarna, mis. baris transaksi), dalam px, default 0"},
        "children": {
            "type": "array",
            "description": "Elemen di dalam ROW/STACK/GRID. ROW=kiri ke kanan, STACK=atas ke bawah, GRID=urutan baca normal kiri-ke-kanan lalu atas-ke-bawah (backend yang mengatur ulang untuk penataan grid Figma). Hanya dipakai bila type=ROW, STACK, atau GRID.",
            "items": _figma_child_item_schema(container_depth - 1),
        },
    }}


# Tools the conversational agent may call. A curated, safe set — read-only
# system queries plus start_task, which only ever QUEUES a task held for the
# operator's one-tap confirm (bridge.handle_task force_confirm). Deliberately
# not the MCP hub: that exposes ask_user, which would deadlock a chat turn.
CHAT_TOOLS = [
    {"type": "function", "function": {
        "name": "list_projects",
        "description": "Daftar proyek terdaftar beserta path dan apakah foldernya ada di disk.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "recent_tasks",
        "description": "Beberapa task orkestrasi terakhir beserta status dan teksnya.",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "description": "jumlah maksimal, default 5"}}}}},
    {"type": "function", "function": {
        "name": "get_task_detail",
        "description": "Status dan potongan log terakhir sebuah task, berdasarkan task_id.",
        "parameters": {"type": "object", "properties": {
            "task_id": {"type": "string"}}, "required": ["task_id"]}}},
    {"type": "function", "function": {
        "name": "failure_report",
        "description": ("Ringkasan kegagalan task terakhir, dikelompokkan menurut jenisnya "
                        "(lingkungan / struktural / sesaat / kode) beserta yang berulang. "
                        "Pakai ini bila ditanya kenapa task sering gagal atau apa yang "
                        "perlu diperbaiki — jangan menebak dari ingatan."),
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "description": "berapa task terakhir diperiksa, default 50"}}}}},
    {"type": "function", "function": {
        "name": "start_task",
        "description": ("Antre lalu jalankan task orkestrasi. Bila permintaan menyebut "
                        "@nama-proyek, repositorinya bersih, dan pekerjaannya tidak "
                        "berisiko (push/deploy/hapus), task LANGSUNG berjalan; selain "
                        "itu task ditahan sampai operator menekan Run. Hasil pemanggilan "
                        "berisi status sebenarnya beserta alasannya — pakai itu, jangan "
                        "menebak."),
        "parameters": {"type": "object", "properties": {
            "description": {"type": "string",
                            "description": "instruksi task, mis. '@myprofit jalankan pengujian'"}},
            "required": ["description"]}}},
    {"type": "function", "function": {
        "name": "calendar_events",
        "description": ("Acara Google Calendar yang akan datang, dibaca dari alamat "
                        "iCal rahasia di setelan. Read-only — tidak bisa membuat, "
                        "mengubah, atau menghapus acara. Pakai ini bila ditanya "
                        "jadwal, rapat, atau agenda; jangan menebak dari ingatan."),
        "parameters": {"type": "object", "properties": {
            "days": {"type": "integer",
                     "description": "rentang hari ke depan, default 7, maksimal 60"}}}}},
    {"type": "function", "function": {
        "name": "open_app",
        "description": ("Buka aplikasi desktop yang dikenal (mis. paint, notepad, calculator, "
                        "explorer, wordpad) ATAU sebuah URL http/https, langsung di komputer "
                        "pengguna. Langsung DIBUKA tanpa konfirmasi operator — bukan aksi "
                        "tertahan. Setelah status 'opened', katakan sudah dibuka. Hanya app "
                        "dalam daftar aman yang bisa; lainnya balas 'unknown_app'."),
        "parameters": {"type": "object", "properties": {
            "target": {"type": "string",
                       "description": "nama app (mis. 'paint') atau URL (mis. 'https://calendar.google.com')"}},
            "required": ["target"]}}},
    {"type": "function", "function": {
        "name": "generate_image",
        "description": ("Buat/generate gambar dari deskripsi teks dan tampilkan ke "
                        "pengguna. Pakai ini bila pengguna minta dibuatkan gambar, "
                        "ilustrasi, logo, ikon, atau foto. Hasilnya berisi field "
                        "`markdown` — sertakan APA ADANYA di jawabanmu agar gambarnya "
                        "muncul. Jangan mengarang bahwa gambar sudah dibuat tanpa "
                        "memanggil alat ini."),
        "parameters": {"type": "object", "properties": {
            "prompt": {"type": "string",
                       "description": "deskripsi gambar dalam bahasa apa pun, sedetail mungkin"}},
            "required": ["prompt"]}}},
    {"type": "function", "function": {
        "name": "youtube_clip",
        "description": ("Potong sebuah klip dari video YouTube (atau URL video lain) "
                        "pada rentang waktu tertentu, lalu tampilkan ke pengguna. "
                        "Pakai bila pengguna minta dibuatkan klip/potongan/cuplikan "
                        "video dari sebuah tautan. Hasilnya berisi field `markdown` — "
                        "sertakan APA ADANYA di jawabanmu agar videonya muncul."),
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "URL video, mis. https://youtube.com/watch?v=..."},
            "start": {"type": "string", "description": "waktu mulai, detik atau MM:SS / HH:MM:SS"},
            "end": {"type": "string", "description": "waktu selesai, detik atau MM:SS / HH:MM:SS"},
            "vertical": {"type": "string", "enum": ["blur", "crop", "none"],
                         "description": "format 9:16 untuk Shorts/TikTok: 'blur' (utuh+background blur, DEFAULT), 'crop' (potong tengah), 'none' (rasio asli)."}},
            "required": ["url", "start", "end"]}}},
    {"type": "function", "function": {
        "name": "viral_clip",
        "description": ("Analisa sebuah video YouTube dan otomatis potong bagian yang "
                        "PALING BERPOTENSI VIRAL — memakai data 'most replayed' "
                        "(bagian yang paling banyak diputar ulang penonton) dari "
                        "YouTube. Pakai bila pengguna minta 'carikan bagian viral', "
                        "'potong yang menarik', atau memberi URL tanpa waktu mulai/"
                        "selesai. Durasi maksimal default 60 detik (1 menit). Hasilnya "
                        "berisi `markdown` (sertakan APA ADANYA agar video tampil), "
                        "serta `start`/`end`/`reason`."),
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "URL video YouTube"},
            "max_seconds": {"type": "integer",
                            "description": "durasi maks klip dalam detik, default 60 (maks 60)"},
            "vertical": {"type": "string", "enum": ["blur", "crop", "none"],
                         "description": "format 9:16 Shorts/TikTok, default 'blur' (utuh+background blur). 'crop' potong tengah, 'none' rasio asli."}},
            "required": ["url"]}}},
    {"type": "function", "function": {
        "name": "viral_clips",
        "description": ("Hasilkan BEBERAPA (default 3) kandidat klip viral dari satu "
                        "video YouTube sekaligus: tiap kandidat adalah bagian yang "
                        "paling banyak diputar ulang, LENGKAP dengan judul viral yang "
                        "dibuatkan otomatis. Pakai bila pengguna minta 'beberapa "
                        "kandidat', 'top 3', atau pilihan klip. Hasil berisi daftar "
                        "`candidates`, tiap item punya `title`, `start`, `end`, dan "
                        "`markdown` — tampilkan SETIAP `markdown` apa adanya agar "
                        "semua videonya muncul."),
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "URL video YouTube"},
            "count": {"type": "integer", "description": "jumlah kandidat, default 3 (maks 3)"},
            "max_seconds": {"type": "integer",
                            "description": "durasi maks tiap klip, default 60 (maks 60)"},
            "vertical": {"type": "string", "enum": ["blur", "crop", "none"],
                         "description": "format 9:16 Shorts/TikTok, default 'blur'. 'crop' potong tengah, 'none' rasio asli."}},
            "required": ["url"]}}},
    {"type": "function", "function": {
        "name": "figma_web_design",
        "description": ("Desain frame/UI baru langsung di Figma Web (browser) "
                        "menggunakan automation UI asli (draw tools + panel Figma), "
                        "bukan API/plugin. Menghasilkan frame, AutoLayout, warna, dan "
                        "elemen UI, lalu mengembalikan screenshot preview-nya. Pakai "
                        "ini bila pengguna minta didesainkan frame / UI di Figma Web.\n\n"
                        + _FIGMA_DESIGN_SYSTEM_GUIDE + "\n\n"
                        "Jika pengguna melampirkan gambar (screenshot/mockup/referensi "
                        "UI) di chat, JADI senior UI/UX: baca gambar itu langsung — "
                        "tata letak, urutan elemen dari atas ke bawah, warna (hex "
                        "sedekat mungkin), teks persis, ukuran relatif tiap elemen — "
                        "lalu tuangkan sebagai `children` di bawah sedetail mungkin. "
                        "Jangan menebak generik; reproduksi apa yang benar-benar "
                        "terlihat di gambar, TAPI tetap rapikan ke skala spacing/type "
                        "di atas kalau gambarnya sendiri tidak presisi ke grid. Bila "
                        "TIDAK ada gambar (desain dari nol), rancang sendiri sebagai "
                        "senior UI/UX: tentukan hierarki informasi yang masuk akal, "
                        "lalu terapkan skala di atas — jangan sekadar menumpuk elemen "
                        "generik."),
        "parameters": {"type": "object", "properties": {
            "file_url": {"type": "string", "description": "URL dokumen Figma Web (misal https://www.figma.com/design/xxx/yyy)"},
            "frame_name": {"type": "string", "description": "nama frame UI, misal 'Login Screen'"},
            "layout_mode": {"type": "string", "enum": ["VERTICAL", "HORIZONTAL", "NONE"], "description": "orientasi AutoLayout frame utama"},
            "width": {"type": "integer", "description": "lebar frame dalam px, default 375"},
            "height": {"type": "integer", "description": "tinggi frame dalam px, default 812"},
            "background_color": {"type": "string", "description": "warna latar belakang hex, misal '#FFFFFF'"},
            "padding": {"type": "integer", "description": "padding inner frame dalam px, default 24"},
            "item_spacing": {"type": "integer", "description": "jarak antar elemen inner dalam px, default 16"},
            "children": {
                "type": "array",
                "description": (
                    "Elemen UI di dalam frame, URUT DARI ATAS KE BAWAH persis "
                    "seperti tersusun di gambar/permintaan pengguna."
                ),
                "items": _figma_child_item_schema(2),
            }},
            "required": ["frame_name"]}}},
    {"type": "function", "function": {
        "name": "figma_web_design_flow",
        "description": ("Desain BEBERAPA frame Figma Web sekaligus dalam SATU sesi "
                        "browser, disusun berjejer ke kanan di halaman yang sama "
                        "(mis. alur onboarding multi-layar, wizard beberapa langkah, "
                        "beberapa varian layar). Tiap item di `frames` punya struktur "
                        "PERSIS sama dengan parameter figma_web_design (minus "
                        "file_url) — frame_name, layout_mode, width, height, "
                        "background_color, padding, item_spacing, children. Pakai "
                        "tool ini HANYA bila pengguna eksplisit minta beberapa "
                        "layar/screen/langkah sekaligus; untuk satu frame tunggal "
                        "pakai figma_web_design biasa.\n\n"
                        + _FIGMA_DESIGN_SYSTEM_GUIDE + "\n\n"
                        "Tiap frame di `frames` mengikuti aturan desain di atas "
                        "sendiri-sendiri, TAPI tetap konsisten satu sama lain dalam "
                        "satu alur — warna aksen, radius, dan type scale yang sama "
                        "dipakai di semua layar kecuali pengguna minta beda."),
        "parameters": {"type": "object", "properties": {
            "file_url": {"type": "string", "description": "URL dokumen Figma Web (opsional)"},
            "frame_gap": {"type": "integer", "description": "jarak horizontal antar frame dalam px, default 120"},
            "frames": {
                "type": "array",
                "description": "Daftar frame, URUT sesuai alur yang diminta pengguna (frame pertama = layar pertama).",
                "items": {
                    "type": "object",
                    "properties": {
                        "frame_name": {"type": "string", "description": "nama frame UI, misal 'Onboarding 1'"},
                        "layout_mode": {"type": "string", "enum": ["VERTICAL", "HORIZONTAL", "NONE"], "description": "orientasi AutoLayout frame ini"},
                        "width": {"type": "integer", "description": "lebar frame dalam px, default 375"},
                        "height": {"type": "integer", "description": "tinggi frame dalam px, default 812"},
                        "background_color": {"type": "string", "description": "warna latar belakang hex, misal '#FFFFFF'"},
                        "padding": {"type": "integer", "description": "padding inner frame dalam px, default 24"},
                        "item_spacing": {"type": "integer", "description": "jarak antar elemen inner dalam px, default 16"},
                        "children": {
                            "type": "array",
                            "description": "Elemen UI di dalam frame ini, urut dari atas ke bawah.",
                            "items": _figma_child_item_schema(2),
                        }},
                    "required": ["frame_name"]},
            }},
            "required": ["frames"]}}},
    {"type": "function", "function": {
        "name": "figma_web_fix_photo",
        "description": ("Ganti SATU foto pada frame Figma yang sudah pernah dibuat "
                        "figma_web_design/figma_web_design_flow, TANPA membuat ulang "
                        "seluruh frame. Pakai ini bila hasil self-check (screenshot "
                        "setelah build) menunjukkan header/avatar seharusnya foto asli "
                        "tapi masih warna polos (photoQuery lupa disertakan, atau "
                        "pengambilan foto sebelumnya gagal). WAJIB pakai `file_url` "
                        "dari hasil `file_url` build sebelumnya (BUKAN `url`) dan "
                        "`node_name` dari salah satu entri `photo_nodes` pada hasil "
                        "build itu — jangan menebak nilainya."),
        "parameters": {"type": "object", "properties": {
            "file_url": {"type": "string", "description": "field `file_url` dari hasil figma_web_design/figma_web_design_flow sebelumnya (URL Figma yang nyata, bukan 'design/new')"},
            "node_name": {"type": "string", "description": "field `node_name` dari salah satu entri `photo_nodes` pada hasil build sebelumnya, misal 'hermes:photo:0:header'"},
            "photo_query": {"type": "string", "description": "kata kunci pencarian foto Unsplash, misal 'beach sunset'"}},
            "required": ["file_url", "node_name", "photo_query"]}}},
    {"type": "function", "function": {
        "name": "figma_login",
        "description": ("Buka browser visual Chrome/Edge agar pengguna bisa login "
                        "ke akun Figma secara manual. Browser akan tetap terbuka "
                        "sampai pengguna selesai login (maksimal 5 menit) dan "
                        "menyimpan sesinya secara permanen."),
        "parameters": {"type": "object", "properties": {}}}},
]


class ChatEngine:
    """One conversational agent, shared by every transport that talks to it.

    `bridge` is mutable and may start as None: `hermes/main.py` builds the
    engine before the Bridge exists (the Bridge needs a sender the bot
    constructs later), and fills it in once ready. `pending` may be handed in
    so two transports (web + Telegram) share one write-action queue.
    """

    def __init__(self, store, bridge=None, hub=None, facts=None,
                 pending: PendingStore | None = None):
        self.store = store
        self.bridge = bridge
        self.hub = hub
        self.facts = facts
        self.pending = pending if pending is not None else PendingStore()
        self._mcp_tools_cache = None

    def brain_context(self) -> dict:
        s = config.load_settings()
        return {"role": "system",
                "content": brain.context_block(self.store.list_facts(),
                                               self.store.list_tasks(limit=20),
                                               list(s.projects))}

    def history_with_context(self, sid: str, images: list[Path] | None = None) -> list[dict]:
        history = [self.brain_context(), *self.store.get_messages(sid, limit=CHAT_HISTORY_LIMIT)]
        if images and history[-1]["role"] == "user":
            said = history[-1]["content"].replace(IMAGE_MARKER, "")
            history[-1] = {"role": "user",
                           "content": uploads.as_content_parts(said, images)}
        return history

    async def history_for_turn(self, sid: str, text: str, images: list[Path] | None,
                               dispatch) -> tuple[list[dict], str | None]:
        history = self.history_with_context(sid, images)
        sess = self.store.get_session(sid)
        sproj = sess.get("project") if sess else None
        if not (text and wants_code_task(text, config.load_settings(), session_project=sproj)):
            return history, None
        result = await dispatch("start_task", {"description": text})
        try:
            task_id = json.loads(result).get("task_id")
        except ValueError:
            task_id = None
        return ([*history, {"role": "user",
                            "content": AUTO_TASK_NOTE.format(result=result)}],
                task_id)

    def task_card_suffix(self, reply: str, task_id: str | None,
                         template: str = "\n\nTask `{tid}`") -> str:
        if not task_id or task_id in reply:
            return ""
        return template.format(tid=task_id)

    def take_images(self, sid: str, names: list[str]) -> list[Path]:
        found = [uploads.resolve(paths.uploads_dir(), sid, n) for n in names or []]
        return [p for p in found if p is not None]

    def attach_images_to_task(self, desc: str, images: list[Path]) -> str:
        if not images:
            return desc
        name, _ = parse_project_ref(desc)
        proj = name and config.load_settings().projects.get(name)
        if not proj or not Path(proj).is_dir():
            return desc
        import shutil
        dest_dir = Path(proj) / ".hermes-uploads"
        dest_dir.mkdir(exist_ok=True)
        saved = []
        for img in images:
            dest = dest_dir / img.name
            try:
                shutil.copy2(img, dest)
            except OSError:
                continue
            saved.append(f".hermes-uploads/{img.name}")
        if not saved:
            return desc
        return desc + "\n\n[Gambar terlampir di: " + ", ".join(saved) + "]"

    async def learn_from_turn(self, user_text: str, reply: str) -> None:
        if self.facts is None or not reply.strip():
            return
        if not brain.worth_extracting(user_text):
            return
        try:
            for f in await self.facts(user_text, reply):
                self.store.set_fact(f["key"], f["value"])
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            print(f"Could not learn from turn: {safe}")

    def make_dispatch(self, session_id: str, images: list[Path] | None = None,
                      chat_id: int = 0, user_id: int = 0):
        started: dict = {}
        pending_created: list[PendingAction] = []

        async def chat_dispatch(name: str, args: dict) -> str:
            try:
                if name == "list_projects":
                    s = config.load_settings()
                    return json.dumps(
                        [{"name": n, "path": p, "exists": Path(p).exists()}
                         for n, p in s.projects.items()], ensure_ascii=False)
                if name == "recent_tasks":
                    limit = int(args.get("limit") or 5)
                    rows = [t for t in self.store.list_tasks() if t.get("chat_id", 0) >= 0][:limit]
                    return json.dumps(
                        [{"task_id": t["task_id"], "status": t["status"], "text": t["text"]}
                         for t in rows], ensure_ascii=False)
                if name == "get_task_detail":
                    tid = str(args.get("task_id") or "")
                    t = self.store.get_task(tid)
                    if not t:
                        return json.dumps({"error": "task tidak ditemukan"}, ensure_ascii=False)
                    return json.dumps(
                        {"task_id": tid, "status": t["status"], "text": t["text"],
                         "logs": self.store.get_logs(tid)[-8:]}, ensure_ascii=False)
                if name == "failure_report":
                    limit = int(args.get("limit") or 50)
                    rows = [t for t in self.store.list_tasks(limit=limit)
                            if t.get("chat_id", 0) >= 0]
                    summary = postmortem.summarize(rows, self.store.get_logs)
                    return json.dumps({**summary,
                                       "report": postmortem.render(summary)},
                                      ensure_ascii=False)
                if name == "generate_image":
                    s = config.load_settings()
                    if not s.image_model:
                        return json.dumps({"error": "image model tidak dikonfigurasi"},
                                          ensure_ascii=False)
                    prompt = str(args.get("prompt") or "").strip()
                    if not prompt:
                        return json.dumps({"error": "prompt kosong"}, ensure_ascii=False)
                    sec = config.load_secrets()
                    res = await asyncio.to_thread(
                        imagegen.generate, prompt,
                        base_url=s.nvidia_base_url, key=sec.nvidia_api_key,
                        model=s.image_model,
                        out_dir=paths.artifacts_dir() / "generated")
                    if res.get("status") == "generated":
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['path'])}"
                        if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                            try:
                                await self.bridge.send_file(chat_id, "screenshot", res["path"])
                            except Exception as e:
                                print(f"Could not send generated image to Telegram: {e}")
                        return json.dumps(
                            {"status": "generated", "url": url,
                             "markdown": f"![gambar]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)
                if name == "youtube_clip":
                    res = await asyncio.to_thread(
                        ytclip.clip, str(args.get("url") or ""),
                        start=args.get("start"), end=args.get("end"),
                        vertical=str(args.get("vertical") or "blur"),
                        out_dir=paths.artifacts_dir() / "clips")
                    if res.get("status") == "clipped":
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['path'])}"
                        if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                            try:
                                await self.bridge.send_file(chat_id, "document", res["path"])
                            except Exception as e:
                                print(f"Could not send clip to Telegram: {e}")
                        return json.dumps(
                            {"status": "clipped", "url": url, "seconds": res.get("seconds"),
                             "markdown": f"![clip]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)
                if name == "viral_clip":
                    try:
                        mx = min(float(args.get("max_seconds") or 60), 60.0)
                    except (TypeError, ValueError):
                        mx = 60.0
                    res = await asyncio.to_thread(
                        ytclip.viral_clip, str(args.get("url") or ""),
                        max_seconds=mx, vertical=str(args.get("vertical") or "blur"),
                        out_dir=paths.artifacts_dir() / "clips")
                    if res.get("status") == "clipped":
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['path'])}"
                        if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                            try:
                                await self.bridge.send_file(chat_id, "document", res["path"])
                            except Exception as e:
                                print(f"Could not send clip to Telegram: {e}")
                        return json.dumps(
                            {"status": "clipped", "url": url,
                             "start": res.get("start"), "end": res.get("end"),
                             "reason": res.get("reason"), "title": res.get("title"),
                             "markdown": f"![clip]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)
                if name == "viral_clips":
                    s = config.load_settings()
                    sec = config.load_secrets()
                    try:
                        mx = min(float(args.get("max_seconds") or 60), 60.0)
                    except (TypeError, ValueError):
                        mx = 60.0
                    try:
                        n = min(int(args.get("count") or 3), 3)
                    except (TypeError, ValueError):
                        n = 3
                    res = await asyncio.to_thread(
                        ytclip.viral_candidates, str(args.get("url") or ""),
                        n=n, max_seconds=mx, out_dir=paths.artifacts_dir() / "clips",
                        vertical=str(args.get("vertical") or "blur"),
                        base_url=s.nvidia_base_url, key=sec.nvidia_api_key,
                        model=(s.chat_model or s.model))
                    if res.get("status") == "ok":
                        from urllib.parse import quote
                        cands = []
                        for c in res["candidates"]:
                            u = f"/api/artifacts/view?path={quote(c['path'])}"
                            if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                                try:
                                    await self.bridge.send_file(chat_id, "document", c["path"])
                                except Exception as e:
                                    print(f"Could not send candidate clip to Telegram: {e}")
                            cands.append({"title": c["title"], "start": c["start"],
                                          "end": c["end"],
                                          "markdown": f"### {c['title']}\n![clip]({u})"})
                        return json.dumps({"status": "ok",
                                           "video_title": res["video_title"],
                                           "candidates": cands}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)

                if name == "figma_web_design":
                    file_url = args.get("file_url")
                    frame_name = str(args.get("frame_name") or "Hermes Frame")
                    spec = {
                        "name": frame_name,
                        "layoutMode": args.get("layout_mode") or "VERTICAL",
                        "width": int(args.get("width") or 375),
                        "height": int(args.get("height") or 812),
                        "backgroundColor": args.get("background_color") or "#0F172A",
                        "padding": int(args.get("padding") or 24),
                        "itemSpacing": int(args.get("item_spacing") or 16),
                        "children": args.get("children") or []
                    }
                    res = await figma_browser.design_figma_frame_web(
                        file_url=file_url, spec=spec, out_dir=paths.artifacts_dir() / "figma",
                        unsplash_key=config.load_secrets().unsplash_access_key or None,
                    )
                    if res.get("ok") and res.get("screenshot_path"):
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['screenshot_path'])}"
                        if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                            try:
                                await self.bridge.send_file(chat_id, "screenshot", res["screenshot_path"])
                            except Exception as e:
                                print(f"Could not send Figma screenshot to Telegram: {e}")
                        return json.dumps({**res, "url": url, "markdown": f"![Figma Preview]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)

                if name == "figma_web_design_flow":
                    file_url = args.get("file_url")
                    frame_items = args.get("frames") or []
                    specs = [{
                        "name": str(f.get("frame_name") or f"Frame {i + 1}"),
                        "layoutMode": f.get("layout_mode") or "VERTICAL",
                        "width": int(f.get("width") or 375),
                        "height": int(f.get("height") or 812),
                        "backgroundColor": f.get("background_color") or "#0F172A",
                        "padding": int(f.get("padding") or 24),
                        "itemSpacing": int(f.get("item_spacing") or 16),
                        "children": f.get("children") or [],
                    } for i, f in enumerate(frame_items)]
                    res = await figma_browser.design_multi_frame_web(
                        file_url=file_url, frames=specs, out_dir=paths.artifacts_dir() / "figma",
                        unsplash_key=config.load_secrets().unsplash_access_key or None,
                        frame_gap=float(args.get("frame_gap") or 120),
                    )
                    if res.get("ok") and res.get("screenshot_path"):
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['screenshot_path'])}"
                        if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                            try:
                                await self.bridge.send_file(chat_id, "screenshot", res["screenshot_path"])
                            except Exception as e:
                                print(f"Could not send Figma flow screenshot to Telegram: {e}")
                        return json.dumps({**res, "url": url, "markdown": f"![Figma Flow Preview]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)

                if name == "figma_web_fix_photo":
                    res = await figma_browser.fix_figma_photo(
                        file_url=str(args.get("file_url") or ""),
                        node_name=str(args.get("node_name") or ""),
                        photo_query=str(args.get("photo_query") or ""),
                        unsplash_key=config.load_secrets().unsplash_access_key or None,
                        out_dir=paths.artifacts_dir() / "figma",
                    )
                    if res.get("ok") and res.get("screenshot_path"):
                        from urllib.parse import quote
                        url = f"/api/artifacts/view?path={quote(res['screenshot_path'])}"
                        if chat_id and self.bridge and getattr(self.bridge, "send_file", None):
                            try:
                                await self.bridge.send_file(chat_id, "screenshot", res["screenshot_path"])
                            except Exception as e:
                                print(f"Could not send Figma fix screenshot to Telegram: {e}")
                        return json.dumps({**res, "url": url, "markdown": f"![Figma Fix Preview]({url})"}, ensure_ascii=False)
                    return json.dumps(res, ensure_ascii=False)

                if name == "figma_login":
                    res = await figma_browser.open_figma_login_session(timeout_s=300)
                    return json.dumps(res, ensure_ascii=False)

                if name == "start_task":
                    if started:
                        return json.dumps(
                            {**started,
                             "note": ("task untuk giliran ini sudah diantre — "
                                      "ini hasil yang sama, bukan task baru")},
                            ensure_ascii=False)
                    bridge = self.bridge
                    if not bridge:
                        return json.dumps({"error": "bridge tidak tersedia — tidak bisa antre task"},
                                          ensure_ascii=False)
                    desc = str(args.get("description") or "").strip()
                    if not desc:
                        return json.dumps({"error": "deskripsi task kosong"}, ensure_ascii=False)
                    desc = self.attach_images_to_task(desc, images or [])
                    new_id = new_task_id()
                    sig = inspect.signature(bridge.handle_task)
                    def accepts(param: str) -> bool:
                        return param in sig.parameters or any(
                            p.kind == p.VAR_KEYWORD for p in sig.parameters.values())
                    settled = asyncio.get_running_loop().create_future()
                    def on_decision(status: str, reasons: list):
                        if not settled.done():
                            settled.set_result({"status": status, "reasons": reasons})
                    kwargs = {}
                    if accepts("session_id"):
                        kwargs["session_id"] = session_id
                    if accepts("on_decision"):
                        kwargs["on_decision"] = on_decision
                    t = asyncio.create_task(bridge.handle_task(
                        user_id=user_id, chat_id=chat_id, text=desc, task_id=new_id,
                        trusted=True, force_confirm=True, **kwargs))
                    t.add_done_callback(_bg_crash_cb(self.store, new_id))
                    try:
                        outcome = await asyncio.wait_for(
                            settled, START_TASK_DECISION_TIMEOUT_S)
                    except asyncio.TimeoutError:
                        outcome = {"status": "queued", "reasons": [],
                                   "note": "gate belum memutuskan; lihat kartu task"}
                    started.update({"task_id": new_id, **outcome})
                    return json.dumps({"task_id": new_id, **outcome},
                                      ensure_ascii=False)
                if name == "calendar_events":
                    url = config.load_settings().calendar_ics_url
                    if not url:
                        return json.dumps(
                            {"error": ("alamat iCal kalender belum diisi — set "
                                       "calendar_ics_url di setelan (Google Calendar "
                                       "-> Setelan kalender -> Integrasikan kalender "
                                       "-> Alamat rahasia dalam format iCal)")},
                            ensure_ascii=False)
                    days = max(1, min(60, int(args.get("days") or 7)))
                    events = await ics.upcoming(url, days)
                    return json.dumps({"days": days, "events": events},
                                      ensure_ascii=False)
                if name == "open_app":
                    return json.dumps(launcher.open_app(str(args.get("target") or "")),
                                      ensure_ascii=False)
                # integrate_mcp/integrate_status/integrate_secret are NOT here —
                # see Global Constraints: that wizard stays web-only, layered on
                # top of this dispatch by web_ui.py (Task 3), not inside it.
                hub = self.hub
                if hub is not None and mcp_risk.is_mcp_name(name):
                    if config.load_settings().confirm_risky and mcp_risk.is_risky_tool(name):
                        pa = self.pending.add(name, args, session_id,
                                              chat_id=chat_id or None)
                        pending_created.append(pa)
                        return json.dumps({
                            "status": "pending_confirmation",
                            "pending_id": pa.id,
                            "tool": name, "args": args,
                            "note": ("Aksi menulis/mengirim/mengubah data ini TERTAHAN, "
                                     "menunggu persetujuan operator (tombol atau ucapkan "
                                     "'konfirmasi' / 'batal'). BELUM dijalankan — jangan "
                                     "mengaku sudah melakukannya."),
                        }, ensure_ascii=False)
                    result = await hub.call(name, args)
                    return result if isinstance(result, str) \
                        else json.dumps(result, ensure_ascii=False)
                return json.dumps({"error": f"tool tak dikenal: {name}"}, ensure_ascii=False)
            except Exception as e:
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                return json.dumps({"error": f"tool gagal: {safe}"}, ensure_ascii=False)

        chat_dispatch.pending_created = pending_created
        return chat_dispatch

    def wrap_dispatch(self, dispatch, extra: dict):
        """Layer transport-specific tool handlers on top of the shared dispatch,
        without teaching the engine about them. `extra` maps tool name ->
        async (args) -> str. Used by web_ui.py (Task 3) for integrate_mcp/
        integrate_status/integrate_secret, which stay web-only (Global
        Constraints). Preserves `dispatch.pending_created` on the wrapper so
        callers reading it after the fact (run_turn) still see it."""
        async def wrapped(name: str, args: dict) -> str:
            fn = extra.get(name)
            if fn is not None:
                return await fn(args)
            return await dispatch(name, args)
        wrapped.pending_created = dispatch.pending_created
        return wrapped

    async def chat_tools(self) -> list[dict]:
        base = list(CHAT_TOOLS)
        if not config.load_settings().image_model:
            base = [t for t in base if t["function"]["name"] != "generate_image"]
        import importlib.util
        if importlib.util.find_spec("yt_dlp") is None:
            base = [t for t in base
                    if t["function"]["name"] not in
                    ("youtube_clip", "viral_clip", "viral_clips")]
        hub = self.hub
        if hub is None:
            return base
        cache = self._mcp_tools_cache
        if not cache:
            try:
                cache = await hub.list_tools()
            except Exception as e:
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                print(f"MCP tool discovery failed, retrying next turn: {safe}")
                cache = []
            if cache:
                self._mcp_tools_cache = cache
        from .mcp_hub import to_openai_tools
        return base + to_openai_tools(cache)

    async def resolve_pending(self, pa: PendingAction, approved: bool) -> dict:
        self.pending.pop(pa.id)
        if not approved:
            msg = f"\u274c Aksi dibatalkan: {pa.summary()}."
            self.store.add_message(pa.conv_id, "assistant", msg)
            return {"id": pa.id, "approved": False, "tool": pa.tool, "message": msg}
        hub = self.hub
        if hub is None:
            msg = f"\u26a0\ufe0f Tidak bisa menjalankan {pa.summary()}: MCP tidak tersedia."
            self.store.add_message(pa.conv_id, "assistant", msg)
            return {"id": pa.id, "approved": True, "resume": True,
                    "error": "hub tidak tersedia", "message": msg}
        try:
            result = await hub.call(pa.tool, pa.args)
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            msg = f"\u26a0\ufe0f Gagal menjalankan {pa.summary()}: {safe}"
            self.store.add_message(pa.conv_id, "assistant", msg)
            return {"id": pa.id, "approved": True, "resume": True, "error": safe, "message": msg}
        text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        reason = mcp_hub.failure_reason(text)
        if reason:
            msg = f"\u26a0\ufe0f {pa.summary()} tidak berhasil: {reason}"
            self.store.add_message(pa.conv_id, "assistant", msg)
            return {"id": pa.id, "approved": True, "resume": True, "error": reason, "message": msg}
        msg = f"\u2705 {pa.summary()} selesai.\n\n{text[:800]}"
        self.store.add_message(pa.conv_id, "assistant", msg)
        return {"id": pa.id, "approved": True, "resume": True, "result": text, "message": msg}

    async def run_turn(self, session_id: str, text: str,
                       images: list[Path] | None = None, chat=None,
                       chat_id: int = 0, user_id: int = 0) -> dict:
        """One non-streaming conversational turn: record it, run the model
        (with auto-task routing and tool dispatch), persist the answer, learn
        from it. Used by both the web UI's non-streaming endpoint and every
        Telegram message."""
        text = (text or "").strip()
        self.store.add_message(session_id, "user", text + (IMAGE_MARKER if images else ""))
        dispatch = self.make_dispatch(session_id, images, chat_id=chat_id, user_id=user_id)
        if chat is None:
            s = config.load_settings()
            agent_name = s.agent_name or "Lail Agent"
            reply = (f"Halo! Saya {agent_name}, asisten orkestrasi Anda.\n\n"
                    "Untuk menjalankan tugas, gunakan `/task <deskripsi>`.")
            auto_id = None
        else:
            try:
                turn, auto_id = await self.history_for_turn(session_id, text, images, dispatch)
                reply = await chat(turn, tools=await self.chat_tools(), dispatch=dispatch)
            except Exception as e:
                safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
                reply = f"(Maaf, chat gagal: {safe})"
                auto_id = None
        from . import voice
        clean, _ = voice.strip_voice_tag(reply)
        clean += self.task_card_suffix(clean, auto_id)
        self.store.add_message(session_id, "assistant", clean)
        if images:
            uploads.discard(images)
        await self.learn_from_turn(text, clean)
        return {"reply": clean, "task_id": auto_id,
                "pending": [{"id": pa.id, "tool": pa.tool, "args": pa.args,
                             "summary": pa.summary()}
                            for pa in dispatch.pending_created]}

    async def run_resume_turn(self, session_id: str, chat, chat_id: int = 0,
                              user_id: int = 0) -> dict:
        """The turn after an approved write action ran: no new operator
        message, just the model picking its plan back up. Mirrors the web
        SSE endpoint's `resume` branch."""
        dispatch = self.make_dispatch(session_id, None, chat_id=chat_id, user_id=user_id)
        history = [*self.history_with_context(session_id),
                  {"role": "user", "content": RESUME_NUDGE}]
        try:
            reply = await chat(history, tools=await self.chat_tools(), dispatch=dispatch)
        except Exception as e:
            safe = str(e).encode("ascii", "backslashreplace").decode("ascii")
            reply = f"(Maaf, chat gagal: {safe})"
        from . import voice
        clean, _ = voice.strip_voice_tag(reply)
        self.store.add_message(session_id, "assistant", clean)
        return {"reply": clean,
                "pending": [{"id": pa.id, "tool": pa.tool, "args": pa.args,
                             "summary": pa.summary()}
                            for pa in dispatch.pending_created]}


def _bg_crash_cb(store, task_id: str):
    def _cb(t: asyncio.Task):
        if t.cancelled():
            return
        exc = t.exception()
        if exc is None:
            return
        safe = repr(exc).encode("ascii", "backslashreplace").decode("ascii")
        print(f"Background task crashed: {safe}")
        try:
            store.append_log(task_id, f"error: background task crashed: {exc}")
            store.set_task_status(task_id, "failed")
        except Exception:
            pass
    return _cb
