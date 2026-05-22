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
  export function graphics(): Promise<{
    controllers: Array<{ utilizationGpu?: number }>;
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
      onData: (cb: (data: string) => void) => () => void;
      onExit: (cb: (code: number) => void) => () => void;
      onReady: (cb: (pid: number) => void) => () => void;
      sendInput: (data: string) => void;
      resize: (cols: number, rows: number) => void;
      restart: () => void;
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
  };
}
