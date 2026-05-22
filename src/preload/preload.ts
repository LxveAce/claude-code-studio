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

contextBridge.exposeInMainWorld('electronAPI', {
  terminal: {
    onData: (callback: (data: string) => void) =>
      subscribe<[string]>(IPC.TERMINAL_DATA, callback),
    onExit: (callback: (code: number) => void) =>
      subscribe<[number]>(IPC.TERMINAL_EXIT, callback),
    onReady: (callback: (pid: number) => void) =>
      subscribe<[number]>(IPC.TERMINAL_READY, callback),
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
  tray: {
    getSettings: () => ipcRenderer.invoke(IPC.TRAY_GET_SETTINGS),
    setSettings: (partial: unknown) =>
      ipcRenderer.invoke(IPC.TRAY_SET_SETTINGS, partial),
    onInvokeAction: (callback: (action: string) => void) =>
      subscribe<[string]>(IPC.TRAY_INVOKE_ACTION, callback),
  },
});
