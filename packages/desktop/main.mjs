import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog, Menu, shell } from 'electron';

import { ensureUserState, serverUrl } from './runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let backendServer;
let mainWindow;

function userDataPath() {
  return process.env.TIMETABLE_DESKTOP_USER_DATA
    || join(app.getPath('appData'), 'AP排课系统');
}

function resourcePath(...parts) {
  return join(app.isPackaged ? process.resourcesPath : here, ...parts);
}

function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: '打开数据目录',
          click: () => shell.openPath(userDataPath()),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '查看',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ]));
}

async function startBackend() {
  const stateFile = join(userDataPath(), 'timetable.json');
  const seedFile = app.isPackaged
    ? resourcePath('seed-state.json')
    : join(here, 'seed-state.json');
  await ensureUserState({ stateFile, seedFile });
  process.env.STATE_FILE = stateFile;

  if (process.platform === 'win32') {
    const sidecar = resourcePath('solver', 'timetable-solver.exe');
    if (!existsSync(sidecar)) throw new Error(`Windows 求解器组件缺失: ${sidecar}`);
    process.env.TIMETABLE_SOLVER_SIDECAR = sidecar;
  }

  const { startServer } = await import('../backend/src/server.mjs');
  backendServer = startServer({ port: 0, host: '127.0.0.1' });
  if (!backendServer.listening) await once(backendServer, 'listening');
  return serverUrl(backendServer.address());
}

async function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(url);
}

async function launch() {
  try {
    installApplicationMenu();
    await createWindow(await startBackend());
  } catch (error) {
    console.error('AP timetable desktop startup failed', error);
    dialog.showErrorBox('AP 排课系统无法启动', error?.stack || error?.message || String(error));
    app.quit();
  }
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(launch);
}

app.on('before-quit', () => backendServer?.close());
app.on('window-all-closed', () => app.quit());
