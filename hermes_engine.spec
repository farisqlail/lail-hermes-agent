# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_data_files
import os
import sys

block_cipher = None

# Collect all required packages
datas = [('hermes/static', 'hermes/static')]
binaries = []
hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.http.httptools_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.protocols.websockets.wsproto_impl',
    'uvicorn.lifespans',
    'uvicorn.lifespans.auto',
    'uvicorn.lifespans.on',
    'uvicorn.lifespans.off',
    'starlette.staticfiles',
    'starlette.responses',
    'starlette.routing',
    'starlette.middleware',
    'fastapi',
    'fastapi.staticfiles',
    'fastapi.responses',
    'pydantic',
    'pydantic_settings',
    'sse_starlette',
    'httpx',
    'edge_tts',
    'dotenv',
]

# Collect submodules for hermes and critical dependencies
hiddenimports += collect_submodules('hermes')
hiddenimports += collect_submodules('mcp')
hiddenimports += collect_submodules('pydantic')
hiddenimports += collect_submodules('pydantic_settings')
hiddenimports += collect_submodules('edge_tts')

for pkg in ['uvicorn', 'fastapi', 'starlette', 'sse_starlette', 'edge_tts', 'mcp']:
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# Remove duplicates
hiddenimports = list(set(hiddenimports))

a = Analysis(
    ['hermes_server.py'],
    pathex=['.'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='hermes-engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='desktop/assets/icon.ico'
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='hermes-engine',
)
