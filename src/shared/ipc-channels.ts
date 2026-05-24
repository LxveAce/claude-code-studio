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
} as const;
