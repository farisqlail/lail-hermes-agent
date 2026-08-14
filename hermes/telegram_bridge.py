from __future__ import annotations
import re, secrets, time
from pathlib import Path
from .config import Settings
from .session_store import Store
from .project_resolve import (
    parse_project_ref, parse_engine_ref, resolve_project, ProjectNotFound, ProjectPathMissing)

def is_allowed(user_id: int, settings: Settings) -> bool:
    return user_id in settings.allowed_user_ids

def help_text() -> str:
    return (
        "🤖 Lail Hermes — panduan perintah & chat\n"
        "\n"
        "Perintah & Chat:\n"
        "Pesan teks bebas (tanpa /) akan dijawab oleh Asisten AI. Kamu bisa bertanya status task, riwayat kegagalan, membuat klip, atau mengirim gambar & pesan suara.\n"
        "/task <deskripsi> — buat tugas baru di workspace baru\n"
        "/task @nama <deskripsi> — jalankan tugas di project terdaftar\n"
        "/projects — daftar project yang terdaftar (untuk @nama)\n"
        "/help — tampilkan panduan ini\n"
        "\n"
        "Contoh:\n"
        "apa saja task yang gagal belakangan ini?\n"
        "@sayur perbaiki bug login di halaman kasir\n"
        "/task buat app counter Flutter, build APK, test di emulator\n"
        "\n"
        "Aksi Berisiko & MCP:\n"
        "Aksi MCP menulis/mengirim data (seperti email atau edit berkas) dan task berisiko akan memunculkan tombol konfirmasi langsung di chat Telegram ini.\n"
        "\n"
        "Pengaturan: web UI di http://127.0.0.1:8799."
    )

def projects_overview(settings: Settings) -> str:
    if not settings.projects:
        return ("Belum ada project terdaftar.\n"
                "Tambahkan lewat panel Projects Registry di web UI "
                "http://127.0.0.1:8799, lalu pakai `/task @nama <deskripsi>`.")
    lines = ["Project terdaftar:"]
    for name in sorted(settings.projects):
        path = settings.projects[name]
        missing = "" if Path(path).is_dir() else "  ⚠ folder hilang"
        lines.append(f"  @{name} — {path}{missing}")
    lines.append("")
    lines.append("Pakai: /task @nama <deskripsi>")
    return "\n".join(lines)

def new_task_id() -> str:
    return time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)

_DELETE_VERBS = r"(?:delete|remove|hapus(?:kan)?|erase|wipe|drop)"
_FS_OBJECTS = (r"(?:files?|berkas|folders?|director(?:y|ies)|dir|repo(?:sitory)?|"
               r"database|db|tab(?:le|el)|workspace|proje[ck]t|semuanya|everything)")
_RISKY_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bgit\s+push\b", re.I), "runs `git push`"),
    (re.compile(r"\brm\s+-[a-z]*[rf]\b|\bdel\s+/|\brmdir\b|\bgit\s+clean\b", re.I),
     "deletes files"),
    (re.compile(rf"\b{_DELETE_VERBS}\b[^.,;\n]{{0,60}}\b{_FS_OBJECTS}\b", re.I),
     "deletes files"),
    (re.compile(r"(?:^|[\s\"'=(])(?:[A-Za-z]:[\\/]|/etc/|~[\\/]|\.\.[\\/])"),
     "touches paths outside the project dir"),
]

def detect_risky(text: str) -> list[str]:
    reasons = []
    for rx, reason in _RISKY_PATTERNS:
        if rx.search(text) and reason not in reasons:
            reasons.append(reason)
    return reasons

class TelegramBridge:
    def __init__(self, settings: Settings, store: Store, orchestrator, sender,
                 ask_confirm=None, git_dirty=None, send_file=None):
        self.settings = settings
        self.store = store
        self.orchestrator = orchestrator
        self.sender = sender
        self.ask_confirm = ask_confirm
        self.git_dirty = git_dirty
        self.send_file = send_file
        self.pending: dict[str, tuple[int, int, str, Path | None, str | None]] = {}
        self.confirm_reasons: dict[str, list[str]] = {}

    def get_settings(self):
        from . import config, paths
        if not (paths.config_dir() / "config.yaml").exists():
            return self.settings
        return config.load_settings()

    async def handle_task(self, user_id: int, chat_id: int, text: str,
                          task_id: str | None = None, trusted: bool = False,
                          force_confirm: bool = False, session_id: str | None = None,
                          on_decision=None, engine: str | None = None):
        settings = self.get_settings()
        if not trusted and not is_allowed(user_id, settings):
            await self.sender(chat_id, f"You are not authorized to use this bot. Your Telegram User ID is: {user_id}\n\nPlease add this ID to the allowed user list in the settings UI at http://127.0.0.1:8799")
            return None

        def decided(status: str, why: list[str] | None = None):
            if on_decision:
                on_decision(status, list(why or []))

        # Check session defaults if available
        sess = self.store.get_session(session_id) if session_id else None
        if sess:
            if engine is None and sess.get("engine"):
                engine = sess["engine"]

        # Parse engine override from text if present (e.g. !claude or !agy)
        eng_ref, text = parse_engine_ref(text)
        if eng_ref:
            engine = eng_ref

        # Parse project reference
        name, text = parse_project_ref(text)
        if name is None and sess and sess.get("project"):
            name = sess["project"]

        proj = None
        if name is not None:
            try:
                proj = resolve_project(name, settings)
            except (ProjectNotFound, ProjectPathMissing) as e:
                await self.sender(chat_id, str(e))
                decided("rejected", [str(e)])
                return None

        if task_id is None:
            task_id = new_task_id()
        if session_id is None and chat_id > 0:
            session_id = f"tg-{chat_id}"
            self.store.ensure_session(session_id, f"Telegram {chat_id}")
        self.store.create_task(task_id, chat_id, text, session_id=session_id)
        if proj is not None:
            self.store.append_log(task_id, f"project: {proj}")
        if engine is not None:
            self.store.append_log(task_id, f"engine: {engine}")

        reasons = detect_risky(text)
        gate_live = bool(settings.confirm_risky and self.ask_confirm)
        if proj is not None and self.git_dirty is not None:
            try:
                dirty = await self.git_dirty(proj)
            except Exception:
                dirty = None
            if dirty is None:
                reasons.append(
                    f"@{name} has no usable git undo (not a repo, git-ignored, or git unavailable) "
                    f"— a bad run here can't be rolled back")
            elif dirty:
                reasons.append(
                    f"@{name} has uncommitted changes that could be lost")

        if force_confirm:
            if proj is None:
                reasons.append("tidak ada proyek yang disebut — kerja akan "
                               "jatuh ke workspace kosong")
            elif self.git_dirty is None:
                reasons.append("status git tidak bisa diperiksa — tidak ada "
                               "bukti run ini bisa dibatalkan")
        must_confirm = force_confirm and bool(self.ask_confirm)
        if force_confirm and reasons and not self.ask_confirm:
            await self.sender(
                chat_id, f"Task {task_id} tidak dijalankan: tidak ada kanal konfirmasi.")
            self.store.set_task_status(task_id, "cancelled")
            decided("cancelled", reasons)
            return task_id

        if reasons and (gate_live or must_confirm):
            self.confirm_reasons[task_id] = reasons
            self.pending[task_id] = (user_id, chat_id, text, proj, engine)
            self.store.set_task_status(task_id, "awaiting_confirm")
            decided("awaiting_confirm", reasons)
            if self.ask_confirm:
                await self.ask_confirm(chat_id, task_id, reasons)
            return task_id

        if reasons:
            await self.sender(
                chat_id,
                f"Task {task_id} queued. Warning — running without confirmation: "
                + "; ".join(reasons))
        elif chat_id > 0:
            await self.sender(chat_id, f"Task {task_id} queued.")
        decided("running", reasons)
        await self._run(task_id, chat_id, text, proj, engine)
        return task_id

    async def resolve_confirm(self, user_id: int, task_id: str, approved: bool,
                              trusted: bool = False) -> bool:
        self.confirm_reasons.pop(task_id, None)
        pend = self.pending.pop(task_id, None)
        if pend is None:
            return False
        if len(pend) == 5:
            _, chat_id, text, proj, engine = pend
        else:
            _, chat_id, text, proj = pend[:4]
            engine = None
        if not trusted and not is_allowed(user_id, self.get_settings()):
            self.pending[task_id] = pend
            return False
        if not approved:
            self.store.set_task_status(task_id, "cancelled")
            await self.sender(chat_id, f"Task {task_id} cancelled.")
            return True
        await self.sender(chat_id, f"Task {task_id} confirmed, queued.")
        await self._run(task_id, chat_id, text, proj, engine)
        return True

    async def _run(self, task_id: str, chat_id: int, text: str,
                   proj: Path | None = None, engine: str | None = None):
        async def report(tid, msg, html=False):
            await self.sender(chat_id, f"[{tid}] {msg}", html=html)
        kwargs = {}
        if self.send_file is not None:
            async def file_out(kind, path):
                await self.send_file(chat_id, kind, path)
            kwargs["send_file"] = file_out
        if engine:
            kwargs["engine"] = engine
        await self.orchestrator.run_task(task_id, chat_id, text, report,
                                         proj=proj, **kwargs)

Bridge = TelegramBridge
