# Hermes Desktop Windows Installer Builder
# Packages Hermes into a standalone Windows .exe Setup Installer (NSIS) and Portable Executable.
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$WebDir = "$RepoRoot\web"
$DesktopDir = "$RepoRoot\desktop"
$DistDir = "$RepoRoot\dist"

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "    LAIL HERMES - WINDOWS INSTALLER BUILD PIPELINE    " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "Repo Root:    $RepoRoot"
Write-Host "Web Dir:      $WebDir"
Write-Host "Desktop Dir:  $DesktopDir"
Write-Host "Output Dist:  $DistDir"
Write-Host ""

# 1. Generate Icons
Write-Host "[1/5] Generating Application & Tray Icons from user logo..." -ForegroundColor Yellow

$py = "$RepoRoot\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    $py = "python"
}
& $py "$DesktopDir\generate_icons.py"
Write-Host "  Icons generated successfully." -ForegroundColor Green

# 2. Build Frontend
Write-Host "[2/5] Building Next.js Web Frontend & Assets..." -ForegroundColor Yellow
Set-Location $WebDir
npm run build
Write-Host "  Web frontend build & sync to hermes/static completed." -ForegroundColor Green

# 3. Build Standalone Python Backend Engine with PyInstaller
Write-Host "[3/5] Compiling Standalone Python Backend Engine (PyInstaller)..." -ForegroundColor Yellow
Set-Location $RepoRoot
& $py -m PyInstaller --noconfirm --distpath dist-backend --workpath build-backend hermes_engine.spec
Write-Host "  Python Backend Engine compiled successfully into dist-backend\hermes-engine." -ForegroundColor Green

# 4. Check Desktop Node Modules
Write-Host "[4/5] Checking Desktop Dependencies..." -ForegroundColor Yellow
Set-Location $DesktopDir
if (-not (Test-Path "$DesktopDir\node_modules")) {
    Write-Host "  Installing desktop packages..."
    npm install
}

# 5. Run Electron Builder (Bundles Frontend + Backend into Standalone NSIS & Portable EXE)
Write-Host "[5/5] Packaging Standalone Windows Installer (NSIS + Portable)..." -ForegroundColor Yellow
npm run dist


Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "  BUILD SUCCESSFUL!                                  " -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host "Installer outputs created at:" -ForegroundColor Cyan
Get-ChildItem -Path $DistDir -Filter "*.exe" | ForEach-Object {
    $sizeMB = [math]::Round($_.Length / 1MB, 2)
    Write-Host ("  -> {0} ({1} MB)" -f $_.FullName, $sizeMB) -ForegroundColor Green
}
Write-Host ""
Write-Host "You can now run the Setup .exe to install Hermes on Windows Desktop!" -ForegroundColor Green
