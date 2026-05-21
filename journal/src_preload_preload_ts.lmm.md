# LMM: src/preload/preload.ts

> File: `src/preload/preload.ts` · LOC: 74 · Role: Electron `contextBridge` exposing the typed `window.electronAPI` surface to the renderer; the only sanctioned cross-context boundary.

## Phase 1: RAW

This is the entire renderer-facing API of the app, in 74 lines. It runs in the preload script's privileged context (isolated, no full Node, but `ipcRenderer` available) and uses `contextBridge.exposeInMainWorld('electronAPI', ...)` to publish a namespaced object the renderer can call without ever touching `ipcRenderer` directly. The five namespaces are `terminal`, `resources`, `compact`, `git`, `github`, plus a bare `window` for chrome controls.

Pattern is consistent and correct: `ipcRenderer.send` for fire-and-forget (terminal input/resize/restart, resource start/stop, window controls), `ipcRenderer.on` for push streams (terminal data/exit/ready, resource updates), `ipcRenderer.invoke` for request/response (everything in compact/git/github). This matches `main/index.ts` exactly — `ipcMain.on` for the send channels (lines 86, 90, 94, 107-108, 174-182) and `ipcMain.handle` for the invoke channels (lines 114-170). The IPC constants are imported from `../shared/ipc-channels` so renames stay in sync.

Two structural smells. First, `window:minimize/maximize/close` (lines 69-71) are bare string literals instead of `IPC.*` constants — small but real drift from the single-source-of-truth pattern this file otherwise upholds. Second, the `terminal.onData/onExit/onReady` handlers register `ipcRenderer.on` without ever returning an unsubscribe function. If `TerminalPanel.tsx` mounts twice (StrictMode, hot reload, panel toggling), each mount adds another listener and the same data is delivered multiple times to ghost callbacks. Same hazard for `resources.onUpdate`. This is the kind of bug that only shows up under load (terminal echo doubling, dev-time only) and gets blamed on xterm.

The file has no exported types of its own — typing is entirely informal here, and the renderer's `window.electronAPI` typing comes from `declarations.d.ts`. That means a typo in this file (`getStatu` instead of `getStatus`) would break the renderer with a runtime "is not a function" error rather than a TS error. The structural shape of what's exposed and what's declared must be hand-kept-in-sync across two files.

Parameter handling is straightforward and correct: payloads are passed through `invoke` as additional args (`ipcRenderer.invoke(IPC.GITHUB_REPO_INFO, owner, repo)`) and unpacked in the main process via `(_event, owner, repo)`. Default state for PR/issue lists is `'open'` (lines 59, 64), matching `main/index.ts:156, 161`.

### Open Questions
- Should `onData/onExit/onReady/onUpdate` return an unsubscribe closure? Almost certainly yes.
- Why the bare `'window:*'` strings instead of importing from `ipc-channels.ts`?
- Should the API expose `ipcRenderer.removeAllListeners` for the channels it owns, so renderer unmounts can clean up?
- Is there value in narrowing `callback: (data: unknown)` in `resources.onUpdate` to the typed `ResourceSnapshot`? The type is right next door in `shared/types.ts`.

## Phase 2: NODES

### Node 1: Five typed namespaces + window chrome
Lines 5-72. `terminal`, `resources`, `compact`, `git`, `github`, `window`. Mirrors sidebar panels almost 1:1.

### Node 2: Correct usage of send/on/invoke per direction
`send` for renderer→main fire-and-forget; `on` for main→renderer push; `invoke` for request/response. No anti-patterns.

### Node 3: Bare strings for window controls (drift)
Lines 69-71: `'window:minimize'`, `'window:maximize'`, `'window:close'` are not in `IPC` const. Breaks the import-only convention used elsewhere.

### Node 4: Listeners never unsubscribe
`onData`, `onExit`, `onReady` (lines 6-14), `onUpdate` (line 26-28). Returns `void`. Renderer cannot dispose, so repeated subscription leaks listeners and duplicates events.

### Node 5: `unknown` typing for resources.onUpdate payload
Line 26 takes `(data: unknown)`. The actual payload is `ResourceSnapshot` (defined in `shared/types.ts`). Type information is lost at the bridge and recovered only via the ambient declaration in `declarations.d.ts:56`.

### Node 6: `compact.setConfig` also `unknown`
Line 37 takes `(config: unknown)`. Should be `Partial<CompactConfig>`.

### Node 7: ElectronAPI shape declared three times
Here (implicitly via the literal object), in `declarations.d.ts:46-108` (for renderer typing), and partially in `types.ts:119-127`. Triple-redundant.

### Node 8: No error handling on `invoke` rejections
The file is a transparent passthrough; rejections bubble to the renderer. Probably fine, but worth noting as a design choice rather than oversight.

### TENSION A: Hand-maintained mirroring vs. zero compile-time safety net
This file's correctness depends on developer discipline to keep `IPC` keys, handler signatures, preload methods, and ambient `Window` declarations all in alignment. Nothing in the toolchain enforces this.

### TENSION B: Stream subscribe-only API vs. React component lifecycle
React (especially StrictMode + HMR) re-runs effects. Without unsubscribe semantics, every dev cycle leaks. Production is mostly fine because mounts are stable, but the API shape is wrong.

## Phase 3: REFLECT

### Core Insight
This file is the *narrowest* part of the entire app's contract surface but is held together by manual cross-file consistency and lacks listener cleanup — both problems would compound as Phases 5-7 add channels.

### Resolved Tensions
- **A (no compile-time safety):** Build a tiny typed-helper layer (`createIpcBridge(channelMap)`) that takes an `IpcPayloadMap` from `shared/types.ts` and returns a strongly-typed object. The preload still calls `contextBridge.exposeInMainWorld` but the developer can't expose a method whose channel/return shape disagrees with the map.
- **B (no unsubscribe):** Change all `on*` methods to return `() => void`. Refactor consumers (`TerminalPanel`, `ResourcePanel`) to call the returned disposer in their `useEffect` cleanup.

### Hidden Assumptions
- That `contextBridge.exposeInMainWorld` is called exactly once. True today; could break silently if preload is ever bundled into multiple scripts.
- That the renderer is single-window. `safeSend` in main targets `mainWindow` only; multi-window will need per-`WebContents` routing.
- That every `invoke` resolves quickly enough that the renderer doesn't need cancellation. Long Octokit calls (rate-limited GitHub) could violate this.
- That listener leaks are tolerable because the app is single-window. True for now.

## Phase 4: SYNTHESIZE

### What this file should become
A thin, typed adapter generated (or at least guided) by a single `IpcPayloadMap` declared in `shared/types.ts`. Subscribe APIs return disposers. Bare strings eliminated. The file shrinks slightly and gains end-to-end type safety from channel string to callback signature.

### Actionable items
- [ ] Change `onData`, `onExit`, `onReady`, `onUpdate` to return `() => void` that calls `ipcRenderer.removeListener` for the registered handler.
- [ ] Replace `'window:minimize/maximize/close'` literals with `IPC.WINDOW_*` after adding those constants to `ipc-channels.ts`.
- [ ] Type `resources.onUpdate` callback as `(data: ResourceSnapshot) => void`; type `compact.setConfig` as `(config: Partial<CompactConfig>) => Promise<CompactConfig>`.
- [ ] Audit `TerminalPanel.tsx` and `ResourcePanel.tsx` to confirm they currently work around the leak (or not) and wire the new disposers in `useEffect` cleanup.
- [ ] Eventually: generate this file from the IPC payload map so it can never drift.

### Risks
- Returning disposers changes the public API of `window.electronAPI.terminal.onData` etc.; renderer call sites that ignore the return value are fine, but TS will need `declarations.d.ts` updated in lockstep or the renderer's types fall out of sync.
- Removing window control bare strings requires careful grep — they may appear in `TitleBar.tsx`.
- Tightening `unknown` to `ResourceSnapshot` can surface latent shape mismatches in `resource-monitor.ts`; expect to fix one or two field-name drifts.
