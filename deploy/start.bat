@echo off
title LAIL HERMES
REM Launch Hermes bot + web UI (http://127.0.0.1:8799) with auto-restart.
REM Runs from the repo checkout; install.ps1 writes a stub into %HERMES_HOME%
REM that sets HERMES_HOME and calls this file.
if "%HERMES_HOME%"=="" set HERMES_HOME=C:\Hermes
cd /d %~dp0..
call .venv\Scripts\activate.bat

REM Launch the 9Router local AI gateway (OpenAI-compatible, port 20128) in the
REM background so Hermes can route LLM calls through its token and models. Point
REM Hermes at it via base_url http://127.0.0.1:20128/v1 and the token from its
REM dashboard (http://localhost:20128/dashboard). Started once here, before the
REM restart loop, so a Hermes crash-restart never spawns a second gateway; it
REM no-ops when a gateway is already listening on the port.
where 9router >nul 2>nul && start "9Router" /min 9router -t -n --skip-update

REM Native tray helper (voice state icon + always-on wake word), started once
REM before the restart loop so a Hermes crash-restart never spawns a second
REM tray. Gated on the voice settings: it only makes sense when the mic stays
REM live with the browser closed -- hands-free or wake word. The python check
REM exits 0 (launch) or 1 (skip); pythonw keeps the tray process windowless.
.venv\Scripts\python.exe -c "from hermes import config; s=config.load_settings(); raise SystemExit(0 if (s.voice_handsfree or s.wakeword_enabled) else 1)" && start "Hermes Tray" /min .venv\Scripts\pythonw.exe -m hermes.tray

:loop
cls
color 0B
echo(
echo   _        _    ___ _       _   _ _____ ____  __  __ _____ ____
echo  ^| ^|      / \  ^|_ _^| ^|     ^| ^| ^| ^| ____^|  _ \^|  \/  ^| ____/ ___^|
echo  ^| ^|     / _ \  ^| ^|^| ^|     ^| ^|_^| ^|  _^| ^| ^|_) ^| ^|\/^| ^|  _^| \___ \
echo  ^| ^|___ / ___ \ ^| ^|^| ^|___  ^|  _  ^| ^|___^|  _ ^<^| ^|  ^| ^| ^|___ ___) ^|
echo  ^|_____/_/   \_\___^|_____^| ^|_^| ^|_^|_____^|_^| \_\_^|  ^|_^|_____^|____/
echo(
echo   LAIL HERMES agent  --  web UI: http://127.0.0.1:8799
echo   auto-restart: on   (Ctrl+C then Y to stop)
echo(
python -m hermes.main
echo(
echo  [%date% %time%] Hermes exited with code %errorlevel%. Restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop
