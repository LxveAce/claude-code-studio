# Claude Code Studio - Development Handoff

## Current State (2026-05-23)

All seven plan phases shipped (v1.0.0 released). The app embeds Claude Code
via node-pty in resizable split panes, with sidebar panels for
compact-controller, commands, GitHub, LMM journaling, vault sync, account,
cost tracking, and settings. Auto-updater, system tray, command palette,
snippets, notifications, and rebindable hotkeys are wired in. Each phase
carries its own self-red-team review under `docs/security-reviews/`
(`SECURITY_REVIEW_*.md`).

### v1.1 development — bootstrap installer (in progress on `feature/bootstrap-installer`)

v1.1 replaces v1.0's "user must install Node + npm i -g @anthropic-ai/claude-code
themselves" prereq with a one-click NSIS installer that bootstraps the
Claude CLI for the user. Migration plan: 9 phases (5 shipped at time of
writing). See `INSTALLER_REDESIGN.md` for the design + status,
`MIGRATING_FROM_V1.md` for the v1.0 → v1.1 upgrade path,
`journal/config/INSTALLER_REDESIGN.lmm.md` for the phase-by-phase progress
log, and `BACKLOG.md` §0 for what's left to ship rc1.

## Post-v1.0 Fixes & Polish (2026-05-23)

### Terminal resize-loop flicker — FIXED (BACKLOG #3)
The terminal could flicker/resize when a sidebar panel opened or the
window narrowed. Two distinct mechanisms in `TerminalPanel.tsx`:
- *Self-sustaining fit loop* — every ResizeObserver tick called
  `fit()`+resize-IPC; `fit()` mutates the DOM, which re-triggers the
  observer, ad infinitum. Now gated behind a `proposeDimensions()`
  equality check (`fitIfChanged()`): a converged grid is a no-op, so the
  loop can't sustain.
- *Panel-open ratchet* (the user-visible flicker) — the pane flex
  containers lacked `min-width: 0`, so their default `min-width: auto`
  kept them as wide as the old xterm content when a 320px panel claimed
  its space; the box then caught up only one column per fit, crawling to
  the right width over ~1.5 s. Adding `minWidth/minHeight: 0` lets it
  shrink to its allotted size in the same layout pass.

### Smooth panel-open animation — ADDED
Panel open now animates the layout **width first** (terminal smoothly
resizes into the opening space) and **then fades the panel in**, via a
`panelEnter` keyframe (width 0→320 over the first ~55%, opacity after).
The right panel is split into an animated clipping wrapper + a fixed
320px scrollable inner. Terminal resize debounce dropped 50→16 ms so the
grid reflows smoothly with the animation (safe now that the ratchet is
gone and `fitIfChanged()` no-ops once converged).

Verified on Linux by driving the running app over CDP: panel-open settles
the grid in one ~66 ms step (was 30+ steps crawling over 1.6 s); a forced
90px squeeze settles to a single stable width; zero console errors.
NOTE: the original flicker was reported on a Windows install — re-confirm
there before closing the issue.

## What's Working

### Phase 1: Shell + Terminal (COMPLETE)
- Electron 42 + React 19 + Vite + TypeScript foundation.
- node-pty spawns `claude.exe` with full ANSI support via xterm.js.
- Frameless window with custom title bar + window controls.
- Hardening (Phase 4 follow-up): CSP meta, sandbox: true,
  contextIsolation: true, navigation lockdown via `web-contents-created`.

### Phase 2: Resource Monitor (COMPLETE)
- `systeminformation` polls CPU/RAM/GPU every 2 s.
- Process-tree walking from Claude's root PID(s) — aggregates across
  multiple panes (Phase 7c).
- GaugeBar with dual-fill (purple = Claude, grey = system).

### Phase 3: Compact Controller (COMPLETE)
- Reads `~/.claude/compact-controller/state.json` for token/turn/vault
  counts.
- Toggle installs/uninstalls hooks in `~/.claude/settings.json` with
  parse-failure refusal + `.bak` backup (Phase 4 C1 remediation).
- Exact-path hook matching (Phase 4 M4) so other users' similarly-named
  projects aren't false-positive matches.

### Phase 4: GitHub Integration (COMPLETE)
- `src/main/git-service.ts` — local git ops (branch/status/ahead/behind),
  parses GitHub owner/repo from origin URL, UNC + symlink hardening,
  5 s execFile timeout.
- `src/main/github-service.ts` — Octokit wrapper for repos/commits/
  branches/PRs/issues; PAT stored encrypted via Electron safeStorage
  (DPAPI on Windows), plaintext fallback requires explicit opt-in.
- GitHub panel: WorkingDirCard, ConnectGitHub, RepoHeader, CommitList,
  BranchList, PRList, IssueList.
- `shell.openExternal` URL allowlist (github.com / *.github.com).

### Phase 4.5: LMM Panel (COMPLETE)
- In-app sidebar panel walking the Lincoln Manifold Method
  (RAW → NODES → REFLECT → SYNTHESIZE) with toggle, journal-dir picker,
  variant (quick/deep) selector, persisted cycles.
- Path-traversal-safe cycle ids (`^[a-z0-9][a-z0-9-]{0,79}$`).
- Per-file size cap, scan cap, cumulative cap on save.

### Phase 5: Auth + Cross-Device Settings Sync (COMPLETE)
- `src/main/auth-service.ts` with two backends behind one contract:
  `local-stub` (scrypt + safeStorage in userData) and `http` (POST
  register/login/logout, GET/PUT /settings against a configured
  https:// baseUrl — for a future Cloudflare Worker drop-in).
- "Continue without login" as primary CTA. GitHub PAT explicitly
  EXCLUDED from sync (device-local encryption key).
- Per-user sync file scoping (`auth-synced-settings.<uuid>.json`),
  NaN-safe expiry, pinned scrypt keylen, validated session shape.

### Phase 6: Vault Sync to Private GitHub Repo (COMPLETE)
- `src/main/cloud-sync.ts` watches `~/.claude/compact-controller/vault/`
  and pushes each `vault-*.json` to `deviceName/vault-*.json` in a
  user-chosen private GitHub repo. Setup wizard (create-new or
  use-existing) with consent gate + write-access verification.
- Per-file failure backoff (3 attempts then 15-min cooldown).
- "Uploads are append-only" warning + delete-remote-vault button.

### Phase 7a: Command Palette + Snippets + Notifications (COMPLETE)
- Ctrl+Shift+P palette with fuzzy-search across panels, themes,
  snippet inserts, terminal actions.
- Snippet store (CRUD + atomic JSON, 64 KB / 500 cap).
- Desktop notification service with per-kind throttling, settings
  toggles, and a test button.

### Phase 7b: Auto-Updater + Installer (COMPLETE)
- `src/main/updater-service.ts` wraps `update-electron-app` for GitHub
  Releases. Dev mode + non-Windows + user-disable gates.
- StatusBar "Update vX.Y.Z ready" badge; SettingsPanel Updates section
  with channel toggle, check-now (rate-limited), and reason copy.
- `forge.config.ts`: `PublisherGithub` (draft), Squirrel branding
  fields, commented signing/icon placeholders.

### Phase 7c: Split Panes + Session Persistence (COMPLETE)
- react-resizable-panels split tree with `PtyRegistry` (max 16 panes).
- Per-pane PTY with reattach-if-alive semantics. ResourceMonitor
  aggregates across all live panes.
- `SessionService` persists layout tree + active panel + theme to
  `<userData>/session.json` with depth/node caps + sanitization.
- Palette: Split horizontal/vertical, Close pane, Focus next/prev,
  Reset layout.

### Phase 7d: System Tray + Custom Hotkeys (COMPLETE)
- Tray icon (16x16 base64 PNG) + context menu (Show / Toggle Compact
  / Quit). Minimize-to-tray-on-close toggle.
- Shutdown consolidated into `before-quit` — closing the window while
  tray is on hides it (PTYs survive) instead of quitting.
- Rebindable shortcuts service: click-to-record chords, conflict
  detection, persisted in `<userData>/hotkeys.json`.

### Phase 7e: Token Cost Tracker (COMPLETE)
- `src/main/cost-service.ts` polls compact-controller state + vaults
  every 30 s. Per-session dedup, per-model rate table, daily totals.
- `CostPanel` with stat cards, 30-day inline-SVG sparkline, daily
  budget setting, reset history.
- Notification fires once per day when the budget is exceeded.
- In-panel disclaimer: estimates are a lower bound (vaults lack
  per-session output counts).

### UI Design (COMPLETE)
- Modern dark theme (#0f0f1a base) + 6 accent presets (Purple/Blue/
  Emerald/Rose/Amber/Cyan). Theme apply extracted to
  `src/renderer/theme-presets.ts` so SettingsPanel and CommandPalette
  share one source of truth.
- SVG icons everywhere; design tokens for radius/shadow/transition;
  fadeIn/slideIn animations.

## Shipping Status

**v1.0.0 released** on 2026-05-23 (UTC). Available at:
https://github.com/LxveAce/claude-code-studio/releases/tag/v1.0.0

Three published assets:
- `Claude.Code.Studio-1.0.0.Setup.exe` (174 MB) — Squirrel installer
- `claude_code_studio-1.0.0-full.nupkg` (174 MB) — auto-update payload
- `RELEASES` — Squirrel update manifest

See `SHIPPING_CERTIFICATION.md` for the certifying red-team output
(SHIP verdict on the integrated code) and `docs/security-reviews/SECURITY_REVIEW_PACKAGING.md`
for the post-cert packaging fixes that produced this v1.0 build.

## What's Next (post-v1.0 backlog)

Phase 7 closed the original plan. **See [`BACKLOG.md`](./BACKLOG.md)
for spitballed ideas and known bugs that don't yet have a plan** —
backend / database planning, macOS + Linux ports, and any reported
bugs that haven't been triaged into a real fix go there.

Smaller items scoped from prior `SECURITY_REVIEW_*.md` reviews (each
is a deferred Medium, not a v1.0 blocker):

1. **Tray icon HiDPI variants** — current tray icon is a single 16x16
   PNG; supply @2x for crisp Retina.
2. **Cost panel model awareness** — vault data doesn't record which
   model was used; cost is currently estimated against a single chosen
   model + an in-panel "lower-bound" disclaimer. Either ship a per-day
   model picker or accept the disclaimer permanently.
3. **Updater beta-channel pipeline** — UI was reduced to "stable" only
   (publisher pipeline is stable-only). To enable beta, split
   `update-electron-app` config + add a beta tag to GitHub Releases,
   then re-enable the channel picker in SettingsPanel.
4. **Multi-pane resource-monitor UI** — backend aggregates across all
   panes; ResourcePanel could optionally show a per-pane breakdown.

### Already-closed Mediums (no longer open work)
- ✅ Hotkey cold-start window — hardcoded Ctrl/Cmd+Shift+P fallback
  in `App.tsx` works regardless of bindings state.
- ✅ Session migration scaffold — `SessionService.migrate()` handles
  forward-version bumps and "from-the-future" files (refuse + default).
- ✅ electron-store ESM landmine — dep removed entirely.
- ✅ Unattended-toast warning — SettingsPanel tray copy now warns that
  background services keep running while hidden.
- ✅ Installer end-to-end verification — `npm run make` produces a
  working Setup.exe on Node 22; v1.0.0 is the proof.
- ✅ Renderer not in asar — `vite.renderer.config.ts` now sets explicit
  `outDir` + `base: './'`.
- ✅ node_modules not in asar — custom `packagerConfig.ignore` shipped.
- ✅ node-pty DLLs stuck in asar — `asar.unpack` pattern shipped.
- ✅ No DevTools in prod — F12 / Ctrl+Shift+I keybind in all builds.
- ✅ Missing AppUserModelID — set in `app.whenReady()` on win32.

## Known issues (open)

See `BACKLOG.md` § "Known Bugs" for details. Active items:

- **Terminal resize loop when sidebar narrows the window** —
  with a side panel open and the window shrunk small, the terminal
  flashes/loops on auto-fit. Cosmetic, doesn't crash. (Reported
  2026-05-22 after v1.0 install.)

## Project Structure

```
claude-code-studio/
├── scripts/
│   └── patch-node-pty.js
├── src/
│   ├── main/
│   │   ├── index.ts                # window + IPC + lifecycle + service wiring
│   │   ├── pty-manager.ts          # single-PTY (wrapped by PtyRegistry)
│   │   ├── pty-registry.ts         # paneId-keyed PTY registry (Phase 7c)
│   │   ├── resource-monitor.ts     # multi-PID aggregation
│   │   ├── compact-controller.ts   # hook install/uninstall + state
│   │   ├── git-service.ts          # local git ops (Phase 4)
│   │   ├── github-service.ts       # Octokit wrapper (Phase 4)
│   │   ├── lmm-service.ts          # LMM cycle store (Phase 4.5)
│   │   ├── auth-service.ts         # local-stub + http auth (Phase 5)
│   │   ├── cloud-sync.ts           # vault → GitHub (Phase 6)
│   │   ├── snippets-service.ts     # CRUD snippets (Phase 7a)
│   │   ├── notifications-service.ts# OS notifications (Phase 7a, extended)
│   │   ├── updater-service.ts      # update-electron-app wrapper (Phase 7b)
│   │   ├── session-service.ts      # layout persistence (Phase 7c)
│   │   ├── hotkeys-service.ts      # rebindable chords (Phase 7d)
│   │   ├── tray-service.ts         # tray icon + menu (Phase 7d)
│   │   └── cost-service.ts         # token usage sampling (Phase 7e)
│   ├── preload/preload.ts          # contextBridge surface (all services)
│   ├── renderer/
│   │   ├── App.tsx                 # root layout + hotkey dispatch + palette
│   │   ├── main.tsx, index.html
│   │   ├── styles/globals.css
│   │   ├── theme-presets.ts        # shared theme apply (Phase 7a)
│   │   ├── hotkeys.ts              # chord parsing/build (Phase 7d)
│   │   └── components/
│   │       ├── layout/             # TitleBar, Sidebar (10 entries), StatusBar
│   │       ├── terminal/           # TerminalPanel, SplitLayout (Phase 7c)
│   │       ├── resources/          # ResourcePanel, GaugeBar
│   │       ├── compact/            # CompactPanel
│   │       ├── commands/           # CommandsPanel, QuickCommands
│   │       ├── github/             # 8 sub-components (Phase 4)
│   │       ├── lmm/                # LMMPanel (Phase 4.5)
│   │       ├── auth/               # AuthPanel (Phase 5)
│   │       ├── sync/               # SyncPanel, SyncWizard, VaultPreview (Phase 6)
│   │       ├── palette/            # CommandPalette, SnippetEditor (Phase 7a)
│   │       ├── cost/               # CostPanel (Phase 7e)
│   │       └── settings/           # SettingsPanel (theme, notif, tray, hotkeys, updater)
│   ├── shared/{ipc-channels,types}.ts
│   └── declarations.d.ts
├── journal/                        # Per-source-file LMM analyses (one .lmm.md per file)
├── docs/                           # Project documentation
│   ├── HANDOFF.md                  # this file
│   ├── BACKLOG.md                  # post-v1.0 ideas + known bugs
│   ├── SHIPPING_CERTIFICATION.md   # v1.0 ship certification
│   └── security-reviews/           # per-phase self-red-team reviews
│       ├── SECURITY_REVIEW.md      # Phase 4 review
│       ├── SECURITY_REVIEW_PHASE4_5.md
│       ├── SECURITY_REVIEW_PHASE5.md  …through…  SECURITY_REVIEW_PHASE7E.md
│       ├── SECURITY_REVIEW_PACKAGING.md
│       └── SECURITY_REVIEW_PHASE7_INTEGRATED.md  # cross-feature review
├── .github/                        # PR + issue templates
├── README.md
├── LICENSE                         # MIT
├── CONTRIBUTING.md
├── SECURITY.md
├── forge.config.ts
├── vite.{main,renderer,preload}.config.ts
├── tsconfig.json
└── package.json
```

## Setup on New Machine

```bash
git clone https://github.com/LxveAce/claude-code-studio.git
cd claude-code-studio
npm install

# Required Windows toolchain (for the node-pty native build):
# - VS Build Tools 2022 with the C++ workload
# - Windows 10/11 SDK (10.0.22621 or newer)

node scripts/patch-node-pty.js
npx electron-rebuild -m . --only node-pty

npm start                # dev (Vite + Electron)
npm run package          # smoke-test build
npm run make             # NSIS/Squirrel installer (Phase 7b)
npm run publish          # publish to GitHub Releases (draft, Phase 7b)
```

### Node version requirement

**Use Node 22 LTS.** `package.json` pins `engines.node: ">=22.0.0 <24.0.0"`.

Node 24 LTS has an undiagnosed incompatibility with `electron-packager`
(verified against both `18.4.4` shipped with forge 7 and `20.0.0` shipped
with forge 8-alpha): the packager's async extraction promise drops off
the event loop within ~30ms of starting, the process exits 0, and no
artifact is written. Node 22.12.0 LTS works end-to-end and produces the
Squirrel installer.

If you have Node 24 installed system-wide, the fastest workaround is to
download the Node 22 binary side-by-side and use it for the build:

```powershell
# one-time setup (no installer, fully reversible — just a folder)
Invoke-WebRequest 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip' `
  -OutFile "$env:TEMP\node22.zip"
Expand-Archive "$env:TEMP\node22.zip" 'C:\Users\<you>\nodejs-22'

# then for any build command
$env:PATH = 'C:\Users\<you>\nodejs-22\nodejs-22;' + $env:PATH
npm install   # native modules rebuild against Node 22's ABI
npm run make
```

## GitHub Repo
https://github.com/LxveAce/claude-code-studio

## Branch Layout
- `master` — original Phase 1–3 base
- `phase-4-github-integration` — Phase 4 PR
- `phase-4.5-lmm-panel`        — Phase 4.5 PR
- `phase-5-auth`               — Phase 5 PR
- `phase-6-vault-sync`         — Phase 6 PR
- `phase-7a-palette-snippets-notifications` — Phase 7a PR
- `phase-7b-auto-updater`, `-7c-split-panes-session`,
  `-7d-tray-hotkeys`, `-7e-cost-tracker` — individual sub-feature PRs
- **`phase-7-integrated`** — recommended merge target: all of 7b–e
  merged on top of 7a, plus a cross-feature red-team pass
- `explore/smooth-panel-resize` — post-v1.0: terminal resize-loop fix
  (BACKLOG #3) + smooth panel-open animation. Open PR.

## Workflow Conventions
- LMM applied as a thinking discipline on non-trivial work (see
  `journal/` for per-file analyses).
- Red-team + remediate after each phase before commit. Every phase has
  a self-review at `docs/security-reviews/SECURITY_REVIEW_*.md` listing the Criticals + Highs
  fixed in the same commit set, with Mediums explicitly deferred as
  documented tech debt.
- Worktree-isolated agents per phase (see Phase 7b–e). Integration
  happens in a `phase-N-integrated` branch with a final cross-feature
  review.
