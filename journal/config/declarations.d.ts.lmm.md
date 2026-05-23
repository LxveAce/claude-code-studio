# LMM: src/declarations.d.ts

> File: `src/declarations.d.ts` · LOC: 110 · Role: Ambient TypeScript declarations — CSS modules, `node-pty` and `systeminformation` shims, and the global `Window.electronAPI` shape consumed by the renderer.

## Phase 1: RAW

This file is doing three jobs at once and it shows. Lines 1-4 declare CSS modules so `import styles from './foo.css'` typechecks. Lines 6-27 declare a hand-rolled type shim for `node-pty` because the package ships without bundled `.d.ts` (or because the install on Windows is brittle enough — see HANDOFF.md known issue #2 — that the team chose not to depend on whatever ambient types the package might publish). Lines 29-43 do the same shim for `systeminformation`, declaring only the four functions actually called from `resource-monitor.ts` (`currentLoad`, `mem`, `graphics`, `processes`). Lines 45-109 then redeclare `interface Window { electronAPI: { ... } }` — the entire renderer-facing IPC surface, in full structural detail, with `import('./shared/types').XYZ` references for return shapes.

The single biggest concern is *not* this file's existence but that it carries the *only* complete, current definition of `ElectronAPI`. The other shared file (`types.ts:119-127`) defines a thin, terminal-only `ElectronAPI` that is essentially dead — nothing in the cluster reuses it. The renderer sees `window.electronAPI` typed by this `.d.ts`, so this file is the de-facto contract and `types.ts`'s `ElectronAPI` is stale shadow. Two definitions, one truthful — same drift smell as called out in the `types.ts` analysis but from the other side.

Within this file, the `Window.electronAPI` block is structurally correct against `preload.ts`: terminal exposes `onData/onExit/onReady/sendInput/resize/restart` (matches preload lines 6-23), resources exposes `onUpdate/start/stop` (preload 26-30), compact (preload 33-38), git (preload 41-44), github (preload 47-66), window (preload 69-71). However: `preload.ts:26` types `onUpdate` callback as `(data: unknown)` while this declaration types it as `(cb: (data: ResourceSnapshot) => void)`. The declaration is more honest; the preload is just lossy. Similarly `preload.ts:37` accepts `(config: unknown)` while this declares `Partial<CompactConfig>`. So the renderer gets correct typing through this file *despite* preload's looseness — the declaration is the contract, preload is the implementation, and they're not synchronized.

The `node-pty` shim is suspiciously minimal: only `pid`, `onData`, `onExit`, `write`, `resize`, `kill`. Real node-pty has flow control, `pause/resume`, `clear`, etc. The shim is tight enough that adding a feature in `pty-manager.ts` will require expanding the shim by hand — silent friction.

### Open Questions
- Why is `ElectronAPI` defined twice (here and in `types.ts:119-127`)? Which is canonical?
- Should the `node-pty` and `systeminformation` shims live in this file or move to `types/` sub-folder per package?
- Is using `import('./shared/types')` in an ambient `.d.ts` always evaluated, or only when types are referenced? (TS resolves these lazily, so it's fine, but worth confirming for the team.)
- Should there be `// @ts-expect-error` guards or `module 'node-pty'` augmentation if upstream adds types?

## Phase 2: NODES

### Node 1: Three unrelated declarations in one file
CSS module ambient, two package shims, one Window global. None of these belong together except by virtue of being "ambient stuff."

### Node 2: This file is the de-facto canonical ElectronAPI
Lines 45-109 are complete, current, and consumed by the renderer. `types.ts:119-127`'s `ElectronAPI` is stale and partial.

### Node 3: ElectronAPI here is more typed than in preload.ts
`onUpdate` callback typed as `ResourceSnapshot` (line 56) vs preload's `unknown` (preload.ts:26). `setConfig` typed as `Partial<CompactConfig>` (line 66) vs preload's `unknown` (preload.ts:37). Declaration is correct; preload is lossy.

### Node 4: node-pty shim is minimal-by-necessity, not minimal-by-design
Lines 6-27. Captures only what `pty-manager.ts` uses. New features = manual shim expansion.

### Node 5: systeminformation shim is tighter than node-pty's
Lines 29-43. Four functions. Same fragility pattern, same justification (avoid pulling huge ambient types from upstream).

### Node 6: Direct dynamic-import references in ambient declarations
`import('./shared/types').ResourceSnapshot` etc. on lines 56, 61, 64, 66, 67, 70, 76-100. Valid TS, well-supported, but couples this ambient file to a real module's path. Move `types.ts` and this file breaks.

### Node 7: No `export {}` at top
File is in ambient/script mode (no top-level `export`/`import`), which is correct for ambient declarations to extend the global `Window`. Fine but easy to break by accident.

### Node 8: Window controls typed here without IPC channel constants
Lines 103-107 type `window.minimize/maximize/close` but the *implementation* (preload.ts:69-71) uses bare strings. Consistent symptom of the missing `IPC.WINDOW_*` constants.

### TENSION A: Two canonical `ElectronAPI` definitions, only one is real
`types.ts` exports a stale, terminal-only `ElectronAPI` (real module, importable). `declarations.d.ts` declares a complete `Window.electronAPI` (ambient, global, not importable as a name). Renderer code can `window.electronAPI` (uses this file) or `import { ElectronAPI } from '../../shared/types'` (uses the stale one) — both compile, only one is right.

### TENSION B: Package shims as ambient declarations vs. proper `@types` strategy
Shimming `node-pty` and `systeminformation` here avoids dependency churn but means any version bump that changes APIs is invisible until runtime.

## Phase 3: REFLECT

### Core Insight
This file is the renderer's de-facto IPC contract — *because* `types.ts`'s `ElectronAPI` was abandoned mid-build and never reconciled, the more honest type definitions live in an ambient `.d.ts` where they cannot be imported by name.

### Resolved Tensions
- **A (two ElectronAPI defs):** Define the canonical `ElectronAPI` in `shared/types.ts` as an exported interface; reduce this file's `Window` block to `interface Window { electronAPI: import('./shared/types').ElectronAPI }`. One source, one truth.
- **B (shim strategy):** Keep shims for now (Windows install pain documented). When `node-pty` or `systeminformation` bumps major versions, audit upstream `.d.ts` and either adopt or expand the shim deliberately.

### Hidden Assumptions
- That ambient `.d.ts` resolves before renderer code typechecks, so `window.electronAPI` is always typed at point of use. True if `tsconfig.json` includes `src/declarations.d.ts` (verify).
- That `import('./shared/types')` paths inside ambient declarations don't trigger circular module evaluation. They don't — TS treats them as type-only.
- That the team will remember to update both this file AND `preload.ts` AND (if reconciled) `types.ts` when adding a channel. Untrue today, hence the drift.
- That `node-pty`'s and `systeminformation`'s ambient global `module` augmentation pattern won't collide with future `@types/*` installs.

## Phase 4: SYNTHESIZE

### What this file should become
A *thin* ambient file that does three small things: CSS module declaration, package shims (until upstream types are trusted), and a single-line `Window.electronAPI` that points to `import('./shared/types').ElectronAPI`. The full IPC API shape moves to `types.ts` where it can be imported by name and shared with `preload.ts`.

### Actionable items
- [ ] Move the full `Window.electronAPI` body (lines 46-108) into `shared/types.ts` as `export interface ElectronAPI { ... }` (replacing the stale partial one at 119-127).
- [ ] Reduce this file's lines 45-109 to: `interface Window { electronAPI: import('./shared/types').ElectronAPI }`.
- [ ] Verify `tsconfig.json` includes `src/declarations.d.ts` and that the renderer build picks it up (run `tsc --noEmit` after the refactor).
- [ ] Annotate the `node-pty` and `systeminformation` shims with comments naming the upstream version pinned and the call sites that depend on them.
- [ ] Split CSS module declaration into `src/css.d.ts` and package shims into `src/packages.d.ts` if this file grows past ~150 lines.
- [ ] Add `WINDOW_*` constants in `ipc-channels.ts` and reflect them in preload — the declaration in this file is already correct for the shape, the implementation just needs to match.

### Risks
- Migrating `ElectronAPI` to an exported type may shake out other places that import the stale partial; fix as you find them.
- Reducing the ambient `Window` block to a single line means a regression in `types.ts` immediately breaks the renderer's typing — keep the move atomic.
- Splitting this file is cheap but `tsconfig.json` `include`/`files` must be updated; ambient `.d.ts` files are easy to silently drop from the build.
- The package shims protect against version drift but also hide it; budget time after each `npm update` to re-verify.
