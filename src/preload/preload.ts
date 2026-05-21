import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

contextBridge.exposeInMainWorld('electronAPI', {
  terminal: {
    onData: (callback: (data: string) => void) => {
      ipcRenderer.on(IPC.TERMINAL_DATA, (_event, data) => callback(data));
    },
    onExit: (callback: (code: number) => void) => {
      ipcRenderer.on(IPC.TERMINAL_EXIT, (_event, code) => callback(code));
    },
    onReady: (callback: (pid: number) => void) => {
      ipcRenderer.on(IPC.TERMINAL_READY, (_event, pid) => callback(pid));
    },
    sendInput: (data: string) => {
      ipcRenderer.send(IPC.TERMINAL_INPUT, data);
    },
    resize: (cols: number, rows: number) => {
      ipcRenderer.send(IPC.TERMINAL_RESIZE, cols, rows);
    },
    restart: () => {
      ipcRenderer.send(IPC.TERMINAL_RESTART);
    },
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
});
