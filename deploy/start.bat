@echo off
title LAIL HERMES
REM Launch Hermes bot + web UI (http://127.0.0.1:8799) with auto-restart.
REM Runs from the repo checkout; install.ps1 writes a stub into %HERMES_HOME%
REM that sets HERMES_HOME and calls this file.
if "%HERMES_HOME%"=="" set HERMES_HOME=C:\Hermes
cd /d %~dp0..
call .venv\Scripts\activate.bat

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
