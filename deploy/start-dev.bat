@echo off
title LAIL HERMES (dev - clean interpreter)
REM ---------------------------------------------------------------------
REM TEMPORARY LAUNCHER -- DO NOT COMMIT, DELETE AFTER CLEANUP.
REM
REM start.bat cannot run on this machine: every .exe under .venv\Scripts was
REM overwritten by Virus:Win32/Grenam.VA on 2026-09-01 (all 538112 bytes),
REM python.exe and pythonw.exe included, so Windows refuses to execute them
REM ("The system cannot execute the specified program", exit 9020).
REM
REM The venv's site-packages is untouched -- the infector only replaced .exe
REM files -- so this drives those same packages with the clean base
REM interpreter and skips the venv launchers entirely.
REM
REM Once Defender's offline scan is done and the venv is rebuilt, delete this
REM file and go back to start.bat.
REM ---------------------------------------------------------------------
cd /d %~dp0..

set "HERMES_PY=C:\Users\USER\AppData\Local\Python\pythoncore-3.14-64\python.exe"
set "PYTHONPATH=%~dp0..\.venv\Lib\site-packages"

if not exist "%HERMES_PY%" (
  echo  Base interpreter missing: %HERMES_PY%
  echo  The infection may have reached it too. Stop and run an offline scan.
  pause
  exit /b 1
)

REM No tray helper here: it launches via .venv\Scripts\pythonw.exe, which is
REM one of the overwritten binaries.

:loop
cls
color 0B
echo(
echo   LAIL HERMES agent  --  web UI: http://127.0.0.1:8799
echo   dev mode: clean base interpreter, venv launchers bypassed
echo   auto-restart: on   (Ctrl+C then Y to stop)
echo(
"%HERMES_PY%" -m hermes.main
echo(
echo  [%date% %time%] Hermes exited with code %errorlevel%. Restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop
