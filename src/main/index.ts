import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
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
import { AccessibilityService } from './accessibility-service';
import { HuggingFaceService } from './huggingface-service';
import { CostService } from './cost-service';
import { CliService } from './cli-service';
import { ModelRegistry } from './model-registry';
import { OllamaService, type OllamaPullProgressEvent } from './ollama-service';
import { detectHardware } from './hardware-detection';
import { detectProject } from './project-language-detect';
import { probeDisk } from './disk-info';
import { FirstRunService } from './first-run-service';
import { ThemeService } from './theme-service';
import { WindowStateService } from './window-state-service';
import {
  ProviderAuthService,
  normalizeProvider,
  PROVIDER_ENV_KEY,
} from './provider-auth-service';
import { PtyKeyInterceptor } from './pty-key-interceptor';
import { providerDetect } from './provider-detect';
import { readGpuPrefs, writeGpuPrefs } from './gpu-prefs';
import { readCliFlags, writeCliFlags, type CliFlags } from './cli-flags';
import {
  listDir as projectListDir,
  readRecentProjects,
  addRecentProject,
  removeRecentProject,
} from './project-explorer';
import { spawn as childSpawn } from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as nodeFsp from 'node:fs/promises';
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
let accessibilityService: AccessibilityService | null = null;
let huggingfaceService: HuggingFaceService | null = null;
let costService: CostService | null = null;
let cliService: CliService | null = null;
let themeService: ThemeService | null = null;
let windowStateService: WindowStateService | null = null;
const ptyKeyInterceptor = new PtyKeyInterceptor();
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

function getThemes(): ThemeService {
  if (!themeService) themeService = new ThemeService();
  return themeService;
}

function getWindowState(): WindowStateService {
  if (!windowStateService) windowStateService = new WindowStateService();
  return windowStateService;
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

function getAccessibility(): AccessibilityService {
  if (!accessibilityService) accessibilityService = new AccessibilityService();
  return accessibilityService;
}

function getHuggingFace(): HuggingFaceService {
  if (!huggingfaceService) huggingfaceService = new HuggingFaceService();
  return huggingfaceService;
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
  const savedState = getWindowState().loadState('main', {
    x: -1,
    y: -1,
    width: 1400,
    height: 900,
    maximized: false,
  });
  const usingSavedPosition = savedState.x >= 0 && savedState.y >= 0;
  mainWindow = new BrowserWindow({
    ...(usingSavedPosition ? { x: savedState.x, y: savedState.y } : {}),
    width: savedState.width,
    height: savedState.height,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
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
  if (savedState.maximized) mainWindow.maximize();
  getWindowState().bindWindow('main', mainWindow);

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
  // 3.0.0-beta.3: split by category so the Resources panel can show
  // Claude RAM vs model RAM as separate gauges instead of one aggregated
  // "Claude" number that grew silently when the user launched a model.
  // Falls back to legacy behavior if the registry doesn't know the
  // category (treats unknowns as 'claude' — preserves pre-beta.3
  // accounting).
  resourceMonitor.setTrackedPids(
    ptyRegistry.pidsByCategory('claude'),
    ptyRegistry.pidsByCategory('model')
  );
}

function setupTerminal() {
  ptyRegistry.on('data', (paneId: string, data: string) => {
    // Feed the key interceptor first — it's a no-op for unregistered panes,
    // so the cost is one Map lookup per data event. If the pane has a
    // registered provider and the data contains a key prompt, the
    // interceptor fires `key-prompt` which we forward to the renderer.
    try {
      ptyKeyInterceptor.feed(paneId, data);
    } catch {
      // Never let interception break terminal data flow.
    }
    safeSend(IPC.TERMINAL_DATA, paneId, data);
  });

  ptyKeyInterceptor.on('key-prompt', (payload: { paneId: string; provider: string }) => {
    safeSend(IPC.PROVIDER_KEY_PROMPT, {
      paneId: payload.paneId,
      provider: payload.provider,
      source: 'pty-interceptor',
    });
  });

  ptyRegistry.on('exit', (paneId: string, code: number) => {
    safeSend(IPC.TERMINAL_EXIT, paneId, code);
    syncResourcePids();
    // Stop watching this pane — even if the PTY is replaced, the interceptor
    // attaches fresh on the next spawn.
    ptyKeyInterceptor.detach(paneId);
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
      // Default terminal-pane spawn = Claude PTY → categorize for the
      // ResourceMonitor's claude bucket. Model PTYs spawned via
      // MODELS_LAUNCH explicitly set category='model' instead.
      ptyRegistry.setPaneCategory(paneId, 'claude');
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
  // PR #25 — `claude --help` capability probe used by the picker to gate
  // the Claude (Chat) catalog entry.
  ipcMain.handle(IPC.CLI_CAPABILITIES, () => getCli().getCapabilities());
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
    // Allowlist: official license sources, model registries, and the
    // PROVIDER_KEY_URL targets in ApiKeyModal so "Get a key →" works.
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
      host === 'github.com' ||
      // Provider key portals — must match ApiKeyModal PROVIDER_KEY_URL.
      host === 'console.anthropic.com' ||
      host === 'platform.openai.com' ||
      host === 'aistudio.google.com' ||
      host === 'openrouter.ai' ||
      host.endsWith('.openrouter.ai');
    if (!allowed) {
      console.warn(`[openExternal] blocked URL outside allowlist: ${parsed.toString()}`);
      return false;
    }
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
      return launchModelDefinition(model, safeCwd);
    }
  );
}

/**
 * Shared launcher used by MODELS_LAUNCH and HF_IMPORT_AND_LAUNCH.
 * Synthesises a paneId, spawns the PTY with the model's command line,
 * attaches the API-key interceptor for providers we know how to
 * recognise, and returns the standard ModelLaunchResult.
 *
 * Lives outside setupModels so the HF wire-up (a separate setup
 * function) can call it without re-deriving the closure state.
 */
function launchModelDefinition(model: ModelDefinition, cwd?: string): ModelLaunchResult {
  const safeIdPart = model.id.replace(/[^A-Za-z0-9_\-:]/g, '_').slice(0, 40);
  const paneId = `model:${safeIdPart}-${Date.now().toString(36)}`.slice(0, 64);
  const providerId = normalizeProvider(model.provider);
  const envInjection: Record<string, string> = providerId
    ? ProviderAuthService.instance().envForProvider(providerId)
    : {};
  try {
    ptyRegistry.setPaneCategory(paneId, 'model');
    ptyRegistry.spawn(paneId, cwd, {
      command: model.command,
      args: model.args,
      env: envInjection,
      label: model.name,
    });
    if (providerId) {
      ptyKeyInterceptor.attach(paneId, providerId);
    }
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

  // Cat 7: daemon lifecycle. The renderer can query state, force-start (used
  // by ModelsPanel's "Restart daemon" affordance), and stop. Lifecycle
  // events stream via OLLAMA_DAEMON_STATE_CHANGED.
  ipcMain.handle(IPC.OLLAMA_DAEMON_STATE, () => svc.daemonState());
  ipcMain.handle(IPC.OLLAMA_DAEMON_START, () => svc.daemonStart());
  ipcMain.handle(IPC.OLLAMA_DAEMON_STOP, () => {
    svc.daemonStop();
    return svc.daemonState();
  });
  ipcMain.handle(IPC.OLLAMA_DAEMON_RESTART, () => svc.daemonRestart());
  ipcMain.handle(IPC.GPU_PREFS_GET, () => readGpuPrefs());
  ipcMain.handle(IPC.GPU_PREFS_SET, (_event, patch: unknown) => {
    return writeGpuPrefs((patch ?? {}) as Parameters<typeof writeGpuPrefs>[0]);
  });
  svc.on('daemon-state', (state) => {
    safeSend(IPC.OLLAMA_DAEMON_STATE_CHANGED, state);
  });
}

/**
 * Cat 7 — autostart the Ollama daemon when local models are registered.
 *
 * Conditions:
 *   - At least one registered model has `provider === 'Ollama'` (display
 *     name match — the registry preserves catalog provider strings).
 *   - `ollama` is installed (getVersion().installed === true).
 *
 * If both true and the daemon isn't already reachable, spawn it. If the
 * daemon is already running (externally — tray app on Windows, LaunchAgent
 * on macOS), `daemonStart` detects that and reports running without
 * spawning a duplicate.
 *
 * Failures are non-fatal — Studio runs without Ollama just fine for Claude
 * users.
 */
async function maybeAutostartOllama(): Promise<void> {
  try {
    const reg = ModelRegistry.instance();
    const hasLocalModel = reg
      .list()
      .some((m) => m.provider === 'Ollama' || m.command === 'ollama');
    if (!hasLocalModel) return;
    const svc = OllamaService.instance();
    const v = await svc.getVersion();
    if (!v.installed) return;
    // Fire-and-forget — startup shouldn't block on the daemon poll.
    void svc.daemonStart().catch(() => {
      // Non-fatal; user can retry from the UI.
    });
  } catch {
    // Never let Ollama autostart take down the app.
  }
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

  // Reliable clipboard write via Electron's main-process clipboard.
  // navigator.clipboard.writeText in the renderer can silently no-op when
  // the window isn't focused; the main-process path always works.
  ipcMain.handle(IPC.APP_CLIPBOARD_WRITE, (_event, text: unknown) => {
    if (typeof text !== 'string') return false;
    // Cap length to avoid OOM if a caller goes wild; 1 MB is plenty for
    // command lines, snippets, model commands, etc.
    if (text.length > 1_000_000) return false;
    try {
      clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  });

  // Danger-zone: wipe everything in <userData> EXCEPT Electron's own
  // Cache / Local Storage / etc. dirs (those rebuild themselves). We
  // only nuke the JSON-y state files we ourselves wrote — keeps the
  // Chromium profile intact so the next launch isn't a slow first-run.
  ipcMain.handle(IPC.APP_RESET_USER_DATA, async () => {
    const userData = app.getPath('userData');
    // Allowlist of files/dirs WE own (everything else is Chromium's).
    const ourArtifacts = [
      'session.json',
      'cost-history.json',
      'cost-settings.json',
      'github-auth.json',
      'cloud-sync-settings.json',
      'cli-onboarding.json',
      'cli-flags.json',
      'hotkeys.json',
      'tray-settings.json',
      'notif-settings.json',
      'snippets.json',
      'lmm-settings.json',
      'updater-settings.json',
      'model-registry.json',
      'models-onboarding.json',
      'recent-projects.json',
      'debug-dump.jsonl',
      'lmm-journal',
    ];
    const removed: string[] = [];
    const failed: Array<{ file: string; error: string }> = [];
    for (const name of ourArtifacts) {
      const full = path.join(userData, name);
      try {
        await nodeFsp.rm(full, { recursive: true, force: true });
        removed.push(name);
      } catch (e) {
        failed.push({ file: name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { ok: failed.length === 0, removed, failed };
  });

  // Spawn the NSIS uninstaller. The installer creates an "Uninstall
  // Claude Code Studio.exe" alongside the app — we just shell it out
  // (detached so Studio can quit while the uninstaller is still running).
  ipcMain.handle(IPC.APP_OPEN_UNINSTALLER, () => {
    // 3.0.0 — cross-platform uninstall flow. Windows uses the NSIS
    // uninstaller. macOS doesn't have one (drag-to-Trash idiom) so we
    // open Finder at /Applications + return instructions. Linux varies
    // by package format so we sniff exe path to give the right hint.
    // Return shape: { ok, error, notice } — `notice` is non-error info
    // the renderer should surface (e.g., "drag the app to Trash").
    if (process.platform === 'win32') {
      const exeDir = path.dirname(app.getPath('exe'));
      // Per electron-builder's NSIS layout, the uninstaller lives in $INSTDIR.
      // Name varies by productName: try both spellings before giving up.
      const candidates = [
        // v4.0.0+ (Catalyst UI productName)
        path.join(exeDir, 'Uninstall Catalyst UI.exe'),
        path.join(exeDir, 'Uninstall catalyst-ui.exe'),
        // v3.x and earlier (Claude Code Studio productName) — kept so
        // in-place upgrades from those builds still find the old exe.
        path.join(exeDir, 'Uninstall Claude Code Studio.exe'),
        path.join(exeDir, 'Uninstall claude-code-studio.exe'),
      ];
      const uninstaller = candidates.find((p) => nodeFs.existsSync(p));
      if (!uninstaller) {
        return {
          ok: false,
          error: `Uninstaller not found next to the app exe. Searched: ${candidates.join(' ; ')}`,
          notice: null,
        };
      }
      try {
        childSpawn(uninstaller, [], { detached: true, stdio: 'ignore' }).unref();
        // Give the uninstaller a moment to start, then quit Studio so the
        // uninstaller can remove files we have open.
        setTimeout(() => app.quit(), 500);
        return { ok: true, error: null, notice: null };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), notice: null };
      }
    }

    if (process.platform === 'darwin') {
      // macOS doesn't have a postinstall/uninstaller concept. The user
      // drags the .app to Trash. We open /Applications so they can do
      // that immediately, and return instructions. The renderer pairs
      // this with the existing Reset User Data flow so the userData JSON
      // gets wiped first (otherwise the Trash drag leaves it orphaned).
      void shell.openPath('/Applications').catch(() => undefined);
      return {
        ok: true,
        error: null,
        notice:
          'macOS doesn\'t have a built-in uninstaller. Finder is now open at /Applications — ' +
          'drag "Catalyst UI" to the Trash. If you also want to wipe settings + history, ' +
          'click "Reset user data" first.',
      };
    }

    if (process.platform === 'linux') {
      // Try to detect install format from the exe path / standard install
      // locations. AppImage = single file (just rm); .deb = apt; .rpm = dnf.
      const exePath = app.getPath('exe');
      let instructions: string;
      if (process.env.APPIMAGE) {
        // AppImage sets this env var to its own path at runtime.
        instructions = `This is an AppImage build. To uninstall: delete the AppImage file at:\n  ${process.env.APPIMAGE}`;
      } else if (exePath.startsWith('/usr/') || exePath.startsWith('/opt/')) {
        instructions =
          'Looks like a system install. To uninstall:\n' +
          '  Debian/Ubuntu:  sudo apt remove claude-code-studio\n' +
          '  Fedora/RHEL:    sudo dnf remove claude-code-studio\n' +
          '  Arch:           sudo pacman -R claude-code-studio';
      } else {
        instructions =
          `Located at: ${exePath}\n` +
          'Remove via your package manager (apt/dnf/pacman) or just delete the file if it\'s a portable build.';
      }
      return {
        ok: true,
        error: null,
        notice:
          `Linux doesn't have an in-app uninstaller. ${instructions}\n\n` +
          'Click "Reset user data" first if you also want to wipe settings + history.',
      };
    }

    return {
      ok: false,
      error: `Unsupported platform: ${process.platform}.`,
      notice: null,
    };
  });
}

function setupProjectExplorer() {
  ipcMain.handle(
    IPC.PROJECT_LIST_DIR,
    async (_event, root: unknown, target: unknown) => {
      const safeRoot = typeof root === 'string' ? root : '';
      const safeTarget = typeof target === 'string' ? target : '';
      return projectListDir(safeRoot, safeTarget);
    }
  );
  ipcMain.handle(IPC.PROJECT_RECENT_LIST, () => readRecentProjects());
  ipcMain.handle(IPC.PROJECT_RECENT_ADD, (_event, target: unknown) => {
    const safe = typeof target === 'string' ? target : '';
    return addRecentProject(safe);
  });
  ipcMain.handle(IPC.PROJECT_RECENT_REMOVE, (_event, target: unknown) => {
    const safe = typeof target === 'string' ? target : '';
    return removeRecentProject(safe);
  });
}

function setupCliFlags() {
  ipcMain.handle(IPC.CLI_FLAGS_GET, () => readCliFlags());
  ipcMain.handle(IPC.CLI_FLAGS_SET, (_event, flags: unknown) => {
    if (!flags || typeof flags !== 'object') return readCliFlags();
    return writeCliFlags(flags as Partial<CliFlags>);
  });
}

function setupRunningModels() {
  ipcMain.handle(IPC.MODELS_LIST_RUNNING, () => ptyRegistry.listModelPanes());
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
    (_event, paneId: unknown, label: unknown, profile: unknown): ModelPopoutResult => {
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
      // The profile string is a catalog id (or 'claude' for the bundled CLI).
      // We URL-encode it into the popout query so the popout renderer can
      // pick the correct chat-skin variant (TUI vs stream-json) without
      // round-tripping to main.  Length bound + character allowlist to
      // keep the URL clean.
      const safeProfile =
        typeof profile === 'string' && profile.length > 0 && profile.length <= 128 && /^[a-zA-Z0-9._\-:]+$/.test(profile)
          ? profile
          : null;
      const popoutId = `models-popout:${paneId}`;
      const savedPopoutState = getWindowState().loadState(popoutId, {
        x: -1,
        y: -1,
        width: 900,
        height: 600,
        maximized: false,
      });
      const popoutUseSavedPos = savedPopoutState.x >= 0 && savedPopoutState.y >= 0;
      try {
        const win = new BrowserWindow({
          ...(popoutUseSavedPos
            ? { x: savedPopoutState.x, y: savedPopoutState.y }
            : {}),
          width: savedPopoutState.width,
          height: savedPopoutState.height,
          minWidth: 400,
          minHeight: 300,
          resizable: true,
          title: `${safeLabel} — Catalyst UI`,
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
        if (savedPopoutState.maximized) win.maximize();
        getWindowState().bindWindow(popoutId, win);
        popoutWindows.set(paneId, win);
        win.on('closed', () => {
          popoutWindows.delete(paneId);
        });

        // Load the same HTML the main window uses, with query params the
        // renderer's popout-mode branch parses. URL-encode the label so
        // the renderer can display it in the title bar.  profile is
        // optional — older callers omit it; renderer falls back to the
        // generic chat-skin path if not present.
        const profileQ = safeProfile ? `&profile=${encodeURIComponent(safeProfile)}` : '';
        const query = `?popout=${encodeURIComponent(paneId)}&label=${encodeURIComponent(safeLabel)}${profileQ}`;
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

function setupThemes() {
  ipcMain.handle(IPC.THEMES_LIST, () => getThemes().list());
  ipcMain.handle(IPC.THEMES_SAVE, (_event, theme) => getThemes().save(theme));
  ipcMain.handle(IPC.THEMES_DELETE, (_event, name: string) =>
    getThemes().delete(name)
  );
}

function setupProviderAuth() {
  const svc = ProviderAuthService.instance();
  ipcMain.handle(IPC.PROVIDER_AUTH_HAS_KEY, (_event, provider: unknown) => {
    if (typeof provider !== 'string') return false;
    const id = normalizeProvider(provider) ?? (provider as never);
    try {
      // hasKey throws on unknown provider; treat as "no key" for safety.
      return svc.hasKey(id);
    } catch {
      return false;
    }
  });
  ipcMain.handle(
    IPC.PROVIDER_AUTH_SET_KEY,
    (_event, provider: unknown, key: unknown) => {
      if (typeof provider !== 'string') throw new Error('provider must be string');
      if (typeof key !== 'string') throw new Error('key must be string');
      const id = normalizeProvider(provider) ?? (provider as never);
      return svc.setKey(id, key);
    }
  );
  ipcMain.handle(IPC.PROVIDER_AUTH_LIST, () => svc.list());
  ipcMain.handle(IPC.PROVIDER_AUTH_DELETE, (_event, provider: unknown) => {
    if (typeof provider !== 'string') throw new Error('provider must be string');
    const id = normalizeProvider(provider) ?? (provider as never);
    return svc.delete(id);
  });
  ipcMain.handle(IPC.PROVIDER_DETECT_LIST, async (_event, force: unknown) => {
    return await providerDetect.list(force === true);
  });
  ipcMain.handle(
    IPC.PROVIDER_DETECT_GET,
    async (_event, cli: unknown, force: unknown) => {
      if (typeof cli !== 'string') throw new Error('cli must be string');
      return await providerDetect.get(cli, force === true);
    }
  );
  ipcMain.handle(
    IPC.PROVIDER_KEY_SUBMIT,
    (_event, paneId: unknown, provider: unknown, key: unknown) => {
      if (typeof paneId !== 'string') throw new Error('paneId must be string');
      if (typeof provider !== 'string') throw new Error('provider must be string');
      if (typeof key !== 'string') throw new Error('key must be string');
      if (!PtyRegistry.isValidPaneId(paneId)) {
        throw new Error('invalid paneId');
      }
      const id = normalizeProvider(provider) ?? (provider as never);
      // Persist the key for next time.
      svc.setKey(id, key);
      // Write the key to the PTY stdin so the running CLI receives it as
      // typed input. We append a newline so the CLI's read-line completes.
      // The renderer should not also write — that would double-submit.
      ptyRegistry.write(paneId, key + '\r');
      // Reset interceptor state so a follow-up wrong-key prompt fires.
      ptyKeyInterceptor.resetPromptState(paneId);
      return true;
    }
  );
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

function setupAccessibility() {
  ipcMain.handle(IPC.ACCESSIBILITY_GET, () => getAccessibility().get());
  ipcMain.handle(IPC.ACCESSIBILITY_SET, (_event, partial: unknown) => {
    if (partial === null || typeof partial !== 'object') {
      throw new Error('accessibility set: partial must be an object');
    }
    return getAccessibility().set(partial as Record<string, unknown>);
  });
}

function setupHuggingFace() {
  ipcMain.handle(IPC.HF_GET_SETTINGS, () => getHuggingFace().getSettings());
  ipcMain.handle(IPC.HF_SET_SETTINGS, (_event, partial: unknown) => {
    if (partial === null || typeof partial !== 'object') {
      throw new Error('hf set settings: partial must be an object');
    }
    return getHuggingFace().setSettings(partial as Record<string, unknown>);
  });
  ipcMain.handle(IPC.HF_SEARCH, (_event, opts: unknown) => {
    if (opts === null || typeof opts !== 'object') {
      throw new Error('hf search: opts must be an object');
    }
    return getHuggingFace().search(opts as Record<string, unknown>);
  });
  ipcMain.handle(IPC.HF_MODEL_INFO, (_event, repoId: unknown) => {
    if (typeof repoId !== 'string') {
      throw new Error('hf modelInfo: repoId must be a string');
    }
    return getHuggingFace().modelInfo(repoId);
  });
  ipcMain.handle(IPC.HF_LIST_CACHED, () => getHuggingFace().listCached());
  ipcMain.handle(IPC.HF_REMOVE_CACHED, (_event, repoId: unknown) => {
    if (typeof repoId !== 'string') {
      throw new Error('hf removeCached: repoId must be a string');
    }
    return getHuggingFace().removeCached(repoId);
  });
  ipcMain.handle(IPC.HF_GET_CACHE_PATH, () => getHuggingFace().getCachePath());

  ipcMain.handle(
    IPC.HF_IMPORT_AND_LAUNCH,
    async (
      _event,
      repoIdRaw: unknown,
      quantRaw: unknown,
      cwdRaw: unknown,
      researchRaw: unknown
    ): Promise<ModelLaunchResult> => {
      if (typeof repoIdRaw !== 'string') {
        return { ok: false, paneId: null, commandLine: null, error: 'repoId must be a string' };
      }
      if (!/^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+$/.test(repoIdRaw) || repoIdRaw.length > 256) {
        return { ok: false, paneId: null, commandLine: null, error: 'invalid repoId' };
      }
      const quant =
        typeof quantRaw === 'string' && /^[A-Za-z0-9_.]+$/.test(quantRaw) && quantRaw.length <= 32
          ? quantRaw
          : null;
      const cwd =
        typeof cwdRaw === 'string' && cwdRaw.length > 0 && cwdRaw.length <= 4096
          ? cwdRaw
          : undefined;
      const isResearch = researchRaw === true;
      // Research mode requires the user to have opted in via Settings -> Advanced.
      if (isResearch && !getHuggingFace().getSettings().researchModeEnabled) {
        return {
          ok: false,
          paneId: null,
          commandLine: null,
          error: 'Research mode is disabled.  Enable it in HF -> Research first.',
        };
      }

      // Idempotent synthesized id so the SAME repo+quant maps to the
      // same catalog entry on repeated imports.  Research entries use
      // a `hf-research.` prefix so they're visually distinct and the
      // user can filter them out of the regular Models list later.
      const safeRepo = repoIdRaw.replace('/', '.').replace(/[^A-Za-z0-9_.\-]/g, '_');
      const safeQuant = quant ?? 'default';
      const synthId = `${isResearch ? 'hf-research' : 'hf'}.${safeRepo}.${safeQuant.toLowerCase()}`;
      const ollamaName = `hf.co/${repoIdRaw}${quant ? `:${quant}` : ''}`;

      const reg = ModelRegistry.instance();
      let model = reg.get(synthId);
      if (!model) {
        const fresh: ModelDefinition = {
          id: synthId,
          name: `${repoIdRaw}${quant ? ` (${quant})` : ''}`,
          description: isResearch
            ? `Research catalog import — runs via Ollama (\`${ollamaName}\`).  Outputs are logged to the audit trail.`
            : `Imported from Hugging Face — runs via Ollama (\`${ollamaName}\`).`,
          category: 'local',
          provider: 'Ollama',
          command: 'ollama',
          args: ['run', ollamaName],
          ollamaName,
          huggingfaceName: repoIdRaw,
          architecture: 'dense',
          recommendedQuant: quant ?? undefined,
          roles: ['general-chat'],
          hardwareTiers: ['low', 'mid', 'high'],
          badge: isResearch ? 'Research' : 'HF Import',
          recommendedFor: isResearch
            ? 'Research-only.  Use in a sandboxed environment; outputs are logged for review.'
            : 'Imported from the Hugging Face panel.  Ollama pulls the weights on first launch.',
        };
        try {
          reg.add(fresh);
          model = fresh;
        } catch (e) {
          return {
            ok: false,
            paneId: null,
            commandLine: null,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      const result = launchModelDefinition(model, cwd);
      // Audit log only on successful research-mode launches so we don't
      // record failed spawns.
      if (isResearch && result.ok) {
        try {
          getHuggingFace().appendAuditEntry({
            ts: new Date().toISOString(),
            repoId: repoIdRaw,
            quant,
          });
        } catch {
          // ignore — best-effort logging
        }
      }
      return result;
    }
  );

  ipcMain.handle(IPC.HF_GET_RESEARCH_LOG, () => getHuggingFace().readAuditLog());
  ipcMain.handle(IPC.HF_CLEAR_RESEARCH_LOG, () => {
    getHuggingFace().clearAuditLog();
    return true;
  });
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
  // v4.0.0 (Catalyst UI rename) — preserve the existing user-data
  // directory so settings, snippets, sessions, GitHub PAT, etc. survive
  // the rename.  Electron derives userData from productName by default;
  // since productName changed from "Claude Code Studio" to "Catalyst UI",
  // the default would point at an empty new directory.  Anchor it to the
  // historical "Claude Code Studio" folder explicitly so v3.2.1 -> v4
  // upgrades feel like an upgrade, not a fresh install.  Fresh installs
  // also use this folder so v4.0.0 onward has a single canonical state
  // location.
  try {
    const appData = app.getPath('appData');
    app.setPath('userData', path.join(appData, 'Claude Code Studio'));
  } catch {
    // If setPath ever fails, the default productName-derived path is the
    // fallback (fresh dir, but no crash).
  }

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
  setupThemes();
  setupProviderAuth();
  setupUpdater();
  setupSession();
  setupCost();
  setupCli();
  setupModels();
  setupOllama();
  // Cat 7 — autostart the Ollama daemon if local models are registered.
  // Fire-and-forget; non-fatal on failure.
  void maybeAutostartOllama();
  setupHardware();
  setupProject();
  setupDisk();
  setupFirstRun();
  setupPopout();
  setupAppMeta();
  setupProjectExplorer();
  setupCliFlags();
  setupRunningModels();
  setupWindowControls();
  setupHotkeys();
  setupAccessibility();
  setupHuggingFace();
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
  // Flush any pending window-state write so a quick close-after-resize doesn't
  // lose the user's geometry. WindowStateService debounces writes by 500 ms.
  try {
    windowStateService?.flush();
  } catch {
    // ignore
  }
  // Cat 7 — clean shutdown of the Studio-owned Ollama daemon. Externally-
  // managed Ollama processes are untouched (daemonStop is a no-op if we
  // never spawned one).
  try {
    OllamaService.instance().daemonStop();
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
