# Red-Team Pass — Everything Done This Session

**Scope:** Self red-team of the entire `feature/macos-support` branch
(v2.0 multi-OS work) plus the v1.1 Windows bootstrap on
`feature/bootstrap-installer` that it's built on top of. Focus on real
bugs, not hypothetical risks already covered in per-phase reviews.
**Reviewer:** assistant (per the user's explicit "red-team everything
you did" request).
**Date:** 2026-05-24.

---

## Bugs found and fixed in the same commit

### B1 — npm install lifecycle scripts ran with stale PATH (HIGH)

**Where:** `CliService.install()` `spawn(nodeBin, args, { windowsHide: true })`.
**Bug:** No `env` passed → child inherited Electron's env, which has
PATH pointing at the user's system Node (or no Node at all). When npm
ran lifecycle scripts (preinstall/install/postinstall) for
`@anthropic-ai/claude-code` or its transitive deps, any subprocess
spawn of bare `node`, `npm`, or `node-gyp` would either pick the wrong
Node version (silent ABI mismatch, late crash) or fail outright with
`node: command not found`.
**Likelihood:** High in practice on a clean macOS/Linux machine that
doesn't have Node installed — which is exactly our v2.0 target user.
On Windows it was less likely because NSIS install dir already had
Node, but PATH still didn't prefer it.
**Fix:** Construct `childEnv` with the bundled bin dir prepended to
PATH (platform-aware: Windows uses `runtimeDir` directly, POSIX uses
`runtimeDir/bin`). Pass via `spawn(..., { env: childEnv })`.

### B2 — Bogus MIME type registration on Linux (MEDIUM)

**Where:** `electron-builder.yml` linux config.
**Bug:** I added `mimeTypes: [x-scheme-handler/claude-code-studio]`
without the app actually registering or handling that URL scheme.
Linux desktop entries with mime claims produce dead "Open with…" file-
manager menu entries that no-op on click. Confusing UX + filing
bug reports we can't action.
**Fix:** Removed the mimeTypes block. Comment in YAML notes "add back
if we ever wire a claude-code-studio:// protocol".

### B3 — MIGRATING_FROM_V1.md was frozen at v1.1 (MEDIUM)

**Where:** `docs/MIGRATING_FROM_V1.md`.
**Bug:** Wrote the migration doc against v1.1 originally; after the
v2.0 pivot I bumped package.json + UI version labels but forgot to
update this doc. Users following the doc would download
`Claude.Code.Studio-1.1.0-Setup.exe` (which doesn't exist) and look
for v1.1 features.
**Fix:** Renamed mentions throughout (v1.1 → v2.0), updated the
download URL example, refreshed the failure-modal table to reference
the Phase 6 onboarding flow that exists, added per-platform reset
instructions for the `cli-onboarding.json` flag (was Windows-only;
now covers macOS + Linux paths too). Added a "macOS and Linux users:
v1.0 was Windows-only, no migration needed" callout.

### B4 — CI Linux job missing `rpm` + `libfuse2` build deps (MEDIUM)

**Where:** `.github/workflows/ci.yml` ubuntu-latest matrix entry.
**Bug:** `electron-builder --linux` produces AppImage + deb + rpm.
ubuntu-latest has `dpkg-deb` (deb) but **not** `rpm`. AppImage
runtime needs `libfuse2`, present on GHA but worth pinning. Without
these, the Linux build would fail at the rpm step (deb + AppImage
might succeed).
**Fix:** Added a "Install Linux build deps" step gated to
`ubuntu-latest` that `apt install -y rpm libfuse2`. Documented in
CONTRIBUTING.md "Linux build host" section.

## Bugs NOT found (audit passes)

### Node SHA256 hashes consistent across NSIS + in-app paths

**Windows (NSIS)** Node SHA: `6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33`.
**macOS x64**: `45830ba752fa0d892c6dcd640946669801293cac820a33591ded40ac075198ec`.
**macOS arm64**: `0da7ff74ef8611328c8212f17943368713a2ad953fb7d89a8c8a0eae87c23207`.
**Linux x64**: `2e5d13569282d016861fae7c8f935e741693c269101a5bebcf761a5376d1f99f`.
All re-verified against `https://nodejs.org/dist/v22.22.3/SHASUMS256.txt`
during this red-team pass. All four match. No bump-induced mismatch.

### `extractTo()` archive type matches downloaded format per platform

`nodeDownloadFor('darwin', ...)` returns `archiveType: 'tar-gz'`,
which dispatches to `tar -xzf` — gzip tar, matches `.tar.gz` ext.
`nodeDownloadFor('linux', 'x64')` returns `'tar-xz'`, dispatches to
`tar -xJf` — xz tar, matches `.tar.xz` ext. macOS bsdtar 11+ supports
`-J`. No bug.

### Bundled `claude` binary type matches platform

POSIX: `bin/claude` is created by npm as a symlink to
`../lib/node_modules/@anthropic-ai/claude-code/cli.js`.
`fs.existsSync` on a symlink returns true if the target exists.
`PtyManager` then spawns the symlink which resolves to the cli.js
shebang `#!/usr/bin/env node`. Works because we prepended bundled
`bin/` to PATH (after B1 fix), so `env node` finds OUR bundled node.

### Concurrent install button clicks

Modal disables the "Install Claude CLI" button while `busy === true`.
Cannot double-click into two simultaneous npm installs. No bug.

### TOCTOU between findClaudePath and spawn

Documented as Phase 3 L1 / accepted. Same status here.

### `https.get` redirect limit

Bounded at 5 redirects in `downloadFileWithProgress()`. GitHub →
Fastly is 1 hop currently. Plenty of headroom; never infinite-loops.

### `cleanup()` double-resolve guard

`cleaned` boolean flag prevents Promise resolve/reject double-fire.
Verified by code reading: every entry path (error / finish / timeout)
calls `cleanup()` which is no-op after first call. No bug.

## Risks accepted (not bugs, already-documented decisions)

- Code-signing absent on all 3 platforms (v2.1 work).
- Untested on real macOS + Linux machines (CI matrix is the proxy;
  functional test pending).
- Online-only bootstrap (offline variant deferred per Phase 1 H1).
- Trust delegated to Anthropic npm + nodejs.org HTTPS.

## Summary

4 real bugs found, all fixed in the same commit cycle as this
review. 9 audit points came back clean. Branch is now in better
shape than when I declared it "feature-complete" 30 minutes ago —
which is exactly what red-teams are for.
