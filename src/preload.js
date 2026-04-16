const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeDash', {
  startAuth: () => ipcRenderer.invoke('start-auth'),
  logout: () => ipcRenderer.invoke('logout'),
  getAuthStatus: () => ipcRenderer.invoke('get-auth-status'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  minimizeApp: () => ipcRenderer.invoke('minimize-app'),
  refreshUsage: () => ipcRenderer.invoke('refresh-usage'),
  resizeWindow: (w, h) => ipcRenderer.invoke('resize-window', w, h),

  onAuthStatus: (callback) => {
    ipcRenderer.removeAllListeners('auth-status');
    ipcRenderer.on('auth-status', (_event, data) => callback(data));
  },
  onUsageUpdate: (callback) => {
    ipcRenderer.removeAllListeners('usage-update');
    ipcRenderer.on('usage-update', (_event, data) => callback(data));
  },
});
