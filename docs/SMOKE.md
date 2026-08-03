# Hermes — Smoke Test

## Automated (done, no credentials needed)

- Full unit suite, from the repo checkout: `.venv\Scripts\python -m pytest -q` → all green.
  (Deliberately not a count: a hardcoded number rots on the next commit.)
- Frontend gates, from the same checkout: `npm --prefix web test` → typecheck (`tsc --noEmit`,
  `strict`) plus the pure-module unit tests, both green. Run this before every commit that
  touches `web/`: the React bundle is git-ignored, so a type error that slips through is only
  discovered by whoever next runs `start.bat`.
- Bundle builds: `npm --prefix web run build` writes `hermes/static/app.js` + `app.css`.
  Serving them is covered by pytest (`test_static_serving_*`), so a missing bundle shows the
  build command rather than a blank page.
- Web UI serves on `127.0.0.1:8799`: `GET /`, `/api/tasks`, `/api/settings`, `/api/secrets/status` all 200; secrets returned as booleans only (masked). ✅
- `hermes.main` imports; `main.run` is a coroutine; `Adb` exposes async `is_running/start/install/launch/screencap`; `build_nim_planner` callable. ✅

## Manual end-to-end (needs your credentials — pending)

Prereqs on PATH: `python` 3.11+, `node` 20+ with `npm` (builds the React web UI),
`claude` (Claude Code CLI), `agy` (Antigravity CLI), `adb`/`emulator` (Android SDK).
For browser tests: `pip install -e ".[browser]"` + `python -m playwright install chromium`.

Paths below use `%HERMES_HOME%` for the data root and `<repo>` for this checkout. Both are
yours to choose; nothing here assumes a particular drive.

1. Pick the data root and make it stick, **before** installing — the installer, `start.bat`
   and `hermes/paths.py` do not agree on a fallback, so an unset `HERMES_HOME` gives you two
   data roots that never see each other:
   ```powershell
   [Environment]::SetEnvironmentVariable("HERMES_HOME", "D:\Hermes", "User")
   $env:HERMES_HOME = "D:\Hermes"
   ```
2. Run installer: `powershell -ExecutionPolicy Bypass -File <repo>\deploy\install.ps1`
3. Start: `%HERMES_HOME%\start.bat`
4. Open `http://127.0.0.1:8799`, fill settings:
   - NVIDIA API key (build.nvidia.com), model (e.g. `deepseek-ai/deepseek-v3`)
   - Telegram bot token (BotFather)
   - **Allowed Telegram user ID** (your numeric id — required; others are rejected)
   - Android SDK path, emulator AVD name (from `emulator -list-avds`)
5. From Telegram, send: *"buat app counter Flutter, build APK, test di emulator"*
6. Confirm:
   - Task appears on the dashboard, engine (`claude`/`agy`) runs in `%HERMES_HOME%\projects\<task-id>`
   - APK artifact produced under `%HERMES_HOME%\artifacts\<task-id>\`
   - Emulator screenshot returned to Telegram
7. Verify the structured-output path against the live `claude` — the two things fakes
   cannot settle. Open `%HERMES_HOME%\artifacts\<task-id>\step-0-engine.log`:
   - **Does the envelope arrive?** The attempt header should carry `session: <uuid>` and
     `cost: $…`. If it does not, every claude run silently fell back to text mode.
   - **Does the engine honour the completion contract?** A step reported as
     `coded (confirmed done, 1 round(s))` means the model ended on the sentinel. If every
     step instead reports `completion not confirmed`, the contract is being ignored and each
     step is burning all three rounds — settle this before trusting the loop.
   - **Does `--resume` restore context?** Force a second round (a step the engine cannot
     finish in one session). Round two's prompt should be the short continuation only; check
     from its output that the engine still knew the task.
8. Confirm the run used the data root you chose: the task should appear in
   `%HERMES_HOME%\hermes.db` and its workspace under `%HERMES_HOME%\projects\`. If either
   landed somewhere else, `HERMES_HOME` was not set for the process that started Hermes.
9. Record results below.

## Memory and spoken narration (manual, needs the NIM key)

Everything below is server-decided, so check it from a page that is **not** the
dashboard — that is the bug the move fixed.

1. Settings -> Suara: turn on **Notifikasi Suara Task** and **Narasi Langkah**.
2. In the chat pane, say something durable about yourself
   ("aku biasanya deploy hari Jumat"). Reply as usual, then `GET /api/facts` —
   the fact should be there, keyed (`hari_deploy`), not a copy of the sentence.
   Say it again with a different day: the value changes, no second row appears.
3. Ask "apa yang lagi jalan?" with a task running. The answer must name the real
   task and project; if it hedges or invents one, the context block is not
   reaching the model — check the first message of the history in a debugger.
4. Queue a task (`/task @project ...`), press Run, then navigate to **Configure**
   and stay there. You should hear a line as each step starts, and the result
   announced at the end, without going back to the dashboard.
5. Turn both toggles off and repeat step 4: silence. The gates are read
   per event on the server, so no restart is needed.
6. `GET /api/facts` then `DELETE /api/facts/<key>` for anything the extractor
   got wrong — an unremovable wrong fact rides in every prompt.

## Images in chat (manual, needs a vision-capable chat model)

1. Attach a photo (clip button, or paste from the clipboard) and ask what is in it. The answer
   must describe the actual picture, not guess from the filename.
2. While the answer is arriving, look in `%HERMES_HOME%\uploads\<session>\` — the file is
   there. Once the reply finishes, it is gone. That is the whole lifecycle: one look, one
   answer, deleted.
3. Ask a follow-up about the same photo. The model no longer has the image (it sees
   `[gambar dilampirkan]`), so it should ask for the picture again rather than invent detail.
4. Try an `.svg` renamed to `.png`: refused with a 415 and a message, never stored. Content is
   sniffed from the leading bytes; the name decides nothing.
5. Switch the chat model to a text-only one and attach an image: the turn fails with a note
   pointing at the attachment, not a bare provider error.

## Known follow-ups

- **`HERMES_HOME` fallbacks disagree.** `deploy/install.ps1` and `deploy/start.bat` default to
  `C:\Hermes`; `hermes/paths.py` defaults to `E:\Hermes`. Both are leftovers from the machine
  this was first built on. Until they are reconciled, always set `HERMES_HOME` explicitly —
  otherwise `start.bat` and `python -m hermes.main` silently use different data roots.

## Results

_(fill after the manual run)_
