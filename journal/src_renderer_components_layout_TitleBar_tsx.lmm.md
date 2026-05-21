# LMM: src/renderer/components/layout/TitleBar.tsx

## RAW

This is a 109-line custom Windows-style titlebar component. Lines 5-17 declare the outer drag region using the Electron-specific `WebkitAppRegion: 'drag'` CSS property, escaped with `@ts-expect-error` comments on lines 12 and 57. The component renders an app logo (a 22x22 rounded gradient square containing an inline terminal SVG, lines 19-33), the product title "Claude Code Studio" at line 40, a hard-coded version pill "v1.0.0" at line 50, and a trio of window control buttons (minimize, maximize, close) wired through `window.electronAPI.window.*` IPC calls on lines 62, 66, and 70. The `WinButton` subcomponent (lines 78-108) is a self-contained button with local hover state, sized at the Windows-standard 46x32, with the close button getting a red hover treatment via the `isClose` prop branch on line 95.

Open questions:
- Why is the version literal `v1.0.0` baked into JSX (line 50) and also into StatusBar (line 38)? Where is the single source of truth?
- The maximize button always shows the "maximize" icon; should it swap to the "restore" double-square glyph when already maximized?
- Why does each `WinButton` carry its own `useState(hovered)` instead of using `:hover` pseudo-class? Is there a stylistic reason to avoid CSS hover, or just a pattern inherited from the rest of the codebase?
- The logo SVG (the "code prompt" icon at lines 29-32) is duplicated exactly in `Sidebar.tsx` lines 14-17 — should it be extracted to a shared `<Icon>` library?
- There is no `aria-label` on any window button (lines 60, 64, 68); screen readers will announce them as nameless buttons. Is that intentional for an opaque chrome bar, or a gap?

## NODES

1. **Drag region escape hatch** (lines 12, 57) — two `@ts-expect-error` for `WebkitAppRegion`. Suggests `declarations.d.ts` should augment `CSSProperties` once, not silence per-site.
2. **Hardcoded version string** (line 50) — duplicated in StatusBar; should read from `package.json` via a build-time constant or `app.getVersion()` IPC.
3. **Branded logo SVG** (lines 29-32) — identical to Sidebar terminal icon. Branding and panel-nav share a glyph by coincidence, not by design.
4. **Inline SVG window-control icons** (lines 61, 65, 69) — strokes/sizes set per-icon; no consistency primitive.
5. **Hover-state-in-JS pattern** (lines 83, 87-88) — `useState` on every button rerenders entire button on mouseenter/leave. CSS `:hover` is cheaper and accessible to keyboard focus too.
6. **Missing keyboard focus styling** — no `:focus-visible` outline; controls disappear for keyboard users.
7. **No a11y labels** — `WinButton` accepts no `label` prop; missing `aria-label="Minimize"` etc.
8. **isClose semantic flag** (line 71) — boolean-prop variant pattern that will not scale to a third color (e.g. error/warning states).
9. **Color theme assumption** — `rgba(239,68,68,0.9)` for close hover (line 95) is a raw literal instead of `var(--danger)` used elsewhere (StatusBar line 27). Theming will drift.
10. **No restore icon swap** — maximize button always shows square, not double-square on maximized state. The IPC doesn't expose window state to the renderer.

Tensions:
- **T1: Custom chrome vs platform conventions.** Reimplementing Windows controls in React costs us a11y, hover transitions, and HiDPI scaling that the OS gives for free. Yet a fully custom titlebar is the only way to get a brand-colored drag region.
- **T2: Per-button hover state vs declarative CSS.** Each button owns its hover state in React, which is convenient but mismatched against the rest of the app that uses CSS variables for transitions.
- **T3: Hard-coded literals (`v1.0.0`, red rgba) vs design tokens.** The file mixes both styles, suggesting nobody owns "what is a token vs what is a one-off."

## REFLECT

**Core insight:** The titlebar treats chrome as a one-off React island rather than a small set of reusable design-system primitives, so version strings, brand glyphs, and danger colors each diverge once.

Resolved tensions:
- **T1 resolved:** Custom chrome is justified for branding, but the cost (no `:focus`, no a11y, no restore icon) is unbooked tech debt — accept the custom shell, then port back OS-style behaviors deliberately (focus ring via CSS, restore icon via window-state subscription).
- **T2 resolved:** The hover-state-in-React pattern leaks into every panel in this cluster (Sidebar, QuickCommands, SettingsPanel). It is the codebase's convention now, not an accident — but it should be migrated to a shared `useHover()` hook so future themes (e.g. reduced-motion) can hook in once.
- **T3 resolved:** Introduce a `--danger` token usage (StatusBar already uses one) and an `APP_VERSION` constant imported by both TitleBar and StatusBar.

Hidden assumptions:
- That the app is always Windows-styled (the controls match Windows ordering: min/max/close on the right). On macOS this layout would be wrong.
- That `window.electronAPI.window.*` always exists at render time — no null check in `onClick` handlers.
- That `useSelect: 'none'` on the chrome covers the version pill — fine for now, but if the version becomes copyable that needs revisiting.

## SYNTHESIZE

**What it should become:**
- Lift `WinButton` into `components/primitives/IconButton.tsx` accepting `variant: 'default' | 'danger'`, `aria-label` required.
- Move `WebkitAppRegion` typing fix into `declarations.d.ts` once; delete both `@ts-expect-error`s.
- Replace `'v1.0.0'` (and StatusBar line 38) with `APP_VERSION` imported from a shared `version.ts` that reads from `package.json` at build time.
- Extract the brand glyph (lines 29-32) into `components/brand/AppLogo.tsx`; Sidebar imports the same.
- Add `aria-label` to each window control; add `:focus-visible` ring via global CSS.
- Subscribe to window-maximized state via a new `window.electronAPI.window.onMaximizeChange` and swap the maximize icon for a restore glyph when maximized.

Actionable items:
1. Add `aria-label="Minimize window"`, `aria-label="Maximize window"`, `aria-label="Close window"` to the three calls on lines 60, 64, 68. (1-line change each.)
2. Create `src/shared/version.ts` exporting `export const APP_VERSION = '1.0.0';` and import in TitleBar + StatusBar.
3. Replace `rgba(239,68,68,0.9)` (line 95) with `var(--danger)`.
4. Drop the per-button `useState(hovered)` in favor of a `data-hovered` attribute set via CSS `:hover`, or extract into `useHoverState()`.

Risks:
- Changing the close-button color to `var(--danger)` may shift the exact red shown today (token is opaque; literal has 0.9 alpha) — verify visual diff.
- Adding focus rings could clash with the drag region's `userSelect: none` if `outline` collapses; test keyboard tab order through chrome.
- Reading version at build time requires a small Vite plugin or `import.meta.env` wiring — not free.
