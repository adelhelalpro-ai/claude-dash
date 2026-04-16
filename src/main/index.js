const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { AuthManager } = require('./auth');
const { UsageTracker } = require('./usage');

let mainWindow = null;
let store, auth, usage;

// ── Window ────────────────────────────────────────────────

function createWindow() {
  const isMac = process.platform === 'darwin';
  const saved = store.get('windowBounds');

  // Default: bottom-right corner with 24px margin
  let x, y;
  if (saved) {
    x = saved.x;
    y = saved.y;
  } else {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    x = sw - 360 - 24;
    y = sh - 520 - 24;
  }

  mainWindow = new BrowserWindow({
    width: 360,
    height: 520,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    skipTaskbar: false,
    ...(isMac && {
      vibrancy: 'under-window',
      visualEffectState: 'active',
    }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('moved', () => {
    const b = mainWindow.getBounds();
    store.set('windowBounds', { x: b.x, y: b.y });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC Handlers ──────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('get-auth-status', () => ({
    authenticated: auth.isAuthenticated(),
    account: auth.getAccount(),
  }));

  ipcMain.handle('start-auth', async () => {
    try {
      const result = await auth.startOAuth();
      mainWindow.webContents.send('auth-status', result);
      startUsagePolling();
      return result;
    } catch (err) {
      return { authenticated: false, error: err.message };
    }
  });

  ipcMain.handle('logout', () => {
    usage.stop();
    auth.clearTokens();
    store.delete('usageHistory');
    mainWindow.webContents.send('auth-status', { authenticated: false });
  });

  ipcMain.handle('close-app', () => app.quit());
  ipcMain.handle('minimize-app', () => mainWindow?.minimize());

  ipcMain.handle('refresh-usage', () => usage.manualRefresh());
}

// ── Usage polling ─────────────────────────────────────────

function startUsagePolling() {
  usage.start((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usage-update', data);
    }

    // If auth expired, tell renderer to switch to login
    if (data.error === 'auth_expired') {
      mainWindow.webContents.send('auth-status', { authenticated: false, error: 'Session expired' });
    }
  });
}

// ── App lifecycle ─────────────────────────────────────────

app.whenReady().then(async () => {
  store = new Store();
  auth = new AuthManager(store);
  usage = new UsageTracker(store, auth);

  createWindow();
  setupIPC();

  // Try to silently reconnect with stored tokens
  const valid = await auth.ensureValidToken();
  if (valid) {
    const sendAuthAndStartPolling = () => {
      mainWindow.webContents.send('auth-status', {
        authenticated: true,
        account: auth.getAccount(),
      });
      startUsagePolling();
    };

    // Handle both cases: page already loaded or still loading
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.on('did-finish-load', sendAuthAndStartPolling);
    } else {
      sendAuthAndStartPolling();
    }
  }
});

app.on('window-all-closed', () => {
  usage.stop();
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
