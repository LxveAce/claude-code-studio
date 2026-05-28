import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

function subscribe<T extends unknown[]>(
  channel: string,
  callback: (...args: T) => void
): () => void {
  const handler = (_event: unknown, ...args: T) => callback(...args);
  ipcRenderer.on(channel, handler as never);
  return () => ipcRenderer.removeListener(channel, handler as never);
}

/**
 * Wrap a paneId-keyed subscription so the renderer only sees events for the
 * pane it asked about. The dispose function is returned so the renderer can
 * unsubscribe — see docs/security-reviews/SECURITY_REVIEW.md H4 for why this matters.
 */
function paneSubscribe<TArgs extends unknown[]>(
  channel: string,
  wantedPaneId: string,
  callback: (...args: TArgs) => void
): () => void {
  const handler = (_event: unknown, paneId: string, ...rest: TArgs) => {
    if (paneId !== wantedPaneId) return;
    callback(...rest);
  };
  ipcRenderer.on(channel, handler as never);
  return () => ipcRenderer.removeListener(channel, handler as never);
}

contextBridge.exposeInMainWorld('electronAPI', {
  terminal: {
    spawn: (paneId: string, cwd?: string | null) =>
      ipcRenderer.invoke(IPC.TERMINAL_SPAWN, paneId, cwd ?? null),
    kill: (paneId: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL, paneId),
    onData: (paneId: string, callback: (data: string) => void) =>
      paneSubscribe<[string]>(IPC.TERMINAL_DATA, paneId, callback),
    onExit: (paneId: string, callback: (code: number) => void) =>
      paneSubscribe<[number]>(IPC.TERMINAL_EXIT, paneId, callback),
    onReady: (paneId: string, callback: (pid: number) => void) =>
      paneSubscribe<[number]>(IPC.TERMINAL_READY, paneId, callback),
    sendInput: (paneId: string, data: string) => {
      ipcRenderer.send(IPC.TERMINAL_INPUT, paneId, data);
    },
    resize: (paneId: string, cols: number, rows: number) => {
      ipcRenderer.send(IPC.TERMINAL_RESIZE, paneId, cols, rows);
    },
    restart: (paneId: string) => {
      ipcRenderer.send(IPC.TERMINAL_RESTART, paneId);
    },
  },
  session: {
    get: () => ipcRenderer.invoke(IPC.SESSION_GET),
    set: (state: unknown) => ipcRenderer.invoke(IPC.SESSION_SET, state),
    reset: () => ipcRenderer.invoke(IPC.SESSION_RESET),
  },
  resources: {
    onUpdate: (callback: (data: unknown) => void) =>
      subscribe<[unknown]>(IPC.RESOURCE_UPDATE, callback),
    start: () => ipcRenderer.send(IPC.RESOURCE_START),
    stop: () => ipcRenderer.send(IPC.RESOURCE_STOP),
  },
  compact: {
    getStatus: () => ipcRenderer.invoke(IPC.COMPACT_STATUS),
    install: () => ipcRenderer.invoke(IPC.COMPACT_INSTALL),
    uninstall: () => ipcRenderer.invoke(IPC.COMPACT_UNINSTALL),
    getConfig: () => ipcRenderer.invoke(IPC.COMPACT_CONFIG_GET),
    setConfig: (config: unknown) =>
      ipcRenderer.invoke(IPC.COMPACT_CONFIG_SET, config),
  },
  git: {
    detect: (cwd?: string) => ipcRenderer.invoke(IPC.GIT_DETECT, cwd),
    getCwd: () => ipcRenderer.invoke(IPC.GIT_GET_CWD),
    setCwd: (cwd: string) => ipcRenderer.invoke(IPC.GIT_SET_CWD, cwd),
    pickDir: () => ipcRenderer.invoke(IPC.GIT_PICK_DIR),
  },
  github: {
    authState: () => ipcRenderer.invoke(IPC.GITHUB_AUTH_STATE),
    setToken: (token: string, allowPlaintext = false) =>
      ipcRenderer.invoke(IPC.GITHUB_SET_TOKEN, token, allowPlaintext),
    clearToken: () => ipcRenderer.invoke(IPC.GITHUB_CLEAR_TOKEN),
    getRepoInfo: (owner: string, repo: string) =>
      ipcRenderer.invoke(IPC.GITHUB_REPO_INFO, owner, repo),
    listCommits: (owner: string, repo: string) =>
      ipcRenderer.invoke(IPC.GITHUB_COMMITS, owner, repo),
    listBranches: (owner: string, repo: string) =>
      ipcRenderer.invoke(IPC.GITHUB_BRANCHES, owner, repo),
    listPullRequests: (
      owner: string,
      repo: string,
      state: 'open' | 'closed' | 'all' = 'open'
    ) => ipcRenderer.invoke(IPC.GITHUB_PRS, owner, repo, state),
    listIssues: (
      owner: string,
      repo: string,
      state: 'open' | 'closed' | 'all' = 'open'
    ) => ipcRenderer.invoke(IPC.GITHUB_ISSUES, owner, repo, state),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.GITHUB_OPEN_EXTERNAL, url),
  },
  lmm: {
    getSettings: () => ipcRenderer.invoke(IPC.LMM_GET_SETTINGS),
    setSettings: (partial: unknown) => ipcRenderer.invoke(IPC.LMM_SET_SETTINGS, partial),
    listCycles: () => ipcRenderer.invoke(IPC.LMM_LIST_CYCLES),
    getCycle: (id: string) => ipcRenderer.invoke(IPC.LMM_GET_CYCLE, id),
    createCycle: (title: string) => ipcRenderer.invoke(IPC.LMM_CREATE_CYCLE, title),
    savePhase: (id: string, phase: 'raw' | 'nodes' | 'reflect' | 'synth', content: string) =>
      ipcRenderer.invoke(IPC.LMM_SAVE_PHASE, id, phase, content),
    deleteCycle: (id: string) => ipcRenderer.invoke(IPC.LMM_DELETE_CYCLE, id),
    pickJournalDir: () => ipcRenderer.invoke(IPC.LMM_PICK_JOURNAL_DIR),
  },
  auth: {
    state: () => ipcRenderer.invoke(IPC.AUTH_STATE),
    getBackend: () => ipcRenderer.invoke(IPC.AUTH_GET_BACKEND),
    setBackend: (next: unknown) => ipcRenderer.invoke(IPC.AUTH_SET_BACKEND, next),
    register: (creds: unknown) => ipcRenderer.invoke(IPC.AUTH_REGISTER, creds),
    login: (creds: unknown) => ipcRenderer.invoke(IPC.AUTH_LOGIN, creds),
    logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
    pullSettings: () => ipcRenderer.invoke(IPC.AUTH_PULL_SETTINGS),
    pushSettings: (settings: unknown) => ipcRenderer.invoke(IPC.AUTH_PUSH_SETTINGS, settings),
  },
  sync: {
    getSettings: () => ipcRenderer.invoke(IPC.SYNC_GET_SETTINGS),
    setSettings: (partial: unknown) => ipcRenderer.invoke(IPC.SYNC_SET_SETTINGS, partial),
    status: () => ipcRenderer.invoke(IPC.SYNC_STATUS),
    syncNow: () => ipcRenderer.invoke(IPC.SYNC_SYNC_NOW),
    listLocal: () => ipcRenderer.invoke(IPC.SYNC_LIST_LOCAL),
    listRemote: () => ipcRenderer.invoke(IPC.SYNC_LIST_REMOTE),
    previewVault: (name: string) => ipcRenderer.invoke(IPC.SYNC_PREVIEW_VAULT, name),
    createRepo: (repoName: string) => ipcRenderer.invoke(IPC.SYNC_CREATE_REPO, repoName),
    verifyRepo: (owner: string, repo: string) =>
      ipcRenderer.invoke(IPC.SYNC_VERIFY_REPO, owner, repo),
    deleteRemote: (name: string) => ipcRenderer.invoke(IPC.SYNC_DELETE_REMOTE, name),
  },
  snippets: {
    list: () => ipcRenderer.invoke(IPC.SNIPPET_LIST),
    create: (input: { name: string; body: string }) =>
      ipcRenderer.invoke(IPC.SNIPPET_CREATE, input),
    update: (id: string, patch: { name?: string; body?: string }) =>
      ipcRenderer.invoke(IPC.SNIPPET_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.SNIPPET_DELETE, id),
  },
  notifications: {
    supported: () => ipcRenderer.invoke(IPC.NOTIF_SUPPORTED),
    getSettings: () => ipcRenderer.invoke(IPC.NOTIF_GET_SETTINGS),
    setSettings: (partial: unknown) => ipcRenderer.invoke(IPC.NOTIF_SET_SETTINGS, partial),
    test: () => ipcRenderer.invoke(IPC.NOTIF_TEST),
  },
  themes: {
    list: () => ipcRenderer.invoke(IPC.THEMES_LIST),
    save: (theme: unknown) => ipcRenderer.invoke(IPC.THEMES_SAVE, theme),
    delete: (name: string) => ipcRenderer.invoke(IPC.THEMES_DELETE, name),
  },
  providerAuth: {
    hasKey: (provider: string) =>
      ipcRenderer.invoke(IPC.PROVIDER_AUTH_HAS_KEY, provider),
    setKey: (provider: string, key: string) =>
      ipcRenderer.invoke(IPC.PROVIDER_AUTH_SET_KEY, provider, key),
    list: () => ipcRenderer.invoke(IPC.PROVIDER_AUTH_LIST),
    delete: (provider: string) =>
      ipcRenderer.invoke(IPC.PROVIDER_AUTH_DELETE, provider),
    onKeyPrompt: (callback: (evt: unknown) => void) =>
      subscribe<[unknown]>(IPC.PROVIDER_KEY_PROMPT, callback),
    submitKey: (paneId: string, provider: string, key: string) =>
      ipcRenderer.invoke(IPC.PROVIDER_KEY_SUBMIT, paneId, provider, key),
    /** Detect installed status of known provider CLIs (gemini, aider, …). */
    detectList: (force?: boolean) =>
      ipcRenderer.invoke(IPC.PROVIDER_DETECT_LIST, Boolean(force)),
    detectGet: (cli: string, force?: boolean) =>
      ipcRenderer.invoke(IPC.PROVIDER_DETECT_GET, cli, Boolean(force)),
  },
  updater: {
    getState: () => ipcRenderer.invoke(IPC.UPDATER_GET_STATE),
    getSettings: () => ipcRenderer.invoke(IPC.UPDATER_GET_SETTINGS),
    setSettings: (partial: unknown) => ipcRenderer.invoke(IPC.UPDATER_SET_SETTINGS, partial),
    checkNow: () => ipcRenderer.invoke(IPC.UPDATER_CHECK_NOW),
    onAvailable: (callback: (version: string) => void) =>
      subscribe<[string]>(IPC.UPDATER_AVAILABLE, callback),
    onDownloadProgress: (callback: (percent: number) => void) =>
      subscribe<[number]>(IPC.UPDATER_DOWNLOAD_PROGRESS, callback),
  },
  cost: {
    status: () => ipcRenderer.invoke(IPC.COST_STATUS),
    getSettings: () => ipcRenderer.invoke(IPC.COST_GET_SETTINGS),
    setSettings: (partial: unknown) => ipcRenderer.invoke(IPC.COST_SET_SETTINGS, partial),
    resetHistory: () => ipcRenderer.invoke(IPC.COST_RESET_HISTORY),
    listSessions: () => ipcRenderer.invoke(IPC.COST_LIST_SESSIONS),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  hotkeys: {
    get: () => ipcRenderer.invoke(IPC.HOTKEYS_GET),
    setBinding: (action: string, chord: string | null) =>
      ipcRenderer.invoke(IPC.HOTKEYS_SET_BINDING, action, chord),
    reset: () => ipcRenderer.invoke(IPC.HOTKEYS_RESET),
  },
  accessibility: {
    get: () => ipcRenderer.invoke(IPC.ACCESSIBILITY_GET),
    set: (partial: unknown) => ipcRenderer.invoke(IPC.ACCESSIBILITY_SET, partial),
  },
  tray: {
    getSettings: () => ipcRenderer.invoke(IPC.TRAY_GET_SETTINGS),
    setSettings: (partial: unknown) =>
      ipcRenderer.invoke(IPC.TRAY_SET_SETTINGS, partial),
    onInvokeAction: (callback: (action: string) => void) =>
      subscribe<[string]>(IPC.TRAY_INVOKE_ACTION, callback),
  },
  cli: {
    /** Run `claude doctor` + return parsed CliStatus. */
    status: () => ipcRenderer.invoke(IPC.CLI_STATUS),
    /** Returns cached `claude --help` capability flags. Used by the
     *  picker to badge the Claude (Chat) entry. Probed once per app
     *  launch — fast on subsequent calls. */
    capabilities: () => ipcRenderer.invoke(IPC.CLI_CAPABILITIES),
    /** Re-run the Phase 4 npm install using the bundled runtime. */
    install: () => ipcRenderer.invoke(IPC.CLI_INSTALL),
    /** Subscribe to live npm install output (one event per line). */
    onInstallProgress: (callback: (line: string) => void) =>
      subscribe<[string]>(IPC.CLI_INSTALL_PROGRESS, callback),
    /** Read persisted onboarding flag (so we don't reshow the modal). */
    getOnboarding: () => ipcRenderer.invoke(IPC.CLI_ONBOARDING_GET),
    /** Mark first-launch onboarding done — modal won't reshow. */
    markComplete: () => ipcRenderer.invoke(IPC.CLI_ONBOARDING_COMPLETE),
    /** Reset onboarding (for re-prompting / debug). */
    resetOnboarding: () => ipcRenderer.invoke(IPC.CLI_ONBOARDING_RESET),
  },
  models: {
    list: () => ipcRenderer.invoke(IPC.MODELS_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.MODELS_GET, id),
    add: (model: unknown) => ipcRenderer.invoke(IPC.MODELS_ADD, model),
    update: (id: string, patch: unknown) =>
      ipcRenderer.invoke(IPC.MODELS_UPDATE, id, patch),
    remove: (id: string) => ipcRenderer.invoke(IPC.MODELS_REMOVE, id),
    resetSeed: () => ipcRenderer.invoke(IPC.MODELS_RESET_SEED),
    recommend: (cwd?: string) =>
      ipcRenderer.invoke(IPC.MODELS_RECOMMEND, cwd ?? null),
    launch: (modelId: string, cwd?: string) =>
      ipcRenderer.invoke(IPC.MODELS_LAUNCH, modelId, cwd ?? null),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.MODELS_OPEN_EXTERNAL, url),
    popout: (paneId: string, label?: string, profile?: string) =>
      ipcRenderer.invoke(IPC.MODELS_POPOUT, paneId, label ?? null, profile ?? null),
    onboardingGet: () => ipcRenderer.invoke(IPC.MODELS_ONBOARDING_GET),
    onboardingMarkShown: (outcome: 'skipped' | 'completed') =>
      ipcRenderer.invoke(IPC.MODELS_ONBOARDING_MARK_SHOWN, outcome),
    onboardingReset: () => ipcRenderer.invoke(IPC.MODELS_ONBOARDING_RESET),
    listRunning: () => ipcRenderer.invoke(IPC.MODELS_LIST_RUNNING),
  },
  ollama: {
    version: (force = false) => ipcRenderer.invoke(IPC.OLLAMA_VERSION, force),
    list: () => ipcRenderer.invoke(IPC.OLLAMA_LIST),
    pullStart: (name: string) => ipcRenderer.invoke(IPC.OLLAMA_PULL_START, name),
    pullCancel: (name: string) => ipcRenderer.invoke(IPC.OLLAMA_PULL_CANCEL, name),
    delete: (name: string) => ipcRenderer.invoke(IPC.OLLAMA_DELETE, name),
    onPullProgress: (callback: (evt: unknown) => void) =>
      subscribe<[unknown]>(IPC.OLLAMA_PULL_PROGRESS, callback),
    /** Cat 7: daemon lifecycle for autostart. */
    daemonState: () => ipcRenderer.invoke(IPC.OLLAMA_DAEMON_STATE),
    daemonStart: () => ipcRenderer.invoke(IPC.OLLAMA_DAEMON_START),
    daemonStop: () => ipcRenderer.invoke(IPC.OLLAMA_DAEMON_STOP),
    daemonRestart: () => ipcRenderer.invoke(IPC.OLLAMA_DAEMON_RESTART),
    onDaemonStateChanged: (callback: (state: unknown) => void) =>
      subscribe<[unknown]>(IPC.OLLAMA_DAEMON_STATE_CHANGED, callback),
  },
  gpuPrefs: {
    get: () => ipcRenderer.invoke(IPC.GPU_PREFS_GET),
    set: (patch: unknown) => ipcRenderer.invoke(IPC.GPU_PREFS_SET, patch),
  },
  hardware: {
    detect: (force = false) => ipcRenderer.invoke(IPC.HARDWARE_DETECT, force),
  },
  project: {
    detect: (cwd?: string) => ipcRenderer.invoke(IPC.PROJECT_DETECT, cwd ?? null),
  },
  disk: {
    info: (target?: string) => ipcRenderer.invoke(IPC.DISK_INFO, target ?? null),
  },
  app: {
    version: () => ipcRenderer.invoke(IPC.APP_VERSION),
    resetUserData: () => ipcRenderer.invoke(IPC.APP_RESET_USER_DATA),
    openUninstaller: () => ipcRenderer.invoke(IPC.APP_OPEN_UNINSTALLER),
    clipboardWrite: (text: string) => ipcRenderer.invoke(IPC.APP_CLIPBOARD_WRITE, text),
  },
  projectExplorer: {
    listDir: (root: string, target: string) =>
      ipcRenderer.invoke(IPC.PROJECT_LIST_DIR, root, target),
    recentList: () => ipcRenderer.invoke(IPC.PROJECT_RECENT_LIST),
    recentAdd: (target: string) => ipcRenderer.invoke(IPC.PROJECT_RECENT_ADD, target),
    recentRemove: (target: string) =>
      ipcRenderer.invoke(IPC.PROJECT_RECENT_REMOVE, target),
  },
  cliFlags: {
    get: () => ipcRenderer.invoke(IPC.CLI_FLAGS_GET),
    set: (flags: { dangerouslySkipPermissions?: boolean }) =>
      ipcRenderer.invoke(IPC.CLI_FLAGS_SET, flags),
  },
});
