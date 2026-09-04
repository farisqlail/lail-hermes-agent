const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, session, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, exec } = require('child_process');


// Constants
const BACKEND_PORT = 8799;
const BACKEND_HOST = '127.0.0.1';
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
const STATE_POLL_INTERVAL_MS = 800;
const HEALTH_CHECK_TIMEOUT_MS = 60000;

let mainWindow = null;
let splashWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;
let isAlwaysOnTop = false;
let currentVoiceState = 'idle';
let statePollTimer = null;

// Ensure single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

// App paths
const isDev = process.argv.includes('--dev') || !app.isPackaged;
const appRoot = isDev ? path.resolve(__dirname, '../..') : path.dirname(app.getPath('exe'));
const stateFilePath = path.join(app.getPath('userData'), 'window-state.json');

// --- Helper Functions ---

function log(...args) {
  console.log('[Hermes Desktop]', ...args);
}

function loadWindowState() {
  try {
    if (fs.existsSync(stateFilePath)) {
      return JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    }
  } catch (err) {
    log('Failed to load window state:', err.message);
  }
  return { width: 1320, height: 860, isMaximized: false };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const isMaximized = mainWindow.isMaximized();
    const bounds = mainWindow.getBounds();
    const state = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: isMaximized
    };
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    log('Failed to save window state:', err.message);
  }
}

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${BACKEND_URL}/api/voice/state`, { timeout: 1500 }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolveBackendLauncher() {
  // 1. Check bundled hermes-engine.exe in packaged Electron resources
  const bundledEngine = path.join(process.resourcesPath || '', 'backend', 'hermes-engine.exe');
  if (fs.existsSync(bundledEngine)) {
    return { command: bundledEngine, args: [], cwd: path.dirname(bundledEngine) };
  }

  // 2. Check local dist-backend build
  const localDistEngine = path.join(appRoot, 'dist-backend', 'hermes-engine', 'hermes-engine.exe');
  if (fs.existsSync(localDistEngine)) {
    return { command: localDistEngine, args: [], cwd: path.dirname(localDistEngine) };
  }

  // 3. Check virtual environment in repo root
  const venvPy = path.join(appRoot, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPy)) {
    return { command: venvPy, args: ['-m', 'hermes.main'], cwd: appRoot };
  }

  // 4. Check HERMES_HOME venv
  const hermesHome = process.env.HERMES_HOME || 'C:\\Hermes';
  const hermesPy = path.join(hermesHome, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(hermesPy)) {
    return { command: hermesPy, args: ['-m', 'hermes.main'], cwd: hermesHome };
  }

  return { command: 'python', args: ['-m', 'hermes.main'], cwd: appRoot };
}

const logFilePath = path.join(app.getPath('userData'), 'hermes-backend.log');
let backendTail = '';

function startBackendServer() {
  const launcher = resolveBackendLauncher();
  log(`Spawning Hermes Backend via: ${launcher.command} at cwd: ${launcher.cwd}`);
  log(`Backend logs will be saved to: ${logFilePath}`);

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    HERMES_HOME: process.env.HERMES_HOME || 'C:\\Hermes'
  };

  try {
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    logStream.write(`\n--- Hermes Backend Started at ${new Date().toISOString()} ---\n`);

    backendProcess = spawn(launcher.command, launcher.args, {
      cwd: launcher.cwd,
      env: env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true
    });

    backendProcess.stdout.on('data', (data) => {
      const line = data.toString();
      logStream.write(line);
      backendTail = (backendTail + line).slice(-2000);
      console.log(`[Hermes Core] ${line.trim()}`);
    });

    backendProcess.stderr.on('data', (data) => {
      const line = data.toString();
      logStream.write(`[ERR] ${line}`);
      backendTail = (backendTail + line).slice(-2000);
      console.error(`[Hermes Core ERR] ${line.trim()}`);
    });

    backendProcess.on('exit', (code, signal) => {
      const msg = `Backend process exited with code ${code} (${signal})\n`;
      logStream.write(msg);
      log(msg);
      backendProcess = null;
      // A crash before the window exists means the app has no backend at all.
      // Say so now with the actual traceback: waiting out the 60s health poll
      // and blaming the network sent operators back to deploy/start.bat.
      if (!mainWindow && !isQuitting) {
        dialog.showErrorBox(
          'Backend Lail Hermes Berhenti',
          `Proses backend keluar dengan kode ${code} sebelum siap.\n\n${backendTail.trim() || '(tidak ada output)'}\n\nLog lengkap: ${logFilePath}`
        );
      }
    });
  } catch (err) {
    log('Failed to spawn backend process:', err);
  }
}


function killBackendProcess() {
  if (backendProcess && backendProcess.pid) {
    log(`Terminating backend process PID: ${backendProcess.pid}`);
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${backendProcess.pid} /T /F`);
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch (e) {
      log('Error terminating backend:', e.message);
    }
    backendProcess = null;
  }
}

// --- Windows Creation ---

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });
}

function createMainWindow() {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width || 1320,
    height: windowState.height || 860,
    minWidth: 960,
    minHeight: 640,
    frame: true, // Native window with frame
    titleBarStyle: 'default',
    backgroundColor: '#0b0f19',
    show: false,
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      devTools: isDev
    }
  });

  // Custom User-Agent tag so web app detects Hermes Desktop
  const userAgent = mainWindow.webContents.getUserAgent();
  mainWindow.webContents.setUserAgent(`${userAgent} HermesDesktop/0.0.2`);

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  // Auto-grant Media (Microphone, Camera) and Notification permissions for seamless Voice & Vision AI
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'camera', 'notifications', 'mediaKeySystem', 'pointerLock'];
    if (allowed.includes(permission)) {
      return callback(true);
    }
    return callback(false);
  });

  // Handle external links securely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Event handlers
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (tray) {
        tray.displayBalloon?.({
          title: 'Lail Hermes',
          content: 'Lail Hermes berjalan di latar belakang (System Tray). Tekan Alt+Space untuk membuka kembali.'
        });
      }
    } else {
      saveWindowState();
    }
  });

  // Load backend UI
  mainWindow.loadURL(BACKEND_URL);

  mainWindow.webContents.once('did-finish-load', () => {
    log('Lail Hermes Web UI successfully loaded in Desktop Window.');
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', () => {
    log('Failed to load Web UI, retrying in 1s...');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(BACKEND_URL);
      }
    }, 1000);
  });
}

// --- System Tray ---

function getTrayIconPath(state) {
  const iconName = `tray-${state || 'idle'}.png`;
  const customPath = path.join(__dirname, '../assets', iconName);
  if (fs.existsSync(customPath)) return customPath;
  return path.join(__dirname, '../assets/icon.png');
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Lail Hermes v1.0',
      enabled: false
    },
    { type: 'separator' },
    {
      label: mainWindow && mainWindow.isVisible() ? 'Sembunyikan Jendela' : 'Buka Jendela Lail Hermes',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Picu Voice Wake ("Hey Ev")',
      click: () => triggerVoiceWake()
    },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: isAlwaysOnTop,
      click: (item) => {
        isAlwaysOnTop = item.checked;
        if (mainWindow) mainWindow.setAlwaysOnTop(isAlwaysOnTop);
      }
    },
    { type: 'separator' },
    {
      label: 'Buka di Web Browser',
      click: () => shell.openExternal(BACKEND_URL)
    },
    {
      label: 'Restart Server Backend',
      click: () => restartBackend()
    },
    {
      label: 'Periksa Pembaruan...',
      click: () => checkForUpdates(true)
    },
    { type: 'separator' },

    {
      label: 'Keluar Sepenuhnya',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray() {
  const iconPath = getTrayIconPath('idle');
  tray = new Tray(iconPath);
  tray.setToolTip('Lail Hermes — Siaga');

  tray.on('double-click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  updateTrayMenu();
}

function updateVoiceState(state) {
  if (state === currentVoiceState) return;
  currentVoiceState = state;

  if (tray) {
    tray.setImage(getTrayIconPath(state));
    const labels = {
      idle: 'Siaga',
      listen: 'Mendengarkan...',
      think: 'Berpikir...',
      speak: 'Berbicara...'
    };
    tray.setToolTip(`Lail Hermes — ${labels[state] || state}`);
  }


  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('voice-state-update', state);
  }
}

function startStatePolling() {
  if (statePollTimer) clearInterval(statePollTimer);
  statePollTimer = setInterval(() => {
    http.get(`${BACKEND_URL}/api/voice/state`, { timeout: 1000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.state) {
            updateVoiceState(parsed.state);
          }
        } catch (e) {}
      });
    }).on('error', () => {});
  }, STATE_POLL_INTERVAL_MS);
}

function triggerVoiceWake() {
  const req = http.request(`${BACKEND_URL}/api/voice/wake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeout: 2000
  }, (res) => {
    log('Voice wake requested. Server replied:', res.statusCode);
  });
  req.on('error', (err) => log('Failed to send voice wake:', err.message));
  req.end('{}');

  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function restartBackend() {
  log('Restarting Backend Server...');
  killBackendProcess();
  setTimeout(() => {
    startBackendServer();
  }, 1000);
}

// --- IPC Handlers ---

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('window-toggle-always-on-top', () => {
  if (mainWindow) {
    isAlwaysOnTop = !isAlwaysOnTop;
    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
    updateTrayMenu();
    return isAlwaysOnTop;
  }
  return false;
});

ipcMain.handle('window-get-always-on-top', () => {
  return isAlwaysOnTop;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.on('trigger-voice-wake', () => {
  triggerVoiceWake();
});

ipcMain.on('restart-backend', () => {
  restartBackend();
});

// --- Auto-Updater via GitHub Releases ---

let isManualCheck = false;

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log('Memeriksa pembaruan di GitHub Releases...');
  });

  autoUpdater.on('update-available', (info) => {
    log(`Pembaruan tersedia: v${info.version}`);
    const releaseNotes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes.replace(/<[^>]*>/g, '').trim()
      : 'Peningkatan performa dan perbaikan bug.';

    dialog.showMessageBox(mainWindow || null, {
      type: 'info',
      title: 'Pembaruan Tersedia — Lail Hermes',
      message: `Versi Baru Lail Hermes (v${info.version}) Telah Tersedia!`,
      detail: `Versi saat ini: v${app.getVersion()}\n\nCatatan Rilis:\n${releaseNotes}\n\nApakah Anda ingin mengunduh pembaruan sekarang?`,
      buttons: ['Unduh Pembaruan Sekarang', 'Ingatkan Nanti'],
      defaultId: 0,
      cancelId: 1,
      icon: path.join(__dirname, '../assets/icon.png')
    }).then((result) => {
      if (result.response === 0) {
        log('User menyetujui pengunduhan update.');
        autoUpdater.downloadUpdate();
        if (tray) {
          tray.displayBalloon?.({
            title: 'Lail Hermes Update',
            content: `Mengunduh pembaruan v${info.version} di latar belakang...`
          });
        }
      }
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent);
    log(`Download update: ${percent}%`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(progressObj.percent / 100);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`Pembaruan v${info.version} selesai diunduh.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }

    dialog.showMessageBox(mainWindow || null, {
      type: 'question',
      title: 'Pembaruan Siap Dipasang — Lail Hermes',
      message: `Pembaruan Lail Hermes v${info.version} Selesai Diunduh!`,
      detail: 'Aplikasi perlu dimulai ulang untuk menerapkan pembaruan. Restart aplikasi sekarang?',
      buttons: ['Restart & Pasang Sekarang', 'Pasang Saat Aplikasi Ditutup'],
      defaultId: 0,
      cancelId: 1,
      icon: path.join(__dirname, '../assets/icon.png')
    }).then((result) => {
      if (result.response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log('Aplikasi sudah dalam versi terbaru.');
    if (isManualCheck) {
      dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Pembaruan Lail Hermes',
        message: 'Aplikasi Sudah Versi Terbaru',
        detail: `Anda sudah menggunakan versi terbaru Lail Hermes (v${app.getVersion()}).`,
        buttons: ['OK'],
        icon: path.join(__dirname, '../assets/icon.png')
      });
      isManualCheck = false;
    }
  });

  autoUpdater.on('error', (err) => {
    log('Info Auto-updater:', err ? err.message : err);
    if (isManualCheck) {
      dialog.showMessageBox(mainWindow || null, {
        type: 'warning',
        title: 'Pemeriksaan Pembaruan',
        message: 'Gagal Memeriksa Pembaruan',
        detail: `Tidak dapat terhubung ke server GitHub Releases:\n${err ? err.message : 'Koneksi gagal'}`,
        buttons: ['OK']
      });
      isManualCheck = false;
    }
  });
}

function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Mode Pengembang',
        message: 'Pengecekan update otomatis aktif pada aplikasi yang telah diinstall (Packaged/Installer).'
      });
    }
    return;
  }
  isManualCheck = manual;
  autoUpdater.checkForUpdates().catch(err => log('Check for updates failed:', err.message));
}

// --- App Lifecycle ---

app.whenReady().then(async () => {
  createSplashWindow();
  createTray();
  setupAutoUpdater();

  // Register Global Hotkey: Alt+Space (or Ctrl+Shift+H) to summon Hermes from anywhere
  try {
    globalShortcut.register('Alt+Space', () => {
      if (mainWindow) {
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
    log('Registered global hotkey: Alt+Space');
  } catch (err) {
    log('Failed to register global hotkey Alt+Space:', err);
  }

  // Check if backend is already online
  let isOnline = await checkBackendHealth();
  if (!isOnline) {
    log('Backend not detected. Starting background Hermes server...');
    startBackendServer();
  } else {
    log('Existing backend detected at', BACKEND_URL);
  }

  // Wait until backend becomes responsive
  const startTime = Date.now();
  const pollInterval = setInterval(async () => {
    isOnline = await checkBackendHealth();
    if (isOnline) {
      clearInterval(pollInterval);
      log('Backend is responsive! Creating main window...');
      createMainWindow();
      startStatePolling();
      // Check for updates silently 4s after startup
      setTimeout(() => {
        checkForUpdates(false);
      }, 4000);
    } else if (Date.now() - startTime > HEALTH_CHECK_TIMEOUT_MS) {
      clearInterval(pollInterval);
      dialog.showErrorBox(
        'Gagal Memulai Backend Lail Hermes',
        `Server backend Lail Hermes tidak merespons dalam 60 detik.\n\n${backendTail.trim() || '(tidak ada output)'}\n\nLog lengkap: ${logFilePath}`
      );
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    }
  }, 500);
});


app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (statePollTimer) clearInterval(statePollTimer);
  killBackendProcess();
});
