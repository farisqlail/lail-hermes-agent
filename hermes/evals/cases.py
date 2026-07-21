"""The golden set: task texts, the project each is aimed at, and the rules that
must hold for the resulting plan.

Written in the language the tasks are actually sent in. The live task history is
Indonesian, and planning behaviour is not language-invariant — an eval written
only in English would score a path the operator never takes.

Kept small on purpose. Each case exists to exercise one rule against one project
shape; adding near-duplicates costs a model call per run and tells you nothing
the neighbouring case did not.
"""
from __future__ import annotations
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Case:
    id: str
    text: str
    rules: tuple[str, ...]
    # Relative path -> contents. Empty means a fresh empty workspace, which is
    # what a task with no @project reference gets.
    files: dict[str, str] = field(default_factory=dict)
    # Whether this project can produce an APK. Not derived from `files`: for a
    # greenfield case it depends on what the task asks to be built, which is
    # the very judgement under test.
    builds_apk: bool = False
    name: str | None = None

    @property
    def greenfield(self) -> bool:
        return not self.files


_WEB = {
    "package.json": '{"name":"dashboard","dependencies":{"next":"14.0.0"}}',
    "app/page.tsx": "export default function Page() { return null }",
    "app/history/detail/index.tsx": "export default function Detail() {}",
}

_RN = {
    "package.json": '{"name":"myprofit","dependencies":{"expo":"51.0.0"}}',
    "app.json": '{"expo":{"name":"myprofit"}}',
    "android/app/build.gradle": 'android { defaultConfig { applicationId "com.myprofit" } }',
    "app/history/detail/index.tsx": "export default function Detail() {}",
}

_FLUTTER = {
    "pubspec.yaml": "name: counter\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
    "lib/main.dart": "void main() {}",
}


CASES: list[Case] = [
    # The live failure, reconstructed: a fix on a web project. A build step here
    # can only end in "unsupported project type: unknown".
    Case(id="web-fix-detail-page",
         text="coba cek di halaman detail history transaction, qty mejanya "
              "tidak sama dengan response api nya, coba cek dan fixing",
         files=_WEB, name="dashboard", builds_apk=False,
         rules=("R0-schema", "R0-nonempty", "R1-no-apk", "R5-single-code")),

    Case(id="web-add-feature",
         text="tambah dark mode di halaman settings",
         files=_WEB, name="dashboard", builds_apk=False,
         rules=("R0-schema", "R1-no-apk", "R5-single-code")),

    # The two cases that give the set its teeth. Both name "build" or "APK" on
    # a project that has neither, so the task text pulls one way and the
    # project pulls the other. Measured 2026-07-21 on deepseek-v4-flash: with
    # project context both plan a lone code step; with `--no-context` they plan
    # ['code','build'] and ['code','build','test'] — the second reproducing the
    # live failure of task 20260715-104754-5b44a5 exactly. Every other case in
    # this file passes with or without context, so without these two the set
    # cannot fail and measures nothing.
    Case(id="web-build-wording",
         text="app nya crash pas buka halaman detail transaksi, coba cek dan "
              "fix, terus build ulang buat mastiin jalan",
         files=_WEB, name="dashboard", builds_apk=False,
         rules=("R0-schema", "R0-nonempty", "R1-no-apk")),

    Case(id="web-apk-wording",
         text="tolong perbaiki halaman detail lalu build APK nya dan test di "
              "emulator",
         files=_WEB, name="dashboard", builds_apk=False,
         rules=("R0-schema", "R0-nonempty", "R1-no-apk")),

    Case(id="web-write-tests",
         text="bikin unit test buat modul auth",
         files=_WEB, name="dashboard", builds_apk=False,
         rules=("R0-schema", "R1-no-apk", "R5-single-code")),

    # React Native: an APK project, so build and emulator are permitted — but
    # ordering still applies.
    Case(id="rn-fix-only",
         text="ketika table status reserved, create order baru jangan kirim "
              "table fee dan table qty nya",
         files=_RN, name="myprofit", builds_apk=True,
         rules=("R0-schema", "R0-nonempty", "R2-build-first", "R5-single-code")),

    Case(id="rn-fix-and-verify-build",
         text="update dependency expo lalu pastikan build APK masih jalan",
         files=_RN, name="myprofit", builds_apk=True,
         rules=("R0-schema", "R0-nonempty", "R2-build-first")),

    Case(id="flutter-refactor",
         text="refactor semua service jadi async",
         files=_FLUTTER, name="counter", builds_apk=True,
         rules=("R0-schema", "R0-nonempty", "R2-build-first", "R5-single-code")),

    # Greenfield. The context says the type is whatever the task builds, so the
    # planner has to read the task itself.
    Case(id="greenfield-flutter-apk",
         text="buat app counter Flutter, build APK, test di emulator",
         builds_apk=True,
         rules=("R0-schema", "R0-nonempty", "R2-build-first")),

    # The hardest case: greenfield, and the correct answer is "not Android"
    # inferred from the task text alone.
    Case(id="greenfield-backend",
         text="buatkan REST API sederhana pakai FastAPI untuk CRUD produk",
         builds_apk=False,
         rules=("R0-schema", "R0-nonempty", "R1-no-apk")),
]
