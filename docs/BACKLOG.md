# Backlog (post-v1.0)

Loose notes on things spitballed but not implemented yet. Add to this
file as ideas come up; don't bother with formal design until something
is ready to actually pick up. Each entry: what / why-it-matters / where
to start.

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
