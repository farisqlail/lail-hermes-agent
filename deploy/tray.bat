@echo off
title LAIL HERMES TRAY
REM Native tray helper: always-on wake word ("Hey Ev") + voice-state tray icon.
REM Run this alongside start.bat. It talks to the running server over HTTP
REM (http://127.0.0.1:8799); start Hermes first, then this.
REM Needs the desktop extras: pip install -e .[desktop]
if "%HERMES_HOME%"=="" set HERMES_HOME=C:\Hermes
cd /d %~dp0..
call .venv\Scripts\activate.bat

:loop
python -m hermes.tray
echo(
echo  [%date% %time%] Tray exited with code %errorlevel%. Restarting in 5s...
timeout /t 5 /nobreak >nul
goto loop
