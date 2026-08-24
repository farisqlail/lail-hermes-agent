const { contextBridge, ipcRenderer, shell } = require('electron');

// Expose safe hermesDesktop API to renderer window
contextBridge.exposeInMainWorld('hermesDesktop', {
  isDesktop: true,
  platform: process.platform,
  
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  
  // Always on top
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window-toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('window-get-always-on-top'),
  
  // System actions
  openExternal: (url) => shell.openExternal(url),
  triggerVoiceWake: () => ipcRenderer.send('trigger-voice-wake'),
  restartBackend: () => ipcRenderer.send('restart-backend'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Event listeners
  onWindowStateChange: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('window-state-change', handler);
    return () => ipcRenderer.removeListener('window-state-change', handler);
  },
  onVoiceStateUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('voice-state-update', handler);
    return () => ipcRenderer.removeListener('voice-state-update', handler);
  }
});
