# LMM: src/shared/ipc-channels.ts

> File: `src/shared/ipc-channels.ts` · LOC: 43 · Role: Single source of truth for all IPC channel string constants between main, preload, and renderer.

## Phase 1: RAW

This file is small (42 lines, 39 channel constants) but disproportionately load-bearing. It is the only file that physically prevents drift between `src/main/index.ts` (which calls `ipcMain.on` / `ipcMain.handle`) and `src/preload/preload.ts` (which calls `ipcRenderer.send` / `ipcRenderer.invoke`). The pattern is the conventional Electron one: a frozen `const` object with `as const` so each value narrows to its literal string. The channels are grouped by domain (terminal, resources, compact, git, github, auth, sync) with consistent `domain:verb` naming. That convention is observed everywhere except `window:minimize/maximize/close`, which exist as raw string literals in `preload.ts` lines 69-71 and `main/index.ts` lines 174-182 with no constant here at all — the first drift smell.

Looking at what's wired vs declared: lines 34-41 declare `AUTH_*` and `SYNC_*` channels that have zero references in `main/index.ts` (no `setupAuth()` or `setupSync()` function exists). HANDOFF.md confirms these are Phase 5/6 work. So the file is partly a forward-declaration of an API surface, which is honest enough, but creates a subtle hazard: any future contributor scanning this file will assume those channels are alive. The GitHub channels (lines 24-32) were also declared-but-not-wired through Phase 3; HANDOFF and the task list both confirm Phase 4 wired them, and `main/index.ts` `setupGitHub()` lines 139-171 now backs every one. Good — that drift is resolved.

The `as const` produces a readonly object but the file does not export a derived `IpcChannel` type (e.g. `typeof IPC[keyof typeof IPC]`), which would let downstream code accept "any valid channel" without stringly-typed casts. There is also no enforcement that the keys form an exhaustive switch.

### Open Questions
- Why is `window:minimize/maximize/close` not in this enum? Deliberate omission or oversight?
- Should `TERMINAL_READY` exist in `preload.ts`? The preload exposes `onReady` (line 12-14) but `types.ts` `ElectronAPI` does not list it — drift with the types file.
- Are `AUTH_*` and `SYNC_*` channels really dead code today, and is that OK to keep in a v1.0.0 ship?
- Should this file be the seed of a generated type for handler signatures (`Record<Channel, (...args) => Promise<T>>`)?

## Phase 2: NODES

### Node 1: Channels-as-strings is the entire contract
Every other file in the cluster (`preload.ts`, `main/index.ts`, `declarations.d.ts`, `types.ts`) trusts these literals. If a key is renamed without a global search, only runtime errors will catch it.

### Node 2: Domain grouping is consistent
7 domains, blank-line separated, each prefix matching the channel value's namespace. Easy to scan.

### Node 3: Window controls bypass the enum (drift)
`window:minimize`, `window:maximize`, `window:close` appear as bare strings in `preload.ts:69-71` and `main/index.ts:174-182` but are absent here. Violation of the file's invariant role.

### Node 4: Forward-declared channels (AUTH/SYNC)
Lines 34-41: 7 channels with no handler and no preload binding. Aspirational API surface.

### Node 5: Channels but no payload schemas
The file names the channels but not what flows over them. Payload types live in `types.ts` (e.g. `ResourceSnapshot`) but there is no machine-checkable mapping `IPC.RESOURCE_UPDATE -> ResourceSnapshot`. So a main-process refactor that changes a payload shape will not break this file or any caller until runtime.

### Node 6: No exported channel type
`as const` is used, but `export type IpcChannel = typeof IPC[keyof typeof IPC]` is missing. Downstream code that wants to type a generic IPC helper has to re-derive it.

### Node 7: `TERMINAL_READY` is a one-way push but typed as request
Sits next to `TERMINAL_INPUT`/`RESIZE` which are renderer-to-main; `READY` is main-to-renderer. The naming doesn't encode direction. Both `RESOURCE_UPDATE` and `TERMINAL_DATA` have the same ambiguity.

### TENSION A: Centralization vs. completeness
The file claims to be THE channel registry (Node 1) but excludes window controls (Node 3). Either it's the registry or it isn't.

### TENSION B: Declared API surface vs. shipped functionality
Auth/Sync constants (Node 4) advertise an API that doesn't exist. This is good for stability of future imports but bad for "what does this app actually do" clarity.

## Phase 3: REFLECT

### Core Insight
This file is a *namespace*, not a *contract* — it pins names but not directions, payloads, or aliveness, which is why drift hides in plain sight.

### Resolved Tensions
- **A (centralization vs. completeness):** Resolve by adding `WINDOW_MINIMIZE/MAXIMIZE/CLOSE` here and migrating the three bare strings. Cheap, removes the special case.
- **B (declared vs. shipped):** Resolve by moving Phase 5/6 constants to a clearly-marked `IPC_FUTURE` block or `// PHASE 5 (not wired)` comment delimiter so a reader can tell at a glance.

### Hidden Assumptions
- That every contributor will remember to update `preload.ts` AND `declarations.d.ts` AND `types.ts` when a channel is added. Nothing automates this.
- That string typos at handler-registration time will be caught quickly. They won't — `ipcMain.handle('git:detec', ...)` would compile and silently never fire.
- That direction (renderer→main vs main→renderer) is obvious from context. It isn't, e.g. `TERMINAL_READY` (push) sits beside `TERMINAL_INPUT` (send).

## Phase 4: SYNTHESIZE

### What this file should become
A typed channel manifest where each channel literal carries its direction (`Push | Send | Invoke`) and a payload type. Still a single file, still tiny, but the source-of-truth for the IPC surface that the compiler can enforce.

### Actionable items
- [ ] Add `WINDOW_MINIMIZE`, `WINDOW_MAXIMIZE`, `WINDOW_CLOSE` constants; replace the 6 bare-string usages in `preload.ts` and `main/index.ts`.
- [ ] Export `export type IpcChannel = typeof IPC[keyof typeof IPC];`.
- [ ] Add a `// --- Wired ---` / `// --- Phase 5+ (not wired) ---` divider, or move AUTH/SYNC into a sibling `ipc-channels.future.ts`.
- [ ] Introduce an `IpcDirection` and `IpcPayloadMap` (string→type) and use it in a thin `safeInvoke` helper in `preload.ts`. Compile-time payload checking, zero runtime overhead.
- [ ] Document at file top that adding a channel requires touching: `main/index.ts`, `preload.ts`, `types.ts` ElectronAPI, and `declarations.d.ts` Window — until automation closes that loop.

### Risks
- Introducing a payload map is a refactor that touches every handler signature; do it in one PR or it will half-land and increase drift.
- Migrating bare `window:*` strings is trivial but easy to miss if other places (renderer components) reference them — grep first.
- Marking AUTH/SYNC as "future" might tempt deletion; keep the constants so future PRs don't reinvent names.
