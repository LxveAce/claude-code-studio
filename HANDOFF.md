# Claude Code Studio - Development Handoff

## Current State (2026-05-21)

The app launches, renders the full UI, and embeds Claude Code via node-pty with a real pseudo-terminal. All core infrastructure is in place.

## What's Working

### Phase 1: Shell + Terminal (COMPLETE)
- Electron 42 + React 19 + Vite + TypeScript foundation
- node-pty spawns `claude.exe` with full ANSI support via xterm.js
- Auto-launches Claude Code on startup
- Full interactivity (input, resize, restart on exit)
- Frameless window with custom title bar + window controls
- node-pty patches applied via `scripts/patch-node-pty.js` (postinstall)

### Phase 2: Resource Monitor (COMPLETE)
- `systeminformation` polls CPU/RAM/GPU every 2 seconds
- Process tree walking from Claude's root PID for per-process attribution
- GaugeBar component: dual-fill bars (purple=Claude, grey=system)
- Mini stat cards for Claude process count and RAM usage
- GPU gracefully shows N/A when utilization data unavailable (Intel iGPU)

### Phase 3: Compact Controller Integration (COMPLETE)
- Reads compact-controller state.json for live token/turn/vault counts
- Toggle switch installs/uninstalls hooks in `~/.claude/settings.json`
- Shows config (max vaults, transcript tail size, logging)
- Polls status every 3 seconds

### Commands Panel (COMPLETE)
- Quick Actions: clickable buttons for model/effort/session/workflow commands
- All Commands: collapsible accordion with every Claude Code slash command
- Shortcuts: keyboard shortcut reference with kbd-styled keys
- Clicking a command types it directly into Claude Code's terminal

### Settings Panel (COMPLETE)
- 6 accent color themes: Purple, Blue, Emerald, Rose, Amber, Cyan
- Changes all CSS variables live (gradients, glows, gauges, borders)
- Persists selection in localStorage
- Shows terminal config and app info

### UI Design (COMPLETE)
- Modern dark theme (#0f0f1a base) with glassmorphism-inspired elements
- SVG icons throughout (sidebar, title bar, window controls)
- Design tokens: `--radius-*`, `--shadow-*`, `--transition-*`
- fadeIn/slideIn animations for panel transitions
- Tooltip labels on sidebar hover
- Connection status dot with glow in status bar

## Known Issues

1. **Terminal resize on panel toggle**: When the right sidebar opens/closes, the terminal sometimes doesn't resize cleanly. A debounced ResizeObserver fix has been applied but may need further tuning.

2. **node-pty build patches**: The postinstall script (`scripts/patch-node-pty.js`) patches node-pty's build files to fix:
   - `GetCommitHash.bat` path resolution in winpty.gyp
   - Missing Spectre-mitigated MSVC libraries
   
   After `npm install` on a new machine, run:
   ```
   node scripts/patch-node-pty.js
   npx electron-rebuild -m . --only node-pty
   ```

3. **Crash on close**: Fixed with `safeSend()` guard and cleanup in window `close` event, but verify on home machine.

## What's Next

### Phase 4: GitHub Integration
- `src/main/github-service.ts` — Octokit wrapper for repos, PRs, issues, branches
- `src/main/git-service.ts` — Local git operations (detect repo from CWD, branch, status)
- GitHub panel components: RepoInfo, CommitList, BranchList, PRList, IssueList
- Store GitHub PAT encrypted via electron-store
- Auto-detect repo from terminal CWD

### Phase 5: Auth + Cloud Database
- Deploy Cloudflare Worker with auth endpoints (register, login, settings)
- Create private repo `claude-studio-auth` for user data
- `src/main/auth-service.ts` — calls Worker API
- Auth panel: login/register forms, "Continue without login" prominent
- API contract is backend-agnostic (designed for Supabase migration later)

### Phase 6: Conversation Vault Sync
- `src/main/cloud-sync.ts` — commit vault files to user's private GitHub repo
- Watch `~/.claude/compact-controller/vault/` for new files
- Sync wizard UI to create/connect sync repo
- Pull vaults on startup from other devices

### Phase 7: Power User Features
- Split panes (react-resizable-panels + additional PTY instances)
- Command palette (Ctrl+Shift+P)
- Desktop notifications (Electron Notification API)
- Session persistence (save/restore layout)
- Prompt snippets library
- Token cost tracker (chart from stop hook data)
- System tray (minimize to tray)
- Custom hotkeys (rebindable)
- Auto-updater (electron-updater + GitHub Releases)
- Windows installer (NSIS via maker-squirrel)

### Additional Scope (Added During Session)
- Raw CLI/CMD terminal view toggle (switch between GUI and raw terminal)
- Full GUI reskin pass after all phases complete
- CLI commands as clickable buttons (DONE - in Commands panel)
- Accent color theme picker (DONE - in Settings panel)

## Project Structure

```
claude-code-studio/
├── scripts/
│   └── patch-node-pty.js          # Postinstall patches for Electron rebuild
├── src/
│   ├── main/
│   │   ├── index.ts               # Electron main: window, IPC, lifecycle
│   │   ├── pty-manager.ts         # node-pty spawn/write/resize/kill
│   │   ├── resource-monitor.ts    # systeminformation polling + process tree
│   │   └── compact-controller.ts  # Hook install/uninstall, state/config reading
│   ├── preload/
│   │   └── preload.ts             # contextBridge: terminal, resources, compact, window
│   ├── renderer/
│   │   ├── App.tsx                # Root layout: TitleBar + Sidebar + Terminal + Panel
│   │   ├── main.tsx               # React entry
│   │   ├── index.html             # HTML shell
│   │   ├── styles/globals.css     # Design tokens, animations, scrollbar
│   │   └── components/
│   │       ├── layout/            # TitleBar, Sidebar, StatusBar
│   │       ├── terminal/          # TerminalPanel (xterm.js)
│   │       ├── resources/         # ResourcePanel, GaugeBar
│   │       ├── compact/           # CompactPanel (toggle, stats, config)
│   │       ├── commands/          # CommandsPanel, QuickCommands
│   │       └── settings/          # SettingsPanel (accent color picker)
│   ├── shared/
│   │   ├── ipc-channels.ts        # All IPC channel constants
│   │   └── types.ts               # ResourceSnapshot, CompactStatus, etc.
│   └── declarations.d.ts          # Window.electronAPI, node-pty, CSS modules
├── forge.config.ts
├── vite.main.config.ts            # Externals: node-pty, electron-store, systeminformation
├── vite.renderer.config.ts        # root: src/renderer, React plugin
├── vite.preload.config.ts
├── tsconfig.json
└── package.json
```

## Setup on New Machine

```bash
git clone https://github.com/LxveAce/claude-code-studio.git
cd claude-code-studio
npm install

# Install VS Build Tools 2022 (C++ workload) if not present
# Install Windows 10 SDK (10.0.22621) if not present

node scripts/patch-node-pty.js
npx electron-rebuild -m . --only node-pty

npm start
```

## GitHub Repo
https://github.com/LxveAce/claude-code-studio

## Plan File
Full 7-phase plan: `C:\Users\mmrla\.claude\plans\agile-painting-quill.md`
