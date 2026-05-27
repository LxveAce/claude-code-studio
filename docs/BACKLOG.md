# Backlog (post-v1.0)

Loose notes on things spitballed but not implemented yet. Add to this
file as ideas come up; don't bother with formal design until something
is ready to actually pick up. Each entry: what / why-it-matters / where
to start.

---

## ★ v3.0.0-beta.3 — SHIPPED 2026-05-26 (commit 24b3848)

Installer: `Claude-Code-Studio-3.0.0-beta.3-Windows.exe` (91 MB) at
`C:\Users\extra\OneDrive\Desktop\claude-code-studio-installers\`.

Done in this push:

- **Resource monitoring split into claude / models / ollama-daemon
  buckets** — `ResourceMonitor` rebuilt with O(n) process-tree walk;
  PtyRegistry now tracks per-pane category at spawn time; ResourcePanel
  UI renders the new buckets when present. Backward-compatible.
- **Cost rates** bumped to May 2026 Anthropic pricing (Haiku $1/$5).
  Disclaimer expanded re local models being free + uncounted.
- **GitHub error classification** in GitHubPanel.extractError — 401
  / 403 / 404 / network all get friendly one-line messages instead of
  raw stack traces. Rate-limit messages parse the reset timestamp when
  present and say "Resets at HH:MM."
- **File directory navigator** — new `Files` sidebar entry between
  Resources and Cost. Lazy tree (1 dir level per IPC call), path-
  traversal guarded, max 2000 entries per call. Recent-projects list
  with persistence at `<userData>/recent-projects.json`.
- **`--dangerously-skip-permissions` toggle** in Settings → Claude CLI.
  Persisted at `<userData>/cli-flags.json`; PtyManager reads at spawn
  time and prepends only when no `opts.command` (i.e., bundled Claude
  CLI). Model PTYs never affected.
- **Danger Zone** in Settings — Reset user data (wipes 18 named JSON/
  JSONL files; leaves Chromium profile intact) + Uninstall Claude Code
  Studio (spawns NSIS uninstaller, quits app). Both gated by
  confirmation.
- **NSIS uninstaller** now MB_YESNO prompts to also remove the user-
  data JSON files (default No so a planned reinstall keeps settings).
  Lists every file explicitly.
- **Models panel running list** survives panel re-mount via new
  `MODELS_LIST_RUNNING` IPC (rehydrates from `PtyRegistry.listModelPanes()`
  on mount).
- **EmbeddedTerminal** warns when paneId is stale (yellow placeholder
  after 1.5s if `listRunning()` doesn't return the paneId).
- **Auto-updater** now skips beta builds entirely (Gate 4 in
  `UpdaterService.start()` checks `/-beta\./i.test(app.getVersion())`).
  Fixes the v1.0.0 `latest.yml` 404 stack trace.
- **Status bar** shows current git branch + dirty dot, polled every
  30s + on focus.
- **About row in Settings** reads from `app:version` IPC (was hardcoded
  "2.0.0").

Deferred (each its own ≥1 week push):
- Per-provider API key entry (extend AuthPanel)
- Model comparison view (parallel pane + synced input + diff)
- Embedding-RAG over past sessions
- VRAM tracking per loaded model (requires vendor GPU SDKs)

---

## ★ v3.0.0-beta.4 — queued for next push

User request, 2026-05-26 (while testing beta.2):

**Easier uninstall throughout.** Concrete asks not yet detailed; capture
when user provides them. Likely items to investigate:
- Verify the NSIS uninstaller actually removes everything we create
  (bundled Node runtime, model-registry.json, debug-dump.jsonl,
  models-onboarding.json, cli-onboarding.json, github-auth.json,
  cost-history, lmm-journal, sync state, vault tails).
- Add a "Reset Claude Code Studio" action inside the app (Settings →
  Danger zone) that wipes `<userData>` without uninstalling the binary
  — useful for the "I want to start fresh without going through Windows
  Settings → Apps" path.
- The Windows uninstaller currently lives at
  `%LOCALAPPDATA%\Programs\claude-code-studio\Uninstall Claude Code Studio.exe`.
  Add a Start Menu shortcut to it AND a "Uninstall Claude Code Studio"
  action inside the app's Settings panel that just spawns that exe.
- Consider whether uninstall should optionally also remove the user's
  Ollama install + pulled models (separate question — likely "no by
  default, yes with explicit checkbox").
- Confirm `customUnInstall` in `build/installer.nsh` walks the right
  directories on uninstall (today it just `RMDir /r` on
  `$INSTDIR\resources\runtime` — userData isn't touched, which may or
  may not be intentional).

**Auto-updater 404 on beta builds.** User caught during beta.2 testing
(2026-05-26 evening):

```
Cannot find latest.yml in the latest release artifacts
(https://github.com/LxveAce/claude-code-studio/releases/download/v1.0.0/latest.yml):
HttpError: 404
```

Root cause: `electron-updater` queries GitHub for the latest *published*
release, which is still `v1.0.0` (v2.0.0 is in drafts, beta.x builds
aren't on origin at all). The v1.0.0 release predates the
electron-updater migration so it has no `latest.yml` asset — hence the
404. The 404 currently bubbles up as a visible unhandled exception
instead of being swallowed gracefully.

Fix options to weigh in beta.3:
1. **Detect beta builds** (`app.getVersion()` includes `-beta.`) and
   disable the updater entirely in that case — no GitHub queries.
   Simplest, no user-facing log noise. Probably right.
2. Catch the 404 in `UpdaterService` and log-at-debug instead of letting
   it bubble. Plus #1 — defense in depth.
3. Long-term: publish a `latest.yml` to the v1.0.0 release retroactively
   (or to v2.0.0 once promoted) so the updater has something to read.

---

## ★ v3.0.0-beta.2 red-team fixes (2026-05-26)

After packaging beta.1 and trying it on a real machine, three concrete
bugs surfaced that needed immediate fix before further testing:

1. **Version drift across the UI** — `TitleBar.tsx` was hardcoded to
   `v1.0.0` (predating v2), `StatusBar.tsx` was hardcoded to `v2.0.0`,
   and the installer reported `3.0.0-beta.1`. Three different versions
   on screen. Fixed by adding an `app:version` IPC backed by
   `app.getVersion()` and rendering it from both labels.

2. **"Sign in to Claude" sent `claude login` into a running Claude
   session** — the embedded PTY auto-spawns Claude, so the active pane
   is always a running Claude session, never a bare shell. The button
   wired `sendToActivePane('claude login')`, which Claude interpreted
   as chat text and replied "I notice you typed claude login as a
   message rather than as a shell command." Fixed by sending Claude's
   in-session `/login` slash command instead.

3. **Auth modal popped on transient `claude doctor` failures** —
   `CliService.getStatus` reported `authenticated: false` on ANY
   non-zero doctor exit (network blip, telemetry timeout, anything),
   which then popped the onboarding modal even when the user was clearly
   authenticated. Fixed by only flipping to `authenticated: false` when
   stderr explicitly mentions auth phrases; everything else defers to
   Claude itself to prompt for login as needed.

Plus the Ollama-bundle-in-installer removal — see the MULTI_MODEL.md
update for that one.

All four fixes shipped on commit `16f3701` on `feature/multi-model-
scaffold` (testing remote), packaged as `Claude-Code-Studio-3.0.0-
beta.2-Windows.exe`.

---

## ★ Multi-model support — IMPLEMENTED (full scope, 2026-05-26)

**Status:** Built. The full-scope catalog + Ollama bootstrap + hardware
detection + recommendation engine landed on `feature/multi-model-scaffold`
on 2026-05-26. See `docs/MULTI_MODEL.md` for the design + research,
and `_backups/2026-05-26-pre-fullscope/` for the pre-change snapshot.

**Shipped this push:**
- 33-model curated catalog seeded into `ModelRegistry` (covers general
  chat, frontend, backend, polyglot code, reasoning, vision, long
  context, edge, embedding — across all 5 hardware tiers).
- `OllamaService` wrapper: detect, list installed, pull with progress,
  cancel, delete.
- `HardwareDetection`: RAM/CPU/GPU probe → `toaster` / `low` / `mid` /
  `high` / `workstation` tier classification.
- `ProjectLanguageDetect`: cwd → `frontend` / `backend` / `data` /
  `systems` / etc. via package.json / pyproject.toml / Cargo.toml / etc.
- `ModelRegistry.recommend()`: scores models against hardware + project,
  surfaces top picks with reason strings.
- `PtyManager` + `PtyRegistry` generalized: now accept arbitrary
  `command` + `args` so any model can spawn into a pane.
- NSIS installer bootstrap: detects Ollama at well-known install paths
  + PATH; if absent, downloads OllamaSetup.exe via `curl.exe` and runs
  silently with `/verysilent /norestart`.
- `ModelsPanel` UI: hardware-tier banner, recommendations row, role +
  tier + search filters, per-model card with full metadata, pull
  progress bar, license disclosure, launch + kill flow.

**Still deferred (documented in MULTI_MODEL.md):**
- In-panel xterm output viewer for launched models (today: PTY runs in
  background, output reaches the renderer via existing TERMINAL_DATA but
  no Models-panel-local viewer is mounted)
- Pop-out windows per model
- "Add custom model" form (catalog-side CRUD is wired; UI is not)
- Per-provider API-key entry UI (extend AuthPanel beyond Anthropic)
- macOS + Linux installer Ollama bootstrap (Windows shipped this push;
  POSIX install-OllamaSetup logic follows the same curl pattern)

**Original brainstorm (preserved for context):**

### The pitch

Today Studio has one terminal driving one CLI (Anthropic's `claude`).
Expand it to a multi-model surface where the user can run any combination
of remote-API-backed and locally-hosted models in parallel, with the
same GUI shell (terminal panes, resource monitor, etc.) around each.

### Two model categories

1. **API Models** (current behaviour generalised)
   - Talk to a remote API for inference. Lightweight on the user's
     machine — just network + render.
   - Each model is a separate CLI/process spawned in its own pane.
   - Tabs/sub-panels per model: Claude (Anthropic), GPT-x (OpenAI),
     Gemini, etc. — whichever the user adds.
   - Auth per provider stored encrypted via the existing `safeStorage`
     pattern.

2. **Local Models**
   - Run inference on the user's hardware (GPU/CPU). No network call
     for the actual model — though the *binary itself* is downloaded
     once.
   - Source for binaries: a curated registry/database (could be our
     own JSON manifest hosted on GitHub or a backend) that lists
     model + size + URL + hash + runtime requirements.
   - User picks a model from a catalog → Studio downloads to local
     storage (similar to the Phase 4 Node bootstrap pattern — fetch,
     verify SHA, extract) → spawns the model via a runtime
     (`llama.cpp`, `ollama`, `vllm`, custom — depends on format).
   - First-use bootstrap dialog matching the existing Claude CLI
     onboarding UX: "This model is X GB. Download now?"

### Concurrent model runs

- Each model lives in its own pane (existing split-panes infra works).
- Resource monitor needs per-pane breakdown (already noted as C4 in
  earlier polish list) — multi-model makes that essential.
- Cap concurrent local models by available RAM/VRAM. Reuse the
  PtyRegistry pattern with a resource-aware admission control.

### Pop-out windows (separate from tabs)

- Right now everything's a pane inside one window. For multi-model the
  user will want to pop a model out to a separate window (separate
  monitor / side-by-side workflow).
- Electron supports multiple BrowserWindows; need a window manager
  service that tracks which panes are in which window, persists across
  restart, and forwards IPC between windows.

### Where this affects the existing codebase

- `PtyRegistry` → generalize beyond "claude" to any model CLI; add
  `model` metadata to each pane.
- New `ModelRegistry` service: catalog of API + Local models, per-model
  config (auth, runtime, install path).
- New `ModelDownloadService` (mirror Phase 4 bootstrap): handles local
  model fetch + verify + extract.
- Renderer: new "Models" panel with two top-level tabs (API / Local),
  catalog browser, per-model launch button.
- Settings panel: per-provider auth (extend the existing AuthPanel
  pattern that's currently Claude-specific).
- Window manager service in main process for pop-out support.

### Open questions (decide before coding)

- Catalog hosting: GitHub-Pages-hosted JSON? Cloudflare Worker? Own
  schema vs. piggyback on Hugging Face / Ollama registry?
- Local-model runtime: bundle our own (llama.cpp prebuild for each
  OS) or shell out to an existing tool (ollama, lm-studio)?
- License / TOS exposure: local models often have non-commercial
  licenses; surface that prominently in the catalog UI.
- GPU detection: nvidia-smi / Metal / Vulkan probe → only show models
  the user's hardware can run.

### Scope estimate (rough)

- Multi-API tabs (just adding GPT/Gemini providers): ~1 week
- Local-model catalog + download + run: ~3-4 weeks (includes building
  the runtime wrapper)
- Pop-out windows: ~1 week (Electron multi-window is fiddly but well-
  documented)
- Total v3.0 work: ~6-8 weeks if all built sequentially; faster with
  parallel agents on independent pieces.

---

## 0. v1.1 bootstrap installer — IN DEVELOPMENT

**Status:** 4 of 9 phases shipped on `feature/bootstrap-installer`. See
[`INSTALLER_REDESIGN.md`](./INSTALLER_REDESIGN.md) and
[`MIGRATING_FROM_V1.md`](./MIGRATING_FROM_V1.md) for the design + upgrade
path. Per-phase journal at
[`../journal/config/INSTALLER_REDESIGN.lmm.md`](../journal/config/INSTALLER_REDESIGN.lmm.md).

**Phases complete:** 1 (design) · 2 (forge→builder hybrid) · 3 (PtyManager
runtime path) · 4 (NSIS bootstrap macros) · 8 (this docs update).

**Phases remaining for v1.1.0-rc1:**
- Phase 5: branded NSIS UI assets (placeholders OK for rc1; real art before final)
- Phase 6: first-launch CLI auth onboarding modal (`claude doctor` detection,
  one-click `claude login`, "install CLI now" soft-fail recovery). **Hard
  blocker for rc1** per Phase 4 red-team M5.
- Phase 7: `update-electron-app` → `electron-updater` migration
- Phase 9: integrated cross-feature red-team + clean-VM test, tag rc1

### Phase 4b — Offline installer variant (deferred)

Phase 4 shipped online installer only. The offline variant (Setup.exe
bundles Node + the CLI tarball inside the installer payload, no network
needed during install) is deferred to a Phase 4b based on user-reported
install-failure rate. Trigger to implement: first user report of install
failure due to network issues. Estimate: +130 MB on the release asset
size; same NSIS script flow but reads files from `$PLUGINSDIR\` instead of
downloading. See `INSTALLER_REDESIGN.md` Phase 4 red-team H1 for the full
rationale.

---

## 1. Backend databases (Phase 5 follow-through)

**Status**: Phase 5 shipped with a local-stub auth backend that
implements the HTTP contract but stores everything in
`<userData>/auth-users.json`. The contract is real and frozen
(documented in `src/main/auth-service.ts:14-26`); only the server is
missing. Likewise, Phase 6 vault sync uses GitHub as its data store,
which works but isn't a "real" database for things like cross-account
analytics, leaderboards, shared snippets, etc.

**What's needed:**
- Pick a backend platform. Original plan (per `HANDOFF.md` history)
  was **Cloudflare Worker** because it's free-tier-friendly and the
  AuthService HTTP contract was designed against it. Alternatives:
  Supabase, Pocketbase, a small self-hosted Express server. Whatever
  ships needs the four endpoints in `src/main/auth-service.ts`:
  `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`,
  `GET/PUT /settings`.
- Pick a data store. Cloudflare D1 (SQLite) or KV both work for the
  current minimal schema (users + per-user `SyncedSettings`).
  Postgres if you want real relational queries.
- Password hashing: backend should use scrypt or argon2id, not bcrypt.
  Salt + per-user.
- Session tokens: opaque 32-byte random strings, store hashed in DB,
  return raw to client, expire on TTL. The client already encrypts
  the token at rest via `safeStorage`.
- Once a real backend exists, flip the UpdaterChannel + Sync settings
  to point at it; the per-user `auth-synced-settings.<uuid>.json`
  local-stub keying (Phase 5 C1 fix) is **only** for local-stub mode,
  HTTP mode delegates to the backend.

**Schema sketch (minimal):**
```sql
users (id uuid pk, email text unique, password_hash text, salt text, created_at)
sessions (token_hash text pk, user_id uuid fk, issued_at, expires_at)
synced_settings (user_id uuid pk, theme text, lmm_enabled bool, lmm_variant text, updated_at)
```

**Future schema growth ideas:**
- `snippets_synced` — let users share their Phase 7a snippet library
  across devices (currently device-local only)
- `cost_history_synced` — multi-device cost aggregation (Phase 7e)
- `vault_index` — metadata about pushed vaults so the user can see
  "I have N vaults across M devices" without enumerating GitHub repos
- `feedback` / `crash_reports` — if you ever turn on telemetry,
  there's an obvious backend to send it to

**Decisions deferred:**
- Whether to make signup invite-only or open
- Whether to support social login (GitHub OAuth, Google OAuth)
- Rate limiting strategy (per-IP, per-account, per-endpoint)
- Recovery flow if user loses password (email-based reset requires
  picking an email sender — Resend, Postmark, SES…)

**Relevant existing files:**
- `src/main/auth-service.ts` — HTTP contract
- `src/shared/types.ts` — `AuthBackend`, `AuthCredentials`, `SyncedSettings`
- `src/renderer/components/auth/AuthPanel.tsx` — backend switcher UI
- `docs/security-reviews/SECURITY_REVIEW_PHASE5.md` — auth-side threat model

---

## 2. macOS + Linux support

**Status**: v1.0 ships Windows-only via Squirrel.Windows. The forge
config has `MakerZIP({}, ['darwin'])` which would produce a darwin zip
on a Mac build host but the build machine has to be macOS. Linux is
not supported at all yet (no maker, no plugin-fuses Linux variant).

### macOS

**What's needed:**
- A macOS build host. Apple won't let you cross-compile signed Mac
  builds from Windows — you need either a Mac, a Mac mini cloud
  rental (MacStadium / MacInCloud), or GitHub Actions
  `runs-on: macos-latest`.
- Add `@electron-forge/maker-dmg` for a proper .dmg installer.
- Add `@electron-forge/maker-zip` (already present) so the
  auto-updater has an artifact format it can read.
- **Code signing.** Required for distribution. Costs $99/year (Apple
  Developer Program). Without it, users get the "App is damaged or
  can't be opened" gatekeeper warning. With it, the app is trusted
  on first launch.
- **Notarization.** Apple-mandated as of macOS 10.15+. After signing,
  upload the .app to Apple's notarization service via `notarytool`
  (built into Xcode CLI). Notarization stapling makes the app launch
  without network on the user's machine.
- Update `forge.config.ts` `packagerConfig` with `osxSign` and
  `osxNotarize` options keyed to env vars `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- The auto-updater (`update-electron-app`) works on Mac without
  changes — same GitHub Releases backend, just different artifact
  shape that Squirrel.Mac understands.
- The tray icon (Phase 7d) needs a macOS template image variant
  (black PNG, `@2x` retina). Without it the tray shows the Windows
  colored icon which looks wrong against the Mac menu bar.

**Native module rebuild:**
- node-pty needs to rebuild against the macOS Electron ABI. The
  `scripts/patch-node-pty.js` postinstall script is currently
  Windows-specific (patches `winpty.gyp` + Spectre mitigation). Skip
  the patches on `process.platform === 'darwin'`.

### Linux

**Status**: harder than macOS because Squirrel doesn't support Linux
and there's no single installer format.

**Options:**
- `@electron-forge/maker-deb` for Debian/Ubuntu
- `@electron-forge/maker-rpm` for Fedora/RHEL
- `@electron-forge/maker-appimage` (community) for distro-agnostic
  AppImage
- `@electron-forge/maker-flatpak` for Flatpak / Flathub

**Auto-updater:** `update-electron-app` doesn't support Linux out of
the box. Either skip auto-update on Linux (most distros have their
own package manager) or wire a custom updater that downloads the
appropriate format from GitHub Releases.

**node-pty on Linux:** uses POSIX pty (`forkpty`) so no winpty/conpty
hassle, but does require glibc compatible with the build host. The
prebuilt binary in `node_modules/node-pty/prebuilds/linux-x64/`
should "just work" if Electron's Node version matches.

**Tray icon:** Linux tray support is wildly inconsistent across DEs
(GNOME requires an extension, KDE works natively, etc). Default to
disabled-on-Linux for the tray feature.

---

## 3. Known Bugs

### Terminal resize loop when sidebar narrows the window
**Reported**: 2026-05-22 (user, post-v1.0 install)
**Severity**: Medium (cosmetic flicker; doesn't crash)
**Status**: 2026-05-23 — MOVED TO PR on branch `fix/terminal-resize-loop`.
Two distinct flicker mechanisms found and fixed in `TerminalPanel.tsx`:
  1. *Self-sustaining loop* — `fit()`+resize-IPC ran on every
     ResizeObserver tick. Now gated behind a `proposeDimensions()`
     equality check (`fitIfChanged()`): a converged grid is a no-op, so
     the fit→ResizeObserver→fit feedback can't sustain.
  2. *Panel-open ratchet* (the one the user actually saw) — the pane
     flex containers lacked `min-width: 0`, so their default
     `min-width: auto` kept them as wide as the old xterm content when a
     320px panel opened. The container only caught up one column per
     fit(), crawling to the right size over ~1.5s. Adding
     `minWidth/minHeight: 0` lets the box shrink to its allotted size in
     the same layout pass, so xterm fits once and settles.
Verified on Linux (real app via CDP): panel-open now settles the grid in
one ~66ms step (was 30+ steps over 1.6s); forced 90px squeeze settles to
a single stable width. NOTE: original report was a Windows install —
re-confirm there before closing the issue.

**Symptom:** With a sidebar panel open (Resources / Compact / GitHub
/ etc.) AND the window shrunk such that the terminal area is narrower
than the panel's preferred width, the terminal starts auto-adjusting
its size in a loop. Visually you see the terminal rapidly flashing
between two sizes.

**Likely root cause:**
- `src/renderer/components/terminal/TerminalPanel.tsx` uses a
  `ResizeObserver` with a 50ms debounce (set in Phase 1).
- The right-panel container in `src/renderer/App.tsx` has a fixed
  `width: 320, minWidth: 320`.
- When the parent window shrinks below `320 + xterm-min-cols`, the
  flex layout has no good answer. xterm fits to its container, which
  changes the container size (because xterm uses tabular cells that
  round to integer column counts), which triggers ResizeObserver
  again, which re-fits, which re-changes the size...
- Phase 7c (split panes) introduced react-resizable-panels which may
  compound this — multiple terminal panes each running their own
  `fit()` cycle.

**Where to look:**
- `src/renderer/components/terminal/TerminalPanel.tsx` — the
  ResizeObserver + `fit.fit()` call site
- `src/renderer/App.tsx` — the right-panel `width: 320, minWidth: 320`
  rule (it's flex-shrink: 0 implicitly)
- `src/renderer/components/terminal/SplitLayout.tsx` (Phase 7c) —
  each pane has its own resize observer

**Fix ideas:**
- Increase debounce from 50ms to ~150ms — makes the loop converge
  faster but doesn't fix the root cause
- Detect "no-change-in-cols-or-rows" before calling
  `electronAPI.terminal.resize()` and skip — prevents the IPC
  echo from re-triggering
- Compare current xterm cols/rows against the proposed fit result;
  only commit if different — same idea, different layer
- Set a minimum window-content-width on the BrowserWindow so the
  terminal can't be squeezed below xterm's `MINIMUM_COLS` (usually 20)
- Move the right panel to overlay-mode (absolute-positioned) when
  the window is narrow, instead of letting it eat from terminal
  width — fundamentally avoids the squeeze

**Reproduction steps:**
1. Open the app
2. Click any sidebar panel (e.g. Resources)
3. Drag the window's right edge inward to shrink it
4. As the terminal area gets narrower than a certain threshold, the
   flash/loop starts

### Resource Monitor shows "Claude NaN%" / "NaN MB" (Linux)
**Reported**: 2026-05-23 (Linux dev verification)
**Severity**: Low (cosmetic; Linux is dev-only today — the shipped
Windows build may be unaffected, see below)

**Symptom:** In the Resource Monitor panel, the *Claude* memory readout
shows "Claude NaN%" and the "Claude Memory" card shows "NaN MB". Claude
CPU reads fine (0%+), and the System CPU/RAM gauges are correct — only
the per-process Claude *memory* is NaN. "Claude Processes: 1" is correct,
so the process IS being found; the value is just missing.

**Likely root cause:** In `src/main/resource-monitor.ts`, the per-process
RAM is summed as `claudeRam += proc.mem_rss`. On Linux,
`systeminformation`'s `si.processes().list[].mem_rss` comes back
`undefined` for the matched process, so `claudeRam` becomes
`0 + undefined = NaN`, which then propagates into both `ramPercent` and
`ramMB` in the emitted snapshot. CPU is unaffected because `proc.cpu` is
populated. On Windows the field is presumably populated, so the shipped
build likely looks correct — **needs confirmation on Windows.**

**Where to look:**
- `src/main/resource-monitor.ts:73` — `claudeRam += proc.mem_rss`
- `src/main/resource-monitor.ts:100-101` — `ramPercent` / `ramMB` derive
  from `claudeRam`, so a single NaN poisons both
- `getProcessTree()` (same file) — its element type declares
  `mem_rss: number`, but the runtime value can be `undefined` on Linux

**Fix ideas:**
- Coalesce at the source: `claudeRam += proc.mem_rss || 0` (and similarly
  guard `proc.cpu`). Cheapest fix; kills the NaN regardless of platform.
- Guard the snapshot: if `claudeRam` isn't finite, surface `0` / "—"
  rather than letting `NaN` reach the UI.
- **Verify the units while you're in there.** `ramMB` divides by
  `1024 * 1024` (assumes bytes), but `systeminformation` documents
  `mem_rss` in KB on some platforms/versions — if so the MB figure is off
  by ~1024× even once it's no longer NaN. Confirm per-platform before
  trusting the number.

**Reproduction steps:**
1. Run the app on Linux (`electron-forge start`)
2. Let a Claude pane spawn, then open the Resources panel
3. Claude memory row shows "NaN%"; "Claude Memory" card shows "NaN MB"

---

## How to use this file

When you come back to one of these:
1. Read the section
2. If you decide to do it, move the section out to a real plan / PR
3. If you change your mind, leave a note here explaining why
4. New ideas: append a new top-level section. Keep entries short —
   one or two paragraphs of "why" + a list of relevant existing files
   is usually all that's needed to remember context later
