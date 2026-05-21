# LMM: src/renderer/components/terminal/TerminalPanel.tsx

## RAW

This 140-line file is the most behaviorally complex in the cluster: it wraps xterm.js as a React component, owning the terminal lifecycle from mount to dispose. The component takes `onPidChange` (line 7) and an optional `sendRef` ref (line 8) which the parent uses to push data into the terminal from outside (e.g. from the Commands panel). The big `useEffect` (lines 17-114) instantiates xterm with a hardcoded color theme matching the app's purple palette (lines 21-44), loads the FitAddon, opens it into the ref'd div, wires three IPC subscriptions (`onData`, `onReady`, `onExit` — lines 73-87), debounces a `ResizeObserver` callback at 50 ms (lines 89-100), and schedules an initial fit at 150 ms via `setTimeout` (lines 105-108). On terminal exit, the second `useEffect` (lines 116-127) installs a one-shot data handler that restarts the terminal on any keypress and self-disposes (lines 119-124).

The two most subtle moves are: (1) the `useEffect` on line 17 has `[]` dependencies (line 114) but reads `sendRef` and `onPidChange` from closure — a stale-closure trap if the parent ever passes different functions; (2) the exit-restart effect on lines 116-127 depends on `[exited]` so it re-installs the handler each time `exited` flips, but it uses `termRef.current` which may have been swapped out (it hasn't, but the invariant is fragile).

Open questions:
- Why are the theme colors hardcoded (lines 21-44) when SettingsPanel.tsx supports 6 accent themes? Switching to "Emerald" leaves the terminal cursor purple.
- The fit timeouts (50 ms debounce, 150 ms initial) are magic numbers — what conditions were they tuned for?
- The `try { fit.fit() ... } catch {}` at lines 93-98 swallows all errors silently — what classes of errors are expected vs unexpected?
- IPC channels `terminal.onData`, `onReady`, `onExit` register listeners but the cleanup (lines 110-113) only disposes the terminal and resize observer — are the IPC listeners leaked on unmount?
- The restart flow (lines 116-127) waits for any keypress, but what if the user has muscle-memory'd into a prompt before reading the exit message?

## NODES

1. **Hardcoded terminal theme** (lines 21-44) — disconnected from SettingsPanel's theme presets. Mismatch on any theme change.
2. **Closure capture of props** (lines 78, 86) — `onPidChange` and `sendRef` read once at mount; new prop identities would not take effect.
3. **Empty dep array justification** — required because xterm should mount exactly once, but this means the effect cannot react to any prop change. Documented... nowhere.
4. **Silent error swallow** (lines 96-98) — `catch {}` with only a comment "terminal may be disposed". No `console.warn` for unexpected errors.
5. **Magic timing constants** — 50 ms debounce (line 92), 150 ms initial fit (line 108). No comment on derivation.
6. **IPC listener cleanup gap** — `electronAPI.terminal.onData/onReady/onExit` are subscribed at lines 73-87; only `term.dispose()` runs on unmount. If subscribe returns an unsubscribe, it's discarded.
7. **Restart UX is mystery-meat** (lines 82-86, 116-127) — "Press any key to restart" works but bypasses keyboard shortcut conventions; Enter or Ctrl+R would be more discoverable.
8. **One-shot handler self-disposal** (line 123) — clever but brittle; if `setExited(false)` race-condition fires twice, the handler may be missing on the second exit.
9. **Hardcoded font fallback chain** (line 45) — fine for v1 but not user-configurable despite SettingsPanel pretending to show "Font Size" (SettingsPanel.tsx line 213).
10. **`allowTransparency: true`** (line 52) — enables background blend with the app's `var(--bg-primary)` (line 135), but if a user picks a high-contrast theme, the terminal's solid `#0f0f1a` background will fight it.

Tensions:
- **T1: One-shot lifecycle vs reactive props.** xterm wants exactly one instance; React wants effects to track dependencies. The empty `[]` is the pragmatic compromise but creates stale closures.
- **T2: Hardcoded terminal theme vs theme system.** The SettingsPanel changes CSS variables, but xterm needs JS values at construct time. They are two parallel theming systems.
- **T3: Silent fault tolerance vs observability.** The blanket `catch {}` hides bugs; the magic timings hide intent.

## REFLECT

**Core insight:** The terminal lives in two worlds — xterm's imperative JS lifecycle and React's declarative effects — and the seams between them (theme, IPC cleanup, prop reactivity) are exactly where future bugs will appear.

Resolved tensions:
- **T1 resolved:** Keep the empty `[]`, but stash the latest `onPidChange` and `sendRef` in refs (`useRef`) updated by a side-effect each render. The closure reads `latestOnPidChangeRef.current(pid)`. This is the canonical "stable callback" pattern.
- **T2 resolved:** Read CSS variables at mount time via `getComputedStyle(document.documentElement).getPropertyValue('--accent')` and pass them to the xterm theme. Subscribe to theme changes and call `term.options.theme = {...}` to re-apply. Bridge the systems explicitly.
- **T3 resolved:** Replace `catch {}` with `catch (e) { console.warn('xterm fit failed', e); }` so the silent path becomes loud during development. Add comments next to 50/150 ms explaining what they protect against (xterm DOM measurement race during panel mount).

Hidden assumptions:
- `window.electronAPI.terminal.*` is always defined; no null check.
- The parent component will not remount this component (it's the root content of the active panel; if `activePanel` switches and back, xterm is reconstructed and the PID is requested again — does the main process handle reattach?).
- `sendRef.current = ...` is the parent's intended pattern; not enforced by type system that the parent will null it on unmount.

## SYNTHESIZE

**What it should become:**
- Stable-callback pattern for `onPidChange` and `sendRef` via internal refs.
- Theme bridging: read accent from CSS variables at mount; provide a `useTerminalTheme()` hook that re-applies when accent changes.
- Capture and dispose all IPC subscriptions: `const off1 = electronAPI.terminal.onData(...); return () => off1();`
- Replace "press any key to restart" with an explicit button overlay shown when `exited` is true, with `Enter` as the documented shortcut.
- Move timings (50, 150 ms) into named constants with comments.

Actionable items:
1. Wrap callback props in refs to fix the stale-closure trap: `const onPidChangeRef = useRef(onPidChange); useEffect(() => { onPidChangeRef.current = onPidChange; });`
2. Replace `catch {}` (line 96) with `catch (e) { console.warn('[terminal] fit failed:', e); }`.
3. Verify `window.electronAPI.terminal.onData/onReady/onExit` return an unsubscribe function (check preload); if so, capture and call in cleanup.
4. Extract magic numbers: `const RESIZE_DEBOUNCE_MS = 50; const INITIAL_FIT_DELAY_MS = 150;` near top of file, with a comment.
5. Add a `theme` prop that takes an accent color, and apply CSS-var values at mount; later, react to theme changes.
6. Replace bare "Press any key to restart" with a small inline restart affordance (button) for discoverability.

Risks:
- Refactoring the IPC subscription pattern requires preload to return unsubscribe handles; if it currently returns void, that is a contract change.
- Reading CSS variables synchronously at mount is fine, but `getPropertyValue` returns empty string before the stylesheet loads — guard with a fallback.
- Adding a restart button changes the terminal's visual footprint when exited; may push content reflow.
