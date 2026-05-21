# LMM — vite.renderer.config.ts

## RAW

Seven lines. `root: 'src/renderer'` (so Vite treats `src/renderer/index.html` as the entry — standard SPA layout). `plugins: [react()]` for the JSX transform, Fast Refresh, and React-specific HMR. That's it. No `resolve.alias`, no `define`, no `optimizeDeps`, no `build` overrides, no CSS preprocessing config, no `server` config. Everything else is delegated to Vite defaults + Forge's renderer plugin shim. The renderer has access to xterm.js (`@xterm/xterm`, `@xterm/addon-fit`) which it pulls in as ES module imports — Vite handles those transparently. React 19 + the `react-jsx` transform from tsconfig means no `import React` lines needed. The renderer panel components in `src/renderer/components/**/*.tsx` get bundled into a single chunk by default. Open questions: (1) Why no path alias for `@shared/*` given the renderer reads `src/shared/types` and `src/shared/ipc-channels` via relative paths? (2) Why no `define` for build-time constants like the app version (could mirror package.json `version` into the UI)? (3) Does HMR actually work end-to-end given Electron's contextBridge boundary, or is the renderer the only HMR-friendly part?

## NODES

1. **`root: 'src/renderer'`** — Vite serves and builds from this directory; `index.html` must live there.
2. **`@vitejs/plugin-react`** — JSX, Fast Refresh, automatic runtime (matches tsconfig `jsx: react-jsx`).
3. **No `resolve.alias`** — all cross-tree imports are relative (`../../shared/...`).
4. **No `build.outDir`** — Forge's VitePlugin handles output paths; renderer output goes to `.vite/renderer/main_window/`.
5. **No `optimizeDeps`** — pre-bundle phase uses defaults; xterm packages get pre-bundled automatically.
6. **No `define`** — no build-time injection of constants.
7. **No `css` config** — `src/renderer/styles/globals.css` is a plain CSS file imported from a component; no PostCSS plugins, no CSS Modules config.
8. **No `server`** — dev server uses Vite defaults; Forge's VitePlugin wraps this for Electron integration.
9. **Implicit single-page app** — one `index.html`, one entry, one renderer process.
10. **React 19** — bleeding edge; some plugin compatibility warnings possible (jsx runtime is fine but server components flags etc. aren't relevant here).

**Tension A**: Maximum delegation to Vite + Forge defaults means minimal config maintenance, but also minimal visibility — any future build problem requires understanding Forge's VitePlugin internals.
**Tension B**: No path aliases means relative-import sprawl; `../../shared/ipc-channels` shows up everywhere. Aliases would help, but introducing them requires teaching Vite, TypeScript, and (potentially) ESLint the same mapping.

## REFLECT

Core insight: **this config is the smallest possible expression of "a React app inside an Electron renderer" — every decision is delegated, which is the right call until something breaks.**

Tension A resolved: the cost-benefit of explicit config favors defaults at this scale. Single-developer app, single renderer, single CSS file. Adding configuration only when defaults fail.

Tension B resolved: path aliases are pure ergonomics, not correctness. Defer until the relative-path pain exceeds the wiring cost (probably around Phase 7's growth).

Hidden assumptions: (1) Forge's VitePlugin correctly handles the renderer's output location and serving in dev; (2) React 19 + `@vitejs/plugin-react@^6` is a tested combination (recent enough that bugs may exist); (3) HMR works for React component changes but breaks anything spanning the IPC boundary (which is expected); (4) `src/renderer/index.html` exists with the correct `<script type="module" src="./main.tsx">` entry.

## SYNTHESIZE

What this should become:
- Add `resolve.alias` for `@shared` once relative imports cross three levels deep regularly.
- Add `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` to surface the version in About dialogs.
- Add `build.sourcemap: true` for debugging packaged renderer.
- Consider `optimizeDeps.include: ['@xterm/xterm', '@xterm/addon-fit']` to lock pre-bundling.

Actionable items:
1. Inject `__APP_VERSION__` so settings panel doesn't hardcode "1.0.0".
2. Once `@shared` aliases are added in tsconfig, mirror them here.
3. Verify `index.html` correctness (separate journal — but should reference `./main.tsx` as module).

Risks if untouched: very low. This config is the right minimal shape. The main risk is silent reliance on Forge plugin behavior that may change between Forge 7.x minor versions.
