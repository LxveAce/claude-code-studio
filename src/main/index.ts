import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { PtyManager } from './pty-manager';
import { IPC } from '../shared/ipc-channels';

if (require('electron-squirrel-startup')) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
const ptyManager = new PtyManager();

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

function setupTerminal() {
  ptyManager.on('data', (data: string) => {
    mainWindow?.webContents.send(IPC.TERMINAL_DATA, data);
  });

  ptyManager.on('exit', (code: number) => {
    mainWindow?.webContents.send(IPC.TERMINAL_EXIT, code);
  });

  ptyManager.on('ready', (pid: number) => {
    mainWindow?.webContents.send(IPC.TERMINAL_READY, pid);
  });

  ipcMain.on(IPC.TERMINAL_INPUT, (_event, data: string) => {
    ptyManager.write(data);
  });

  ipcMain.on(IPC.TERMINAL_RESIZE, (_event, cols: number, rows: number) => {
    ptyManager.resize(cols, rows);
  });

  ipcMain.on(IPC.TERMINAL_RESTART, () => {
    ptyManager.kill();
    ptyManager.spawn();
  });

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  ptyManager.spawn();
}

app.whenReady().then(() => {
  createWindow();
  setupTerminal();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  ptyManager.kill();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
