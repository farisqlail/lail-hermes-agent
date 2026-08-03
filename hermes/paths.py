import os
from pathlib import Path

def home() -> Path:
    return Path(os.environ.get("HERMES_HOME", r"E:/Hermes"))

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

def ensure_dirs() -> None:
    for d in (config_dir(), projects_dir(), artifacts_dir(), uploads_dir()):
        d.mkdir(parents=True, exist_ok=True)
