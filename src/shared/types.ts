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

export interface ElectronAPI {
  terminal: {
    onData: (callback: (data: string) => void) => void;
    onExit: (callback: (code: number) => void) => void;
    sendInput: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    restart: () => void;
  };
}
