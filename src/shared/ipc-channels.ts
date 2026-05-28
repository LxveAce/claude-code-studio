export const IPC = {
  // Terminal IPC is paneId-scoped (Phase 7c). For *-DATA / READY / EXIT the
  // payload's *first* argument is always the paneId so the renderer can route
  // to the correct xterm instance. All send-paneside IPC includes the paneId
  // as the first arg.
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_READY: 'terminal:ready',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_RESTART: 'terminal:restart',
  TERMINAL_SPAWN: 'terminal:spawn',
  TERMINAL_KILL: 'terminal:kill',

  SESSION_GET: 'session:get',
  SESSION_SET: 'session:set',
  SESSION_RESET: 'session:reset',

  RESOURCE_UPDATE: 'resources:update',
  RESOURCE_START: 'resources:start',
  RESOURCE_STOP: 'resources:stop',

  COMPACT_INSTALL: 'compact:install',
  COMPACT_UNINSTALL: 'compact:uninstall',
  COMPACT_STATUS: 'compact:status',
  COMPACT_CONFIG_GET: 'compact:config-get',
  COMPACT_CONFIG_SET: 'compact:config-set',

  GIT_DETECT: 'git:detect',
  GIT_SET_CWD: 'git:set-cwd',
  GIT_GET_CWD: 'git:get-cwd',
  GIT_PICK_DIR: 'git:pick-dir',

  GITHUB_AUTH_STATE: 'github:auth-state',
  GITHUB_SET_TOKEN: 'github:set-token',
  GITHUB_CLEAR_TOKEN: 'github:clear-token',
  GITHUB_REPO_INFO: 'github:repo-info',
  GITHUB_COMMITS: 'github:commits',
  GITHUB_BRANCHES: 'github:branches',
  GITHUB_PRS: 'github:prs',
  GITHUB_ISSUES: 'github:issues',
  GITHUB_OPEN_EXTERNAL: 'github:open-external',

  AUTH_LOGIN: 'auth:login',
  AUTH_REGISTER: 'auth:register',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATE: 'auth:state',
  AUTH_GET_BACKEND: 'auth:get-backend',
  AUTH_SET_BACKEND: 'auth:set-backend',
  AUTH_PULL_SETTINGS: 'auth:pull-settings',
  AUTH_PUSH_SETTINGS: 'auth:push-settings',

  SYNC_GET_SETTINGS: 'sync:get-settings',
  SYNC_SET_SETTINGS: 'sync:set-settings',
  SYNC_STATUS: 'sync:status',
  SYNC_SYNC_NOW: 'sync:sync-now',
  SYNC_LIST_LOCAL: 'sync:list-local',
  SYNC_LIST_REMOTE: 'sync:list-remote',
  SYNC_PREVIEW_VAULT: 'sync:preview-vault',
  SYNC_CREATE_REPO: 'sync:create-repo',
  SYNC_VERIFY_REPO: 'sync:verify-repo',
  SYNC_DELETE_REMOTE: 'sync:delete-remote',

  SNIPPET_LIST: 'snippet:list',
  SNIPPET_CREATE: 'snippet:create',
  SNIPPET_UPDATE: 'snippet:update',
  SNIPPET_DELETE: 'snippet:delete',

  NOTIF_GET_SETTINGS: 'notif:get-settings',
  NOTIF_SET_SETTINGS: 'notif:set-settings',
  NOTIF_SUPPORTED: 'notif:supported',
  NOTIF_TEST: 'notif:test',

  UPDATER_GET_STATE: 'updater:get-state',
  UPDATER_GET_SETTINGS: 'updater:get-settings',
  UPDATER_SET_SETTINGS: 'updater:set-settings',
  UPDATER_CHECK_NOW: 'updater:check-now',
  UPDATER_AVAILABLE: 'updater:available',
  /** Main → renderer: download-progress event with { percent: number }. */
  UPDATER_DOWNLOAD_PROGRESS: 'updater:download-progress',

  COST_STATUS: 'cost:status',
  COST_GET_SETTINGS: 'cost:get-settings',
  COST_SET_SETTINGS: 'cost:set-settings',
  COST_RESET_HISTORY: 'cost:reset-history',
  COST_LIST_SESSIONS: 'cost:list-sessions',

  LMM_GET_SETTINGS: 'lmm:get-settings',
  LMM_SET_SETTINGS: 'lmm:set-settings',
  LMM_LIST_CYCLES: 'lmm:list-cycles',
  LMM_GET_CYCLE: 'lmm:get-cycle',
  LMM_CREATE_CYCLE: 'lmm:create-cycle',
  LMM_SAVE_PHASE: 'lmm:save-phase',
  LMM_DELETE_CYCLE: 'lmm:delete-cycle',
  LMM_PICK_JOURNAL_DIR: 'lmm:pick-journal-dir',

  HOTKEYS_GET: 'hotkeys:get',
  HOTKEYS_SET_BINDING: 'hotkeys:set-binding',
  HOTKEYS_RESET: 'hotkeys:reset',

  TRAY_GET_SETTINGS: 'tray:get-settings',
  TRAY_SET_SETTINGS: 'tray:set-settings',

  /** Main → renderer: tray asked us to fire a renderer-side action. */
  TRAY_INVOKE_ACTION: 'tray:invoke-action',

  // CLI auth onboarding (Phase 6) — recovery path for Phase 4 soft-fail.
  CLI_STATUS: 'cli:status',
  CLI_INSTALL: 'cli:install',
  CLI_ONBOARDING_GET: 'cli:onboarding-get',
  CLI_ONBOARDING_COMPLETE: 'cli:onboarding-complete',
  CLI_ONBOARDING_RESET: 'cli:onboarding-reset',
  /** Main → renderer: each line of npm install output during cli:install. */
  CLI_INSTALL_PROGRESS: 'cli:install-progress',
  /** Parse `claude --help` once per app launch + cache; returns
   *  CliCapabilities. Renderer uses this to gate the Claude (Chat)
   *  catalog entry when stream-json support is missing. */
  CLI_CAPABILITIES: 'cli:capabilities',

  // v3.0 multi-model — catalog + Ollama lifecycle + hardware/project detection.
  MODELS_LIST: 'models:list',
  MODELS_GET: 'models:get',
  MODELS_ADD: 'models:add',
  MODELS_UPDATE: 'models:update',
  MODELS_REMOVE: 'models:remove',
  MODELS_RESET_SEED: 'models:reset-seed',
  MODELS_RECOMMEND: 'models:recommend',
  MODELS_LAUNCH: 'models:launch',
  /** Open an allowlisted external URL related to models (license pages,
   *  Ollama.com, HuggingFace, etc.). Separate from github:open-external
   *  because the allowlist differs. */
  MODELS_OPEN_EXTERNAL: 'models:open-external',
  /** Live list of running model PTYs — rebuilds ModelsPanel's "Running"
   *  list after a panel re-mount. Returns RunningModelPane[]. */
  MODELS_LIST_RUNNING: 'models:list-running',

  // Ollama lifecycle wrapper. Pull progress streams via OLLAMA_PULL_PROGRESS.
  OLLAMA_VERSION: 'ollama:version',
  OLLAMA_LIST: 'ollama:list',
  OLLAMA_PULL_START: 'ollama:pull-start',
  OLLAMA_PULL_CANCEL: 'ollama:pull-cancel',
  OLLAMA_DELETE: 'ollama:delete',
  /** Main → renderer: each parsed line of `ollama pull` progress. */
  OLLAMA_PULL_PROGRESS: 'ollama:pull-progress',
  /** Daemon lifecycle (Cat 7: autostart-on-app-launch). */
  OLLAMA_DAEMON_STATE: 'ollama:daemon-state',
  OLLAMA_DAEMON_START: 'ollama:daemon-start',
  OLLAMA_DAEMON_STOP: 'ollama:daemon-stop',
  /** Restart the Studio-owned Ollama daemon — used after the user changes
   *  their GPU routing preference (vars only re-read on serve startup). */
  OLLAMA_DAEMON_RESTART: 'ollama:daemon-restart',
  /** Main → renderer: daemon-state changed event. */
  OLLAMA_DAEMON_STATE_CHANGED: 'ollama:daemon-state-changed',

  /** GPU routing preferences (per-app, applied to the Ollama daemon on
   *  next serve startup). */
  GPU_PREFS_GET: 'gpu-prefs:get',
  GPU_PREFS_SET: 'gpu-prefs:set',

  // App metadata + lifecycle.
  APP_VERSION: 'app:version',
  /** Wipe all user data JSON (settings, registries, history, auth) and
   *  relaunch the app fresh. Does NOT uninstall the binary — see APP_OPEN_UNINSTALLER. */
  APP_RESET_USER_DATA: 'app:reset-user-data',
  /** Spawn the platform uninstaller (NSIS on Windows). */
  APP_OPEN_UNINSTALLER: 'app:open-uninstaller',
  /** Write text to the system clipboard via Electron's main-process
   *  clipboard module — more reliable than navigator.clipboard in
   *  unfocused/Electron contexts. */
  APP_CLIPBOARD_WRITE: 'app:clipboard-write',

  // Accessibility (Item 10 of v3.2.1 polish).  Persisted JSON in
  // <userData>/accessibility.json, applied to document.documentElement
  // in the renderer on every change.
  ACCESSIBILITY_GET: 'accessibility:get',
  ACCESSIBILITY_SET: 'accessibility:set',

  // Hugging Face integration (Catalyst UI v4.0.0).  Main wraps
  // @huggingface/hub; raw API tokens (none yet) never cross to the
  // renderer.  Research-mode gating lives in HF settings.
  HF_GET_SETTINGS: 'hf:get-settings',
  HF_SET_SETTINGS: 'hf:set-settings',
  HF_SEARCH: 'hf:search',
  HF_MODEL_INFO: 'hf:model-info',
  HF_LIST_CACHED: 'hf:list-cached',
  HF_REMOVE_CACHED: 'hf:remove-cached',
  HF_GET_CACHE_PATH: 'hf:get-cache-path',
  /** Synthesize an Ollama model definition for an HF repo+quant, register
   *  it in the catalog (idempotent on the synthesized id), and launch it
   *  through the same MODELS_LAUNCH pipeline so a PTY paneId comes back. */
  HF_IMPORT_AND_LAUNCH: 'hf:import-and-launch',
  /** Append a Research-catalog launch event to the audit log so the user
   *  can review which research models they ran and when. */
  HF_RESEARCH_LOG_LAUNCH: 'hf:research-log-launch',
  HF_GET_RESEARCH_LOG: 'hf:get-research-log',
  HF_CLEAR_RESEARCH_LOG: 'hf:clear-research-log',

  // File / project explorer (3.0.0-beta.3).
  PROJECT_LIST_DIR: 'project:list-dir',
  PROJECT_RECENT_LIST: 'project:recent-list',
  PROJECT_RECENT_ADD: 'project:recent-add',
  PROJECT_RECENT_REMOVE: 'project:recent-remove',

  // Claude CLI auto-flags (3.0.0-beta.3 — --dangerously-skip-permissions toggle).
  CLI_FLAGS_GET: 'cli:flags-get',
  CLI_FLAGS_SET: 'cli:flags-set',

  // Hardware + project detection.
  HARDWARE_DETECT: 'hardware:detect',
  PROJECT_DETECT: 'project:detect',
  /** Probe available + total disk bytes at a path (or the Ollama models dir). */
  DISK_INFO: 'disk:info',

  // First-run model picker persistence.
  MODELS_ONBOARDING_GET: 'models:onboarding-get',
  MODELS_ONBOARDING_MARK_SHOWN: 'models:onboarding-mark-shown',
  MODELS_ONBOARDING_RESET: 'models:onboarding-reset',

  /** Open a new BrowserWindow that renders only a terminal for the given
   *  paneId — the "pop out a model" flow. paneId must already exist
   *  (created by MODELS_LAUNCH); the new window simply attaches. */
  MODELS_POPOUT: 'models:popout',

  // Themes — custom theme persistence (v3.0.1+, R&D).
  THEMES_LIST: 'themes:list',
  THEMES_SAVE: 'themes:save',
  THEMES_DELETE: 'themes:delete',

  // Provider auth — universal API key store (v3.0.1+, R&D).
  // Raw keys never cross IPC: `has-key` returns boolean, `list` returns
  // {provider, hasKey, lastUpdated}[]. Only `set` accepts a key.
  PROVIDER_AUTH_HAS_KEY: 'provider-auth:has-key',
  PROVIDER_AUTH_SET_KEY: 'provider-auth:set-key',
  PROVIDER_AUTH_LIST: 'provider-auth:list',
  PROVIDER_AUTH_DELETE: 'provider-auth:delete',
  /** Probe whether a provider's CLI (gemini, aider, …) is on PATH. */
  PROVIDER_DETECT_LIST: 'provider-detect:list',
  PROVIDER_DETECT_GET: 'provider-detect:get',
  /** Main → renderer: a spawned CLI just hit an API-key prompt we recognized.
   *  Payload = ProviderKeyPromptEvent. Renderer shows ApiKeyModal. */
  PROVIDER_KEY_PROMPT: 'provider-auth:key-prompt',
  /** Renderer → main: user submitted a key in response to a key-prompt.
   *  Payload = { paneId, provider, key }. Main writes the key to PTY stdin
   *  and persists via provider-auth:set-key. */
  PROVIDER_KEY_SUBMIT: 'provider-auth:key-submit',
} as const;
