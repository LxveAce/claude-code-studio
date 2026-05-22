import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { PtyManager } from './pty-manager';
import { ResourceMonitor } from './resource-monitor';
import { CompactController } from './compact-controller';
import { GitService } from './git-service';
import { GitHubService } from './github-service';
import { LMMService } from './lmm-service';
import { AuthService } from './auth-service';
import { CloudSyncService } from './cloud-sync';
import { SnippetsService } from './snippets-service';
import { NotificationsService } from './notifications-service';
import { HotkeysService } from './hotkeys-service';
import { TrayService } from './tray-service';
import { IPC } from '../shared/ipc-channels';
import type { HotkeyAction } from '../shared/types';

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
let authService: AuthService | null = null;
let cloudSyncService: CloudSyncService | null = null;
let snippetsService: SnippetsService | null = null;
let notificationsService: NotificationsService | null = null;
let hotkeysService: HotkeysService | null = null;
let trayService: TrayService | null = null;
let suppressNextPtyExitNotification = false;
let isQuitting = false;

function getGitHub(): GitHubService {
  if (!githubService) githubService = new GitHubService();
  return githubService;
}

function getLMM(): LMMService {
  if (!lmmService) lmmService = new LMMService();
  return lmmService;
}

function getAuth(): AuthService {
  if (!authService) authService = new AuthService();
  return authService;
}

function getCloudSync(): CloudSyncService {
  if (!cloudSyncService) {
    cloudSyncService = new CloudSyncService(getGitHub(), (msg) => {
      try {
        getNotifications().notifySyncError(msg);
      } catch {
        // ignore
      }
    });
  }
  return cloudSyncService;
}

function getSnippets(): SnippetsService {
  if (!snippetsService) snippetsService = new SnippetsService();
  return snippetsService;
}

function getNotifications(): NotificationsService {
  if (!notificationsService) notificationsService = new NotificationsService();
  return notificationsService;
}

function getHotkeys(): HotkeysService {
  if (!hotkeysService) hotkeysService = new HotkeysService();
  return hotkeysService;
}

function getTray(): TrayService {
  if (!trayService) trayService = new TrayService();
  return trayService;
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

  mainWindow.on('close', (event) => {
    // If minimize-to-tray is on and we're not in the middle of a real quit,
    // hide the window instead of destroying it. PTY and resource monitor
    // keep running in the background.
    if (!isQuitting && getTray().isMinimizeToTrayEnabled() && mainWindow) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    // Real close path — let main quit handler do the heavy cleanup. We avoid
    // doing it here too because Electron will fire window-all-closed which
    // calls into the same shutdown sequence.
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
    if (suppressNextPtyExitNotification) {
      suppressNextPtyExitNotification = false;
      return;
    }
    try {
      getNotifications().notifyPtyExit(code);
    } catch {
      // notifications must never block PTY teardown
    }
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
    suppressNextPtyExitNotification = true;
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

function setupAuth() {
  ipcMain.handle(IPC.AUTH_STATE, () => getAuth().getState());
  ipcMain.handle(IPC.AUTH_GET_BACKEND, () => getAuth().getBackend());
  ipcMain.handle(IPC.AUTH_SET_BACKEND, (_event, next) => getAuth().setBackend(next));
  ipcMain.handle(IPC.AUTH_REGISTER, (_event, creds) => getAuth().register(creds));
  ipcMain.handle(IPC.AUTH_LOGIN, (_event, creds) => getAuth().login(creds));
  ipcMain.handle(IPC.AUTH_LOGOUT, () => getAuth().logout());
  ipcMain.handle(IPC.AUTH_PULL_SETTINGS, () => getAuth().pullSettings());
  ipcMain.handle(IPC.AUTH_PUSH_SETTINGS, (_event, settings) =>
    getAuth().pushSettings(settings)
  );
}

function setupCloudSync() {
  ipcMain.handle(IPC.SYNC_GET_SETTINGS, () => getCloudSync().getSettings());
  ipcMain.handle(IPC.SYNC_SET_SETTINGS, (_event, partial) =>
    getCloudSync().setSettings(partial)
  );
  ipcMain.handle(IPC.SYNC_STATUS, () => getCloudSync().getStatus());
  ipcMain.handle(IPC.SYNC_SYNC_NOW, () => getCloudSync().syncNow());
  ipcMain.handle(IPC.SYNC_LIST_LOCAL, () => getCloudSync().listLocalVaults());
  ipcMain.handle(IPC.SYNC_LIST_REMOTE, () => getCloudSync().listRemoteVaults());
  ipcMain.handle(IPC.SYNC_PREVIEW_VAULT, (_event, name: string) =>
    getCloudSync().previewVault(name)
  );
  ipcMain.handle(IPC.SYNC_CREATE_REPO, (_event, repoName: string) =>
    getCloudSync().createRepo(repoName)
  );
  ipcMain.handle(IPC.SYNC_VERIFY_REPO, (_event, owner: string, repo: string) =>
    getCloudSync().verifyRepo(owner, repo)
  );
  ipcMain.handle(IPC.SYNC_DELETE_REMOTE, (_event, name: string) =>
    getCloudSync().deleteRemoteVault(name)
  );
}

function setupSnippets() {
  ipcMain.handle(IPC.SNIPPET_LIST, () => getSnippets().list());
  ipcMain.handle(IPC.SNIPPET_CREATE, (_event, input) => getSnippets().create(input));
  ipcMain.handle(IPC.SNIPPET_UPDATE, (_event, id: string, patch) =>
    getSnippets().update(id, patch)
  );
  ipcMain.handle(IPC.SNIPPET_DELETE, (_event, id: string) => getSnippets().delete(id));
}

function setupNotifications() {
  ipcMain.handle(IPC.NOTIF_SUPPORTED, () => getNotifications().isSupported());
  ipcMain.handle(IPC.NOTIF_GET_SETTINGS, () => getNotifications().getSettings());
  ipcMain.handle(IPC.NOTIF_SET_SETTINGS, (_event, partial) =>
    getNotifications().setSettings(partial)
  );
  ipcMain.handle(IPC.NOTIF_TEST, () => getNotifications().fireTest());
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

function setupHotkeys() {
  ipcMain.handle(IPC.HOTKEYS_GET, () => getHotkeys().getSettings());
  ipcMain.handle(
    IPC.HOTKEYS_SET_BINDING,
    (_event, action: unknown, chord: unknown) =>
      getHotkeys().setBinding(action, chord)
  );
  ipcMain.handle(IPC.HOTKEYS_RESET, () => getHotkeys().resetDefaults());
}

function setupTray() {
  const tray = getTray();
  tray.attach({
    getWindow: () => mainWindow,
    onToggleCompact: async () => {
      try {
        const status = compactController.getStatus();
        if (status.enabled) {
          compactController.uninstall();
        } else {
          compactController.install();
        }
      } catch {
        // If the user has a malformed settings.json we don't want the tray
        // click to crash the app. Best-effort only.
      }
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });
  ipcMain.handle(IPC.TRAY_GET_SETTINGS, () => getTray().getSettings());
  ipcMain.handle(IPC.TRAY_SET_SETTINGS, (_event, partial) =>
    getTray().setSettings(partial)
  );
}

/** Forward a tray-triggered action to the renderer. Used by future tray
 *  menu items that map onto renderer-side handlers. */
function dispatchTrayAction(action: HotkeyAction): void {
  safeSend(IPC.TRAY_INVOKE_ACTION, action);
}
// Re-export so unused-var doesn't bite; this hook is here for future tray menu growth.
void dispatchTrayAction;

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
  setupAuth();
  setupCloudSync();
  setupSnippets();
  setupNotifications();
  setupWindowControls();
  setupHotkeys();
  setupTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on('before-quit', () => {
  // Mark the quit so the window close handler stops intercepting.
  isQuitting = true;
  try {
    resourceMonitor.stop();
  } catch {
    // ignore
  }
  try {
    ptyManager.kill();
  } catch {
    // ignore
  }
  try {
    trayService?.dispose();
  } catch {
    // ignore
  }
});

app.on('window-all-closed', () => {
  // If minimize-to-tray is on, the window is just hidden — Electron will not
  // actually fire window-all-closed in that case. So when this fires, we're
  // either on macOS (stay alive) or genuinely shutting down.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
