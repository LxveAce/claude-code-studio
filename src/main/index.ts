import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { PtyManager } from './pty-manager';
import { ResourceMonitor } from './resource-monitor';
import { CompactController } from './compact-controller';
import { GitService } from './git-service';
import { GitHubService } from './github-service';
import { LMMService } from './lmm-service';
import { IPC } from '../shared/ipc-channels';

if (require('electron-squirrel-startup')) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
const ptyManager = new PtyManager();
const resourceMonitor = new ResourceMonitor();
const compactController = new CompactController();
const gitService = new GitService();
let githubService: GitHubService | null = null;
let lmmService: LMMService | null = null;

function getGitHub(): GitHubService {
  if (!githubService) githubService = new GitHubService();
  return githubService;
}

function getLMM(): LMMService {
  if (!lmmService) lmmService = new LMMService();
  return lmmService;
}

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
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.on('close', () => {
    resourceMonitor.stop();
    ptyManager.kill();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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

function safeSend(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function setupTerminal() {
  ptyManager.on('data', (data: string) => {
    safeSend(IPC.TERMINAL_DATA, data);
  });

  ptyManager.on('exit', (code: number) => {
    safeSend(IPC.TERMINAL_EXIT, code);
  });

  ptyManager.on('ready', (pid: number) => {
    safeSend(IPC.TERMINAL_READY, pid);
    resourceMonitor.setClaudePid(pid);
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

  ptyManager.spawn();
}

function setupResources() {
  resourceMonitor.on('update', (snapshot) => {
    safeSend(IPC.RESOURCE_UPDATE, snapshot);
  });

  ipcMain.on(IPC.RESOURCE_START, () => resourceMonitor.start());
  ipcMain.on(IPC.RESOURCE_STOP, () => resourceMonitor.stop());

  resourceMonitor.start();
}

function setupCompact() {
  ipcMain.handle(IPC.COMPACT_STATUS, () => compactController.getStatus());
  ipcMain.handle(IPC.COMPACT_INSTALL, () => compactController.install());
  ipcMain.handle(IPC.COMPACT_UNINSTALL, () => compactController.uninstall());
  ipcMain.handle(IPC.COMPACT_CONFIG_GET, () => compactController.getConfig());
  ipcMain.handle(IPC.COMPACT_CONFIG_SET, (_event, config) =>
    compactController.setConfig(config)
  );
}

function setupGit() {
  ipcMain.handle(IPC.GIT_DETECT, (_event, cwd?: string) => gitService.detect(cwd));
  ipcMain.handle(IPC.GIT_GET_CWD, () => gitService.getCwd());
  ipcMain.handle(IPC.GIT_SET_CWD, (_event, next: string) => gitService.setCwd(next));
  ipcMain.handle(IPC.GIT_PICK_DIR, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a folder',
      properties: ['openDirectory'],
      defaultPath: gitService.getCwd(),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return gitService.setCwd(result.filePaths[0]);
  });
}

function setupGitHub() {
  ipcMain.handle(IPC.GITHUB_AUTH_STATE, () => getGitHub().getAuthState());
  ipcMain.handle(
    IPC.GITHUB_SET_TOKEN,
    (_event, token: string, allowPlaintext?: boolean) =>
      getGitHub().setToken(token, allowPlaintext === true)
  );
  ipcMain.handle(IPC.GITHUB_CLEAR_TOKEN, () => getGitHub().clearToken());
  ipcMain.handle(IPC.GITHUB_REPO_INFO, (_event, owner: string, repo: string) =>
    getGitHub().getRepoInfo(owner, repo)
  );
  ipcMain.handle(IPC.GITHUB_COMMITS, (_event, owner: string, repo: string) =>
    getGitHub().listCommits(owner, repo)
  );
  ipcMain.handle(IPC.GITHUB_BRANCHES, (_event, owner: string, repo: string) =>
    getGitHub().listBranches(owner, repo)
  );
  ipcMain.handle(
    IPC.GITHUB_PRS,
    (_event, owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open') =>
      getGitHub().listPullRequests(owner, repo, state)
  );
  ipcMain.handle(
    IPC.GITHUB_ISSUES,
    (_event, owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open') =>
      getGitHub().listIssues(owner, repo, state)
  );
  ipcMain.handle(IPC.GITHUB_OPEN_EXTERNAL, (_event, url: string) => {
    if (typeof url !== 'string') return false;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    const allowed =
      host === 'github.com' ||
      host === 'gist.github.com' ||
      host === 'docs.github.com' ||
      host.endsWith('.githubusercontent.com');
    if (!allowed) return false;
    void shell.openExternal(parsed.toString());
    return true;
  });
}

function setupLMM() {
  ipcMain.handle(IPC.LMM_GET_SETTINGS, () => getLMM().getSettings());
  ipcMain.handle(IPC.LMM_SET_SETTINGS, (_event, partial) =>
    getLMM().setSettings(partial)
  );
  ipcMain.handle(IPC.LMM_LIST_CYCLES, () => getLMM().listCycles());
  ipcMain.handle(IPC.LMM_GET_CYCLE, (_event, id: string) => getLMM().getCycle(id));
  ipcMain.handle(IPC.LMM_CREATE_CYCLE, (_event, title: string) =>
    getLMM().createCycle(title)
  );
  ipcMain.handle(
    IPC.LMM_SAVE_PHASE,
    (_event, id: string, phase: 'raw' | 'nodes' | 'reflect' | 'synth', content: string) =>
      getLMM().savePhase(id, phase, content)
  );
  ipcMain.handle(IPC.LMM_DELETE_CYCLE, (_event, id: string) =>
    getLMM().deleteCycle(id)
  );
  ipcMain.handle(IPC.LMM_PICK_JOURNAL_DIR, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Pick journal directory',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getLMM().getSettings().journalDir,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return getLMM().pickJournalDir(result.filePaths[0]);
  });
}

function setupWindowControls() {
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());
}

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    const devUrl = (() => {
      try {
        return typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
          ? MAIN_WINDOW_VITE_DEV_SERVER_URL
          : null;
      } catch {
        return null;
      }
    })();
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
  });
});

app.whenReady().then(() => {
  createWindow();
  setupTerminal();
  setupResources();
  setupCompact();
  setupGit();
  setupGitHub();
  setupLMM();
  setupWindowControls();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  ptyManager.kill();
  resourceMonitor.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
