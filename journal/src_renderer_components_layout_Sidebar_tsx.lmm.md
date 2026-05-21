# LMM: src/renderer/components/layout/Sidebar.tsx

## RAW

This 203-line file renders the 56-px-wide vertical icon rail on the left edge of the app. Lines 9-90 declare a static `panels` array of `{ id, label, icon }` tuples where every icon is an inline `<svg>` literal — eight icons in all, ranging from a 24-line GitHub Octocat path (lines 56-58) to a 5-element settings cog (lines 84-87). The exported `Sidebar` component (lines 92-137) splits this list into "first 5" (top group, lines 106-114) and "rest" (bottom group, lines 125-133) with a 24x1 separator div between them (lines 117-122) — there is no semantic reason these groups exist in code other than visual grouping. The `SidebarButton` subcomponent (lines 139-202) owns hover and tooltip state via two separate `useState` hooks (lines 145-146), renders a 40x40 rounded button, and conditionally renders an absolutely-positioned tooltip 52 px to the right (lines 178-199).

Open questions:
- Why are icons baked into the same file as the navigation list? An icon registry would let other components reuse the GitHub icon, the settings cog, etc.
- Why `panels.slice(0, 5)` (line 106) and `panels.slice(5)` (line 125) instead of a `section: 'main' | 'utility'` field on each entry? The magic number 5 will silently break if anyone reorders.
- The `title=""` empty string on line 154 explicitly suppresses native browser tooltips — why? Is it because the custom tooltip on lines 178-199 is preferred? If so, why not omit `title` entirely?
- No keyboard navigation: arrow-up/arrow-down to traverse the rail, no focus management. Is the rail meant to be mouse-only?
- The tooltip uses `animation: 'fadeIn 0.15s ease'` (line 195) referencing a global keyframe — where is `@keyframes fadeIn` defined?

## NODES

1. **Static icon-and-route array** (lines 9-90) — couples nav structure to icon assets. Hard to extend without touching this file.
2. **Slice-based grouping** (lines 106, 125) — `panels.slice(0, 5)` is fragile; should be data-driven (`group: 'primary' | 'secondary'`).
3. **Duplicated terminal glyph** (lines 14-17) — identical to TitleBar logo (TitleBar.tsx 29-32). Confusing because brand and "Terminal panel" use the same symbol.
4. **Per-button hover + tooltip state** (lines 145-146) — two `useState` for related UI state; could be one machine.
5. **Hover state in JS, not CSS** — same anti-pattern as TitleBar; rerender on every mouseenter.
6. **Empty `title=""` (line 154)** — defensive but unclear; comment would help.
7. **Custom tooltip in JS** (lines 178-199) — absolutely positioned, no `role="tooltip"`, no `aria-describedby`, not keyboard-triggered (only `mouseenter`).
8. **No `aria-current` or `aria-selected`** — active button only differs visually via `background: 'var(--accent-gradient)'` (line 161); screen readers cannot tell which panel is active.
9. **No semantic `<nav>` wrapping** — the outer container is a `<div>` (line 94), not `<nav aria-label="Primary">`.
10. **Hardcoded geometry** — width 56 (line 95), button 40x40 (lines 156-157), tooltip offset 52 (line 181). All three must agree; one place to break.
11. **`role="button"` is implicit** but no `aria-pressed` / `aria-selected` to convey toggle state for the active panel.

Tensions:
- **T1: Icon-as-data vs icon-as-asset.** Inlining SVG keeps icons as React nodes (themeable via `currentColor`) but bloats this file and prevents reuse. An icon library would normalize stroke widths but break the bespoke-feel of each panel.
- **T2: Magic slice vs semantic grouping.** `slice(0, 5)` is concise today but invisible coupling tomorrow. A `group` field is verbose now, robust later.
- **T3: Custom tooltip vs native `title`.** Native is free + a11y-compliant but ugly. Custom is pretty but inaccessible (no keyboard, no screen reader). The current code paid both costs (custom + suppress native) without claiming either benefit fully.

## REFLECT

**Core insight:** The sidebar mixes presentation (SVGs, geometry), structure (which panels exist), and interaction (hover + tooltip) into one file, so any new nav item requires touching three concerns; an `Icon` registry plus a typed `NavItem[]` config would split them.

Resolved tensions:
- **T1 resolved:** Keep inline SVG (current pattern is consistent), but extract each icon into `components/icons/*.tsx` so Sidebar imports `TerminalIcon`, `GithubIcon`, etc. Files stay small, icons stay themeable.
- **T2 resolved:** Replace `slice(0,5)`/`slice(5)` with `panels.filter(p => p.group === 'main')` and a `group: 'main' | 'utility'` field. The separator becomes conditional on group boundary.
- **T3 resolved:** Either commit to custom (add `role="tooltip"`, `aria-describedby`, focus-trigger via `onFocus`), or drop custom and use a real positioning library (Floating UI). The current half-state is the worst of both.

Hidden assumptions:
- That hover is reachable — touch and keyboard users cannot trigger the tooltip; the icons are not labeled visibly, so they're effectively guess-the-glyph for those users.
- That the panel order in code matches the desired visual order — no sorting, no priority.
- That `var(--accent-gradient)` will always have enough contrast against white SVG strokes (line 165). On a light theme it might not.

## SYNTHESIZE

**What it should become:**
- A typed `NAV_ITEMS: NavItem[]` config where each entry has `{ id, label, IconComponent, group }`.
- `SidebarButton` accepts `IconComponent` not `icon: ReactNode`, takes `aria-label={label}`, sets `aria-current={active ? 'page' : undefined}`.
- Outer container is `<nav aria-label="Primary navigation">`.
- Tooltip becomes a `<Tooltip>` primitive used app-wide, with `role="tooltip"`, keyboard support, and focus trigger.
- Keyboard nav: arrow up/down moves focus between buttons (roving tabindex pattern).

Actionable items:
1. Add `aria-label={label}` and `aria-current={active ? 'page' : undefined}` to the `<button>` on line 150.
2. Wrap the outer `<div>` (line 94) in `<nav aria-label="Primary">`.
3. Replace `slice(0, 5)` / `slice(5)` with a `group` field — the separator (lines 117-122) becomes derived.
4. Extract each SVG into `components/icons/<Name>Icon.tsx`. Sidebar drops 70 lines.
5. Add `onFocus`/`onBlur` handlers that also toggle `showTooltip` so keyboard users see labels.
6. Remove `title=""` (line 154) once custom tooltip is keyboard-accessible.

Risks:
- Adding `aria-current` may not be honored by all screen readers consistently for non-anchor elements; consider `aria-pressed` instead since these are buttons, not links.
- A focus-triggered tooltip can interfere with screen-reader announcements (the `aria-label` already says it); test with NVDA.
- Splitting icons into files balloons the import list; offset by a barrel `components/icons/index.ts`.
