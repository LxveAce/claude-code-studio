export const IPC = {
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_READY: 'terminal:ready',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_RESTART: 'terminal:restart',

  RESOURCE_UPDATE: 'resources:update',

  COMPACT_INSTALL: 'compact:install',
  COMPACT_UNINSTALL: 'compact:uninstall',
  COMPACT_STATUS: 'compact:status',
  COMPACT_CONFIG_GET: 'compact:config-get',
  COMPACT_CONFIG_SET: 'compact:config-set',

  GITHUB_REPO_INFO: 'github:repo-info',
  GITHUB_COMMITS: 'github:commits',
  GITHUB_PRS: 'github:prs',
  GITHUB_ISSUES: 'github:issues',

  AUTH_LOGIN: 'auth:login',
  AUTH_REGISTER: 'auth:register',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATE: 'auth:state',

  SYNC_PUSH: 'sync:push',
  SYNC_PULL: 'sync:pull',
  SYNC_STATUS: 'sync:status',
} as const;
