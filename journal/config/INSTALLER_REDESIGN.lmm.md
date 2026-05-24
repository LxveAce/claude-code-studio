# LMM — Bootstrap Installer Redesign

**Cycle id:** installer-redesign-2026-05-23
**Variant:** deep
**Scope:** One-click Windows installer that bootstraps Node + Claude Code CLI + Claude Code Studio in a single user-visible step, replacing the v1.0 Squirrel installer that assumed `claude.exe` was already on PATH.
**Author:** assistant (under user's reins-given autonomy)

---

## RAW

User wants a single Setup.exe that, when double-clicked, installs everything a user needs to run Claude Code Studio: a Node.js runtime, the `@anthropic-ai/claude-code` CLI, and the Studio Electron app itself. The install should show a "good looking download and loader" — i.e., real installer UI with progress, not Squirrel's intentionally-chromeless flash. End state: one application icon you click to open Studio, and the embedded terminal already has `claude` working out of the box with no manual prereqs.

Standing constraints that apply: red-team after each phase, LMM as thinking discipline, compact-controller in session (user-side concern, can't toggle from here but stays mindful). Operate autonomously per `--permission-mode bypassPermissions` and "i give you the reigns now". README must be updated to reflect the new install process.

v1.0 ships as `Claude.Code.Studio-1.0.0.Setup.exe` (174 MB Squirrel installer) and assumes the user has separately installed Node 18+ and run `npm i -g @anthropic-ai/claude-code` themselves. Most users will never do that; the current install is effectively a developer tool, not a consumer one.

## NODES

**N1 — Tooling migration is invasive but necessary.** Squirrel.Windows is intentionally chromeless (zero-UI install) by design. It cannot show the "good looking loader" the user asked for. NSIS (via `electron-builder`) is the standard path for Electron apps that need real installer UI. This forces a migration from `electron-forge` + `MakerSquirrel` to `electron-builder` + NSIS, plus a corresponding swap of `update-electron-app` → `electron-updater` for auto-update.

**N2 — Bundled runtime > system runtime.** Three sub-decisions collapse here: (a) Where does Node live post-install? Bundled in Studio's install dir under `runtime\`. (b) Where does `claude` live? Same — `runtime\node_modules\@anthropic-ai\claude-code\cli.js`. (c) How does Studio find it? `PtyManager` resolves bundled location first, falls back to PATH only in dev mode (`!app.isPackaged`). Reasoning: predictable version, no collisions with the user's other Node installs, clean uninstall removes everything, support is tractable ("which Node?" "ours") .

**N3 — Online vs offline installer.** Online: ~174 MB installer that downloads Node + CLI during install (~50 MB extra over the wire = 224 MB total transferred). Offline: ~300 MB installer with everything pre-staged. Picked online because the saved 130 MB on the release artifact matters more than the install-time network dependency (the app needs internet for normal operation anyway — talking to Anthropic's API). Escape hatch: if Phase 4 testing shows the online flow is fragile (npm registry timeouts, mirror outages), pivot to offline by pre-staging Node + the `.tgz` for the pinned CLI version inside the installer payload.

**N4 — Auth cannot be installed.** `claude login` is a web-based OAuth that requires the user to interact with a browser, accept consent, and paste back a code. The installer cannot do this on the user's behalf; doing so would also be the wrong UX (asking for login during install before the user has even seen the app). Conclusion: first-launch in-app onboarding modal that detects missing credentials and offers a one-click "Sign in to Claude" button which runs `claude login` in the embedded terminal.

**N5 — Squirrel → NSIS is a one-time migration cliff for existing v1.0 users.** Squirrel installs cannot be auto-updated to NSIS installs; the formats and install-root assumptions are incompatible. Existing v1.0 users must uninstall the Squirrel version, then run the new NSIS Setup.exe once. After that, all future updates flow through `electron-updater` cleanly. Mitigation: document the cliff prominently in README + release notes for v1.1, and ideally ship a final v1.0.1 Squirrel release that pops a one-time notification telling the user about the v1.1 reinstall path. (Deferred to Phase 7 — may not be worth the effort given the tiny v1.0 user base.)

**N6 — `pty-manager.ts` is the only application-code file that needs to know about the new layout.** Everything else (renderer, IPC, services) stays identical. This is reassuring: the distribution layer is what changes, not the product. Risk: regression in dev workflow where `claude` is on PATH but the bundled location is empty. Fix: dev mode must always fall back to PATH; only packaged builds insist on bundled.

**N7 — NSIS bootstrap script has real failure modes.** Network drop mid-download, npm registry returning 503, disk full during extraction, antivirus quarantining a downloaded file, corporate proxy blocking the registry, hash mismatch on Node download. Each needs a defined behavior: clear error to user, rollback of partial install, no orphaned `runtime\` folder. Pin SHA256 of Node 22.12.0 Windows x64 zip; verify after download.

**N8 — Regression risk to the working v1.0 pipeline.** v1.0 currently builds and ships fine via `npm run make`. The migration must not break that until the new path is proven. Approach: work on branch, keep both `forge.config.ts` AND new `electron-builder.yml` coexisting through phases 2-7, only delete forge configuration in Phase 8 after the builder path is end-to-end validated. Add `:forge` script aliases as an escape hatch ("if builder breaks for an emergency hotfix, fall back to forge").

**N9 — Compact controller hooks.** User mentioned compact controller in the discipline list. Looking at the project itself, it implements compact-controller integration (`src/main/compact-controller.ts`). The compact controller is the user's separate repo that installs hooks into `~/.claude/settings.json` to auto-compact long sessions. Whether it's enabled in MY current Claude Code session is a user-side toggle I can't change from here, but I should structure work in commit-sized chunks so any mid-session compaction doesn't lose state. Each phase ends with a commit; tasks track progress; design doc on disk is the persistent state.

## REFLECT

**Core insight.** This is fundamentally a *distribution* improvement, not a *product* improvement. The app itself stays nearly identical (only `PtyManager` changes); what changes is the path from "user downloads file" to "user has a working app". That framing tells us where the work belongs (build + installer layer, not application code) and what NOT to touch (services, IPC contracts, renderer features). The corollary: most regression risk is in the build pipeline, not in the running app — so the test loop is "build → install fresh → does Studio open and does the terminal spawn `claude`?"

**Challenged assumption — "bundled runtime is heavy."** Disk footprint goes from ~250 MB (current install) to ~380 MB (with Node + CLI). That's significant but well below the threshold where users notice (Discord is ~600 MB, VS Code with extensions is ~1 GB). The disk cost buys: clean uninstall, predictable version, isolation from user's other Node installs, zero "but it works on my machine" debugging. Net positive.

**Challenged assumption — "online is fine because the app needs internet anyway."** True for normal operation, but **not** true for install. Users sometimes install on a fresh machine, in a hotel, behind a flaky network. An offline-capable installer is a meaningfully better fallback. Decision: ship online as v1.1, design Phase 4 so offline is a one-config-flag flip if user-feedback demands it.

**Tension resolution — NSIS migration cliff.** The forced reinstall is a one-time tax we eat now while the user base is one person (the user themselves). Documenting it clearly in v1.1 release notes is sufficient mitigation. Building a Squirrel→NSIS bridge updater is technically possible but is engineering effort better spent elsewhere. **Decision: accept the cliff, document it, move on.**

**Tension resolution — full forge removal vs coexistence.** Keep forge config in place through phases 2-7 as escape hatch. Only delete in Phase 8 once builder is end-to-end validated AND we've shipped at least one builder-produced installer successfully. The cost of carrying both for ~1 week of work is two extra files; the benefit is zero downtime on the build pipeline.

**Risk I'm under-estimating.** NSIS custom scripts are a different language (NSIS macro syntax) and a different debugging environment than the TypeScript I've been writing. The first iteration of Phase 4 will likely have multiple silent failures that need iterative testing on a real Windows box. Budget more time than feels reasonable for Phase 4; do not commit until a real fresh-install test has succeeded.

**Risk I'm correctly estimating.** Path resolution change in `PtyManager` (Phase 3) is small and self-contained. Updater migration (Phase 7) is well-documented in `electron-updater` and is mostly drop-in. README changes (Phase 8) are mechanical. These will take less time than the budget suggests.

## SYNTHESIZE

**Branch:** `feature/bootstrap-installer` (created).

**Phase order, with red-team gates between each:**

1. **Design lock-in** (this doc + design summary + plan red-team) — *current phase*.
2. **electron-forge → electron-builder migration** with the current app payload (no bootstrap yet). Produces a builder-built NSIS installer that installs the same app the Squirrel installer does today. Proves the toolchain swap before piling more changes on.
3. **Bundled-runtime path resolution** in `pty-manager.ts`. Small isolated change. Dev still uses PATH; packaged uses bundled with PATH fallback if bundled is missing (graceful degradation, surfaces clear error).
4. **NSIS bootstrap script** — download Node 22.22.3 zip (SHA256-pinned, latest 22.x LTS), extract to `runtime\`, install `@anthropic-ai/claude-code@2.1.150` (pinned) via bundled npm, with progress UI throughout. Rollback on any failure. This is the highest-unknown phase; budget accordingly.
5. **Branded splash + loader** — NSIS branding assets (sidebar BMP, header BMP, installer icon, success page text). Generate placeholders if no design provided; flag in design doc as needing user sign-off before final v1.1 release.
6. **First-launch CLI auth onboarding** — IPC method to detect credentials, modal component, integration with embedded terminal, one-time-shown logic.
7. **Auto-updater migration** — `update-electron-app` → `electron-updater`. Verify upgrade path; document Squirrel→NSIS cliff.
8. **README + docs update** — README install section, BACKLOG cleanup of items now done, CONTRIBUTING dev-vs-user-Node distinction, new MIGRATING_FROM_V1.md note.
9. **Integrated red-team + clean-VM test** — full `SECURITY_REVIEW_BOOTSTRAP_INSTALLER.md`, end-to-end test on clean VM if available (else document VM test as pending), tag `v1.1.0-rc1` if green.

**Commit cadence:** one commit per phase (after that phase's red-team passes). No squashing. Each commit message names the phase.

**Definition of done for v1.1:**
- One Setup.exe at ~180 MB on GitHub Releases.
- Fresh Windows install: double-click Setup.exe → branded progress UI → app launches → terminal opens with `claude` ready (no PATH setup) → first-launch modal walks user through `claude login`.
- Auto-updater can deliver a hypothetical v1.1.1 from this same NSIS install (verified by `npm run dist -- --publish always` to a draft release + clicking "Check for updates" in the running app).
- `npm run dev` still works for development.
- README install section accurate.

**Out of scope for v1.1 (defer to BACKLOG):**
- macOS + Linux installers (existing BACKLOG #2).
- Backend database (existing BACKLOG #1).
- Code-signing for Windows installer (SmartScreen warning will still appear; documented).
- Bridge v1.0.1 release to notify Squirrel users about v1.1 reinstall path.

Related: [[project-claude-code-studio]], [[feedback-lmm-workflow]].

---

## Progress Log

This section is appended to as each phase completes — single source of truth
for "where are we" in case the conversation is interrupted or compacted.
Read from the bottom up to find the latest state.

### 2026-05-23 — Phase 1 (Design lock-in) — COMPLETE

**Artifacts produced:**
- `docs/INSTALLER_REDESIGN.md` (design doc, decisions + phase table)
- `journal/config/INSTALLER_REDESIGN.lmm.md` (this file)
- `docs/security-reviews/SECURITY_REVIEW_BOOTSTRAP_INSTALLER_PHASE1_PLAN.md`
  (plan red-team: 0 Crit / 3 High / 5 Med / 3 Low)

**Plan adjustments from red-team** (folded back into design doc):
1. Phase 4 ships online + offline installer variants from day one (H1).
2. Phase 4 NSIS writes log to `%TEMP%\ccs-install.log` (M4).
3. Phase 4 NSIS pins npm registry explicitly (M5).
4. Phase 4 must verify Node-on-clean-VM works without VC++ (M2).
5. Bundled CLI is a seed not a floor; CLI self-updates (H3).
6. Phase 6 detection uses `claude doctor` output not file existence (M1).
7. Phase 2 separates output dirs: builder → `dist/`, forge → `out/` (M3).
8. Phase 7 preserves three updater gates from Phase 7b (L1).
9. Phase 8 `MIGRATING_FROM_V1.md` documents Squirrel uninstall step (L2).
10. Phase 9 documents SmartScreen UX warning + steps (H2).
11. Phases 3 and 5 may parallelize with Phase 4 (L3).

**Facts verified:**
- npm package: `@anthropic-ai/claude-code` v2.1.150, bin `claude`, engines
  Node >= 18.
- Latest Node 22.x LTS: 22.22.3 (was originally going to pin 22.12.0 — bumped
  to 22.22.3 for current LTS security patches).
- Claude Code creds: `$env:USERPROFILE\.claude` and
  `$env:USERPROFILE\.claude.json` on Windows.
- Diagnostic: `claude doctor` is the supported authoritative check.

**Branch:** `feature/bootstrap-installer` (created clean off master `d1e2b0d`).

**Next phase:** Phase 2 (electron-forge → electron-builder migration). The
acceptance criteria from the red-team are encoded in the design doc — Phase 2
just needs the dist/ vs out/ separation; everything else lives in later
phases.

**Commit:** `674ff51` Phase 1 (design lock-in): bootstrap installer redesign for v1.1.

### 2026-05-23 — Phase 2 (forge→builder migration) — IN PROGRESS

**Architectural pivot discovered mid-phase** (worth recording before Phase 2 commit):

Original Phase 2 plan was a full migration from `@electron-forge/plugin-vite`
to either `electron-vite` or builder-native Vite plumbing. On reading
`src/main/index.ts` lines 200-204 I found bare references to
`MAIN_WINDOW_VITE_DEV_SERVER_URL` and `MAIN_WINDOW_VITE_NAME` outside any
try/catch — these are injected by forge-plugin-vite's `define` mechanism at
build time. A full migration would have to replace that injection,
modify the index.ts to use `process.env.VITE_DEV_SERVER_URL` instead, and
re-test the dev workflow.

**Pivot:** **Hybrid pipeline.** Forge stays as the dev driver (`npm start`
unchanged — keeps the HMR Vite dev server and the globals injection that
makes it work). Electron-builder takes over **only the installer creation**.
The bridge is `scripts/build-vite.mjs`, a standalone Vite runner that
mimics forge-plugin-vite's prod-mode behavior:

- Builds main → `.vite/build/index.js`
- Builds preload → `.vite/build/preload.js`
- Builds renderer → `.vite/renderer/main_window/index.html` + assets
- Injects `define`:
  - `MAIN_WINDOW_VITE_DEV_SERVER_URL = undefined`
  - `MAIN_WINDOW_VITE_NAME = "main_window"`

This is smaller-blast-radius than a full migration. Forge tooling stays
intact as the escape hatch for emergency hotfixes during the v1.1 transition.
In Phase 8 we evaluate whether to also rip out forge entirely (probably yes,
once builder is proven for v1.1, v1.1.1, and v1.2).

**Files added this phase:**
- `electron-builder.yml` (builder config, dist/ output, NSIS oneClick, asarUnpack for node-pty)
- `scripts/build-vite.mjs` (standalone Vite runner with the defines)
- `package.json` scripts: `vite:build`, `dist:dir`, `dist`, `dist:publish`

**Smoke test:** `vite:build` complete in 0.4s, 3 bundles emitted matching the
forge-produced layout. `electron-builder --win --dir` running in background;
verification of `dist/win-unpacked/Claude Code Studio.exe` launch pending.

**Next sub-steps before Phase 2 commit:**
1. Confirm `dist/win-unpacked/` produced.
2. Smoke-launch the unpacked exe (kill after few seconds).
3. Phase 2 red-team review.
4. Commit.

**Commit:** pending Phase 2 completion.

### 2026-05-23 — Phase 2 (forge→builder migration) — COMPLETE (with env caveat)

**What landed:**
- `electron-builder.yml` — NSIS one-click config, `dist/` output, `asarUnpack`
  for node-pty, GitHub publisher pointed at LxveAce/claude-code-studio.
- `scripts/build-vite.mjs` — standalone Vite runner that mimics
  forge-plugin-vite's prod injection: builds main → `.vite/build/index.js`,
  preload → `.vite/build/preload.js`, renderer →
  `.vite/renderer/main_window/`, with `MAIN_WINDOW_VITE_*` defines so the
  bundled main doesn't ReferenceError on production load.
- `package.json` scripts: `vite:build`, `dist:dir`, `dist`, `dist:publish`.
- `electron-builder@26.8.1` added to devDeps.

**Verified:**
- `npm run dist:dir` produces working `dist/win-unpacked/` (217 MB exe +
  19 MB asar). node-pty unpacked to `app.asar.unpacked/` with all DLLs.
  Vite defines substituted correctly — `main_window` literal present,
  dev branch dead-code-eliminated.
- Bundled package.json strips `scripts` + `devDependencies`. No postinstall
  ship risk.
- Forge dev workflow (`npm start`) untouched; both pipelines coexist.

**Discovered constraint (documented, not blocking):**
- `npm run dist` (full NSIS installer) needs **Windows Developer Mode**
  enabled. electron-builder downloads winCodeSign helpers including macOS
  dylib symlinks that 7za can't extract without `SeCreateSymbolicLinkPrivilege`.
  Workarounds tested (pre-extract cache, `-xr!darwin`) — all defeated by
  builder's random-tmpdir-per-run cache logic. The real fix is the Settings
  toggle. Documented in `docs/INSTALLER_REDESIGN.md` "Build prerequisite"
  section + the Phase 2 red-team H1 finding. Phase 8 will add it to
  `CONTRIBUTING.md`.

**Architectural decision recorded:**
- Hybrid pipeline confirmed sound. Forge stays through Phase 7 as escape
  hatch; Phase 8 evaluates full removal.

**Red-team:** `docs/security-reviews/SECURITY_REVIEW_BOOTSTRAP_INSTALLER_PHASE2_BUILDER.md`
— 0 Crit / 1 High (env, not code) / 5 Med (all verified, no fix needed) /
3 Low. Plan adjustment: CONTRIBUTING.md documents Dev Mode in Phase 8.

**Next phase:** Phase 3 (bundled-runtime path resolution in pty-manager.ts).
Independent of full NSIS build, so the Dev Mode constraint doesn't block it.

**Commit:** to follow this entry.

