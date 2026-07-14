# Hermes installer (Windows)
# Adapted for this machine: uses `python` (3.11+; 3.14 present), playwright is an
# optional [browser] extra that may lack wheels on very new Python — installed
# best-effort, never hard-fails the install.
$ErrorActionPreference = "Stop"
$HermesHome = "E:\Hermes"
$AppDir = "$HermesHome\app"

Write-Host "== Hermes install ==" -ForegroundColor Cyan

# 1. Prerequisite check (report-only; missing runtime tools don't block install)
Write-Host "Checking prerequisites on PATH..."
$req = @{ python = "Python (3.11+)"; claude = "Claude Code CLI"; agy = "Antigravity CLI"; adb = "Android platform-tools" }
$missing = @()
foreach ($bin in $req.Keys) {
  if (Get-Command $bin -ErrorAction SilentlyContinue) {
    Write-Host ("  [ok]      {0}" -f $req[$bin]) -ForegroundColor Green
  } else {
    Write-Host ("  [MISSING] {0}  (command: {1})" -f $req[$bin], $bin) -ForegroundColor Yellow
    $missing += $bin
  }
}
if ($missing -contains "python") { throw "python not found on PATH; install Python 3.11+ first." }

# 2. Directory tree
New-Item -ItemType Directory -Force -Path "$HermesHome\config","$HermesHome\projects","$HermesHome\artifacts" | Out-Null
Write-Host "Directories ready under $HermesHome"

# 3. venv + deps
Set-Location $AppDir
if (-not (Test-Path "$AppDir\.venv\Scripts\python.exe")) {
  Write-Host "Creating venv..."
  python -m venv .venv
}
$py = "$AppDir\.venv\Scripts\python.exe"
& $py -m pip install -U pip | Out-Null
Write-Host "Installing hermes (core + dev)..."
& $py -m pip install -e ".[dev]"

# playwright is optional; browser testing needs it but it may fail on bleeding-edge Python
Write-Host "Installing optional browser extra (playwright)..." -ForegroundColor Cyan
try {
  & $py -m pip install -e ".[browser]"
  & $py -m playwright install chromium
  Write-Host "  playwright + chromium installed (browser testing enabled)" -ForegroundColor Green
} catch {
  Write-Host "  playwright install failed on this Python — browser testing disabled until fixed. Emulator testing still works." -ForegroundColor Yellow
}

# 4. Seed empty config + secrets (filled via web UI)
if (-not (Test-Path "$HermesHome\config\config.yaml")) {
  & $py -c "from hermes import config, paths; paths.ensure_dirs(); config.save_settings(config.load_settings()); config.save_secrets(config.load_secrets())"
  Write-Host "Seeded empty config.yaml + .env"
}

# 5. Auto-start at logon
try {
  $action  = New-ScheduledTaskAction -Execute "$HermesHome\start.bat"
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  Register-ScheduledTask -TaskName "Hermes" -Action $action -Trigger $trigger -Force | Out-Null
  Write-Host "Registered Task Scheduler entry 'Hermes' (starts at logon)" -ForegroundColor Green
} catch {
  Write-Host "Could not register scheduled task (may need elevation). Start manually via start.bat." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Start Hermes:  $HermesHome\start.bat" -ForegroundColor Green
Write-Host "Then open the settings UI:  http://127.0.0.1:8799" -ForegroundColor Green
if ($missing.Count) { Write-Host ("Note: install missing tools before running tasks: {0}" -f ($missing -join ', ')) -ForegroundColor Yellow }
