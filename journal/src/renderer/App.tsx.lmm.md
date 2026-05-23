# LMM: src/renderer/App.tsx

> File: `src/renderer/App.tsx` · LOC: 195 · Role: Root React component; owns sidebar panel routing, terminal-send ref bridge, and the placeholder/coming-soon scaffolding.

## Phase 1: RAW

This is the structural spine of the renderer. It declares the `SidebarPanel` union (8 ids, line 12-20) which is the single source of truth for *what panels exist in this app* — Sidebar.tsx imports it as a type and CommandsPanel/GitHubPanel are looked up by the same string. The component owns three pieces of state: `activePanel`, `claudePid`, and a `terminalSendRef` that is *passed by mutable ref into TerminalPanel*. That ref pattern is unusual: instead of lifting `sendInput` into context, App keeps the function pointer alive via a `useRef<((data:string)=>void)|null>` (line 25), and any panel that needs to inject text (currently only `CommandsPanel` via `handleSendCommand` on line 27-32) calls a stable `useCallback` that dereferences it. The `\r` appended on line 29 is a deliberate ENTER — the command is *executed*, not just typed. After sending, control flips back to the terminal panel via `setActivePanel('terminal')`.

Layout is entirely inline-styled (no CSS modules, no styled-components): TitleBar / Sidebar+main / StatusBar in a flex column, with the main area itself a flex row containing the always-mounted `TerminalPanel` and a conditionally-rendered 320px right panel. The right panel is keyed by `showRightPanel = activePanel !== 'terminal'` (line 34) — meaning Terminal is the "panel zero" baseline, never as a slide-in.

`RightPanel` (line 90) is a `switch` over the union; `case 'github'` (line 106-107) is the recently wired Phase 4 addition. `sync`, `auth`, `settings` fall through to `PlaceholderPanel`, which is interesting because `settings` *also* has a real component imported on line 9 — but the switch routes it to SettingsPanel, so the `settings` entry in the placeholder `info` dict (line 125-129) is dead code (or a stale safety net). The PlaceholderPanel renders a small "Coming in Phase N" badge with the accent gradient — a nice UX signal that the app is being built in phases.

### Open Questions
- Why a mutable `useRef` instead of context for `terminalSendRef`? Is it because TerminalPanel writes to the ref imperatively from its own `useEffect`, and a context provider would force re-renders?
- The `settings` PlaceholderPanel entry is unreachable. Was Settings recently promoted from placeholder to real component, leaving stale data?
- `'terminal'` and `'commands'` are the only panels that interact with the terminal — should `handleSendCommand` be lifted into a `useTerminalSender` hook so future panels (e.g. GitHub "checkout this PR") can reuse it without prop-drilling?

## Phase 2: NODES

### Node 1: SidebarPanel union as routing schema
Lines 12-20 declare an 8-member string union that drives the Sidebar buttons, the RightPanel switch, and (via re-import) the Sidebar component. Adding a new panel requires three coordinated edits.

### Node 2: useRef-based imperative terminal bridge
`terminalSendRef` (line 25) is mutated by TerminalPanel (`sendRef` prop on line 62) and read by `handleSendCommand` (line 27-32). This sidesteps React's data flow for a stable function pointer.

### Node 3: Terminal-always-mounted invariant
The `TerminalPanel` is rendered unconditionally (line 60-63); only the *right* panel toggles. This preserves the pty session, xterm scrollback, and the `terminalSendRef` connection across panel switches.

### Node 4: Phase 4 GitHub wiring
Lines 10 (import) and 106-107 (route) are the surgical additions for Phase 4. Notably, `GitHubPanel` is the only right-panel component that takes *no props* — it pulls auth/repo state via `window.electronAPI.github` directly.

### Node 5: Auto-return to terminal after command
`handleSendCommand` ends with `setActivePanel('terminal')` (line 31). UX choice: after picking a command from the palette, the user wants to see the terminal scroll, not stay on the picker.

### Node 6: 320px fixed right panel width
Lines 68-69 hardcode `width: 320, minWidth: 320`. Not resizable. Reasonable for an MVP; eventually a drag-handle and persistence in settings.

### Node 7: PlaceholderPanel as phase-tracking UI
Lines 113-195 produce a unified "coming soon" card per unbuilt panel. The `phase` field doubles as roadmap documentation rendered to the user — phases 5, 6, 7 visible to anyone running the build.

### Node 8: Inline-style monoculture
Every style is an inline object. Pros: zero CSS cascade conflicts, theme tokens via CSS vars still work. Cons: no `:hover`/`:focus` pseudo-classes (Sidebar simulates them with state), no media queries.

### Node 9: Animation hooks via globals.css keyframes
`animation: 'slideIn 0.2s ease'` (line 74) and `'fadeIn 0.3s ease'` (line 135) reference keyframes defined in globals.css. The renderer relies on a small named-animation vocabulary.

### Tensions
- **T1 (Imperative ref vs declarative React):** The `terminalSendRef` pattern works but is the one place that breaks React's data-flow rules; it will surprise contributors expecting context.
- **T2 (Inline styles vs design system):** The app *has* design tokens (globals.css) but no component library — every consumer rebuilds the same chrome (cards, badges, gradients) inline.
- **T3 (Routed-by-string union vs typed components):** The `switch` on line 97-110 hides the fact that two panels (`auth`, `sync`) have no real implementation; TypeScript can't catch a missing case because `default:` swallows it.

## Phase 3: REFLECT

### Core Insight
App.tsx is a *router masquerading as a component*: its real job is to map the 8-string `SidebarPanel` union to a right-side React tree while keeping the terminal mounted as a persistent zero-state, and the `terminalSendRef` is the one imperative escape hatch that lets the palette inject commands into that persistent pty.

### Resolved Tensions
- **T1:** The ref pattern is correct here, *because* re-rendering TerminalPanel would tear down xterm and the pty connection — the imperative bridge is the price of keeping that session alive. Context would have the same property *only* if exposed as a ref-like object; a plain context value would still trigger consumer re-renders.
- **T3:** The lack of exhaustiveness check in `RightPanel` is hidden by `PlaceholderPanel`'s graceful fallback — but this is also why a stale `settings` entry sat undetected in the placeholder dict. A `satisfies Record<SidebarPanel, ReactNode>` table would be safer.

### Hidden Assumptions
- That the user always wants the terminal *behind* the right panel (no full-screen mode for, say, the GitHub PR list).
- That 320px is the right width for every right-panel kind (Resources gauges, Commands search, GitHub repos all share it).
- That string-keyed routing is "good enough" — no deep links, no back/forward history, no URL.
- That only one extra panel is ever needed beside the terminal (no split-view).

## Phase 4: SYNTHESIZE

### What this file should become
A minimal `<AppShell>` that delegates routing to a typed registry, with the terminal-sender exposed via a small `TerminalContext` whose value is a stable ref object. The placeholder system should be data-driven from a single roadmap module rather than an inline dict.

### Actionable items
- [ ] Extract a `panelRegistry: Record<SidebarPanel, { component, label, icon, phase? }>` shared by Sidebar and RightPanel — eliminates the three-place edit when adding a panel.
- [ ] Add a `satisfies` constraint on the registry so TypeScript fails the build if a `SidebarPanel` id is unrouted.
- [ ] Remove the dead `settings` entry from `PlaceholderPanel.info` (line 125-129) — SettingsPanel is already wired on line 104-105.
- [ ] Wrap `terminalSendRef` in a `TerminalSenderContext` exposing `{ send: (cmd) => void }` so future panels (GitHub "checkout PR", Resources "kill pid") don't need prop-drilling. Keep the underlying ref; just hide the imperative-ness behind a hook.
- [ ] Promote the inline right-panel chrome (`width 320 / borderLeft / padding 16`) into a `<RightPanelFrame>` component so each panel doesn't re-implement padding.
- [ ] Consider a roadmap.ts module that owns the `phase` metadata, imported by both PlaceholderPanel and any future "What's coming" splash.

### Risks
- Refactoring to context will work *only* if the context value is a stable ref-bearing object — a fresh `{ send }` per render would cause downstream consumers to re-render and could thrash TerminalPanel if it ever consumes its own context.
- A typed registry that requires `component`, `label`, and `icon` would force `auth` / `sync` to have real (even stub) components, removing the convenient PlaceholderPanel fallback unless the registry value allows `{ kind: 'placeholder', phase }`.
- Inline-styled monoculture is *self-consistent* today; partial migration to a component library would create a confusing mixed style.
