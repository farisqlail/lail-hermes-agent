# Hermes installer (Windows)
# Adapted for this machine: uses `python` (3.11+; 3.14 present), playwright is an
# optional [browser] extra that may lack wheels on very new Python — installed
# best-effort, never hard-fails the install.
$ErrorActionPreference = "Stop"

# HERMES_HOME: data root (config/projects/artifacts). Override via env var; default C:\Hermes.
$HermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { "C:\Hermes" }
# App dir: the repo checkout this script lives in (deploy\.. = repo root).
$AppDir = (Resolve-Path "$PSScriptRoot\..").Path

Write-Host "== Hermes install ==" -ForegroundColor Cyan
Write-Host "  HERMES_HOME: $HermesHome"
Write-Host "  App dir:     $AppDir"

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

# 2. Directory tree + persistent HERMES_HOME so hermes.paths resolves the same root everywhere
New-Item -ItemType Directory -Force -Path "$HermesHome\config","$HermesHome\projects","$HermesHome\artifacts" | Out-Null
[Environment]::SetEnvironmentVariable("HERMES_HOME", $HermesHome, "User")
$env:HERMES_HOME = $HermesHome
Write-Host "Directories ready under $HermesHome (HERMES_HOME set for current user)"

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

# uv provides `uvx`, which the default `win` MCP server (windows-mcp) is launched
# with. It goes in the venv because start.bat activates that venv, so its Scripts
# directory is the PATH Hermes' subprocesses inherit. Best-effort: without it the
# hub skips `win` with a warning and every other server still works.
Write-Host "Installing uv (uvx, for the windows-mcp server)..." -ForegroundColor Cyan
try {
  & $py -m pip install -U uv
  Write-Host "  uv installed (win MCP server enabled)" -ForegroundColor Green
} catch {
  Write-Host "  uv install failed - the 'win' MCP server will be skipped at startup." -ForegroundColor Yellow
}

# Video clipping extra (yt-dlp + a bundled ffmpeg) for the youtube_clip chat
# tool. Best-effort: without it that one tool reports "yt-dlp belum terpasang"
# and everything else works.
Write-Host "Installing optional media extra (yt-dlp + ffmpeg)..." -ForegroundColor Cyan
try {
  & $py -m pip install -e ".[media]"
  Write-Host "  media extra installed (youtube_clip enabled)" -ForegroundColor Green
} catch {
  Write-Host "  media extra install failed - youtube_clip will be disabled." -ForegroundColor Yellow
}

# playwright is optional; browser testing needs it but it may fail on bleeding-edge Python
Write-Host "Installing optional browser extra (playwright)..." -ForegroundColor Cyan
try {
  & $py -m pip install -e ".[browser]"
  & $py -m playwright install chromium
  Write-Host "  playwright + chromium installed (browser testing enabled)" -ForegroundColor Green
} catch {
  Write-Host "  playwright install failed on this Python - browser testing disabled until fixed. Emulator testing still works." -ForegroundColor Yellow
}

# obsidian-mcp is a default server launched with `npx -y obsidian-mcp`. On first
# boot that download races the hub's start timeout and, on a slow or blocked
# registry, loses — leaving the agent without its knowledge tools. Pre-warm the
# npx cache here, while the network is already in use. A throwaway vault path is
# passed on purpose: the server rejects a non-vault and exits immediately, so the
# package downloads without a server process left running. Best-effort.
Write-Host "Pre-warming obsidian-mcp (default 'obsidian' server)..." -ForegroundColor Cyan
try {
  $warm = Start-Job { param($p) npx -y obsidian-mcp $p 2>&1 | Out-Null } -ArgumentList "$HermesHome\__vault_warm__"
  if (Wait-Job $warm -Timeout 180) {
    Write-Host "  obsidian-mcp cached (obsidian server ready on first boot)" -ForegroundColor Green
  } else {
    Stop-Job $warm
    Write-Host "  pre-warm timed out - obsidian-mcp will download on first use." -ForegroundColor Yellow
  }
  Remove-Job $warm -Force
} catch {
  Write-Host "  pre-warm skipped (npx unavailable)." -ForegroundColor Yellow
}

# 4. Seed empty config + secrets (filled via web UI)
if (-not (Test-Path "$HermesHome\config\config.yaml")) {
  & $py -c "from hermes import config, paths; paths.ensure_dirs(); config.save_settings(config.load_settings()); config.save_secrets(config.load_secrets())"
  Write-Host "Seeded empty config.yaml + .env"
}

# 5. Generate a stub start.bat into HERMES_HOME: sets env, delegates to the repo
# copy (single source of truth for the banner + auto-restart loop).
$startBat = @"
@echo off
set HERMES_HOME=$HermesHome
call "$AppDir\deploy\start.bat"
"@
Set-Content -Path "$HermesHome\start.bat" -Value $startBat -Encoding ASCII
Write-Host "Wrote $HermesHome\start.bat"

# 6. Auto-start at logon
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
