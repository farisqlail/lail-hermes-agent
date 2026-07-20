from __future__ import annotations
import re, secrets, time
from pathlib import Path
from .config import Settings
from .session_store import Store
from .project_resolve import (
    parse_project_ref, resolve_project, ProjectNotFound, ProjectPathMissing)

def is_allowed(user_id: int, settings: Settings) -> bool:
    return user_id in settings.allowed_user_ids

# One source of truth for what the bot can do. /help, /start, and any plain
# chat message all answer with this, so the user can always rediscover the
# command surface from inside Telegram.
def help_text() -> str:
    # Plain text on purpose: sender() sends without parse_mode, so Markdown
    # markers would render literally.
    return (
        "🤖 Hermes — panduan perintah\n"
        "\n"
        "Perintah:\n"
        "/task <deskripsi> — buat tugas baru di workspace baru\n"
        "/task @nama <deskripsi> — jalankan tugas di project terdaftar\n"
        "/projects — daftar project yang terdaftar (untuk @nama)\n"
        "/help — tampilkan panduan ini\n"
        "\n"
        "Contoh:\n"
        "/task buat app counter Flutter, build APK, test di emulator\n"
        "/task @sayur perbaiki bug login di halaman kasir\n"
        "\n"
        "Cara kerja @nama:\n"
        "Hanya @nama pertama yang dianggap project; harus terdaftar di "
        "Projects Registry (web UI). @nama yang tidak terdaftar ditolak "
        "sebelum tugas berjalan.\n"
        "\n"
        "Konfirmasi tugas berisiko:\n"
        "Tugas yang push/hapus file/menyentuh path luar, atau menarget "
        "project dengan perubahan uncommitted, menunggu tombol konfirmasi "
        "dulu. Tombol lama mati setelah Hermes restart — kirim ulang "
        "tugasnya.\n"
        "\n"
        "Hasil:\n"
        "Progres tiap langkah dikirim ke chat ini; APK dan screenshot "
        "dikirim langsung sebagai file.\n"
        "\n"
        "Pengaturan (model, engine, project, timeout): web UI di "
        "http://127.0.0.1:8799 (hanya dari PC yang menjalankan Hermes)."
    )

def projects_overview(settings: Settings) -> str:
    """What /projects answers: the registered names, flagged when the folder
    is gone, plus how to register more."""
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

# Confirmation gate (design spec §8): tasks that push, delete, or reach outside
# the project dir need explicit approval before running.
#
# Deletion is two patterns because bare verbs over-gated badly: "hapus warning
# di console" or "remove unused imports" are refactors, not destruction. A
# natural-language verb only counts when a filesystem-ish object follows in
# the same clause; explicit shell commands count on their own. This stays a
# text heuristic on purpose — the gate runs before the planner (a rejected or
# unconfirmed task must cost zero tokens), and letting the planner self-declare
# a "risky" flag would hang the gate's fail-closed guarantee on LLM output.
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
        if rx.search(text) and reason not in reasons:  # both delete patterns share one reason
            reasons.append(reason)
    return reasons

class Bridge:
    def __init__(self, settings: Settings, store: Store, orchestrator, sender,
                 ask_confirm=None, git_dirty=None, send_file=None):
        self.settings = settings
        self.store = store
        self.orchestrator = orchestrator
        self.sender = sender            # async (chat_id, text)
        self.ask_confirm = ask_confirm  # async (chat_id, task_id, reasons)
        self.git_dirty = git_dirty      # async (path) -> bool | None
        self.send_file = send_file      # async (chat_id, kind, path)
        # task_id -> (user, chat, text, proj)
        self.pending: dict[str, tuple[int, int, str, Path | None]] = {}

    def get_settings(self):
        from . import config, paths
        if not (paths.config_dir() / "config.yaml").exists():
            return self.settings
        return config.load_settings()

    async def handle_task(self, user_id: int, chat_id: int, text: str):
        settings = self.get_settings()
        if not is_allowed(user_id, settings):
            await self.sender(chat_id, f"You are not authorized to use this bot. Your Telegram User ID is: {user_id}\n\nPlease add this ID to the allowed user list in the settings UI at http://127.0.0.1:8799")
            return None

        # Resolve before anything else: a bad @name costs zero tokens because
        # the planner never runs, and the gate below needs the project path.
        name, text = parse_project_ref(text)
        proj = None
        if name is not None:
            try:
                proj = resolve_project(name, settings)
            except (ProjectNotFound, ProjectPathMissing) as e:
                await self.sender(chat_id, str(e))
                return None

        task_id = new_task_id()
        self.store.create_task(task_id, chat_id, text)
        if proj is not None:
            self.store.append_log(task_id, f"project: {proj}")

        reasons = detect_risky(text)
        gate_live = bool(settings.confirm_risky and self.ask_confirm)
        # The git probe runs even when the gate is off: an ungated risky run
        # against a real project must at least say so, not proceed silently.
        if proj is not None and self.git_dirty is not None:
            try:
                dirty = await self.git_dirty(proj)
            except Exception:
                dirty = None   # can't tell -> gate, per git_dirty's own contract
            if dirty is None:
                reasons.append(
                    f"@{name} has no usable git undo (not a repo, git-ignored, or git unavailable) "
                    f"— a bad run here can't be rolled back")
            elif dirty:
                reasons.append(
                    f"@{name} has uncommitted changes that could be lost")

        if reasons and gate_live:
            self.store.set_task_status(task_id, "awaiting_confirm")
            self.pending[task_id] = (user_id, chat_id, text, proj)
            await self.ask_confirm(chat_id, task_id, reasons)
            return task_id

        if reasons:
            # Gate off (confirm_risky=False, or no ask_confirm wired): run,
            # but never silently — the user still learns what the gate saw.
            await self.sender(
                chat_id,
                f"Task {task_id} queued. Warning — running without confirmation: "
                + "; ".join(reasons))
        else:
            await self.sender(chat_id, f"Task {task_id} queued.")
        await self._run(task_id, chat_id, text, proj)
        return task_id

    async def resolve_confirm(self, user_id: int, task_id: str, approved: bool) -> bool:
        pend = self.pending.pop(task_id, None)
        if pend is None:
            return False
        _, chat_id, text, proj = pend
        if not is_allowed(user_id, self.get_settings()):
            self.pending[task_id] = pend  # keep waiting for an authorized user
            return False
        if not approved:
            self.store.set_task_status(task_id, "cancelled")
            await self.sender(chat_id, f"Task {task_id} cancelled.")
            return True
        await self.sender(chat_id, f"Task {task_id} confirmed, queued.")
        await self._run(task_id, chat_id, text, proj)
        return True

    async def _run(self, task_id: str, chat_id: int, text: str,
                   proj: Path | None = None):
        async def report(tid, msg, html=False):
            # The task-id prefix is safe to prepend to an HTML message: it is
            # hex + digits + dashes, nothing the parser reacts to.
            await self.sender(chat_id, f"[{tid}] {msg}", html=html)
        # Only thread send_file through when configured, so orchestrator fakes
        # (and a Bridge wired without Telegram) keep their narrower signature.
        kwargs = {}
        if self.send_file is not None:
            async def file_out(kind, path):
                await self.send_file(chat_id, kind, path)
            kwargs["send_file"] = file_out
        await self.orchestrator.run_task(task_id, chat_id, text, report,
                                         proj=proj, **kwargs)
