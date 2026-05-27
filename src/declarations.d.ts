declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module 'node-pty' {
  export interface IPty {
    pid: number;
    onData(callback: (data: string) => void): void;
    onExit(callback: (e: { exitCode: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
  }

  export function spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): IPty;
}

declare module 'systeminformation' {
  export function currentLoad(): Promise<{ currentLoad: number }>;
  export function mem(): Promise<{ total: number; used: number }>;
  export function cpu(): Promise<{
    manufacturer?: string;
    brand?: string;
    physicalCores?: number;
    cores?: number;
    speed?: number;
  }>;
  export function graphics(): Promise<{
    controllers: Array<{
      vendor?: string;
      model?: string;
      vram?: number;
      utilizationGpu?: number;
    }>;
  }>;
  export function processes(): Promise<{
    list: Array<{
      pid: number;
      parentPid: number;
      cpu: number;
      mem_rss: number;
    }>;
  }>;
}

interface Window {
  electronAPI: {
    terminal: {
      spawn: (paneId: string, cwd?: string | null) => Promise<boolean>;
      kill: (paneId: string) => Promise<boolean>;
      onData: (paneId: string, cb: (data: string) => void) => () => void;
      onExit: (paneId: string, cb: (code: number) => void) => () => void;
      onReady: (paneId: string, cb: (pid: number) => void) => () => void;
      sendInput: (paneId: string, data: string) => void;
      resize: (paneId: string, cols: number, rows: number) => void;
      restart: (paneId: string) => void;
    };
    session: {
      get: () => Promise<import('./shared/types').SessionState>;
      set: (
        state: import('./shared/types').SessionState
      ) => Promise<import('./shared/types').SessionState>;
      reset: () => Promise<import('./shared/types').SessionState>;
    };
    resources: {
      onUpdate: (
        cb: (data: import('./shared/types').ResourceSnapshot) => void
      ) => () => void;
      start: () => void;
      stop: () => void;
    };
    compact: {
      getStatus: () => Promise<import('./shared/types').CompactStatus>;
      install: () => Promise<boolean>;
      uninstall: () => Promise<boolean>;
      getConfig: () => Promise<import('./shared/types').CompactConfig>;
      setConfig: (
        config: Partial<import('./shared/types').CompactConfig>
      ) => Promise<import('./shared/types').CompactConfig>;
    };
    git: {
      detect: (cwd?: string) => Promise<import('./shared/types').GitRepoState>;
      getCwd: () => Promise<string>;
      setCwd: (cwd: string) => Promise<string>;
      pickDir: () => Promise<string | null>;
    };
    github: {
      authState: () => Promise<import('./shared/types').GitHubAuthState>;
      setToken: (
        token: string,
        allowPlaintext?: boolean
      ) => Promise<import('./shared/types').GitHubAuthState>;
      clearToken: () => Promise<import('./shared/types').GitHubAuthState>;
      getRepoInfo: (
        owner: string,
        repo: string
      ) => Promise<import('./shared/types').GitHubRepoInfo>;
      listCommits: (
        owner: string,
        repo: string
      ) => Promise<import('./shared/types').GitHubCommit[]>;
      listBranches: (
        owner: string,
        repo: string
      ) => Promise<import('./shared/types').GitHubBranch[]>;
      listPullRequests: (
        owner: string,
        repo: string,
        state?: 'open' | 'closed' | 'all'
      ) => Promise<import('./shared/types').GitHubPullRequest[]>;
      listIssues: (
        owner: string,
        repo: string,
        state?: 'open' | 'closed' | 'all'
      ) => Promise<import('./shared/types').GitHubIssue[]>;
      openExternal: (url: string) => Promise<boolean>;
    };
    lmm: {
      getSettings: () => Promise<import('./shared/types').LMMSettings>;
      setSettings: (
        partial: Partial<import('./shared/types').LMMSettings>
      ) => Promise<import('./shared/types').LMMSettings>;
      listCycles: () => Promise<import('./shared/types').LMMCycleSummary[]>;
      getCycle: (id: string) => Promise<import('./shared/types').LMMCycle | null>;
      createCycle: (title: string) => Promise<import('./shared/types').LMMCycle>;
      savePhase: (
        id: string,
        phase: import('./shared/types').LMMPhase,
        content: string
      ) => Promise<import('./shared/types').LMMCycle>;
      deleteCycle: (id: string) => Promise<boolean>;
      pickJournalDir: () => Promise<import('./shared/types').LMMSettings | null>;
    };
    snippets: {
      list: () => Promise<import('./shared/types').Snippet[]>;
      create: (input: { name: string; body: string }) =>
        Promise<import('./shared/types').Snippet>;
      update: (
        id: string,
        patch: { name?: string; body?: string }
      ) => Promise<import('./shared/types').Snippet>;
      delete: (id: string) => Promise<boolean>;
    };
    notifications: {
      supported: () => Promise<boolean>;
      getSettings: () => Promise<import('./shared/types').NotificationSettings>;
      setSettings: (
        partial: Partial<import('./shared/types').NotificationSettings>
      ) => Promise<import('./shared/types').NotificationSettings>;
      test: () => Promise<boolean>;
    };
    updater: {
      getState: () => Promise<import('./shared/types').UpdaterState>;
      getSettings: () => Promise<import('./shared/types').UpdaterSettings>;
      setSettings: (
        partial: Partial<import('./shared/types').UpdaterSettings>
      ) => Promise<import('./shared/types').UpdaterSettings>;
      checkNow: () => Promise<import('./shared/types').UpdaterState>;
      onAvailable: (cb: (version: string) => void) => () => void;
      onDownloadProgress: (cb: (percent: number) => void) => () => void;
    };
    cost: {
      status: () => Promise<import('./shared/types').CostStatus>;
      getSettings: () => Promise<import('./shared/types').CostSettings>;
      setSettings: (
        partial: Partial<import('./shared/types').CostSettings>
      ) => Promise<import('./shared/types').CostSettings>;
      resetHistory: () => Promise<boolean>;
      listSessions: () => Promise<import('./shared/types').SessionTotal[]>;
    };
    sync: {
      getSettings: () => Promise<import('./shared/types').SyncSettings>;
      setSettings: (
        partial: Partial<import('./shared/types').SyncSettings>
      ) => Promise<import('./shared/types').SyncSettings>;
      status: () => Promise<import('./shared/types').SyncStatus>;
      syncNow: () => Promise<import('./shared/types').SyncStatus>;
      listLocal: () => Promise<import('./shared/types').LocalVault[]>;
      listRemote: () => Promise<import('./shared/types').RemoteVault[]>;
      previewVault: (name: string) => Promise<import('./shared/types').VaultPreview | null>;
      createRepo: (repoName: string) => Promise<{ owner: string; name: string }>;
      verifyRepo: (
        owner: string,
        repo: string
      ) => Promise<{ defaultBranch: string; isPrivate: boolean }>;
      deleteRemote: (name: string) => Promise<{ deleted: boolean }>;
    };
    auth: {
      state: () => Promise<import('./shared/types').AuthState>;
      getBackend: () => Promise<import('./shared/types').AuthBackend>;
      setBackend: (
        next: Partial<import('./shared/types').AuthBackend>
      ) => Promise<import('./shared/types').AuthBackend>;
      register: (
        creds: import('./shared/types').AuthCredentials
      ) => Promise<import('./shared/types').AuthState>;
      login: (
        creds: import('./shared/types').AuthCredentials
      ) => Promise<import('./shared/types').AuthState>;
      logout: () => Promise<import('./shared/types').AuthState>;
      pullSettings: () => Promise<import('./shared/types').SyncedSettings | null>;
      pushSettings: (
        settings: import('./shared/types').SyncedSettings
      ) => Promise<import('./shared/types').SyncedSettings>;
    };
    window: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
    hotkeys: {
      get: () => Promise<import('./shared/types').HotkeySettings>;
      setBinding: (
        action: import('./shared/types').HotkeyAction,
        chord: string | null
      ) => Promise<import('./shared/types').HotkeySettings>;
      reset: () => Promise<import('./shared/types').HotkeySettings>;
    };
    tray: {
      getSettings: () => Promise<import('./shared/types').TraySettings>;
      setSettings: (
        partial: Partial<import('./shared/types').TraySettings>
      ) => Promise<import('./shared/types').TraySettings>;
      onInvokeAction: (
        cb: (action: import('./shared/types').HotkeyAction) => void
      ) => () => void;
    };
    cli: {
      status: () => Promise<import('./shared/types').CliStatus>;
      install: () => Promise<{ ok: boolean; output: string; error: string | null }>;
      onInstallProgress: (cb: (line: string) => void) => () => void;
      getOnboarding: () => Promise<import('./shared/types').CliOnboardingState>;
      markComplete: () => Promise<import('./shared/types').CliOnboardingState>;
      resetOnboarding: () => Promise<import('./shared/types').CliOnboardingState>;
    };
    models: {
      list: () => Promise<import('./shared/types').ModelDefinition[]>;
      get: (id: string) => Promise<import('./shared/types').ModelDefinition | null>;
      add: (model: import('./shared/types').ModelDefinition) => Promise<import('./shared/types').ModelRegistryState>;
      update: (id: string, patch: Partial<import('./shared/types').ModelDefinition>) => Promise<import('./shared/types').ModelRegistryState>;
      remove: (id: string) => Promise<import('./shared/types').ModelRegistryState>;
      resetSeed: () => Promise<import('./shared/types').ModelRegistryState>;
      recommend: (cwd?: string) => Promise<import('./shared/types').ModelRecommendation[]>;
      launch: (modelId: string, cwd?: string) => Promise<import('./shared/types').ModelLaunchResult>;
      openExternal: (url: string) => Promise<boolean>;
      popout: (paneId: string, label?: string) => Promise<import('./shared/types').ModelPopoutResult>;
      onboardingGet: () => Promise<import('./shared/types').ModelsOnboardingState>;
      onboardingMarkShown: (
        outcome: 'skipped' | 'completed'
      ) => Promise<import('./shared/types').ModelsOnboardingState>;
      onboardingReset: () => Promise<import('./shared/types').ModelsOnboardingState>;
    };
    ollama: {
      version: (force?: boolean) => Promise<import('./shared/types').OllamaVersionInfo>;
      list: () => Promise<import('./shared/types').OllamaInstalledModel[]>;
      pullStart: (name: string) => Promise<{ ok: boolean; error: string | null }>;
      pullCancel: (name: string) => Promise<{ ok: boolean }>;
      delete: (name: string) => Promise<{ ok: boolean; error: string | null }>;
      onPullProgress: (
        cb: (evt: import('./shared/types').OllamaPullProgressEvent) => void
      ) => () => void;
    };
    hardware: {
      detect: (force?: boolean) => Promise<import('./shared/types').HardwareProfile>;
    };
    project: {
      detect: (cwd?: string) => Promise<import('./shared/types').ProjectFingerprint>;
    };
    disk: {
      info: (target?: string) => Promise<import('./shared/types').DiskInfo>;
    };
    app: {
      version: () => Promise<string>;
    };
  };
}
