from __future__ import annotations
import json
import re
from pathlib import Path
from typing import Literal

def detect(project_dir: Path) -> Literal["flutter", "react_native", "android", "unknown"]:
    if (project_dir / "pubspec.yaml").exists():
        return "flutter"
    if (project_dir / "package.json").exists():
        android_dir = project_dir / "android"
        if (android_dir / "gradlew.bat").exists() or (android_dir / "gradlew").exists():
            return "react_native"
    if (project_dir / "build.gradle").exists() or (project_dir / "build.gradle.kts").exists():
        return "android"
    if (project_dir / "settings.gradle").exists():
        return "android"
    return "unknown"


def detect_app_id(project_dir: Path) -> str | None:
    """Android application id, for launching via `adb shell monkey -p <pkg>`.

    Looks in app.json (Expo), gradle app module config (Flutter/RN keep it under android/,
    plain Android at the root), then falls back to the manifest package attr.
    """
    app_json = project_dir / "app.json"
    if app_json.exists():
        try:
            data = json.loads(app_json.read_text(encoding="utf-8", errors="replace"))
            pkg = data.get("expo", {}).get("android", {}).get("package")
            if isinstance(pkg, str) and pkg:
                return pkg
        except Exception:
            pass

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

