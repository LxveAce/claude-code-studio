import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { PtyRegistry } from './pty-registry';
import { ResourceMonitor } from './resource-monitor';
import { CompactController } from './compact-controller';
import { GitService } from './git-service';
import { GitHubService } from './github-service';
import { LMMService } from './lmm-service';
import { AuthService } from './auth-service';
import { CloudSyncService } from './cloud-sync';
import { SnippetsService } from './snippets-service';
import { NotificationsService } from './notifications-service';
import { UpdaterService } from './updater-service';
import { SessionService } from './session-service';
import { HotkeysService } from './hotkeys-service';
import { TrayService } from './tray-service';
import { CostService } from './cost-service';
import { CliService } from './cli-service';
import { ModelRegistry } from './model-registry';
import { OllamaService, type OllamaPullProgressEvent } from './ollama-service';
import { detectHardware } from './hardware-detection';
import { detectProject } from './project-language-detect';
import { probeDisk } from './disk-info';
import { FirstRunService } from './first-run-service';
import { IPC } from '../shared/ipc-channels';
import type {
  HotkeyAction,
  ModelDefinition,
  ModelLaunchResult,
  ModelPopoutResult,
} from '../shared/types';

if (require('electron-squirrel-startup')) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
/** Pop-out BrowserWindows keyed by paneId so we can close them when the main
 *  window closes (and detect "already popped out" attempts to focus instead). */
const popoutWindows = new Map<string, BrowserWindow>();
const ptyRegistry = new PtyRegistry();
const resourceMonitor = new ResourceMonitor();
const compactController = new CompactController();
const gitService = new GitService();
let githubService: GitHubService | null = null;
let lmmService: LMMService | null = null;
let authService: AuthService | null = null;
let cloudSyncService: CloudSyncService | null = null;
let snippetsService: SnippetsService | null = null;
let notificationsService: NotificationsService | null = null;
let updaterService: UpdaterService | null = null;
let sessionService: SessionService | null = null;
let hotkeysService: HotkeysService | null = null;
let trayService: TrayService | null = null;
let costService: CostService | null = null;
let cliService: CliService | null = null;
let isQuitting = false;
/** Pane IDs whose PTY was killed by an explicit user "restart" — suppresses
 * the imminent "Claude exited" notification once per restart. Superseded the
 * single-boolean version from 7d (paneId-aware now that 7c shipped split panes). */
const suppressedRestartPanes = new Set<string>();

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

function isDevMode(): boolean {
  try {
    return typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
      && MAIN_WINDOW_VITE_DEV_SERVER_URL.length > 0;
  } catch {
    return false;
  }
}

function getUpdater(): UpdaterService {
  if (!updaterService) {
    updaterService = new UpdaterService({
      isDevMode: isDevMode(),
      callbacks: {
        onUpdateDownloaded: (version: string) => {
          try {
            getNotifications().notifyUpdateAvailable(version);
          } catch {
            // notifications must never block updater
          }
          safeSend(IPC.UPDATER_AVAILABLE, version);
        },
        onDownloadProgress: (percent: number) => {
          // Stream to renderer for status-bar progress UI. Fire-and-forget;
          // safeSend no-ops if the window is gone.
          safeSend(IPC.UPDATER_DOWNLOAD_PROGRESS, percent);
        },
        onError: (_msg: string) => {
          // Soft-fail: lastError is captured in updater state and surfaced via UI.
          // We intentionally do NOT fire an OS notification on every transient
          // network error — would be spammy.
        },
      },
    });
  }
  return updaterService;
}

function getSession(): SessionService {
  if (!sessionService) sessionService = new SessionService();
  return sessionService;
}

function getHotkeys(): HotkeysService {
  if (!hotkeysService) hotkeysService = new HotkeysService();
  return hotkeysService;
}

function getTray(): TrayService {
  if (!trayService) trayService = new TrayService();
  return trayService;
}

function getCli(): CliService {
  if (!cliService) cliService = new CliService();
  return cliService;
}

function getCost(): CostService {
  if (!costService) {
    costService = new CostService((day, budget) => {
      try {
        getNotifications().notifyCostBudget(day.estCostUSD, budget);
      } catch {
        // notifications must never break sampling
      }
    });
  }
  return costService;
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
    // hide the window instead of destroying it. PTYs and resource monitor
    // keep running in the background.
    if (!isQuitting && trayService?.isMinimizeToTrayEnabled() && mainWindow) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    // Real close path — before-quit handles teardown (PTY registry + resource
    // monitor + tray dispose).
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // DevTools keybind — available in BOTH dev and packaged builds. The
  // packaged build has no other way for the user to surface renderer
  // errors (the `EnableNodeOptionsEnvironmentVariable: false` fuse means
  // they can't set NODE_ENV=development to enable the existing auto-open
  // path), and "blank window with no clue why" is the worst diagnostic
  // experience. F12 / Ctrl+Shift+I / Cmd+Opt+I all toggle.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isF12 = input.key === 'F12';
    const isCtrlShiftI =
      (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
    if (isF12 || isCtrlShiftI) {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
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

function syncResourcePids() {
  resourceMonitor.setClaudePids(ptyRegistry.allPids());
}

function setupTerminal() {
  ptyRegistry.on('data', (paneId: string, data: string) => {
    safeSend(IPC.TERMINAL_DATA, paneId, data);
  });

  ptyRegistry.on('exit', (paneId: string, code: number) => {
    safeSend(IPC.TERMINAL_EXIT, paneId, code);
    syncResourcePids();
    if (suppressedRestartPanes.has(paneId)) {
      suppressedRestartPanes.delete(paneId);
      return;
    }
    try {
      getNotifications().notifyPtyExit(code);
    } catch {
      // notifications must never block PTY teardown
    }
  });

  ptyRegistry.on('ready', (paneId: string, pid: number) => {
    safeSend(IPC.TERMINAL_READY, paneId, pid);
    syncResourcePids();
  });

  ipcMain.on(IPC.TERMINAL_INPUT, (_event, paneId: unknown, data: unknown) => {
    if (!PtyRegistry.isValidPaneId(paneId)) return;
    if (typeof data !== 'string') return;
    ptyRegistry.write(paneId, data);
  });

  ipcMain.on(
    IPC.TERMINAL_RESIZE,
    (_event, paneId: unknown, cols: unknown, rows: unknown) => {
      if (!PtyRegistry.isValidPaneId(paneId)) return;
      if (typeof cols !== 'number' || typeof rows !== 'number') return;
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
      if (cols <= 0 || rows <= 0 || cols > 1000 || rows > 1000) return;
      ptyRegistry.resize(paneId, Math.floor(cols), Math.floor(rows));
    }
  );

  ipcMain.on(IPC.TERMINAL_RESTART, (_event, paneId: unknown) => {
    if (!PtyRegistry.isValidPaneId(paneId)) return;
    suppressedRestartPanes.add(paneId);
    // Restart is a *hard* lifecycle transition (kill + spawn). spawn()'s
    // reattach-if-alive shortcut would skip the kill, so we must kill first.
    try {
      ptyRegistry.kill(paneId);
      ptyRegistry.spawn(paneId);
    } catch {
      // Surfaces via missing 'ready' event on the renderer.
    }
    // Auto-expire the suppression after a short window. The kill+spawn path
    // disposes the old PTY's exit listener before exit fires, so the exit
    // event never reaches our registry handler — without this auto-clear we
    // would leak a "suppress next exit" flag that wrongly silences the
    // *next legitimate exit* of the NEW PTY (e.g. user-driven /quit minutes
    // later).
    setTimeout(() => suppressedRestartPanes.delete(paneId), 1500);
  });

  ipcMain.handle(
    IPC.TERMINAL_SPAWN,
    (_event, paneId: unknown, cwd: unknown) => {
      if (!PtyRegistry.isValidPaneId(paneId)) {
        throw new Error('invalid paneId');
      }
      const safeCwd =
        typeof cwd === 'string' && cwd.length > 0 && cwd.length <= 4096 ? cwd : undefined;
      ptyRegistry.spawn(paneId, safeCwd);
      return true;
    }
  );

  ipcMain.handle(IPC.TERMINAL_KILL, (_event, paneId: unknown) => {
    if (!PtyRegistry.isValidPaneId(paneId)) return false;
    ptyRegistry.kill(paneId);
    syncResourcePids();
    return true;
  });
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

function setupCli() {
  // Phase 6 onboarding — recovers from Phase 4 NSIS bootstrap soft-fail.
  ipcMain.handle(IPC.CLI_STATUS, () => getCli().getStatus());
  ipcMain.handle(IPC.CLI_INSTALL, () =>
    getCli().install((line) => {
      // Stream each line to the renderer for live progress in the
      // onboarding modal (Phase 6 M1). Fire-and-forget; safeSend no-ops
      // if the window is gone.
      safeSend(IPC.CLI_INSTALL_PROGRESS, line);
    })
  );
  ipcMain.handle(IPC.CLI_ONBOARDING_GET, () => getCli().getOnboardingState());
  ipcMain.handle(IPC.CLI_ONBOARDING_COMPLETE, () => getCli().setOnboardingComplete());
  ipcMain.handle(IPC.CLI_ONBOARDING_RESET, () => getCli().resetOnboarding());
}

function setupModels() {
  // v3.0 multi-model — catalog + recommend + launch. The catalog seed
  // lives in model-catalog-seed.ts; recommend() ranks against the host's
  // hardware tier + the cwd's project fingerprint.
  const reg = ModelRegistry.instance();
  ipcMain.handle(IPC.MODELS_LIST, () => reg.list());
  ipcMain.handle(IPC.MODELS_GET, (_event, id: unknown) => {
    if (typeof id !== 'string') return null;
    return reg.get(id);
  });
  ipcMain.handle(IPC.MODELS_ADD, (_event, model: unknown) => {
    return reg.add(model as ModelDefinition);
  });
  ipcMain.handle(IPC.MODELS_UPDATE, (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string') throw new Error('model id must be string');
    return reg.update(id, patch as Partial<ModelDefinition>);
  });
  ipcMain.handle(IPC.MODELS_REMOVE, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('model id must be string');
    return reg.remove(id);
  });
  ipcMain.handle(IPC.MODELS_RESET_SEED, () => reg.resetToSeed());

  ipcMain.handle(IPC.MODELS_OPEN_EXTERNAL, (_event, url: unknown) => {
    if (typeof url !== 'string') return false;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    // Model-related allowlist: official license sources + model registries.
    const allowed =
      host === 'ollama.com' ||
      host.endsWith('.ollama.com') ||
      host === 'huggingface.co' ||
      host.endsWith('.huggingface.co') ||
      host === 'ai.google.dev' ||
      host === 'llama.com' ||
      host.endsWith('.llama.com') ||
      host === 'www.bigcode-project.org' ||
      host === 'bigcode-project.org' ||
      host === 'github.com';
    if (!allowed) return false;
    void shell.openExternal(parsed.toString());
    return true;
  });

  ipcMain.handle(IPC.MODELS_RECOMMEND, async (_event, cwd: unknown) => {
    const safeCwd =
      typeof cwd === 'string' && cwd.length > 0 && cwd.length <= 4096 ? cwd : null;
    const hardware = await detectHardware();
    const project = safeCwd ? detectProject(safeCwd) : null;
    return reg.recommend(hardware, project);
  });

  ipcMain.handle(
    IPC.MODELS_LAUNCH,
    async (_event, modelId: unknown, cwd: unknown): Promise<ModelLaunchResult> => {
      if (typeof modelId !== 'string') {
        return { ok: false, paneId: null, commandLine: null, error: 'modelId must be a string' };
      }
      const model = reg.get(modelId);
      if (!model) {
        return { ok: false, paneId: null, commandLine: null, error: `Unknown model: ${modelId}` };
      }
      const safeCwd =
        typeof cwd === 'string' && cwd.length > 0 && cwd.length <= 4096 ? cwd : undefined;
      // paneId = "model:<id>-<timestamp>" — bounded length, only allowed chars.
      const safeIdPart = model.id.replace(/[^A-Za-z0-9_\-:]/g, '_').slice(0, 40);
      const paneId = `model:${safeIdPart}-${Date.now().toString(36)}`.slice(0, 64);
      try {
        ptyRegistry.spawn(paneId, safeCwd, {
          command: model.command,
          args: model.args,
          label: model.name,
        });
        syncResourcePids();
        return {
          ok: true,
          paneId,
          commandLine: ptyRegistry.commandLineFor(paneId),
          error: null,
        };
      } catch (e) {
        return {
          ok: false,
          paneId: null,
          commandLine: null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );
}

function setupOllama() {
  const svc = OllamaService.instance();
  // Forward pull progress to the renderer as a broadcast event keyed by
  // model name (renderer routes to the right per-model UI).
  ipcMain.handle(IPC.OLLAMA_VERSION, (_event, force: unknown) =>
    svc.getVersion(force === true)
  );
  ipcMain.handle(IPC.OLLAMA_LIST, () => svc.listInstalled());
  ipcMain.handle(IPC.OLLAMA_PULL_START, (_event, name: unknown) => {
    if (typeof name !== 'string') {
      return { ok: false, error: 'name must be a string' };
    }
    try {
      const ee = svc.startPull(name);
      ee.on('progress', (evt: OllamaPullProgressEvent) =>
        safeSend(IPC.OLLAMA_PULL_PROGRESS, evt)
      );
      ee.on('done', () =>
        safeSend(IPC.OLLAMA_PULL_PROGRESS, {
          modelName: name,
          percent: 100,
          status: 'done',
          bytesCompleted: null,
          bytesTotal: null,
        })
      );
      ee.on('error', (err: Error) =>
        safeSend(IPC.OLLAMA_PULL_PROGRESS, {
          modelName: name,
          percent: null,
          status: `error: ${err.message}`,
          bytesCompleted: null,
          bytesTotal: null,
        })
      );
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle(IPC.OLLAMA_PULL_CANCEL, (_event, name: unknown) => {
    if (typeof name !== 'string') return { ok: false };
    return { ok: svc.cancelPull(name) };
  });
  ipcMain.handle(IPC.OLLAMA_DELETE, (_event, name: unknown) => {
    if (typeof name !== 'string') return { ok: false, error: 'name must be a string' };
    return svc.delete(name);
  });
}

function setupHardware() {
  ipcMain.handle(IPC.HARDWARE_DETECT, (_event, force: unknown) =>
    detectHardware(force === true)
  );
}

function setupProject() {
  ipcMain.handle(IPC.PROJECT_DETECT, (_event, cwd: unknown) => {
    const safeCwd =
      typeof cwd === 'string' && cwd.length > 0 && cwd.length <= 4096 ? cwd : gitService.getCwd();
    return detectProject(safeCwd);
  });
}

function setupDisk() {
  ipcMain.handle(IPC.DISK_INFO, async (_event, target: unknown) => {
    const safeTarget =
      typeof target === 'string' && target.length > 0 && target.length <= 4096
        ? target
        : undefined;
    return probeDisk(safeTarget);
  });
}

function setupAppMeta() {
  // Single source of truth for the version shown in the title bar + status bar.
  // app.getVersion() reads from package.json (or the packaged Info.plist /
  // resources). Prevents the title=v1.0.0 / status=v2.0.0 / installer=v3.0.0
  // tri-version drift observed in beta.1.
  ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());
}

function setupFirstRun() {
  const svc = FirstRunService.instance();
  ipcMain.handle(IPC.MODELS_ONBOARDING_GET, () => svc.get());
  ipcMain.handle(IPC.MODELS_ONBOARDING_MARK_SHOWN, (_event, outcome: unknown) => {
    const safe = outcome === 'completed' ? 'completed' : 'skipped';
    return svc.markShown(safe);
  });
  ipcMain.handle(IPC.MODELS_ONBOARDING_RESET, () => svc.reset());
}

function setupPopout() {
  ipcMain.handle(
    IPC.MODELS_POPOUT,
    (_event, paneId: unknown, label: unknown): ModelPopoutResult => {
      if (!PtyRegistry.isValidPaneId(paneId)) {
        return { ok: false, windowId: null, error: 'invalid paneId' };
      }
      if (!ptyRegistry.has(paneId)) {
        return { ok: false, windowId: null, error: 'pane not found — launch the model first' };
      }
      // Focus existing popout if present rather than spawning a duplicate.
      const existing = popoutWindows.get(paneId);
      if (existing && !existing.isDestroyed()) {
        existing.show();
        existing.focus();
        return { ok: true, windowId: existing.id, error: null };
      }

      const safeLabel =
        typeof label === 'string' && label.length > 0 && label.length <= 128
          ? label
          : 'Model';
      try {
        const win = new BrowserWindow({
          width: 900,
          height: 600,
          title: `${safeLabel} — Claude Code Studio`,
          parent: mainWindow ?? undefined,
          backgroundColor: '#0a0a14',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        });
        popoutWindows.set(paneId, win);
        win.on('closed', () => {
          popoutWindows.delete(paneId);
        });

        // Load the same HTML the main window uses, with query params the
        // renderer's popout-mode branch parses. URL-encode the label so
        // the renderer can display it in the title bar.
        const query = `?popout=${encodeURIComponent(paneId)}&label=${encodeURIComponent(safeLabel)}`;
        if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
          void win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}${query}`);
        } else {
          void win.loadFile(
            path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
            { search: query.slice(1) }
          );
        }
        return { ok: true, windowId: win.id, error: null };
      } catch (e) {
        return {
          ok: false,
          windowId: null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
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

function setupUpdater() {
  ipcMain.handle(IPC.UPDATER_GET_STATE, () => getUpdater().getState());
  ipcMain.handle(IPC.UPDATER_GET_SETTINGS, () => getUpdater().getSettings());
  ipcMain.handle(IPC.UPDATER_SET_SETTINGS, (_event, partial) =>
    getUpdater().setSettings(partial)
  );
  ipcMain.handle(IPC.UPDATER_CHECK_NOW, () => getUpdater().checkNow());
}

function setupCost() {
  ipcMain.handle(IPC.COST_STATUS, () => getCost().getStatus());
  ipcMain.handle(IPC.COST_GET_SETTINGS, () => getCost().getSettings());
  ipcMain.handle(IPC.COST_SET_SETTINGS, (_event, partial) =>
    getCost().setSettings(partial)
  );
  ipcMain.handle(IPC.COST_LIST_SESSIONS, () => getCost().listSessions());
  ipcMain.handle(IPC.COST_RESET_HISTORY, async () => {
    const svc = getCost();
    svc.resetHistory();
    // Force a sample so re-ingested vaults appear immediately rather than
    // waiting up to 30 s for the next poll. Best-effort — sample is wrapped
    // in its own try/catch.
    await svc.sampleNow();
    return true;
  });
  // Start the 30 s polling loop after IPC is wired so the first sample's data
  // is available the moment the renderer requests it.
  getCost().start();
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

function setupSession() {
  ipcMain.handle(IPC.SESSION_GET, () => getSession().get());
  ipcMain.handle(IPC.SESSION_SET, (_event, state: unknown) => {
    // SessionService.sanitize() rejects anything malformed; we only need to
    // ensure we pass *something* and not crash on null/undefined.
    return getSession().set(state as never);
  });
  ipcMain.handle(IPC.SESSION_RESET, () => getSession().reset());
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
  // Windows toast notifications require an AppUserModelID that matches
  // the installer's registered AUMID. Squirrel sets one based on the
  // executable's metadata, but explicitly calling setAppUserModelId
  // ensures Notification.show() is correctly attributed and not
  // silently dropped by the OS Action Center.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.squirrel.claude_code_studio.claude-code-studio');
  }

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
  setupUpdater();
  setupSession();
  setupCost();
  setupCli();
  setupModels();
  setupOllama();
  setupHardware();
  setupProject();
  setupDisk();
  setupFirstRun();
  setupPopout();
  setupAppMeta();
  setupWindowControls();
  setupHotkeys();
  setupTray();

  // Kick off the auto-updater after a short grace period so the window
  // is responsive first. start() is a no-op in dev mode.
  setTimeout(() => {
    try {
      getUpdater().start();
    } catch {
      // never crash the app on updater wiring failure
    }
  }, 5000);

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
  // Close pop-out windows so their renderers tear down their xterms before
  // we kill the PTYs they're attached to (avoids "writing to disposed term"
  // races in the destruct order).
  try {
    for (const win of popoutWindows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    popoutWindows.clear();
  } catch {
    // ignore
  }
  try {
    ptyRegistry.killAll();
  } catch {
    // ignore
  }
  try {
    trayService?.dispose();
  } catch {
    // ignore
  }
  try {
    costService?.stop();
  } catch {
    // ignore
  }
});

app.on('window-all-closed', () => {
  // If minimize-to-tray is on, the window is just hidden — Electron will not
  // actually fire window-all-closed in that case. So when this fires, we're
  // either on macOS (stay alive) or genuinely shutting down via before-quit.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
