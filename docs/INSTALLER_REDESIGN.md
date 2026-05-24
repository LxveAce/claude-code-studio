# Bootstrap Installer Redesign (v1.0 → v1.1)

> **Status:** Design locked 2026-05-23. Phase 1 of 9 complete on branch
> `feature/bootstrap-installer`. See
> [`journal/config/INSTALLER_REDESIGN.lmm.md`](../journal/config/INSTALLER_REDESIGN.lmm.md)
> for the full LMM walk-through.

## Problem

v1.0 ships as a Squirrel.Windows installer that **only installs the Electron
app** and assumes the user has already installed Node 18+ and run
`npm i -g @anthropic-ai/claude-code` themselves. Most users will never do
that — the current install is effectively a developer tool, not a consumer
one.

User goal: one Setup.exe that, when double-clicked, ends with a working app
icon — no manual prereqs, no terminal commands, no missing dependencies.

## Decisions

| Fork | Picked | Why |
|---|---|---|
| **Installer technology** | `electron-builder` + NSIS one-click | NSIS provides the real progress UI Squirrel intentionally lacks. `electron-builder`'s NSIS path is the most mature option. |
| **Online vs offline** | **Online** (~174 MB installer + ~50 MB pulled at install) | Saves 130 MB on the release artifact. App requires internet at runtime anyway. Offline is a one-config-flag pivot if Phase 4 testing shows online is fragile. |
| **Bundled vs system runtime** | **Bundled** in `runtime\` under install dir | Predictable Node version, no collisions with user's other Node installs, clean uninstall, isolated support story. |
| **Auth bootstrap** | First-launch in-app onboarding modal | `claude login` is browser-based OAuth — cannot be done from the installer, and asking pre-install is wrong UX. |
| **Migration of existing v1.0 installs** | One-time uninstall + reinstall (documented) | Squirrel → NSIS is a fundamental format change. Bridge updaters are not worth building for the current user base of one. |

## Migration sequencing

Each phase is its own commit on `feature/bootstrap-installer` with a red-team
review before commit. The forge pipeline stays in place through Phase 7 as an
escape hatch, removed only in Phase 8 after the builder pipeline is proven.

| # | Phase | Outcome |
|---|---|---|
| 1 | **Design lock-in** | This doc + LMM journal + plan red-team. *Current*. |
| 2 | **forge → builder migration** | Builder produces an NSIS Setup.exe with the CURRENT app (no bootstrap yet). Toolchain swap proven. |
| 3 | **Bundled-runtime path resolution** | `PtyManager` resolves `runtime\claude.cmd` first, falls back to PATH in dev. |
| 4 | **NSIS bootstrap script** (online) | Setup.exe downloads + verifies (SHA256) Node 22.22.3, extracts to `resources\runtime\`, installs `@anthropic-ai/claude-code` (latest seed) via bundled npm. Progress UI + rollback. **Offline variant deferred to Phase 4b** based on install-failure feedback. |
| 5 | **Branded splash + loader** | NSIS branding assets. Placeholders if no design supplied — flagged for user sign-off before release. |
| 6 | **First-launch CLI auth onboarding** | Modal detects missing credentials, offers one-click `claude login`. Persists onboarding-complete flag. |
| 7 | **Auto-updater migration** | `update-electron-app` → `electron-updater`. Verifies v1.1 → v1.1.1 upgrade works on NSIS install. |
| 8 | **README + docs update** | Install section, BACKLOG cleanup, CONTRIBUTING dev-vs-user-Node note, `MIGRATING_FROM_V1.md`. Forge config removed here. |
| 9 | **Integrated red-team + clean-VM test** | `SECURITY_REVIEW_BOOTSTRAP_INSTALLER.md`, end-to-end VM test, tag `v1.1.0-rc1`. |

## Build prerequisite: Windows Developer Mode

The full NSIS installer build (`npm run dist`) requires
**Windows Developer Mode enabled** on the build machine.

**Why:** electron-builder downloads `winCodeSign-2.6.0.7z` and extracts it
using a bundled 7za. The archive contains macOS code-signing helpers with
internal symlinks (`libcrypto.dylib`, `libssl.dylib`). On Windows, creating
symlinks requires either admin privileges or the
`SeCreateSymbolicLinkPrivilege` granted by Developer Mode. Without it, 7za
errors and builder bails before producing the installer.

**Enable once:** *Settings → Privacy & Security → For Developers → Developer
Mode → On.* No restart required. The `npm run dist:dir` build (unpacked
output for testing) works without this — only the full installer needs it.

This is documented further in `CONTRIBUTING.md` (Phase 8) and called out in
the Phase 2 security review.

## Versions pinned at design time

- **Node runtime:** 22.22.3 Windows x64 (`node-v22.22.3-win-x64.zip`) — latest 22.x LTS.
  SHA256 to be captured in Phase 4 from `https://nodejs.org/dist/v22.22.3/SHASUMS256.txt`.
- **Claude Code CLI:** `@anthropic-ai/claude-code@2.1.150` (latest at design time).
  `bin.claude = cli.js`, `engines.node >= 18.0.0`.
- **electron-builder:** latest stable at Phase 2 (currently ~24.x line).

## Definition of done for v1.1

- One Setup.exe at ~180 MB on GitHub Releases.
- Fresh Windows install path: double-click Setup.exe → branded progress UI →
  app launches → embedded terminal has `claude` ready (no PATH setup) →
  first-launch modal walks user through `claude login`.
- Auto-updater can deliver a hypothetical v1.1.1 from this same NSIS install.
- `npm run dev` still works for development.
- README install section accurate.

## Out of scope for v1.1

Deferred to `docs/BACKLOG.md`:

- macOS + Linux installers (existing BACKLOG #2).
- Backend database (existing BACKLOG #1).
- Code-signing for Windows installer — SmartScreen warning will still appear
  on first install. Documented in `SECURITY_REVIEW_BOOTSTRAP_INSTALLER.md`.
- Bridge v1.0.1 Squirrel release to notify users of the v1.1 reinstall path.

## Plan adjustments from Phase 1 red-team

See [`security-reviews/SECURITY_REVIEW_BOOTSTRAP_INSTALLER_PHASE1_PLAN.md`](./security-reviews/SECURITY_REVIEW_BOOTSTRAP_INSTALLER_PHASE1_PLAN.md)
for the full review. Material adjustments folded back into the phase plan:

- **Phase 4 ships both an online (~180 MB) AND offline (~310 MB) installer
  variant from day one** (H1) — offline is not a future pivot. NSIS bootstrap
  detects online-install failure and surfaces a clear "download the offline
  installer" modal with a direct URL.
- **Phase 4 NSIS script:** writes install log to `%TEMP%\ccs-install.log`
  (M4); pins npm registry explicitly to `https://registry.npmjs.org/`
  ignoring user's `.npmrc` (M5); verifies bundled Node works on a clean
  Windows install without VC++ Redistributable (M2).
- **The bundled Claude Code CLI is a seed, not a floor (H3).** The CLI is
  expected to self-update on first launch; bundled version is the on-disk
  starting point only. Studio's auto-updater does NOT manage the CLI
  version; users see "Update CLI" controls in the first-launch onboarding.
- **Phase 6 auth detection uses `claude doctor` output, not file
  existence (M1).** Delegates source of truth to Claude Code's own
  diagnostic instead of guessing at the credentials file path.
- **Phase 2 separates output directories:** electron-builder → `dist/`,
  electron-forge → `out/` (M3). Both pipelines coexist without artifact
  collision until forge is removed in Phase 8.
- **Phase 7 acceptance preserves the three updater gates** (rate-limit,
  dev-mode, user-disable) from Phase 7b's existing
  `updater-service.ts` (L1).
- **Phase 8's `MIGRATING_FROM_V1.md` explicitly tells v1.0 users to
  uninstall via Programs & Features first** (L2) — NSIS installer installs
  to `Program Files`, Squirrel installed to `%LocalAppData%`, so a fresh
  install leaves both side by side without manual cleanup.
- **Phase 9 release notes + README include SmartScreen UX documentation**
  (H2) — screenshot of the warning + literal "click More info → Run anyway"
  steps. Code-signing tagged for v1.2.
- **Phases 3 and 5 may execute in parallel with Phase 4** (L3) — only
  Phase 2 must complete first. Phase ordering in the table is a default;
  parallel execution is permitted once Phase 2 is committed.

## Tracking

Tasks #39–#47 in the session task list, one per phase. Per the red-team,
phases 3 and 5 do not block on each other or on phase 4; they only block on
phase 2 being committed.
