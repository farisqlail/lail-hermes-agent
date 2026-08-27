import os
from pathlib import Path

def home() -> Path:
    env = os.environ.get("HERMES_HOME")
    if env:
        return Path(env)
    if os.name == "nt":
        c_hermes = Path(r"C:\Hermes")
        if c_hermes.exists():
            return c_hermes
        try:
            c_hermes.mkdir(parents=True, exist_ok=True)
            return c_hermes
        except (PermissionError, OSError):
            return Path.home() / "Hermes"
    return Path.home() / ".hermes"



def config_dir() -> Path:
    return home() / "config"

def projects_dir() -> Path:
    return home() / "projects"

def artifacts_dir() -> Path:
    return home() / "artifacts"

def uploads_dir() -> Path:
    # Files the operator hands to a conversation (images, for now). One
    # directory per conv_id so deleting a conversation is one rmtree, with no
    # per-file bookkeeping to drift out of step with the messages table.
    return home() / "uploads"

def wakewords_dir() -> Path:
    # Custom wake-word models ("hey_<name>.onnx") the tray helper loads by name.
    return home() / "wakewords"

def db_path() -> Path:
    return home() / "hermes.db"

def vault_dir() -> Path:
    # Obsidian vault: the agent's knowledge store (operator facts + task
    # archive), as plain markdown the human can browse and the obsidian MCP
    # server reads. Separate from hermes.db, which stays the operational store.
    return home() / "vault"

def figma_profile_dir() -> Path:
    return home() / "figma_browser_profile"

def skills_dir() -> Path:
    # Each installed skill is skills_dir()/<id>/SKILL.md — real files, not a
    # blob in config.json, so a skill is portable to/from any other agent
    # that speaks the agentskills.io SKILL.md format. See hermes/skills.py.
    return home() / "skills"

def ensure_dirs() -> None:
    for d in (config_dir(), projects_dir(), artifacts_dir(), uploads_dir(),
              vault_dir(), figma_profile_dir(), skills_dir()):
        d.mkdir(parents=True, exist_ok=True)

def ensure_vault() -> None:
    """Make the vault a folder the obsidian MCP server will accept.

    That server refuses a plain markdown directory — it wants a real vault, i.e.
    a `.obsidian/` config. A fresh install (or a pull onto a new machine) has an
    empty vault, so without this the default `obsidian` server would fail to
    start and the agent would silently lose its knowledge tools. Every write is
    idempotent (only missing files are created), so an existing vault the
    operator has opened in Obsidian is left untouched.
    """
    v = vault_dir()
    o = v / ".obsidian"
    o.mkdir(parents=True, exist_ok=True)
    seed = {"app.json": "{}", "appearance.json": "{}",
            "core-plugins.json": "[]", "community-plugins.json": "[]"}
    for name, body in seed.items():
        f = o / name
        if not f.exists():
            f.write_text(body, encoding="utf-8")
    index = v / "INDEX.md"
    if not index.exists():
        index.write_text(
            "---\ntags: [index]\n---\n# Vault Agent\n\n"
            "Basis pengetahuan agent: fakta operator ([[operator]]) di `facts/` "
            "dan arsip task di `tasks/`. Ditulis & dibaca lewat Obsidian MCP.\n",
            encoding="utf-8")
