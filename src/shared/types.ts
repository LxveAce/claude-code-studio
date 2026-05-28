/**
 * Status of the Claude Code CLI on this machine. Populated by
 * CliService.getStatus() which shells out to `claude doctor` and falls
 * back to checking ~/.claude.json existence if doctor is unavailable.
 *
 * - installed: `claude` is resolvable (bundled or on PATH).
 * - authenticated: `claude doctor` reports OK, OR `~/.claude.json` exists
 *   and contains an auth section. Best-effort — `claude doctor` is the
 *   source of truth when available.
 * - version: parsed from doctor output if present; null otherwise.
 * - source: where the CLI was found — 'bundled' (resources/runtime/),
 *   'path' (system PATH), or 'missing'.
 * - lastError: last shell-out error message for diagnostics; null on success.
 */
export interface CliStatus {
  installed: boolean;
  authenticated: boolean;
  version: string | null;
  source: 'bundled' | 'path' | 'missing';
  lastError: string | null;
}

/** Persisted onboarding completion flag. Stored at <userData>/cli-onboarding.json. */
export interface CliOnboardingState {
  complete: boolean;
  completedAt: number | null;
}

/**
 * Capability flags parsed from `claude --help`. Used to gate features that
 * depend on specific CLI flag support (e.g., `Claude (Chat)` requires
 * `--input-format=stream-json` / `--output-format=stream-json`). Cached in
 * main per app launch — `claude --help` is fast but not free, and the
 * binary doesn't change underneath a running session.
 */
export interface CliCapabilities {
  /** True if the binary's help output mentions stream-json support. */
  streamJson: boolean;
  /** True if `--print` flag is supported (non-interactive mode). */
  printMode: boolean;
  /** Parsed version string if discoverable (e.g., '1.2.3'); null otherwise. */
  version: string | null;
  /** True iff the probe actually ran successfully. False = couldn't even
   *  invoke claude --help (CLI missing / hang / spawn error); the other
   *  fields should be ignored in that case. */
  probed: boolean;
  /** ISO timestamp of the probe. */
  probedAt: string | null;
  /** First few lines of help output for debug surfacing — capped at ~2 KB. */
  helpExcerpt: string;
}

/**
 * v3.0 multi-model scaffold types.
 *
 * Two categories of model the app can run side-by-side:
 *   - 'api': inference happens on a remote server (Anthropic, OpenAI, …).
 *           Local cost is just network + render. Auth per-provider.
 *   - 'local': inference happens on the user's hardware. Binary is
 *           downloaded once + cached in <userData>/models/<id>/, then
 *           launched via a runtime (llama.cpp / ollama / custom).
 *
 * This file defines the data shapes only — runtime, download flow, and
 * pane wiring come in subsequent commits. See BACKLOG.md ★ multi-model
 * section for the full design notes.
 */
export type ModelCategory = 'api' | 'local';

/**
 * Hardware tier sweet-spot for Q4_K_M. Used by both the catalog
 * (which tiers does this model target?) and the hardware detector
 * (what tier is the host machine?). See src/main/hardware-detection.ts.
 */
export type HardwareTier = 'toaster' | 'low' | 'mid' | 'high' | 'workstation' | 'jetson-thor';

/**
 * Catalog-side use-case tags. Multi-select per model so a polyglot
 * coder can advertise both 'frontend' and 'backend'. Kept loose to
 * accommodate new categories without a schema bump.
 */
export type ModelRole =
  | 'general-chat'
  | 'frontend'
  | 'backend'
  | 'polyglot-code'
  | 'reasoning'
  | 'vision'
  | 'long-context'
  | 'edge'
  | 'embedding'
  | 'agentic'
  | 'data';

export interface ModelDefinition {
  /** Stable unique id, e.g. "anthropic.claude" or "local.llama-3.1-8b". */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Optional one-line description. */
  description?: string;
  category: ModelCategory;
  /** Provider name for grouping in UI ("Anthropic", "OpenAI", "Ollama", ...). */
  provider: string;
  /** Command to spawn when launching the model (PTY argv[0]).
   * For api: typically the provider's CLI ('claude', 'gpt', ...).
   * For local: typically a runtime wrapper ('ollama', 'llama-cli', ...). */
  command: string;
  /** Default args to pass after `command`. */
  args?: string[];

  // --- Catalog metadata (full-scope expansion, May 2026). ---
  // All fields below are optional so the registry stays backward-compatible
  // with seed scaffolds that shipped before the catalog rebuild.

  /** Exact `ollama pull <name>` string for local Ollama models. */
  ollamaName?: string;
  /** Hugging Face repo path (org/name) if relevant. */
  huggingfaceName?: string;
  /** Parameter count in billions. */
  paramsB?: number;
  /** 'dense' for standard transformers; 'moe' for mixture-of-experts. */
  architecture?: 'dense' | 'moe';
  /** Active parameter count for MoE models (billions). */
  activeParamsB?: number;
  /** Recommended GGUF quant (Q4_K_M, Q5_K_M, etc.). */
  recommendedQuant?: string;
  /** Approximate VRAM needed at recommended quant + small context (GB). */
  vramGB?: number;
  /** Approximate system RAM for CPU offload at recommended quant (GB). */
  ramGB?: number;
  /** Native context length in tokens (e.g. 128000). */
  contextTokens?: number;
  /** Human-readable license name (e.g. "Apache 2.0", "Llama Community"). */
  license?: string;
  /**
   * True when license has commercial-use restrictions worth showing the
   * user a "Read license" link before pulling (Llama, Gemma, BigCode).
   */
  licenseFlag?: boolean;
  /** URL to the license/terms page (shown when licenseFlag is set). */
  licenseUrl?: string;
  /** Release date in YYYY-MM form. */
  releaseDate?: string;
  /** Use-case tags this model is good at. Multi-select. */
  roles?: ModelRole[];
  /** Hardware tiers this model realistically targets at recommended quant. */
  hardwareTiers?: HardwareTier[];
  /** 1-3 short phrases on what it's actually good at. */
  strengths?: string[];
  /** 1-2 short phrases on notable weaknesses (honest, not promotional). */
  weaknesses?: string[];
  /** 1-2 sentences of concrete "use this if…" guidance. */
  recommendedFor?: string;
  /**
   * Featured in the "Recommended" section of the catalog. Reserved for
   * consensus-best picks in their tier per the research report.
   */
  featured?: boolean;
  /** Short marketing-style badge (e.g. "Best 7B coder", "New in 2026"). */
  badge?: string;
  /** For local models: where to fetch the binary/model weights. */
  download?: {
    url: string;
    /** Hex SHA256 hash for integrity verification. */
    sha256: string;
    /** Tarball type or 'zip' / 'raw' (single file). */
    archiveType: 'tar-gz' | 'tar-xz' | 'zip' | 'raw';
    /** Approximate download size in bytes (for UI display). */
    sizeBytes: number;
  };
  /** Optional URL of an icon (PNG/SVG) for the catalog UI. */
  iconUrl?: string;
}

// --- Ollama / hardware / project IPC payload shapes ---

export interface OllamaInstalledModel {
  name: string;
  id: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface OllamaVersionInfo {
  installed: boolean;
  cliPath: string | null;
  version: string | null;
  daemonReachable: boolean;
  reason: 'not-found' | 'daemon-unreachable' | 'ok' | 'unknown-error';
  lastError: string | null;
}

export interface OllamaPullProgressEvent {
  modelName: string;
  percent: number | null;
  status: string;
  bytesCompleted: number | null;
  bytesTotal: number | null;
}

/** Canonical GPU vendor used by the Ollama routing decisions. */
export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';

/** Backend Ollama would target for a given GPU. */
export type GpuBackend = 'cuda' | 'rocm' | 'metal' | 'vulkan' | 'cpu';

export interface GpuInfo {
  name: string;
  vendor: GpuVendor;
  vramGB: number | null;
  isDedicated: boolean;
  vendorId: number | null;
  backend: GpuBackend;
  index: number;
}

export interface HardwareProfile {
  cpu: { model: string; physicalCores: number; logicalCores: number };
  ramGB: number;
  gpus: GpuInfo[];
  maxVramGB: number;
  totalVramGB: number;
  /** Largest dedicated GPU; null if no dedicated GPU is present. */
  preferredGpu: GpuInfo | null;
  /** Backend that would route the preferred GPU. `cpu` if no dedicated GPU. */
  ollamaCompat: GpuBackend;
  tier: HardwareTier;
  summary: string;
  platform: 'win32' | 'darwin' | 'linux' | 'other';
  detectedAt: string;
}

/** GPU routing preference for the Ollama daemon. Mirrors `src/main/gpu-prefs.ts`. */
export type GpuMode = 'auto' | 'gpu' | 'cpu';
export interface GpuPrefs {
  mode: GpuMode;
  targetGpuIndex: number | null;
  enableVulkan: boolean;
  flashAttention: boolean;
}

export type ProjectRole =
  | 'frontend'
  | 'backend'
  | 'systems'
  | 'data'
  | 'mobile'
  | 'devops'
  | 'general';

export interface ProjectFingerprint {
  cwd: string;
  detectedLanguages: string[];
  roles: ProjectRole[];
  signals: string[];
}

export interface ModelRecommendation {
  modelId: string;
  /** 0..1 confidence — higher = stronger match for hardware+project. */
  score: number;
  /** Short human-readable reason ("Best 7B coder for your frontend project"). */
  reason: string;
}

export interface ModelLaunchResult {
  ok: boolean;
  paneId: string | null;
  /** For local models: the resolved command line that was spawned (for UI display). */
  commandLine: string | null;
  error: string | null;
}

export interface DiskInfo {
  path: string;
  freeBytes: number | null;
  totalBytes: number | null;
  ok: boolean;
  error: string | null;
}

export type ModelsOnboardingOutcome = 'skipped' | 'completed';

export interface ModelsOnboardingState {
  shown: boolean;
  outcome: ModelsOnboardingOutcome | null;
  completedAt: string | null;
}

export interface ModelPopoutResult {
  ok: boolean;
  windowId: number | null;
  error: string | null;
}

// --- File / project explorer (3.0.0-beta.3) ---

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  modified: string;
  hidden: boolean;
}

export interface DirListing {
  root: string;
  path: string;
  truncated: boolean;
  totalEntries: number;
  entries: DirEntry[];
  error: 'not-found' | 'not-a-directory' | 'access-denied' | 'outside-root' | null;
}

export interface RecentProject {
  path: string;
  addedAt: string;
  label: string;
}

// --- CLI flags (3.0.0-beta.3) ---

export interface CliFlags {
  /** When true, the Claude PTY launches with --dangerously-skip-permissions.
   *  Bypasses permission prompts. Convenient in trusted projects only. */
  dangerouslySkipPermissions: boolean;
}

// --- App reset (3.0.0-beta.3) ---

export interface AppResetResult {
  ok: boolean;
  /** Files that were removed (relative to userData). */
  removed: string[];
  /** Files that couldn't be removed (with error reasons). */
  failed: Array<{ file: string; error: string }>;
}

/** Live snapshot of a currently-running model PTY — used by ModelsPanel
 *  to rebuild its "Running" list after a tab switch / panel re-mount. */
export interface RunningModelPane {
  paneId: string;
  pid: number;
  commandLine: string;
}

export interface ModelRegistryState {
  /** All registered models. Order is the user's display order in the panel. */
  models: ModelDefinition[];
  /** ISO timestamp of last edit. */
  updatedAt: string;
}

export interface ResourceSnapshot {
  system: {
    cpuPercent: number;
    ramPercent: number;
    ramUsedGB: number;
    ramTotalGB: number;
    gpuPercent: number | null;
  };
  /** Claude CLI PTYs (the original terminal flow). */
  claude: {
    cpuPercent: number;
    ramPercent: number;
    ramMB: number;
    pidCount: number;
  };
  /**
   * Local-model PTYs launched via MODELS_LAUNCH (typically `ollama run X`).
   * Added in 3.0.0-beta.3 — backward-compatible: older renderers that
   * only read `system` + `claude` still work.
   */
  models?: {
    cpuPercent: number;
    ramMB: number;
    pidCount: number;
  };
  /**
   * The persistent Ollama daemon + its model-loader children, if Ollama
   * is installed and running. Found via process-name scan each poll.
   */
  ollama?: {
    present: boolean;
    cpuPercent: number;
    ramMB: number;
    pidCount: number;
    /** Number of `ollama runner` / `llama-server` children — i.e.,
     *  currently-loaded models. 0 means daemon is idle. */
    runnerCount: number;
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

export interface Snippet {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  modifiedAt: string;
}

export interface NotificationSettings {
  enabled: boolean;
  notifyOnPtyExit: boolean;
  notifyOnSyncError: boolean;
  notifyOnUpdateAvailable: boolean;
  notifyOnCostBudget: boolean;
}

export type UpdateChannel = 'stable' | 'beta';

export interface UpdaterSettings {
  /** When true, the updater is wired up at app start in production builds. */
  enabled: boolean;
  channel: UpdateChannel;
}

export interface UpdaterState {
  /** Current installed application version (semver, from package.json). */
  currentVersion: string;
  /** True in production builds only; false when MAIN_WINDOW_VITE_DEV_SERVER_URL is set. */
  productionMode: boolean;
  /** True if the auto-updater is wired and running on this platform. */
  active: boolean;
  /**
   * If active === false, why. Stable copy for the UI:
   *   - 'dev-mode'        — running from `electron-forge start`
   *   - 'unsupported-platform' — not Windows/macOS (Linux Squirrel not supported)
   *   - 'unsigned'        — required code signing not present
   *   - 'disabled'        — user disabled via settings
   *   - 'init-error'      — wiring threw at startup; see lastError
   */
  inactiveReason:
    | 'dev-mode'
    | 'unsupported-platform'
    | 'unsigned'
    | 'disabled'
    | 'init-error'
    | null;
  channel: UpdateChannel;
  /** ISO timestamp of last successful check (any outcome); null until first attempt. */
  lastCheckedAt: string | null;
  /** ISO timestamp of last update-found event; null if none ever. */
  lastUpdateFoundAt: string | null;
  /** Version string of the update that's pending install on next launch, if any. */
  pendingVersion: string | null;
  /** Free-text last error message if the updater errored on start or during check. */
  lastError: string | null;
}

export type CostModel = 'opus' | 'sonnet' | 'haiku';

export interface CostRate {
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
}

export type CostRateTable = Record<CostModel, CostRate>;

export interface CostDayTotal {
  /** YYYY-MM-DD in local time. */
  date: string;
  inputTokens: number;
  outputTokens: number;
  estCostUSD: number;
  sessionCount: number;
}

export interface CostSettings {
  /** USD per day. 0 = no budget. */
  dailyBudgetUSD: number;
  /** Which model the rate-table uses for cost estimates. */
  model: CostModel;
}

export interface CostStatus {
  /** Today's bucket (local-date). Never null — zeroed if no data. */
  today: CostDayTotal;
  /** 30 most-recent days (oldest first), zero-filled. */
  last30Days: CostDayTotal[];
  /** Rate table currently used. */
  rates: CostRateTable;
  /** Settings (budget + model). */
  settings: CostSettings;
  /** True if today's estimate has crossed the daily budget. */
  budgetExceeded: boolean;
  /** ISO timestamp of last successful sample. */
  lastSampledAt: string | null;
  /** Heuristic disclaimer — never null, always a short string. */
  disclaimer: string;
}

/**
 * Per-conversation (session_id) token totals — Phase 7f.
 * Aggregates the same data CostService already collects (state.json +
 * vault files), grouped by session instead of by day.
 */
export interface SessionTotal {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD cost at the currently-selected model rate. */
  estCostUSD: number;
  /** Local-date key (YYYY-MM-DD) of the most recent sample for this session. */
  lastActivityDate: string;
  /** True if this session_id was seen in the live state.json (i.e. is the
   *  current conversation), false if only from a vault snapshot. */
  isCurrent: boolean;
}

export interface SyncSettings {
  enabled: boolean;
  owner: string | null;
  repo: string | null;
  deviceName: string;
  branch: string;
  consentAt: string | null;
  debounceMs: number;
}

export interface SyncStatus {
  configured: boolean;
  enabled: boolean;
  ghConnected: boolean;
  ghScopeOk: boolean;
  ghScopes: string[];
  localVaultCount: number;
  pushedCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingCount: number;
}

export interface LocalVault {
  name: string;
  size: number;
  modified: string;
  pushed: boolean;
}

export interface RemoteVault {
  name: string;
  size: number;
  sha: string;
  path: string;
  htmlUrl: string;
}

export interface VaultPreview {
  name: string;
  size: number;
  sessionId: string | null;
  contextTokens: number | null;
  turnCount: number | null;
  cwd: string | null;
  transcriptTailExcerpt: string;
  transcriptTailBytes: number;
}

export type AuthBackendMode = 'local-stub' | 'http';

export interface AuthBackend {
  mode: AuthBackendMode;
  baseUrl: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthSession {
  user: AuthUser;
  issuedAt: string;
  expiresAt: string | null;
}

export interface AuthState {
  signedIn: boolean;
  session: AuthSession | null;
  backend: AuthBackend;
  encryptionAvailable: boolean;
}

export interface SyncedSettings {
  theme: string | null;
  lmm: {
    enabled: boolean;
    variant: LMMVariant;
  } | null;
  // GitHub PAT is INTENTIONALLY excluded — encryption key is device-local
  // and the token loses its security properties if synced.
  updatedAt: string | null;
}

export interface AuthCredentials {
  email: string;
  password: string;
  allowPlaintextToken?: boolean;
}

// Session / terminal tabs ----------------------------------------------------

/**
 * A persisted terminal tab. Only Claude tabs survive a restart — model
 * tabs (Ollama, BitNet, Gemini, etc.) are ephemeral because their PTYs
 * are killed on app shutdown and re-launching them silently on hydrate
 * would risk surprising the user with downloads / GPU spin-up.
 *
 * Runtime tabs carry an extra `ready` flag (see TerminalTabs.tsx); the
 * persisted shape stays minimal so old session files migrate cleanly.
 */
export interface PersistedTab {
  /** Stable renderer tab id. Same regex constraints as paneId. */
  id: string;
  /** Display label shown in the tab strip. */
  label: string;
  /** PTY paneId backing this tab. For Claude tabs: `p_<id>`. */
  paneId: string;
  /** Profile id: 'claude' for the bundled Claude CLI; model id otherwise. */
  profile: string;
}

export type SessionPanelId =
  | 'terminal'
  | 'commands'
  | 'resources'
  | 'github'
  | 'cost'
  | 'compact'
  | 'lmm'
  | 'sync'
  | 'auth'
  | 'settings'
  | 'models'
  | 'files'
  | 'hf';

export interface SessionState {
  version: number;
  activePanel: SessionPanelId;
  /** Theme preset name; null = renderer default. */
  theme: string | null;
  /** Open terminal tabs. Persisted Claude tabs only — see PersistedTab. */
  tabs: PersistedTab[];
  /** Id of the currently focused tab, or null if there are no tabs. */
  activeTabId: string | null;
}

// Hotkeys + tray (Phase 7d) ---------------------------------------------------

export type HotkeyAction =
  | 'palette.open'
  | 'terminal.restart'
  | 'compact.toggle'
  | 'panel.lmm'
  | 'panel.github'
  | 'models.focus-search'
  | 'terminal.new-profile';

export interface HotkeyBinding {
  action: HotkeyAction;
  /** Null = unbound. */
  chord: string | null;
}

export interface HotkeySettings {
  bindings: HotkeyBinding[];
}

export interface TraySettings {
  minimizeToTrayOnClose: boolean;
}

// Hugging Face integration (v4.0.0 Catalyst UI).  Settings persisted
// under <userData>/huggingface-settings.json.  The research-mode flag
// gates the experimental / uncensored sub-tab; everything else is just
// Browse / Cached and is always available.

export interface HFSettings {
  /** When true, the renderer exposes the Research catalogs sub-tab
   *  with uncensored / experimental community collections.  Off by
   *  default — explicit opt-in via Settings -> Advanced. */
  researchModeEnabled: boolean;
  /** ISO timestamp of the first time the user accepted the disclaimer.
   *  Persists so the disclaimer doesn't re-prompt every launch. */
  researchModeAcknowledgedAt: string | null;
  /** Optional override cache directory.  Null means: try ~/.cache/huggingface/hub,
   *  fall back to <userData>/hf-cache. */
  cachePath: string | null;
}

export interface HFSearchOptions {
  query?: string;
  task?: string;
  library?: string;
  limit?: number;
  ggufOnly?: boolean;
}

export interface HFSearchHit {
  id: string;
  author: string;
  downloads: number;
  likes: number;
  tags: string[];
  pipelineTag: string | null;
  gated: boolean;
  updatedAt: string | null;
}

export interface HFGgufVariant {
  fileName: string;
  /** Q4_K_M / Q8_0 / F16 / etc. Null if the filename doesn't include a
   *  recognizable quantization tag. */
  quant: string | null;
  sizeBytes: number | null;
}

export interface HFModelCard {
  id: string;
  description: string | null;
  downloads: number;
  likes: number;
  tags: string[];
  pipelineTag: string | null;
  license: string | null;
  gated: boolean;
  files: { path: string; size: number | null }[];
  gguf: HFGgufVariant[];
  updatedAt: string | null;
}

export interface HFCachedEntry {
  /** "<org>/<name>" repo id reconstructed from the cache directory name. */
  id: string;
  /** Raw cache directory name (`models--<org>--<name>`). */
  dirName: string;
  sizeBytes: number;
}

export interface HFAuditEntry {
  /** ISO timestamp of the launch. */
  ts: string;
  /** Repo id launched from the research catalog. */
  repoId: string;
  /** Quantization tag selected, if any. */
  quant: string | null;
  /** Optional free-form note (currently unused; reserved for future
   *  per-prompt logging if/when we add that pass). */
  note?: string;
}

// Accessibility — Item 10 of the v3.2.1 polish pass.  Persisted per
// user under <userData>/accessibility.json.  Renderer applies these to
// document.documentElement on hydration + on every change so the
// effect is live without a window reload.
export type FontScale = '90' | '100' | '115' | '130';
export type ColorBlindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface AccessibilitySettings {
  /** WCAG-AAA high-contrast color palette. Overrides the chosen theme. */
  highContrast: boolean;
  /** Multiplier applied to --app-font-size CSS variable. */
  fontScale: FontScale;
  /** Forces prefers-reduced-motion behavior (disables animations/transitions). */
  reduceMotion: boolean;
  /** Thicker, higher-contrast focus outlines on all focusable elements. */
  largeFocusRing: boolean;
  /** Bumps min-height on interactive elements to 44px (WCAG-AAA touch target). */
  largeClickTargets: boolean;
  /** Switches base font stack to a dyslexia-friendly stack
   *  (OpenDyslexic if installed, falls back to Comic Sans / Verdana). */
  dyslexiaFont: boolean;
  /** Adds aria-live regions + extra aria-labels for assistive tech. */
  screenReaderMode: boolean;
  /** Renders a fixed overlay listing the active hotkeys. */
  keyboardHints: boolean;
  /** SVG color matrix LUT for color-blind palettes. */
  colorBlindMode: ColorBlindMode;
  /** Placeholder for v4.0.0 audio captions — toggle persists, no effect yet. */
  audioCaptions: boolean;
}

// Themes — user-defined accent presets persisted to <userData>/themes.json.
// Built-in presets live in src/renderer/theme-presets.ts and are not
// duplicated here; the shape mirrors `ThemePreset` from that file minus the
// `custom` discriminator (always true for stored themes).
export interface CustomTheme {
  name: string;
  accent: string;
  accentLight: string;
  gradient: string;
  gradientSoft: string;
  borderActive: string;
  glow: string;
}

// Window state persistence — per-window-id geometry saved to
// <userData>/window-state.json. Used by main + popout BrowserWindows so the
// user's resize/position survives an app restart.
export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export type WindowStateMap = Record<string, WindowState>;

// Provider auth — universal API key store for non-Anthropic CLI providers
// (Gemini, OpenAI access via Aider, OpenRouter, …). Persisted to
// <userData>/provider-auth.json via Electron safeStorage; raw keys never
// leave the main process. Renderer only sees presence/timestamps.
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter';

/** Where auth for a given provider came from. */
export type AuthSource =
  /** Stored encrypted via our safeStorage. */
  | 'stored'
  /** Env var already set in process.env (inherited from shell). */
  | 'env'
  /** Anthropic only — Claude CLI's OAuth flow has produced a token in
   *  ~/.claude.json (set by `claude /login`). No key is exportable. */
  | 'cli-oauth'
  /** Nothing detected; user needs to provide a key. */
  | 'none';

export interface ProviderAuthEntry {
  provider: ProviderId;
  hasKey: boolean;
  /** ISO 8601 timestamp when the key was last set. Null if never set. */
  lastUpdated: string | null;
  /** Auto-detected auth source; lets the UI skip prompting when the
   *  CLI is already authed via OAuth or an env var. */
  source: AuthSource;
}

/** Renderer-visible info about a "we need an API key now" prompt from a
 *  spawned CLI. Either from the pre-launch check or the PTY interceptor. */
export interface ProviderKeyPromptEvent {
  /** PTY pane id if this is from the interceptor; null for pre-launch. */
  paneId: string | null;
  provider: ProviderId;
  /** Source of the prompt for analytics / debug. */
  source: 'pre-launch' | 'pty-interceptor';
}

/** Detection result for a provider CLI. Used by the catalog to gate
 *  Launch buttons + surface install instructions when missing. */
export interface ProviderCliDetectResult {
  cli: string;
  installed: boolean;
  version: string | null;
  installHint: string;
  installUrl: string;
}

/** Live state of the Ollama daemon (Cat 7). `ownedByStudio` distinguishes
 *  the daemon Studio spawned from an externally-managed Ollama (e.g.,
 *  the Windows tray app), so we know whether `daemonStop` will affect it. */
export interface OllamaDaemonState {
  state: 'stopped' | 'starting' | 'running' | 'failed';
  ownedByStudio: boolean;
  lastError: string | null;
}

// The full ElectronAPI shape lives in src/declarations.d.ts as an ambient
// Window typing. Don't redeclare it here — keep this file for serializable
// IPC payload types only.
