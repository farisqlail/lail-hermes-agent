@echo off
REM Launch Hermes bot + web UI (http://127.0.0.1:8799)
REM Runs from the repo checkout; install.ps1 writes a copy into %HERMES_HOME% with paths baked in.
if "%HERMES_HOME%"=="" set HERMES_HOME=C:\Hermes
cd /d %~dp0..
call .venv\Scripts\activate.bat
python -m hermes.main
pause
