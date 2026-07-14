@echo off
REM Launch Hermes bot + web UI (http://127.0.0.1:8799)
cd /d E:\Hermes\app
call .venv\Scripts\activate.bat
python -m hermes.main
