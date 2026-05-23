# Packaging / Runtime Red-Team

> Reviewed: 2026-05-22 · Branch: master · Reviewer: red-team agent
> Scope: prod-only bugs that surface AFTER the parent's `vite.renderer.config.ts` `root: 'src/renderer'` fix lands.
> Evidence: direct inspection of `out/Claude Code Studio-win32-x64/resources/app.asar` (923 KB, header JSON read directly), forge plugin source, and main/preload bundles.

## Verdict
**NEEDS FIXES BEFORE RESHIP** — the renderer-config fix is necessary but nowhere near sufficient. The packaged asar is missing every `node_modules` dependency, including the externalized `node-pty` and `systeminformation` modules. Even with a working renderer, the terminal will silently fall back to a non-PTY child-process shim and the resource monitor will be permanently dark.

---

## Critical (will keep the app blank or broken even with the renderer fix)

### [C1] `node-pty` and `systeminformation` are externalized but never copied into the package — terminals will silently degrade and resource monitor is permanently dead
**Where:** `vite.main.config.ts:6` (the offending `external` list) + `node_modules/@electron-forge/plugin-vite/dist/VitePlugin.js:124-131` (the ignore filter that excludes `node_modules/`).
**Issue:** Direct inspection of `out/Claude Code Studio-win32-x64/resources/app.asar` shows the asar contains **only** `.vite/build/index.js`, `.vite/build/preload.js`, `.vite/renderer/main_window/**`, and `package.json`. No `node_modules/` is present anywhere in the asar or beside it on disk:
```
> ls out/Claude Code Studio-win32-x64/resources/
app.asar           ← 923 KB, that is the entire shipped app
> ls out/Claude Code Studio-win32-x64/resources/app.asar.unpacked
(does not exist)
```
The forge vite plugin sets `packagerConfig.ignore` to exclude **everything** outside `/.vite/` (it expects vite to inline-bundle every dependency). `vite.main.config.ts` declares:
```ts
rollupOptions: { external: ['node-pty', 'systeminformation'] }
```
So those two modules are emitted as bare `require("node-pty")` / `require("systeminformation")` calls in `.vite/build/index.js` (confirmed via grep), but the modules themselves are stripped from the package. At runtime both requires throw `Cannot find module`. `pty-manager.ts:8-12` catches that error and silently degrades to `child_process.spawn(claudePath, [], { shell: true })` — no PTY, no resize, broken interactive prompt rendering for Claude's REPL on Windows. `resource-monitor.ts:5-9` does the same — `si === null`, `start()` returns early, the Resources panel paints empty forever.
**Why dev works:** `electron-forge start` runs the main process unbundled with the project's full `node_modules` on disk, so `require('node-pty')` resolves normally and a real PTY spawns.
**Fix (pick one):**
1. **Remove the `external` list and let vite bundle them** — won't work for `node-pty` because of its native `.node` binary. Vite/Rollup cannot bundle a `.node` file as JS.
2. **Use a plugin that copies native modules out of `node_modules` into the package and unpacks them** — e.g. `vite-plugin-native` or `@electron-forge/plugin-vite`'s recommended companion. This is the canonical fix.
3. **Manual override of `packagerConfig.ignore`** in `forge.config.ts` so `node_modules/{node-pty,systeminformation,@octokit/rest,update-electron-app,electron-squirrel-startup}/**` is included — then `auto-unpack-natives` + the [C2] fix below will handle the native bits. This is the lowest-friction option.

The other externalized-via-require deps in the bundle (`@octokit/rest`, `update-electron-app`, `electron-squirrel-startup`) — verified by grep against `.vite/build/index.js` — are **inlined** by vite (no `require()` for those is emitted), so they happen to work despite [C1]. Only `node-pty` and `systeminformation` are dead.

### [C2] Even if [C1] is fixed, `auto-unpack-natives` only unpacks `*.node` — node-pty's sibling `winpty.dll`, `winpty-agent.exe`, `conpty.dll`, `conpty-agent.exe` will stay inside the asar and the native loader will fail
**Where:** `node_modules/@electron-forge/plugin-auto-unpack-natives/dist/AutoUnpackNativesPlugin.js:20` — the pattern is hard-coded:
```js
const newUnpack = '**/{.**,**}/**/*.node';
```
**Issue:** node-pty 1.x on Windows ships its binaries under `node_modules/node-pty/prebuilds/win32-x64/`. Verified contents:
```
conpty.node, conpty.pdb, conpty_console_list.node, conpty_console_list.pdb,
pty.node, pty.pdb, winpty-agent.exe, winpty-agent.pdb,
winpty.dll, winpty.pdb, conpty/  (subdir with OpenConsole.exe + conpty.dll)
```
`auto-unpack-natives`'s glob matches only `*.node` files. The `.dll` / `.exe` siblings stay inside the asar. When `conpty.node` is loaded and its native code does `LoadLibraryW("conpty.dll")` (and `WinPty.cc` similarly for `winpty.dll` / `winpty-agent.exe`), Windows looks in the loaded `.node` file's directory — which is `app.asar.unpacked/...prebuilds/win32-x64/` — and the DLLs aren't there. LoadLibrary returns `ERROR_MOD_NOT_FOUND` and node-pty's `loadNativeModule` (`node_modules/node-pty/lib/utils.js:17-37`) throws. That throw is **caught and swallowed** in `pty-manager.ts:8-12`, putting us back in the same silent-fallback failure mode as [C1].
**Fix:** Extend the asar unpack pattern in `forge.config.ts` to cover node-pty's non-`.node` runtime files. Append to the auto-unpack glob, e.g.:
```ts
packagerConfig: {
  asar: {
    unpack: '**/node_modules/node-pty/**',  // unpacks the whole module
  },
  ...
}
```
Then `auto-unpack-natives` will merge this with its own `*.node` pattern (the plugin OR-combines existing `unpack` strings — see `AutoUnpackNativesPlugin.js:21-23`).
**Cross-ref:** This bug only manifests after [C1] is resolved; today the asar has zero node-pty content at all.

### [C3] Renderer bundle in the asar is the stale pre-build from `src/renderer/dist/`, not what the upcoming renderer-fix will rebuild — and the index.html in it uses root-absolute asset paths that 404 under `file://`
**Where:** asar header inspection of `out/.../resources/app.asar` shows `.vite/renderer/main_window/index.html` (820 B) + `assets/index-BO43fDsi.js` (707 KB) + `assets/index-4mmBJUqT.css` (5.8 KB). These hashes match the artifacts in `src/renderer/dist/assets/index-BO43fDsi.js` and `.vite/renderer/main_window/assets/index-BO43fDsi.js`.
**Issue:** Two distinct copies exist on disk right now:
- `src/renderer/dist/index.html` (line 11): `<script type="module" crossorigin src="/assets/index-BO43fDsi.js">` — **root-absolute** path.
- `.vite/renderer/main_window/index.html` (line 11): `<script type="module" crossorigin src="./assets/index-BO43fDsi.js">` — **relative** path.

The one in `.vite/renderer/main_window/` (the forge plugin output) is correct — it uses `./assets/...` which will resolve under `file:///.../resources/app.asar/.vite/renderer/main_window/index.html` to the correct intra-asar asset. Good. **But** the existence of `src/renderer/dist/` suggests someone previously ran `vite build` directly (without the forge plugin) and that build wrote `/assets/...` (root-absolute) into `dist/index.html`. If the parent's renderer-config fix changes the `outDir` to write into `src/renderer/dist/` instead of `.vite/renderer/main_window/`, or if any later refactor uses the standalone `vite build`, the asar will pick up the broken root-absolute version. Under `file://` origins those resolve to `file:///assets/...` (drive root) and 404 → blank window.
**Fix:**
1. Delete `src/renderer/dist/` — it's stale build output that confuses the picture.
2. Ensure `vite.renderer.config.ts` sets `base: './'` explicitly so even a direct `vite build` would produce relative paths. The forge plugin happens to inject this for the in-asar output but the standalone build doesn't, and the existence of a stale-but-wrong copy on disk is a footgun.

### [C4] No way to diagnose a packaged-build failure — devtools is gated on `NODE_ENV === 'development'` so the user sees a blank window with zero feedback
**Where:** `src/main/index.ts:191-193`:
```ts
if (process.env.NODE_ENV === 'development') {
  mainWindow.webContents.openDevTools({ mode: 'detach' });
}
```
**Issue:** `NODE_ENV` is never set to `development` in the packaged app, AND the `EnableNodeOptionsEnvironmentVariable: false` fuse in `forge.config.ts:86` actively prevents the user from injecting it via env vars. Combined with the fact that the renderer is mounted via `loadFile()` (no Ctrl+Shift+I gesture is bound from the main process), the user has **no recourse** when the window paints blank — they cannot open devtools, cannot see CSP violations, cannot see asset 404s, cannot see the `require('node-pty')` throw. This is what produced the original "blank window, no error visible" report and will keep producing it on every future regression.
**Fix:** Add a always-available diagnostic gesture in `index.ts`:
```ts
mainWindow.webContents.on('before-input-event', (event, input) => {
  // Ctrl+Shift+I or F12 → always open devtools, even in packaged build.
  // Costs nothing security-wise (renderer already trusts the preload's IPC).
  if (
    (input.control && input.shift && input.key.toLowerCase() === 'i') ||
    input.key === 'F12'
  ) {
    mainWindow?.webContents.openDevTools({ mode: 'detach' });
  }
});
```
This is a packaging-survivability requirement, not a luxury. Without it every prod regression becomes a guessing game.

---

## High (will work but with surprising defects)

### [H1] `app.setAppUserModelId()` is never called — Windows toast notifications will silently drop or attribute to a wrong publisher
**Where:** `src/main/notifications-service.ts` and `src/main/index.ts:573-610` — confirmed via grep, there's zero `setAppUserModelId` call anywhere in the codebase.
**Issue:** On Windows, `new Notification(...).show()` requires the app to have an `AppUserModelID` (AUMID) that matches a Start Menu shortcut to actually display toasts (per Microsoft docs and Electron's `notification.md`). Squirrel.Windows installs a shortcut whose AUMID is derived from `MakerSquirrel`'s `name` option — in this build, `claude_code_studio` (`forge.config.ts:23`). But Electron's runtime AUMID defaults to `electron.app.<exe-name>` unless `app.setAppUserModelId()` is called explicitly. Mismatch → no toast renders, or the toast is attributed to `electron.app.claude-code-studio` (the executable name) instead of the installed app.

Phase 7a built a whole NotificationsService with PTY-exit, sync-error, update-available, cost-budget, and test toasts. In dev (`electron-forge start`) toasts ALWAYS work because Electron uses a transient identity. In packaged install they will silently no-op or show with the wrong identity.
**Fix:** In `app.whenReady()` before `createWindow()`:
```ts
if (process.platform === 'win32') {
  app.setAppUserModelId('com.squirrel.claude_code_studio.ClaudeCodeStudio');
  // The exact AUMID Squirrel registers is "com.squirrel.<name>.<exe-name-no-ext>"
  // where <name> comes from MakerSquirrel options. Verify post-install with
  // `Get-StartApps | findstr -i claude` in PowerShell.
}
```
Then confirm in the installed shortcut's properties (right-click → Properties → "App ID").

### [H2] `compactController` and `resourceMonitor` are instantiated at module load (before `app.whenReady`) but their constructors are pure — still risky pattern
**Where:** `src/main/index.ts:30-31`:
```ts
const resourceMonitor = new ResourceMonitor();
const compactController = new CompactController();
```
**Issue:** These run at the top of the main entry, before `app.whenReady()` has fired. Today they happen to be safe because their constructors don't touch any electron API that requires the app to be ready — `compact-controller.ts` only uses `os.homedir()` (safe at any time), and `resource-monitor.ts` only initializes an empty Map. **However**, this is a fragile pattern: any future refactor that adds `app.getPath('userData')` to either constructor (mirroring the pattern of every other service) will silently crash on packaged builds where Electron does enforce `app.whenReady` more strictly than dev runs. Recommend converting to the lazy-getter pattern used by the other services (`getCompact()`, `getResource()`).
**Risk:** Latent, not active. Flag as tech debt.

### [H3] CostService starts a 30 s polling interval inside `setupCost()` — that's called inside `app.whenReady().then(...)`, but the FIRST sample fires synchronously from `start()` and reads `state.json` via `fs.statSync` on the main thread
**Where:** `src/main/cost-service.ts:123-134` and `src/main/index.ts:454`.
**Issue:** `getCost().start()` calls `void this.sample()` immediately. `sample()` does sync file I/O via `fs.statSync`/`fs.readFileSync` on the `~/.claude/compact-controller/` directory. On first-launch of the installed app the user almost certainly has no `~/.claude/compact-controller/` (they haven't installed the compact controller hooks yet), so `readStateSample()` and `readVaultSamples()` both return null/empty — fine. But on a **fresh** packaged install, the `userData` directory itself (`%APPDATA%/Claude Code Studio/`) doesn't exist until `app.getPath('userData')` is consulted. CostService's constructor at `cost-service.ts:116-121` calls `app.getPath('userData')` and `readHistory()` which `fs.statSync`s the (nonexistent) path — handled with `ENOENT → freshHistory()`. Confirmed safe.
**Status:** Verified-OK. Mentioned here because the polling interval also calls `writeHistory()` every cycle even when nothing changed — minor disk churn, deferred.

### [H4] `app.asar` integrity is enabled by Electron 30+ by default, but no integrity hash is in `package.json` — verify packager wrote one in the asar header
**Where:** the asar header dump shows `"integrity": {"algorithm": "SHA256", "hash": "..."}` for each file entry. Good — the packager DID compute integrity hashes for each file inside the asar. Electron 30+ uses these to detect tampering with the asar contents and refuses to load mutated files.
**Status:** Verified-OK. Listed here only to confirm explicit-check.

---

## Medium (deferred — track as tech debt)

### [M1] `electron-squirrel-startup` is `require()`d at the top of `src/main/index.ts:21` but is inlined by vite (no external `require` call in the bundle) — works today, fragile to refactor
**Where:** `src/main/index.ts:21`.
**Issue:** grep against `.vite/build/index.js` confirms there's no `require("electron-squirrel-startup")` left in the bundle — vite inlined the whole module. Good, because it's NOT in the asar's `node_modules` (which doesn't exist — see [C1]). If anyone later adds `'electron-squirrel-startup'` to vite's `external` list, the very first thing the app does on Squirrel install/update/uninstall will throw `Cannot find module`, the app will refuse to register file associations and update-handling. Add a comment in `vite.main.config.ts` noting that **nothing else** should be added to the `external` list without solving the packaging story first.

### [M2] safeStorage usage is timing-safe — verified
**Where:** `github-service.ts:50`, `auth-service.ts` (multiple). Both services are instantiated lazily via `getGitHub()` / `getAuth()` only when their first IPC handler fires. Those handlers are registered after `app.whenReady().then(...)` runs `setupGitHub()` / `setupAuth()` in `index.ts:579, 581`. By the time an IPC call arrives, `app.whenReady()` has long since fired and DPAPI is ready. The constructors themselves do NOT call `safeStorage.isEncryptionAvailable()` — they only call it inside `setToken()` / `clearToken()` etc. Safe.
**Status:** Verified-OK.

### [M3] CSP under `file://` origin will allow xterm + GitHub avatars + Octokit fetch — verified
**Where:** `src/renderer/index.html:7-9` (also identically embedded in `.vite/renderer/main_window/index.html`).
**Issue analyzed:**
- `default-src 'self' 'unsafe-inline'` covers `script-src` and `style-src` via fallback. `'self'` under `file://` means the file-origin which IS the asar location, so the relative bundle script loads. `'unsafe-inline'` covers xterm.js's runtime `<style>` injection AND the React/Vite stylesheet (which is in a separate `<link>` anyway, also matching `'self'`).
- `img-src 'self' data: https://avatars.githubusercontent.com https://*.githubusercontent.com` — Sidebar/Auth panels load GitHub avatars; fine. The `data:` covers tray-icon-style inline base64 if any renderer code uses it; fine.
- `connect-src 'self' https://api.github.com http://localhost:* ws://localhost:*` — Octokit calls in the main process don't go through CSP (CSP only applies to the renderer); cloud-sync and GitHub services are main-side. Renderer doesn't make direct network calls — all goes through IPC. Confirmed via grep that no `fetch(` to external URL appears in `src/renderer/`. Safe.
- No `worker-src` directive — would fall back to `default-src`. xterm.js 6.x does NOT spawn web workers by default (the conout-on-worker path is a separate addon we don't use). Safe.
**Status:** Verified-OK.

### [M4] `web-contents-created` handler in `index.ts:555-571` blocks `will-navigate` for any URL not matching the dev server or `file://` — verify it doesn't break the dev-tools attached webview
**Where:** `src/main/index.ts:555-571`.
**Issue:** DevTools is loaded via `webContents.openDevTools({ mode: 'detach' })` which spawns a separate WebContents on a `devtools://` URL. Our `will-navigate` handler explicitly allows only the dev-server URL and `file://`; `devtools://` falls through to `event.preventDefault()`. In practice DevTools navigates within its own contents and doesn't hit the renderer-attached `will-navigate`, but worth testing once [C4]'s always-on-devtools is added.
**Status:** Likely fine, flag for one-time verification.

### [M5] Fuses applied correctly — verified
**Where:** `forge.config.ts:82-88` enables `RunAsNode: false`, `EnableCookieEncryption: true`, `EnableNodeOptionsEnvironmentVariable: false`, `EnableNodeCliInspectArguments: false`.
**Status:** Cannot directly inspect the compiled `claude-code-studio.exe` without running it, but `@electron-forge/plugin-fuses` is a well-tested plugin and the config is well-formed. If the build completed without throwing, the fuses applied. The first user launch will confirm — if fuses didn't apply the app still runs (just less secure), so this is a security posture concern not an availability concern.

---

## Verified-OK (explicitly checked, no issue)

- **Preload bundle is sandbox-compatible.** `.vite/build/preload.js` is a single 7.9 KB file containing `require("electron")` at the top and zero other `require()` calls — the `import { IPC } from '../shared/ipc-channels'` was inlined. Works under `sandbox: true`. Confirmed by direct read of the bundled file.
- **Preload path resolution post-package.** `path.join(__dirname, 'preload.js')` in `index.ts:158` resolves correctly: in the asar, `__dirname` of the main module is `.vite/build/`, and `preload.js` is right there (confirmed in asar header).
- **`MAIN_WINDOW_VITE_NAME` define injection.** Forge's `vite.base.config.js:45-62` confirms it injects `MAIN_WINDOW_VITE_NAME = "main_window"` at build time. The `loadFile(path.join(__dirname, '../renderer/${MAIN_WINDOW_VITE_NAME}/index.html'))` call in `index.ts:187` resolves to `.vite/renderer/main_window/index.html` inside the asar — correct path.
- **`electron-squirrel-startup` shipped.** It's in `dependencies` (not devDeps) at `package.json:34` AND is inlined into the main bundle by vite. The `require()` at `index.ts:21` works.
- **CompactController, ResourceMonitor, GitService constructors are pure.** None touch `app.getPath` or any electron API at construction time. Safe to instantiate at module load (today; see [H2]).
- **SessionService, NotificationsService, etc.** All other services are lazily instantiated only inside `app.whenReady().then(setup*)` blocks. `app.getPath('userData')` always resolves correctly.
- **`shell.openExternal` URL allowlist.** `index.ts:352-370` correctly validates HTTPS-only and allowlists github.com domains. Safe.
- **`setWindowOpenHandler` denies all.** `index.ts:556` returns `{ action: 'deny' }` for any window-open attempt. Safe.
- **xterm.js does not require web workers.** Confirmed by grepping `@xterm/xterm/lib` — no `new Worker(` calls in the default Terminal class. The CSP doesn't need `worker-src`.
- **asar integrity hashes present.** Header inspection shows SHA256 hash + blocks for each file entry. Electron 30+ asar integrity check will succeed.
- **No `prune: false` or other packagerConfig flag fighting the vite plugin.** `forge.config.ts` is clean.

---

## Recommended fix-order

1. **[C4] devtools always-on** — do this FIRST. Without it you cannot diagnose the next four bugs in the installed build.
2. **[C1] node_modules packaging** — override `packagerConfig.ignore` in forge.config.ts to keep `node_modules/{node-pty,systeminformation}/**` (the other two-deps inlined fine). Alternative: drop the `external` list from `vite.main.config.ts` and accept whatever Vite does with `systeminformation` (might bundle ok).
3. **[C2] asar unpack pattern** — add `unpack: '**/node_modules/node-pty/**'` to `packagerConfig.asar`.
4. **[C3] delete `src/renderer/dist/`** — and set `base: './'` in `vite.renderer.config.ts` for safety.
5. **[H1] `app.setAppUserModelId`** — single line in `app.whenReady()` handler.
6. Reship and re-verify with the freshly always-on devtools.
