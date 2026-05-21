# LMM — forge.config.ts

## RAW

A clean, almost-default Forge 7 config. `packagerConfig.asar: true` (production-mode packaging), name override `Claude Code Studio` (spaces and capitalization — affects installer display name and app data folder). No `appBundleId`, no `icon`, no `appCategoryType`, no signing config (no `osxSign`, no `osxNotarize`, no `windowsSign`). Makers: `MakerSquirrel({})` (Windows installer, all defaults) and `MakerZIP({}, ['darwin'])` (Mac zip, never going to be invoked on a Windows-only dev machine). No deb, no rpm — but they're devDeps in package.json (`@electron-forge/maker-deb`, `@electron-forge/maker-rpm`) so something installed them and then didn't wire them up. Plugins are: `AutoUnpackNativesPlugin` (unpacks `.node` binaries out of the asar so dlopen works — required for node-pty), the `VitePlugin` (three builds: main, preload, one renderer named `main_window`), and `FusesPlugin` with four security-hardening fuses set: `RunAsNode: false`, `EnableCookieEncryption: true`, `EnableNodeOptionsEnvironmentVariable: false`, `EnableNodeCliInspectArguments: false`. Notably absent fuses: `OnlyLoadAppFromAsar`, `LoadBrowserProcessSpecificV8Snapshot`, `GrantFileProtocolExtraPrivileges`, `EnableEmbeddedAsarIntegrityValidation`. The renderer is registered as `main_window` — this name becomes a global at build time (`MAIN_WINDOW_VITE_DEV_SERVER_URL`, `MAIN_WINDOW_VITE_NAME`) which `src/main/index.ts` must reference. Open questions: (1) Why are deb/rpm makers installed but not registered? (2) Why no icon — does the app default to Electron's grey diamond? (3) Are the absent fuses an oversight or deliberate?

## NODES

1. **`asar: true`** + `AutoUnpackNativesPlugin` — standard combo for native modules; node-pty's `.node` file must be unpacked.
2. **`MakerSquirrel({})` with no options** — no setup icon, no setup exe name, no certificate, no remoteReleases. Installer will be "Claude Code Studio Setup.exe" with default branding.
3. **`MakerZIP` restricted to `darwin`** — author isn't on Mac but kept the option open.
4. **No `MakerDeb`/`MakerRpm` registered** despite devDeps installed — dead weight or aspiration.
5. **No `icon` field** — default Electron icon in title bar and installer.
6. **No code signing config** — Windows installer will be unsigned, SmartScreen warns users.
7. **Fuses: 4 of ~10 set** — partial hardening. Missing `OnlyLoadAppFromAsar` is notable.
8. **`EnableCookieEncryption: true`** — only matters if cookies are used; renderer uses xterm + local IPC, no obvious cookie surface.
9. **VitePlugin wires main + preload as `build:`, renderer as `renderer:`** — three configs, three Vite invocations.
10. **Renderer name `main_window`** — couples Forge config to main process globals at compile time.
11. **`rebuildConfig: {}`** — empty; uses Forge defaults. Native modules (node-pty) rely on this for `electron-rebuild` invocation during `package`.

**Tension A**: Security-conscious fuses are partially configured, but no code signing — the most user-visible security gap is unaddressed while internal hardening is half-done.
**Tension B**: Cross-platform makers are installed (deb/rpm/zip) but only Windows is real. Configuration drift between intent and execution.

## REFLECT

Core insight: **this config commits to Windows-only distribution while pretending to be cross-platform** — and the security posture mirrors that: fuses (cheap, declarative) get set; signing (expensive, requires a cert) does not.

Tension A resolved: the fuses are free; code signing requires a $300/yr cert and EV signing flow. The author is shipping locally / to GitHub Releases for self-install. Reasonable for personal use, blocking for any public distribution path.

Tension B resolved: the deb/rpm devDeps are likely leftovers from `electron-forge init` and never pruned. Cost of carrying them is small (devDep tree size).

Hidden assumptions: (1) `rebuildConfig: {}` is enough for node-pty — but only because patch-node-pty.js already fixed the gyp files at postinstall; (2) AutoUnpackNativesPlugin will correctly identify node-pty's `.node` files without configuration; (3) the renderer name `main_window` is hardcoded in `src/main/index.ts` somewhere (verified — that's standard Forge Vite template); (4) Squirrel's defaults are acceptable for an app named `Claude Code Studio` with spaces (Squirrel package IDs derived from name don't love spaces — installer folder will be sanitized).

## SYNTHESIZE

What this should become:
- Add `icon: './assets/icon'` (Forge picks `.ico` on Windows, `.icns` on Mac).
- Prune `@electron-forge/maker-deb` and `@electron-forge/maker-rpm` from package.json devDeps, OR register them here.
- Add the remaining hardening fuses, especially `OnlyLoadAppFromAsar: true`.
- Document the renderer name `main_window` couples to `MAIN_WINDOW_VITE_DEV_SERVER_URL` in main.
- Add a `MakerSquirrel` `setupIcon` and `iconUrl` once an icon exists.

Actionable items:
1. Create a real icon asset and wire it (highest user-visible impact).
2. Add `OnlyLoadAppFromAsar: true` fuse for tamper resistance in packaged builds.
3. Prune unused maker devDeps.
4. If/when public distribution begins, set up Azure code signing or sigstore.

Risks if untouched: packaged builds ship with Electron's default icon (looks like an unfinished product), SmartScreen warns on install (looks like malware to non-technical users), and any post-package modification of asar contents goes undetected.
