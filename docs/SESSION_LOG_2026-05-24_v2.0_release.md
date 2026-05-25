# Session log — 2026-05-24 → 2026-05-25 — v2.0 release push

**Read this first when picking up the project tomorrow.** It captures the
full state of the v2.0 release effort: what was done, what's pending,
where exactly we left off, and the next action.

---

## TL;DR

- **Branch:** `master` at commit `f626b45` — all v2.0 multi-OS work merged.
- **Tag:** `v2.0.0` pushed (most recently force-retagged after each fix).
- **Release workflow:** running on the latest force-retag —
  https://github.com/LxveAce/claude-code-studio/actions
- **Last known issue:** Windows installer hits *"Couldn't download the
  Node.js runtime"* on the user's real machine. Fixed in `f626b45` by
  rewriting NSIS bootstrap to use `curl.exe + tar.exe + certutil` instead
  of PowerShell. **Test the rebuilt Windows .exe when the workflow
  finishes — that's the one bit of validation still needed.**
- **Open: code-signing decision.** SmartScreen "Unknown Publisher" warning
  will still appear until you buy a cert (~$300/yr EV for instant trust,
  or ~$70-200/yr OV with reputation period). Not blocking the release,
  but a known UX wart.

---

## Where to look first tomorrow

1. **Open this file** — `docs/SESSION_LOG_2026-05-24_v2.0_release.md`.
2. **Check release workflow status:**
   https://github.com/LxveAce/claude-code-studio/actions
   - Look for the latest "Release" workflow run. Should be green with
     3 jobs: `Build + upload (windows-latest|macos-latest|ubuntu-latest)`.
3. **Check the v2.0.0 draft release:**
   https://github.com/LxveAce/claude-code-studio/releases
   - Should have exactly 5 installer files + 2 auto-added source files.
4. **Try installing the Windows .exe** on your own machine. If it works
   end-to-end, you're done — promote the draft to published.
5. **Per-platform validation matrix** in
   `docs/RELEASE_NOTES_v2.0.0.md` "Maintainer verification" section.

---

## What got built tonight (v2.0 multi-OS release effort)

### Source-code changes — all merged to master

| File | What |
|---|---|
| `src/main/runtime-paths.ts` | (new) Centralizes per-OS bundled-runtime location. Win = `resources/runtime/`, Mac/Linux = `<userData>/runtime/`. Both `PtyManager` and `CliService` import `findBundledRuntime()` / `targetRuntimePaths()` from here. Single source of truth for paths going forward — any new file that touches the runtime location uses this module. |
| `src/main/pty-manager.ts` | Cross-platform `findClaudePath()` via `runtime-paths`. |
| `src/main/cli-service.ts` | Cross-platform `findClaudePath()` + new `bootstrapNodeRuntime()` for macOS/Linux first-launch Node download/verify/extract (curl + tar from inside the app). `install()` sets env.PATH to include bundled bin dir so npm lifecycle scripts find the right `node`. |
| `src/main/updater-service.ts` | Platform gate widened from `win32` only to `['win32','darwin','linux']`. Otherwise auto-update would have been completely dead on Mac/Linux. |
| `scripts/patch-node-pty.js` | Early-exit on non-Windows (winpty patches only apply to the Windows backend). |
| `electron-builder.yml` | Mac + Linux targets added. mac is arm64-only (Apple Silicon native; Intel runs via Rosetta). dmg + zip dropped to just dmg (we don't use the Mac auto-update zip for v2.0). Per-distro Linux artifactName: `Linux-Universal.AppImage` / `Linux-Debian.deb` / `Linux-Fedora.rpm`. Windows artifactName: `Claude-Code-Studio-${version}-Windows.exe`. `nsis.differentialPackage: false` (drops .exe.blockmap — not needed for v2.0 since there's no install base to delta against). |
| `build/installer.nsh` | **Rewritten to use Windows-builtin tools only — no PowerShell.** Download = `curl.exe`, SHA256 = `certutil + findstr`, extract = `tar.exe`, flatten = `cmd xcopy + rmdir`. Every failure modal now embeds the actual captured stderr + exit code from the failing tool so users can self-diagnose. |
| `.github/workflows/ci.yml` | Matrix-builds all 3 OSes on every push to master/feature branches. On failure, pushes the build log to a `ci-logs` branch (publicly readable via raw.githubusercontent.com) — without this we'd never have found the real CI failures since the GH Actions log API is auth-walled. |
| `.github/workflows/release.yml` | Tag-driven publish. Builds via `npm run dist:<os>` (no `--publish`), then uses `gh release create --draft` + `gh release upload --clobber` to add ONLY the user-facing installers. Auto-update manifests (`latest*.yml`), blockmaps, and Mac .zip are deliberately NOT uploaded — that's why the v2.0.0 draft is clean (5 installers + 2 source). |
| `README.md` | Lead paragraph rewritten with "one installer, zero prereqs" pitch. Quick install section with the three asset filenames per OS. Per-platform install instructions with SmartScreen/Gatekeeper workarounds. Build pipeline section with the new `dist:mac` / `dist:linux` scripts. |
| `CONTRIBUTING.md` | "Platform parity (v2.0+)" convention codified. Linux build host needs `rpm + libfuse2`. |
| `docs/RELEASE_NOTES_v2.0.0.md` | Final user-facing release notes. Leads with a "⬇️ Download" table that says ONE file per OS, ignore the rest. Per-platform first-install warnings. Migration from v1.0 note. Maintainer V1-V4 verification checklist. This file gets pre-populated into the GitHub release draft by the workflow. |
| `docs/security-reviews/SECURITY_REVIEW_V2_MULTI_OS.md` | Cross-feature red-team for the v2.0 work. 0 Crit / 3 High / 5 Med / 3 Low. All Highs accepted with documented mitigations (code-signing deferred, untested-on-real-mac-linux, online-only install). |
| `docs/security-reviews/SECURITY_REVIEW_V2_REDTEAM_PASS.md` | Second-pass red-team that found the critical IH5 bug — updater platform gate was Windows-only, would have killed auto-update for 2/3 of v2.0's user base. Fixed. |
| `package.json` | Version `2.0.0`. New scripts: `dist:mac`, `dist:linux`, `dist:all`, `dist:publish:mac`, `dist:publish:linux`. Added `electron-updater@6.8.3` as dependency. |
| StatusBar.tsx + SettingsPanel.tsx About | App version label = `2.0.0`. |

### Bugs found + fixed this session (in order of discovery)

1. **`npm install` lifecycle scripts had stale PATH** — `CliService.install()` spawned npm without env, so subprocess `node` calls would find system Node (or fail). Fixed: prepend bundled bin dir to PATH.
2. **Bogus Linux MIME type** in electron-builder.yml claimed an x-scheme-handler we don't register. Removed.
3. **MIGRATING_FROM_V1.md frozen at v1.1** — rewrote for v2.0 throughout, added per-platform onboarding-reset paths.
4. **CI Linux missing rpm + libfuse2** — added apt install step.
5. **🔴 CRITICAL: Updater dead on Mac + Linux** — Phase 7 (v1.1) left a `win32`-only platform gate. v2.0 multi-OS pivot didn't touch it → 2/3 of users would never see updates. Fixed: positive-list `[win32, darwin, linux]`.
6. **CI installer build red for unknown reason** — couldn't see logs (API auth-walled, HTML page JS-rendered). Worked around by pushing failure logs to a `ci-logs` branch. Two real bugs surfaced:
   - **`--publish never` missing** from `dist:<os>` scripts — electron-builder tried to upload to GitHub without `GH_TOKEN` → exit 1. The build itself was succeeding the whole time.
   - **NSIS `$_` variable** in PowerShell catch blocks — NSIS parsed as unknown var, `-WX` made warning fatal. Escaped to `$$_`.
7. **Release draft had 20 files** — user wanted clean per-OS list. Restructured release.yml to build without publishing, then `gh release upload` only the user-facing globs. Asset names now `Claude-Code-Studio-{version}-{OS}.{ext}` with Linux split into Universal/Debian/Fedora.
8. **Windows installer failed at runtime** — *"Couldn't download the Node.js runtime"* despite working internet. Suspect: Windows Defender blocking PowerShell from making HTTPS calls during an unsigned installer's execution. **Fixed: rewrote NSIS to use curl.exe + tar.exe + certutil — no PowerShell anywhere.** Plus modal now embeds actual stderr.

### Final commit chain on master (most recent first)

```
f626b45  fix(nsis): simplify SHA256 check — was using bash-style quote escapes
607a29d  fix(nsis): rewrite bootstrap to use curl/tar/certutil — no PowerShell
afdfa71  release.yml: rewrite to use gh release upload (surgical asset list)
adb4891  release: surgical asset list — one installer per OS + per-distro Linux
39c0b66  release: reduce file count + clear "what to download" notes
63a53f7  docs: fix last stale Quick install asset name
a610764  docs: update README install names to match Claude-Code-Studio-{OS}.{ext}
59f1279  release: simplify asset names → Claude-Code-Studio-{Windows|Mac|Linux}.{ext}
e40c8a0  chore: bump 2.0.0-dev.1 → 2.0.0 + lead README with one-click pitch
8558fb4  Merge pull request #10 from LxveAce/feature/macos-support
26bd615  Merge pull request #9 from LxveAce/feature/bootstrap-installer
```

---

## What's left to do (in priority order)

### 1. Validate Windows installer (high priority)

Latest release workflow build is on commit `f626b45` with the curl-based
bootstrap. Once the workflow finishes:

1. Download `Claude-Code-Studio-2.0.0-Windows.exe` from
   https://github.com/LxveAce/claude-code-studio/releases (look for the
   v2.0.0 draft).
2. Run it.
3. If it succeeds → confirm app launches, sign in to Claude via the
   onboarding modal, terminal works.
4. If it fails → the modal will show the actual curl/tar/certutil error
   (exit code + stderr). Screenshot the modal and we'll fix the specific
   issue.

### 2. Validate Mac + Linux installers (medium priority)

The build artifacts are in the same draft. If you have access to Mac or
Linux hardware:
- Mac: drag DMG to /Applications, right-click → Open (Gatekeeper).
- Linux: `chmod +x` the AppImage and run it.

The macOS/Linux first-launch flow downloads Node + Claude CLI in-app via
`CliService.bootstrapNodeRuntime()` (also rewritten to use OS `tar`).

### 3. Promote draft → published

After Step 1 (Windows test) passes:
1. Open the v2.0.0 draft on GitHub Releases.
2. Body is pre-populated from `docs/RELEASE_NOTES_v2.0.0.md`.
3. Uncheck "pre-release" if checked.
4. Click **Publish release**.

### 4. Code-signing (separate decision — not blocking release)

The "Unknown Publisher" + SmartScreen warning will continue to appear
on Windows until you buy a code-signing cert. Three real options:

- **EV cert (~$300-500/yr)** — instant SmartScreen trust, no reputation
  period. Best for non-technical users.
- **OV cert (~$70-200/yr)** — removes "Unknown Publisher" but
  SmartScreen still warns until reputation builds (weeks/months).
- **No cert** — keep the README's "click More info → Run anyway"
  instructions. Free, but scares off some users.

If you go with a cert, the integration point is electron-builder's
`CSC_LINK` + `CSC_KEY_PASSWORD` env vars. Wire them as GitHub Actions
secrets and reference in `.github/workflows/release.yml`.

---

## Outstanding minor items (tracked, not urgent)

- **macOS Intel native build** — currently arm64-only; Intel Macs run
  arm64 via Rosetta. Tracked for v2.1.
- **Code-signing for Windows + notarization for macOS** — see above.
- **Linux beta channel + AppImage auto-update** — disabled in v2.0
  because we're not publishing `latest*.yml`. Can be re-enabled in
  v2.1 either by publishing those files or by setting up a separate
  update channel (e.g. GitHub Pages hosting just the manifests).
- **Phase 5 branding assets** — installer icons, sidebar BMP. NSIS
  defaults look fine; ship real branding when ready.

---

## Key file locations

```
docs/SESSION_LOG_2026-05-24_v2.0_release.md  # this file
docs/RELEASE_NOTES_v2.0.0.md                 # user-facing release notes
docs/INSTALLER_REDESIGN.md                   # design doc for the bootstrap installer
docs/MIGRATING_FROM_V1.md                    # v1.0 → v2.0 upgrade guide
docs/security-reviews/                       # 13 per-phase + integrated reviews
journal/config/INSTALLER_REDESIGN.lmm.md     # full LMM walk + Progress Log
build/installer.nsh                          # NSIS bootstrap macros (curl/tar/certutil)
electron-builder.yml                         # multi-OS build config
.github/workflows/ci.yml                     # matrix build on every push
.github/workflows/release.yml                # tag-driven release publishing
src/main/runtime-paths.ts                    # cross-platform bundled-runtime paths
src/main/cli-service.ts                      # CLI auth check + first-launch Node bootstrap
src/main/updater-service.ts                  # auto-updater wrapper
src/renderer/components/auth/CliAuthOnboarding.tsx  # first-launch modal
```

---

## Useful commands

```bash
# Check latest CI / Release workflow status
curl -sL "https://api.github.com/repos/LxveAce/claude-code-studio/actions/runs?per_page=3" | grep -E '"(name|head_sha|status|conclusion)":'

# Check what's on the v2.0.0 tag
curl -sL "https://api.github.com/repos/LxveAce/claude-code-studio/git/refs/tags/v2.0.0"

# Find the v2.0.0 release (returns "Not Found" if it's a draft — drafts need auth)
curl -sL "https://api.github.com/repos/LxveAce/claude-code-studio/releases/tags/v2.0.0"

# Local builds (Windows — needs Dev Mode toggle in Settings)
PATH="/c/Users/extra/nodejs-22:$PATH" /c/Users/extra/nodejs-22/node.exe scripts/build-vite.mjs
PATH="/c/Users/extra/nodejs-22:$PATH" /c/Users/extra/nodejs-22/node.exe node_modules/electron-builder/out/cli/cli.js --win

# Re-fire the release workflow without a code change (force-retag)
git tag -d v2.0.0 && git push origin :refs/tags/v2.0.0
git tag -a v2.0.0 -m "v2.0.0" && git push origin v2.0.0
```

---

## Pick-up-where-we-left-off — exact words

When you open Claude Code tomorrow, say something like:

> Read `docs/SESSION_LOG_2026-05-24_v2.0_release.md`. The Windows
> installer was just rebuilt with a curl-based bootstrap to replace
> the PowerShell one that was failing. Help me test it and finish
> publishing v2.0.0.

Or shorter:

> Continue the v2.0 release. Last action was force-retagging v2.0.0
> after fixing the NSIS bootstrap to use curl instead of PowerShell.
> Check if the new release workflow run produced a draft and what's
> in it.

The auto-memory entry at
`C:\Users\extra\.claude\projects\C--Users-extra--local-bin\memory\project_claude_code_studio.md`
will also remind any new Claude Code session about this file.
