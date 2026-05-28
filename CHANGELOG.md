# Changelog

All notable changes to Claude Code Studio. Dates are when the tag was
pushed to origin. Detailed per-release notes live in
`docs/RELEASE_NOTES_v{version}.md` and are attached to each GitHub
release; this file is the at-a-glance summary.

The project follows [semver](https://semver.org/) loosely — major bumps
mean breaking install/migration changes (v1 → v2 = Squirrel → NSIS;
v2 → v3 = multi-model surface).

---

## [3.2.1] — 2026-05-28

Polish pass driven by user-reported issues in the live v3.2.0 build,
plus a brand-new Accessibility section under Settings.  No new
headline features; this release fixes things that didn't work,
makes things easier to use, and surfaces hidden workflows.

Full notes: `docs/RELEASE_NOTES_v3.2.1.md`.

### Added
- **Accessibility section under Settings** — ten persisted toggles:
  high-contrast palette, 90/100/115/130 % font scale, reduce motion,
  large focus ring, 44 px click targets, dyslexia-friendly font,
  screen-reader mode hook, keyboard-hints overlay, color-blind palette
  (protanopia / deuteranopia / tritanopia SVG filters), and an audio
  captions placeholder for v4.0.0.  Persisted at
  `<userData>/accessibility.json`; applied via `data-*` attributes on
  `<html>` so the entire app reacts without prop-plumbing.  Defaults
  every accommodation OFF.
- **`Ctrl+F` to focus Models search** + **`Ctrl+Shift+T` to open the
  profile picker** — two new hotkey actions (`models.focus-search`,
  `terminal.new-profile`).
- **OpenAI GPT-4o-mini (via Aider)** catalog entry for cost-sensitive
  iterative runs.
- **`+` tab button now opens the profile picker** (previously
  hard-coded to a new Claude tab).
- **In-app "New LMM cycle" modal** replaces `window.prompt()`.

### Changed
- **Models search bar** bumped from 140 / 11 / 4-8 to 280 / 13 / 8-12
  with radius 6.  Visible on both Local and API tabs.
- **`api.aider.multi`** display name renamed to **OpenAI GPT-4o (via Aider)**
  so the OpenAI use case is obvious.  Existing installs pick up the
  rename via new `FORCE_REFRESH_DISPLAY_IDS` migration tied to
  `SEED_VERSION` 2 → 3 (also pulls in any missing seed API entries on
  registries stuck on the older set).
- **`MODELS_POPOUT`** IPC takes a 3rd `profile` arg; popouts now
  render chat-mode profiles with the stream-json renderer instead of
  falling back to the TUI sanitizer.
- **LMM + Compact panels** are focus-aware — they accept an
  `activeFamily` prop and show a "switch to a Claude tab" hint when
  the focused tab is non-Claude.

### Fixed
- **"Get a key →"** link inside `ApiKeyModal` now opens for OpenAI /
  Gemini / OpenRouter / Anthropic (host allowlist extended).  Blocked
  URLs log a console warning.
- **Auto-updater 404 stack trace** demoted to a one-line console warn
  when `latest*.yml` is missing from the latest release.  CI release
  workflow now uploads `dist/latest*.yml` alongside installers — those
  were excluded in v2.0 and never re-added, so every v3.x release
  shipped without the auto-updater manifest.
- **Copy command** in Models tab now uses Electron's main-process
  clipboard via IPC (reliable regardless of window focus), falls back
  to `navigator.clipboard`, then `alert()` with the command line if
  both fail.  Successful copy flashes the button green "✓ Copied!".
- **`[paneId not found]` cold flash** on popouts replaced with a
  re-attaching spinner + 2.5 s retry; only declares the PTY dead
  after a second negative probe.
- **Chat-skin toggle** now syncs across windows via the localStorage
  `storage` event — toggling in main or popout updates the other.

### CI
- `.github/workflows/release.yml` upload globs include
  `dist/latest.yml`, `dist/latest-mac.yml`, `dist/latest-linux.yml`.
  Users on v3.2.0 will receive the v3.2.1 update via auto-updater
  once this release is published (electron-updater pulls `latest.yml`
  from the LATEST release, not the running version's).

---

## [3.2.0] — 2026-05-27

The tab + structured-chat release. Replaces the split-pane terminal
with a Windows-Terminal-style tab strip; adds a Claude (Chat) profile
that runs Claude in non-interactive JSONL mode for a real chat UI;
the Commands sidebar now mirrors the active tab's CLI.

Full notes: `docs/RELEASE_NOTES_v3.2.0.md`.

### Added
- **TerminalTabs** — Windows-Terminal-style tab strip with profile
  picker (Claude / Ollama / Aider / Gemini / BitNet). Replaces the
  prior split-pane layout. Per-tab popout windows, status dots, +
  button, profile dropdown.
- **Claude (Chat) profile** — runs `claude --print
  --input-format=stream-json --output-format=stream-json --verbose`.
  Pairs with the chat skin to render structured messages: text
  bubbles, tool_use cards, tool_result cards, thinking blocks.
- **Stop button** in chat-mode — replaces Send while a response
  streams, sends SIGINT to halt generation.
- **CLI capability probe** — `claude --help` parsed on app startup;
  Claude (Chat) entry in the picker shows a yellow "CLI flags?"
  badge when stream-json isn't supported locally.
- **Commands sidebar profile families** — 6 curated CLI command
  families surface per active tab.
- **Renderer-side `MAX_TABS = 32`** cap with dismissable banner.
- **Extended runtime verifier** — 30 assertions (12 sidebar panels
  + 18 tab/picker/palette/family-chip gestures).

### Changed
- **Session schema v1 → v2** — `tabs[] + activeTabId` replaces
  `layout: SplitNode`. Automatic migration on first launch (first
  pane of old layout becomes single Claude tab on same paneId).
- **Aider Quick Actions** — `/add `, `/drop `, `/ask `, `/code `,
  `/architect `, `/run ` no longer auto-submit empty arguments;
  they land in the composer for you to finish typing. Active
  terminal auto-focuses.
- **EmbeddedTerminal** wired with `registerSender` + `onPidChange`
  + `active` props so model tabs participate in the snippet /
  palette / StatusBar PID system equally to Claude tabs.
- **CLI onboarding modal** routes `/login` to a Claude tab when
  the active tab is non-Claude.

### Fixed
- StatusBar PID footer now shows real PID for model tabs (was 0).
- Chat-mode user-message echo dedup uses whitespace-normalized
  comparison (no more double-rendered bubbles when Claude
  normalizes text).
- Image content in tool_result shows media_type + source kind +
  size instead of bare `[image]`.
- Race in TerminalTabs `addClaudeTab` / `addModelTab` / `closeTab`
  that dropped concurrently-added tabs during a model-launch await.

### Removed
- `SplitLayout.tsx` (replaced by `TerminalTabs.tsx`).
- The 5 split-pane CommandPalette actions (split-horizontal,
  split-vertical, close-pane, focus-next-pane, focus-prev-pane,
  reset-layout) — repurposed as tab actions.

---

## [3.0.0] — 2026-05-26

The multi-model release. Local + API model catalog, file directory
navigator, accurate per-bucket resource monitoring, cross-platform
uninstall flow, and the full beta.1 → beta.2 → beta.3 fix log folded
into one stable.

### Added
- **Multi-model catalog** — 33 curated local + API models (Qwen,
  DeepSeek, Llama, Gemma, Granite, Phi, Mistral, embeddings) with
  hardware-aware recommendations + cwd-aware project suggestions.
- **Ollama integration** — in-app detection, pull with streaming
  progress, cancel, delete. Install prompt links to `ollama.com/download`
  (not bundled in the installer).
- **In-panel terminal viewer** for launched models + **pop-out windows**
  (separate `BrowserWindow` per model).
- **First-run picker** — auto-opens after install with top
  recommendations for your hardware.
- **File directory navigator** — new sidebar panel, lazy folder tree,
  recent projects, show/hide dotfiles, path-traversal guarded.
- **Add custom model form** — register your own model in the registry.
- **License disclosure** for restricted-license models (Llama, Gemma,
  BigCode) before pull.
- **Per-bucket resource monitoring** — Claude / Models / Ollama tracked
  separately; O(n) process-tree walk (was O(n²)).
- **`--dangerously-skip-permissions` toggle** in Settings → Claude CLI.
  Auto-injects the flag when spawning Claude; never affects model PTYs.
- **Danger Zone in Settings** — Reset User Data (wipes JSON state files,
  keeps Chromium profile) + Uninstall (cross-platform: Windows NSIS,
  macOS Finder, Linux pkg-mgr hint).
- **Status bar git branch** with dirty indicator.
- **App version IPC** — title bar, status bar, and About row all read
  from `app.getVersion()` (no more hardcoded drift).
- **NSIS uninstaller** prompts to also remove userData JSON.

### Changed
- Cost rates updated to May 2026 Anthropic pricing (Haiku $1/$5, was
  $0.8/$4). Sonnet $3/$15 and Opus $15/$75 unchanged.
- Cost disclaimer made explicit: local models via Ollama are free and
  never counted.
- GitHub Octokit errors classified into friendly one-line messages
  (401 token revoked / 403 rate limit with reset time / 404 / network).
- Sign-in flow now sends `/login` (Claude's in-session slash command)
  instead of `claude login` (which the running Claude session was
  treating as chat text).
- `CliService.getStatus` heuristic loosened — only flips `authenticated:
  false` when stderr explicitly mentions auth phrases (was failing on
  any non-zero `claude doctor` exit, popping the modal needlessly).
- Auto-updater skips beta builds entirely (no more `latest.yml` 404
  stack trace).

### Removed
- Ollama bundle from the NSIS installer (was downloading ~2 GB silently
  with no progress UI — users thought the installer was stuck). In-app
  detection + opt-in install link replaces it.

### Known deferred (own pushes later)
- Per-provider API key entry (OpenAI, Gemini, OpenRouter)
- Model comparison view (parallel pane + synced input + diff)
- Embedding-RAG over past sessions
- Per-loaded-model VRAM tracking (requires vendor GPU SDKs)
- macOS code signing + notarization

---

## [2.0.0] — 2026-05-24

Cross-platform release. Windows + macOS + Linux from a single source
tree.

### Added
- macOS DMG (Apple Silicon native, Intel via Rosetta)
- Linux AppImage (portable, any distro) + .deb (Debian/Ubuntu) + .rpm
  (Fedora/RHEL)
- Cross-platform first-launch Node + Claude CLI bootstrap (macOS/Linux
  uses in-app modal; Windows uses NSIS install-time download)
- Per-OS README install sections + SmartScreen/Gatekeeper workarounds

### Changed
- Build pipeline migrated from electron-forge + Squirrel → electron-
  builder + NSIS (Windows) / DMG (Mac) / AppImage/.deb/.rpm (Linux)
- Auto-updater migrated from `update-electron-app` (Squirrel-tied) to
  `electron-updater` (cross-platform via `latest.yml`)
- Tag-driven CI release workflow (matrix build on push of `v*.*.*`)

### Fixed
- npm install MODULE_NOT_FOUND node-gyp/bin/node-gyp.js (added
  `--ignore-scripts` to the bootstrap npm install)
- Sign In button submit (PTY readline needs `\r`, not `\n`)
- Vite `path.join is not a function` browser-stub crash (added explicit
  `external: [...builtinModules]` to vite.main.config)

### Migration from v1
v1 used Squirrel.Windows for Windows-only delivery. v2 uses NSIS which
doesn't know about Squirrel's metadata. v1 users: uninstall via Windows
Settings → Apps, then run the new installer. See
`docs/MIGRATING_FROM_V1.md`.

---

## [1.0.0] — initial release

Single-platform (Windows) Electron app wrapping the Claude Code CLI in
an embedded terminal (node-pty + xterm.js). Resource monitor, GitHub
panel, compact-controller integration, LMM journaling panel,
auth/sync, snippets, hotkeys, system tray.

Built with electron-forge + Squirrel.Windows. Auto-updates via
`update-electron-app`.
