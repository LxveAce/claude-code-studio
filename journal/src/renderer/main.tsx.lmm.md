# LMM: src/renderer/main.tsx

> File: `src/renderer/main.tsx` · LOC: 7 · Role: React 18+ entry point; mounts `<App/>` into `#root` and pulls in the global stylesheet.

## Phase 1: RAW

Seven lines, but every one is load-bearing. Line 1 imports React (still needed for the JSX classic runtime in many Vite TS configs even though React itself is referenced only transitively — but if `jsx: "react-jsx"` is set in tsconfig, this import is just for the side-effectful module identity / future hooks). Line 2 brings in `createRoot` from `react-dom/client` — the React 18+ concurrent root API, *not* the legacy `ReactDOM.render`. Line 3 imports the `App` component. Line 4 imports `./styles/globals.css` for its side effects, relying on Vite to inline/inject it as a `<style>` tag in dev and emit a CSS chunk in build; this is the *only* place globals.css is referenced anywhere in the renderer.

Lines 6-7 do the mount. The non-null assertion `document.getElementById('root')!` trusts that `index.html` always contains `<div id="root"></div>` — which it does (index.html line 9). No `<React.StrictMode>` wrapper, which means double-mounting in dev (a useful tool for catching effect-cleanup bugs) is *not* enabled — and means TerminalPanel's pty connection in `useEffect` won't be exercised by StrictMode's intentional double-invoke. This is probably a deliberate choice: pty processes don't like being spawned twice in 50ms.

No error boundary. No suspense root. No service worker. No analytics. The entry file is intentionally a thin shim because this is an Electron renderer — there's no router (App.tsx is the router via `useState`), no auth gate (handled per-panel via IPC), and no hydration (it's a CSR Electron app, not SSR).

### Open Questions
- Is the absence of `<React.StrictMode>` deliberate (to avoid double-mounting the pty in dev) or an oversight? If deliberate, is there a comment somewhere explaining the choice?
- Should an error boundary wrap `<App/>` so a panel crash doesn't blank the entire window — leaving the user with no way to recover their terminal session?
- The `React` default import on line 1: is `jsx: "react-jsx"` set in tsconfig? If so, line 1 is unused; if not, removing it would crash JSX.

## Phase 2: NODES

### Node 1: React 18+ concurrent root
`createRoot` (line 2, 6) opts into concurrent rendering features (automatic batching, transitions, deferred values). The app uses none of these explicitly today, but the door is open.

### Node 2: CSS side-effect import
Line 4 is the *only* renderer-side `globals.css` reference. Vite handles it; in production, this generates a CSS asset linked from the built HTML.

### Node 3: Non-null assertion on `#root`
Line 6's `!` is safe because index.html guarantees the element. Brittle if anyone ever templates index.html.

### Node 4: No StrictMode
Notably absent. In an Electron app spawning child processes via IPC, StrictMode's double-effect invocation can be actively harmful — spawning two ptys, two resource watchers, two GitHub API requests.

### Node 5: No error boundary
A throw deep in any panel will unmount the entire React tree, leaving the user with a blank screen and a still-running pty they can't see.

### Node 6: Single render call
No lazy loading, no Suspense, no router. The whole App tree mounts synchronously on document load.

### Tensions
- **T1 (StrictMode safety vs Electron pty reality):** Modern React dev culture treats omitting StrictMode as a smell, but spawning a pty twice is a real bug in this app.
- **T2 (Minimalism vs resilience):** A 7-line entry is elegant, but the lack of an error boundary means one bad panel = dead UI.

## Phase 3: REFLECT

### Core Insight
This is a *deliberately stripped-down* React 18 entry that trades dev-time safety nets (StrictMode, error boundaries) for production-mode determinism, because the consumer is an Electron renderer where double-effects spawn real OS processes.

### Resolved Tensions
- **T1:** Omitting StrictMode here is *correct* given the pty side-effects in TerminalPanel, but the reason should be documented — a future contributor will "fix" this and break dev.
- **T2:** A `<ErrorBoundary>` wrapper is the cheapest way to buy resilience without sacrificing minimalism — it's still a one-line addition.

### Hidden Assumptions
- That `#root` always exists (true today; would break if index.html is ever made into a template).
- That CSS side-effect imports survive any Vite reconfiguration (true under Vite defaults; would break under a stricter CSS-modules-only setup).
- That all panels are import-cheap enough to load eagerly (true today; might want `React.lazy` for the GitHub panel if it ever bundles a large markdown renderer).
- That the user can recover from a renderer crash by reloading the Electron window (Ctrl+R works in dev; may not in production builds).

## Phase 4: SYNTHESIZE

### What this file should become
A 12-line entry: same shape, plus an `<ErrorBoundary>` wrapper that catches panel crashes and renders a "Reload window" button, plus a one-line comment explaining why `<React.StrictMode>` is omitted.

### Actionable items
- [ ] Add a comment above line 6 stating: "// StrictMode intentionally omitted — TerminalPanel spawns a real pty in useEffect and re-spawning it would orphan the first process."
- [ ] Wrap `<App/>` in an `<ErrorBoundary>` (a tiny custom class component is fine — react-error-boundary is overkill here) so a panel throw doesn't blank the window.
- [ ] Confirm tsconfig `jsx` setting; if `react-jsx`, drop the `import React` to save a few bytes and surface that `React.useState` etc. require explicit imports elsewhere.
- [ ] If GitHub or Resources panels ever grow large, switch their imports in App.tsx to `React.lazy` and add a `<Suspense fallback>` here — but only when needed.

### Risks
- Adding StrictMode "for safety" would break the terminal in dev. The comment is the guard.
- An overly-clever ErrorBoundary that swallows errors silently would mask real bugs; the boundary should `console.error` and show a visible fallback.
- Removing `import React` is safe only after confirming the JSX transform; getting it wrong breaks every JSX file in the renderer.
