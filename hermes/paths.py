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

def db_path() -> Path:
    return home() / "hermes.db"

def ensure_dirs() -> None:
    for d in (config_dir(), projects_dir(), artifacts_dir()):
        d.mkdir(parents=True, exist_ok=True)
