from __future__ import annotations
from pathlib import Path
from typing import Literal

def detect(project_dir: Path) -> Literal["flutter", "react_native", "android", "unknown"]:
    if (project_dir / "pubspec.yaml").exists():
        return "flutter"
    if (project_dir / "package.json").exists() and (project_dir / "android").is_dir():
        return "react_native"
    if (project_dir / "build.gradle").exists() or (project_dir / "build.gradle.kts").exists():
        return "android"
    if (project_dir / "settings.gradle").exists():
        return "android"
    return "unknown"
