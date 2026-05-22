export interface ResourceSnapshot {
  system: {
    cpuPercent: number;
    ramPercent: number;
    ramUsedGB: number;
    ramTotalGB: number;
    gpuPercent: number | null;
  };
  claude: {
    cpuPercent: number;
    ramPercent: number;
    ramMB: number;
    pidCount: number;
  };
  timestamp: number;
}

export interface CompactStatus {
  enabled: boolean;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  turnCount: number;
  vaultCount: number;
  lastVaultFile: string | null;
}

export interface CompactConfig {
  vault_max_entries: number;
  vault_transcript_tail_bytes: number;
  log_enabled: boolean;
}

export interface GitRepoState {
  found: boolean;
  root: string | null;
  branch: string | null;
  upstream: string | null;
  remoteUrl: string | null;
  owner: string | null;
  repo: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  staged: number;
  modified: number;
  untracked: number;
}

export interface GitHubRepoInfo {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  updatedAt: string;
}

export interface GitHubCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  date: string;
  htmlUrl: string;
}

export interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
  isDefault: boolean;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  authorLogin: string;
  authorAvatarUrl: string | null;
  baseRef: string;
  headRef: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  commentCount: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  authorLogin: string;
  authorAvatarUrl: string | null;
  labels: { name: string; color: string }[];
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  commentCount: number;
}

export interface GitHubAuthState {
  hasToken: boolean;
  login: string | null;
  scopes: string[];
  encryptionAvailable: boolean;
  encrypted: boolean;
}

export type LMMPhase = 'raw' | 'nodes' | 'reflect' | 'synth';
export type LMMVariant = 'quick' | 'deep';

export interface LMMSettings {
  enabled: boolean;
  journalDir: string;
  variant: LMMVariant;
}

export interface LMMCycleSummary {
  id: string;
  title: string;
  created: string;
  modified: string;
  currentPhase: LMMPhase;
  filledPhases: LMMPhase[];
}

export interface LMMCycle extends LMMCycleSummary {
  phases: {
    raw: string;
    nodes: string;
    reflect: string;
    synth: string;
  };
}

// The full ElectronAPI shape lives in src/declarations.d.ts as an ambient
// Window typing. Don't redeclare it here — keep this file for serializable
// IPC payload types only.
