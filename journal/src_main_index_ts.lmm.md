# LMM: src/main/index.ts

> File: `src/main/index.ts` · LOC: 208 · Role: Electron main entry — window lifecycle, IPC wiring, service composition root

## Phase 1: RAW

This is the composition root of the main process. It instantiates five long-lived services (`PtyManager`, `ResourceMonitor`, `CompactController`, `GitService`, `GitHubService`) as module-level singletons, creates the `BrowserWindow`, and wires every IPC handler in seven `setupXxx()` functions. The structure is honest and flat — no DI container, no `app` god-object — just module-level state and direct `ipcMain.handle/on` calls. My gut reaction is "this is fine, and that's the surprise." For a 200-line main-process file, the temptation to over-architect is enormous; this resists it.

What scares me: `mainWindow` is a `let` shared by `safeSend`, `createWindow`, `app.on('activate')`, and the window controls. If a second window is ever created (e.g., split-pane via `BrowserWindow` instead of in-renderer), every handler silently routes to the wrong window. The `app.on('activate')` branch already exists for macOS, so this isn't theoretical. Also: `ptyManager.kill()` is called in BOTH the window `close` handler AND `window-all-closed` — double-kill is benign but indicates duplicated lifecycle logic. `githubService` is lazily initialized via `getGitHub()` because its constructor calls `app.getPath('userData')`, but the comment explaining that is missing — a future refactor could "fix" the lazy pattern and break startup.

The IPC surface area is large (~22 channels) and growing (phases 5-7 will add auth + sync). Nothing here knows about errors thrown from handlers — `ipcMain.handle` will reject the renderer promise, but there is no logging on the main side. A failing GitHub call will be invisible in the main-process console.

Naive understanding: "main.ts wires services to IPC and creates a window." Probably wrong because: the file is *also* the de facto cleanup orchestrator (close handlers, window-all-closed) and the single point that knows which services need lifecycle calls. That coupling is implicit.

### Open Questions
- Should `setupXxx()` functions move into each service so `index.ts` only calls `service.registerIpc(ipcMain)`?
- Why is `githubService` lazy but others eager — is there a test where this distinction matters?
- What happens when an `ipcMain.handle` throws and there's no `.catch` on the renderer side?
- Why does `window-all-closed` call `ptyManager.kill()` again after the window `close` already did?

## Phase 2: NODES

### Node 1: Module-level singleton services
Five `new X()` calls at module load. Simple, but means tests cannot instantiate `index.ts` without side effects.
Why it matters: Untestable in isolation, but pragmatic for an Electron main.

### Node 2: Lazy GitHubService
`getGitHub()` defers construction because the constructor reads `app.getPath('userData')`, which is only valid after `app.whenReady()`.
Tension with Node 1: Inconsistent lifecycle — readers will wonder why GitHub is special.

### Node 3: `safeSend` guard
Wraps `webContents.send` with `!mainWindow.isDestroyed()`. Documented in HANDOFF as a crash fix.
Why it matters: Crash-on-close was a real bug. This guard is load-bearing.

### Node 4: Duplicated kill paths
`ptyManager.kill()` runs in `mainWindow.on('close')` AND `app.on('window-all-closed')`.
Tension with Node 3: Defensive duplication suggests fear of lifecycle gaps that `safeSend` already addresses.

### Node 5: Seven setup functions
Each `setupXxx()` registers IPC for one domain. Symmetric, easy to find.
Why it matters: Adding a new domain = add a service + a setup function. Low friction.

### Node 6: No error logging on IPC handlers
A throw inside `getGitHub().listCommits()` returns a rejected promise to the renderer. Nothing logs it main-side.
Tension with Node 5: Symmetric registration makes the missing cross-cutting concern (logging) obvious.

### Node 7: `getGitHub` IPC URL allowlist
`GITHUB_OPEN_EXTERNAL` checks `/^https?:\/\//`. Good defense.
Why it matters: This is the only handler that validates input. Others trust the renderer fully.

### Node 8: `mainWindow` as shared `let`
Five call sites mutate or read this binding. No abstraction.
Tension with Node 1: If services are singletons, why isn't `mainWindow` a service too?

### Node 9: Mac `activate` branch
Recreates window if all closed on macOS — but services were already torn down in `window-all-closed`.
Why it matters: On Mac, reactivation after window-close would spawn a window with dead PTY/monitor. Latent bug.

## Phase 3: REFLECT

### Core Insight
This file is the **lifecycle hub disguised as a composition root** — every service implicitly trusts `index.ts` to call its `start`/`stop`/`kill` at the right moment, and the contract is undocumented.

### Resolved Tensions
- **Node 1 vs Node 2 (eager vs lazy services)** → Resolution: extract a tiny `Services` factory that runs after `app.whenReady()`. All services become eager-but-deferred, eliminating the lazy special case.
- **Node 4 vs Node 9 (double kill / dead-services-on-reactivate)** → Resolution: centralize teardown in one `shutdown()` and startup in one `startup()`. `window-all-closed` calls `shutdown()`; `activate` calls `startup()`. Today's code half-implements both directions.

### Hidden Assumptions
- Assumed: there will only ever be one `BrowserWindow`. — Challenge: Phase 7 mentions split panes; if those use multiple windows, every `safeSend` and `mainWindow?.` becomes wrong.
- Assumed: IPC handler exceptions are caught by Electron and surfaced sensibly to renderer. — Challenge: Promise rejections cross the IPC boundary as `Error` objects with stack traces stripped; without main-side logging, debugging is a guessing game.
- Assumed: services have no inter-dependencies. — Challenge: `setupTerminal` already calls `resourceMonitor.setClaudePid(pid)` — there's already coupling, and it lives in the wiring layer rather than being explicit.

## Phase 4: SYNTHESIZE

### What this file should become
A 100-line composition root with one `startup()` and one `shutdown()`. Each service exposes `registerIpc(ipcMain)` and owns its own IPC wiring. `index.ts` only orchestrates lifecycle and window management. The PTY→ResourceMonitor coupling moves into a small `wireTerminalToMonitor(pty, monitor)` helper so the dependency is named, not buried in `setupTerminal`.

### Actionable items
- [ ] Extract a `wrapIpcHandler` utility that logs main-side errors before re-throwing, then wrap every `ipcMain.handle` registration.
- [ ] Centralize teardown in `shutdown()`; call it from `window-all-closed`. Remove the duplicate `kill`/`stop` calls in the window `close` handler.
- [ ] Add a `startup()` that `activate` can also call, so reopening on macOS gets fresh services.
- [ ] Move each `setupXxx` into the corresponding service as `registerIpc(ipcMain, getWindow)`. `index.ts` keeps only lifecycle.
- [ ] Replace the shared `mainWindow` `let` with a `getMainWindow()` accessor so future multi-window work has one chokepoint.
- [ ] Document why `GitHubService` is constructed lazily (or refactor to remove the lazy path per the synthesis above).

### Risks
- Refactoring the kill paths could regress the crash-on-close fix; keep `safeSend` and add a test that destroys the window mid-IPC.
- Moving IPC registration into services risks circular imports if a service needs `mainWindow`; pass a getter, not the window itself.
- The `setupGitHub` block uses a default param (`state = 'open'`) inside an arrow — this works for `ipcMain.handle` but if anyone refactors to a method reference, the default disappears silently.
