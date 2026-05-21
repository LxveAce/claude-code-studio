# LMM — vite.preload.config.ts

## RAW

Three lines. `import { defineConfig } from 'vite'; export default defineConfig({});`. Literally an empty config. Every behavior comes from Forge's `VitePlugin` defaults and Vite's own defaults. The preload entry is declared in `forge.config.ts` (`entry: 'src/preload/preload.ts'`, `target: 'preload'`) and the `target: 'preload'` tells Forge's plugin which set of defaults to apply (Electron preload environment: Node + sandbox-restricted browser context, contextBridge available). The preload script bridges main and renderer via `contextBridge.exposeInMainWorld('electronAPI', {...})` — referenced in `HANDOFF.md` and `src/declarations.d.ts`. Because preload runs in a context with Node access but also DOM access (via contextBridge), externalization decisions are subtle: Node built-ins (`electron`, `path`, `fs`) must stay external because they're host-provided; npm packages should generally be bundled to avoid runtime module resolution from a sandboxed context. Open questions: (1) Does the empty config mean preload accidentally bundles Electron itself (it shouldn't — `electron` is treated as external by Forge's defaults)? (2) What if preload starts importing `@xterm/xterm` directly — would it bundle the browser build or the node build? (3) Should this file even exist, or could it be removed and the `config:` field in forge.config.ts simply omitted?

## NODES

1. **Empty config** — pure delegation to Forge's plugin defaults.
2. **Preload context** is Node + sandbox-restricted DOM — different constraints than main or renderer.
3. **`electron` module** must be external (host-provided); Forge defaults handle this automatically.
4. **No `external` list** — preload bundles everything it imports except Electron internals.
5. **No `target`** — defaults to whatever Forge's plugin sets (likely `node22` or similar Electron-compatible target).
6. **File exists only to satisfy the `config:` field in forge.config.ts** — Vite requires a config file when one is referenced.
7. **No comment explaining why it's empty** — future contributor will assume it's a placeholder to fill in.
8. **No `build.lib` config** — preload script output format is determined by Forge.
9. **Could theoretically be removed** if Forge's VitePlugin allowed config-less entries, but the API requires a `config:` path.
10. **Consistency with main/renderer**: both have at least some config; preload has none. Inconsistency invites edits.

**Tension A**: An empty config file is honest ("nothing custom needed here") but invites edits ("must be incomplete, let me add things").
**Tension B**: Preload is the most security-sensitive boundary in Electron (contextBridge implementations leak privileges if wrong) — yet its build config is the least scrutinized.

## REFLECT

Core insight: **the emptiness IS the configuration** — the preload script is small and self-contained, so defaults work, but the file's existence creates the illusion that decisions were made here when in fact none were.

Tension A resolved: add a comment. One sentence ("Intentionally empty — preload uses Forge VitePlugin defaults; no externals required because contextBridge.exposeInMainWorld and ipcRenderer are loaded from Electron at runtime") prevents the "I should add things here" reflex.

Tension B resolved: build-config security and runtime-API security are orthogonal. The preload's safety comes from `src/preload/preload.ts` itself (what it exposes via contextBridge), not from this file. Empty config is fine; the audit target is the preload source.

Hidden assumptions: (1) Forge's VitePlugin handles Electron preload targeting correctly out of the box; (2) preload doesn't import any ESM-only npm packages (it shouldn't — preload should be thin); (3) the preload bundle doesn't accidentally include `node-pty` or other heavy main-process deps (the preload should only import types from `src/shared/types`, never main-process modules).

## SYNTHESIZE

What this should become:
- Add a one-line comment block explaining why the config is empty.
- Optionally add `build.sourcemap: 'inline'` for preload debugging.
- Verify (in a separate src/preload/preload.ts journal) that preload doesn't import any package that requires externalization.

Actionable items:
1. Add a header comment so future contributors don't "fix" the emptiness.
2. Audit `src/preload/preload.ts` imports (separate journal) to confirm no externalization is required.
3. Consider whether preload sourcemaps would help debug contextBridge issues.

Risks if untouched: extremely low for this file specifically. The risk is in `src/preload/preload.ts` getting an inappropriate import that needs externalization, at which point the missing config infrastructure here becomes the bottleneck.
