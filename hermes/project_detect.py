from __future__ import annotations
import re
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

def detect_app_id(project_dir: Path) -> str | None:
    """Android application id, for launching via `adb shell monkey -p <pkg>`.

    Looks in the gradle app module config (Flutter/RN keep it under android/,
    plain Android at the root), then falls back to the manifest package attr.
    """
    gradle_files = [
        project_dir / "android" / "app" / "build.gradle",
        project_dir / "android" / "app" / "build.gradle.kts",
        project_dir / "app" / "build.gradle",
        project_dir / "app" / "build.gradle.kts",
    ]
    for f in gradle_files:
        if f.exists():
            m = re.search(r'applicationId\s*=?\s*["\']([\w.]+)["\']',
                          f.read_text(encoding="utf-8", errors="replace"))
            if m:
                return m.group(1)
    manifests = [
        project_dir / "android" / "app" / "src" / "main" / "AndroidManifest.xml",
        project_dir / "app" / "src" / "main" / "AndroidManifest.xml",
    ]
    for f in manifests:
        if f.exists():
            m = re.search(r'package\s*=\s*["\']([\w.]+)["\']',
                          f.read_text(encoding="utf-8", errors="replace"))
            if m:
                return m.group(1)
    return None
