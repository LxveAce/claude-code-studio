# LMM: src/renderer/index.html

> File: `src/renderer/index.html` · LOC: 12 · Role: Vite entry HTML for the Electron renderer process; provides the `#root` mount and ESM script tag for `main.tsx`.

## Phase 1: RAW

A textbook Vite entry document. `<!DOCTYPE html>`, `lang="en"`, UTF-8, viewport meta, title `Claude Code Studio`, a single `<div id="root"></div>`, and `<script type="module" src="./main.tsx"></script>`. That's it. No favicon, no preconnect, no meta description, no Open Graph (irrelevant for an Electron app, but the title is what shows up in window chrome). No theme-color, no manifest. Most strikingly: **no Content Security Policy meta tag**.

For an Electron renderer that calls `contextBridge.exposeInMainWorld('electronAPI', ...)` (see preload.ts), the absence of a CSP is a real choice. Electron's docs strongly recommend a CSP meta tag for renderers — without one, any successfully-injected `<script>` (or eval, or inline handler) runs with whatever privileges the renderer has. With `contextIsolation` enabled (assumed, since preload uses `contextBridge`), the damage is bounded to what `electronAPI` exposes — but `electronAPI.terminal.sendInput(...)` is a *direct shell injection vector* if a malicious script can call it (e.g. via XSS in rendered markdown from GitHub issues/PRs).

The script tag uses `./main.tsx` — a *relative* path to a TypeScript file. This only works because Vite handles TSX transpilation in dev and rewrites the path during build. Outside of Vite, this HTML is non-functional.

No `<noscript>` fallback. No splash screen / preloader markup — the user sees a flash of unstyled blank space until React mounts. Inline styles on `<body>` could mask that, but the choice was to let globals.css's `html, body, #root { background: var(--bg-primary) }` rule (line 64-74) handle it once CSS loads.

### Open Questions
- Why no `<meta http-equiv="Content-Security-Policy">`? Is the CSP set via Electron's session interceptor in main.ts instead, or is it genuinely missing?
- Should there be a splash background color set as an inline style on `<body>` to avoid the white-flash before globals.css loads?
- Is `lang="en"` accurate for an internationalizable product, or will future i18n change this?

## Phase 2: NODES

### Node 1: Vite-managed TSX entry
Line 10's `src="./main.tsx"` is Vite-specific. Vite serves the transpiled module in dev and emits a hashed JS bundle (rewriting this path) in build.

### Node 2: Single mount node
Line 9's `<div id="root">` is the sole React mount. `main.tsx` line 6 reads it. No alternative mounts, no portals declared in the HTML.

### Node 3: No CSP
Conspicuous omission for an Electron app. May be compensated by main-process `session.webRequest.onHeadersReceived` injection, but a meta tag is the simplest defense-in-depth.

### Node 4: Title as window chrome
`<title>Claude Code Studio</title>` (line 6) controls the Electron BrowserWindow title bar text when no custom title is set in main.ts.

### Node 5: No preloaded fonts
globals.css line 70 declares Inter as the preferred font but doesn't `@import` it and the HTML doesn't `<link rel="preload">` it. Result: Inter is only used if installed locally; otherwise the system fallback chain (Segoe UI on Windows, etc.) kicks in.

### Node 6: No favicon
Irrelevant in Electron's BrowserWindow (the icon is set via `BrowserWindow` options), but if this HTML is ever served via a dev URL in a browser tab, the missing favicon shows.

### Tensions
- **T1 (Minimal HTML vs security hardening):** A 12-line HTML is elegant but skips CSP, which Electron explicitly recommends.
- **T2 (FOUC vs no inline styles):** Letting globals.css paint the background means a brief flash of white before CSS loads; an inline `<body style="background:#0f0f1a">` would eliminate it cheaply.

## Phase 3: REFLECT

### Core Insight
This HTML is a *bootloader stub* — its only jobs are providing a mount point and a script tag — but in the Electron context the missing CSP makes it the de-facto security perimeter for the renderer, and the missing inline body background makes it the de-facto FOUC surface.

### Resolved Tensions
- **T1:** Defense-in-depth is cheap here: a single `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com 'self';">` would meaningfully reduce blast radius for any future XSS in rendered GitHub content (PR titles, issue bodies, commit messages).
- **T2:** A single inline `<body style="background:#0f0f1a">` is one line and eliminates the white flash on slow CSS load (cold start, first paint after an update).

### Hidden Assumptions
- That contextIsolation is enabled in main.ts BrowserWindow creation (must be verified — if disabled, `electronAPI` *is* the full Node API and CSP is non-negotiable).
- That GitHub-derived content (PR titles, issue bodies, commit messages) is never rendered with `dangerouslySetInnerHTML` or via a markdown library with HTML enabled.
- That `'./main.tsx'` resolution will always be Vite-managed (true today; would break if anyone ever opens this HTML directly).
- That the user's system has *some* sans-serif font — true on Win11.

## Phase 4: SYNTHESIZE

### What this file should become
Same skeleton, plus: a CSP meta tag scoped to what the app actually loads (self + api.github.com + maybe avatars.githubusercontent.com), an inline body background matching `--bg-primary` to kill FOUC, and a comment marking the file as Vite-managed.

### Actionable items
- [ ] Add `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self' https://api.github.com;">` — adjust hosts after auditing what the GitHub panel actually fetches.
- [ ] Add inline `<body style="background:#0f0f1a; color:#ececf1;">` matching globals.css `--bg-primary` and `--text-primary` to prevent the white-flash on cold start.
- [ ] Add `<meta name="color-scheme" content="dark">` so native form controls (scrollbars, default buttons) render dark even pre-CSS.
- [ ] Verify in main.ts that `BrowserWindow` is created with `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }`. If not, that is the higher-priority fix.
- [ ] Optional: add a tiny inline SVG/text "Loading…" inside `#root` so the user sees something during the first paint.

### Risks
- A too-strict CSP will silently break the GitHub panel if it loads avatar images or fetches from unanticipated hosts. Add CSP *after* surveying actual network traffic, and use `Content-Security-Policy-Report-Only` first if a reporting endpoint exists.
- Inline body background diverges from the CSS var — if `--bg-primary` is ever themed (e.g. light mode), the hardcoded `#0f0f1a` becomes wrong. Mitigate by also dynamically swapping it from JS once theme is loaded, or accept that the dark-mode flash is fine since this is a dark-only app today.
