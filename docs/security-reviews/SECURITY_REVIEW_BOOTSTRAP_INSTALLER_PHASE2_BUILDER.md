# Security & Soundness Review — Bootstrap Installer, Phase 2 (builder migration)

**Phase reviewed:** `electron-forge` → `electron-builder` migration (hybrid:
forge stays for dev, builder takes over installer creation).
**Artifacts:** `electron-builder.yml`, `scripts/build-vite.mjs`, `package.json`
script additions, `dist/win-unpacked/` smoke build.
**Reviewer:** assistant (self-red-team per project convention).
**Date:** 2026-05-23.

---

## CRITICALS

None. The structural migration is correct: vite-built artifacts land in the
right asar paths, native module unpacking works, package.json scripts are
stripped from the shipped asar, and forge dev workflow is untouched.

## HIGHS

### H1 — Full NSIS installer build is blocked on Windows Developer Mode being enabled

**Where:** `npm run dist` (electron-builder full installer creation).
**Symptom:** `electron-builder` downloads `winCodeSign-2.6.0.7z`, calls
bundled `7za.exe` to extract it into a random tmpdir under
`%LocalAppData%\electron-builder\Cache\winCodeSign\`, and 7za errors out
trying to create symbolic links for the macOS `libcrypto.dylib` /
`libssl.dylib` files in the archive. Windows blocks symlink creation without
admin or Developer Mode.
**Risk:** Without Developer Mode, the full installer cannot be built on the
maintainer's machine. CI builds (GitHub Actions runners) generally have
admin, so this only blocks local builds.
**Why a High and not a Critical:** The `--dir` build (unpacked output) works
fine. The structural migration is verified. This is a one-time-per-machine
env setup, not a code defect.
**Fix:** Document in `CONTRIBUTING.md` (Phase 8) the one-time setup:
*Settings → Privacy & Security → For Developers → Developer Mode → On.*
That toggle grants `SeCreateSymbolicLinkPrivilege` to the user account and
the build works without admin. No code change needed.
**Workarounds investigated but rejected:**
- Pre-extracting the cache manually: builder generates a fresh random
  tmpdir per run and ignores any pre-existing extracted directory.
- Patching the 7za call: requires modifying `node_modules/builder-util` —
  brittle, would be lost on every `npm install`.
- `-xr!darwin` exclusion: 7za 21.07's `-snld` flag doesn't reliably skip
  symlink extraction; only Dev Mode actually solves the underlying privilege.

## MEDIUMS

### M1 — Bundled package.json scripts stripped (verified, not a finding)

Verified via `asar.extractFile`: `scripts` and `devDependencies` are absent
from the shipped `package.json` inside `app.asar`. Builder strips them by
default. No `postinstall` ship risk; users won't accidentally trigger
`node scripts/patch-node-pty.js` from inside an installed app.

### M2 — node-pty + sibling DLLs correctly unpacked (verified)

`dist/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/`
contains the full tree including `build/Release/conpty/`, `deps/winpty/`,
and all `.dll`/`.exe` siblings. Matches the v1.0 forge behavior — node-pty
will `LoadLibraryW` its dependents successfully post-install.

### M3 — Output directory separation enforced (verified)

`directories.output: dist` keeps electron-builder out of forge's `out/`.
The two pipelines can coexist without artifact collision until forge is
removed in Phase 8.

### M4 — Vite define substitution lands correctly in bundled main.js (verified)

`MAIN_WINDOW_VITE_NAME` substituted to literal `"main_window"` everywhere.
`MAIN_WINDOW_VITE_DEV_SERVER_URL` substituted to `undefined`, which dead-
code-eliminates the `if (MAIN_WINDOW_VITE_DEV_SERVER_URL)` dev branch
during rollup tree-shaking. The 1 remaining reference is inside a `typeof`
expression, which doesn't throw on undeclared identifiers in JS — safe.

### M5 — devDependencies pruned from shipped asar (verified)

`asar.extractFile('app.asar', 'package.json').devDependencies` is empty.
No `@electron-forge/*`, `electron-builder`, or build tooling rides into the
installed app. asar is 19 MB vs v1.0's 174 MB largely because forge was
shipping more than it needed to.

## LOWS

### L1 — Renderer bundle is 708 KB un-split

Vite warns about single-chunk renderer size. Not a v1.1 blocker; could
split via dynamic `import()` for the bigger components (LMM panel, GitHub
panel, settings) in a v1.2 cleanup pass. Current size is acceptable for
an Electron app where the bundle is loaded once from disk.

### L2 — Renderer references CSS by hashed filename

`assets/index-BMRO1LvP.css` and `assets/index-cXhyNlAw.js` — the hashes
will change on every build. Not a problem (the HTML references them
directly), just noting for cache-busting awareness if we ever ship a CDN.

### L3 — `npmRebuild: false` skips builder's native rebuild

Intentional — we rebuild node-pty via `scripts/patch-node-pty.js`
postinstall + electron-rebuild. Setting `npmRebuild: true` would undo the
gyp patches. Documented in `electron-builder.yml` comment. If a future
maintainer removes the postinstall, they must also flip this.

## Risks accepted

- **Dev Mode prereq for local builds.** Documented; CI is unaffected.
- **Forge + builder coexistence** through Phases 2-7. Two configs to
  maintain temporarily. Accepted per Phase 1 plan; removed in Phase 8.
- **No code-signing.** Same as v1.0. SmartScreen warning unchanged for
  end users.

## Plan adjustments from this review

1. **CONTRIBUTING.md (Phase 8) must document Developer Mode toggle** for
   local NSIS builds. Include screenshot or literal Settings path.
2. **No code changes required** for Phase 2 itself — all findings are
   environmental or already-mitigated-by-design.

## Phase 2 acceptance summary

- ✅ electron-builder installed and configured (`electron-builder.yml`).
- ✅ Standalone Vite runner (`scripts/build-vite.mjs`) with correct
  defines.
- ✅ Coexistence with forge: `dist/` vs `out/` separation.
- ✅ `npm run dist:dir` produces working unpacked output in
  `dist/win-unpacked/` (217 MB exe + 19 MB asar + node-pty unpacked).
- ✅ Vite defines correctly substituted in bundled main.js.
- ✅ Bundled asar excludes devDeps + build scripts.
- ⚠️ `npm run dist` (full NSIS installer) blocked on Dev Mode env
  setup — documented as install prereq; structurally ready.
