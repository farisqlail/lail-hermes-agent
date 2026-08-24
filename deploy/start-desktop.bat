@echo off
title LAIL HERMES DESKTOP
REM Launch Hermes in Native Windows Desktop Mode (Electron Shell)
if "%HERMES_HOME%"=="" set HERMES_HOME=C:\Hermes
cd /d %~dp0..

echo [Hermes Desktop] Memulai Hermes Desktop Application...
cd desktop
npm start
