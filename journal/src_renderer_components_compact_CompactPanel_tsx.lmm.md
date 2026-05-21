# LMM: src/renderer/components/compact/CompactPanel.tsx

## RAW

This 242-line file is the most stateful panel in the cluster. It polls two IPC methods every 3 seconds (`compact.getStatus`, `compact.getConfig` — lines 10-13, polled via `setInterval` on lines 18-22) and renders the result as: a toggle card to install/uninstall the compact hooks (lines 61-91), a 2x2 stats grid (input tokens, output tokens, turns, vaults — lines 94-106), a session ID display (lines 109-129), and a config card listing max-vaults, transcript-tail, logging (lines 132-156). The toggle (lines 161-198) is a hand-rolled iOS-style switch with a translating thumb, and a `disabled={toggling}` guard prevents double-clicks during the install/uninstall IPC round trip. Local helpers `ToggleSwitch`, `StatCard`, `ConfigRow` are defined at the bottom (lines 161-241).

The `formatTokens` helper (lines 36-40) converts large numbers to "1.2M" / "3.4K" / raw — clean. The toggle card's border shifts to `var(--border-active)` and background to `var(--accent-gradient-soft)` when enabled (lines 64-67), a nice subtle state cue. The session ID is rendered in monospace with `wordBreak: 'break-all'` (lines 121-125), avoiding overflow on long IDs.

Open questions:
- Polling every 3 seconds is fine for status but `getConfig` rarely changes — why fetch both? A separate slower cadence (or push notification) would reduce IPC noise.
- The toggle uses `cursor: 'wait'` (line 180) during the toggle but no visible spinner — users may not realize the install is running.
- `ToggleSwitch` does not accept `aria-label`; for SR users the button has no name (lines 171-197).
- `StatCard` is named identically here and in ResourcePanel (where it's `MiniStat`) — both copies should converge.
- What happens if `getStatus()` rejects? The Promise.all on line 10 would throw, the `refresh` function would propagate, and the interval would silently swallow it (no `.catch`).

## NODES

1. **3-second polling for two endpoints** (line 20) — coupled cadence; config rarely changes, status often does.
2. **No error handling on `refresh()`** (lines 9-16) — Promise.all rejects → unhandled rejection in the interval.
3. **Hand-rolled toggle** (lines 161-198) — no native `<input type="checkbox" role="switch">`; misses keyboard space-bar default and screen-reader announcement.
4. **`disabled={toggling}` with `cursor: wait`** (lines 173, 180) — invisible loading state; users may double-toggle visually even when prevented.
5. **Duplicate `StatCard`** (lines 200-227) — twin of ResourcePanel's `MiniStat`.
6. **Local `SectionHeader` pattern inline** (lines 44-58) — fifth copy in the cluster.
7. **Conditional rendering noise** — `status?.enabled ? X : Y` and `status?.sessionId &&` checks scattered (lines 63, 79, 109). A null-status placeholder would reduce branching.
8. **Session ID exposed as text** — copyable via mouse selection but no copy button.
9. **`vault_transcript_tail_bytes / 1024` formatting** (line 152) — inline math; same `formatBytes` helper desire as ResourcePanel.
10. **`gridTemplateColumns: '1fr 1fr'`** (line 97) — repeated three times in the file; not extracted.
11. **Toggle accessibility** — no `role="switch"`, no `aria-checked`, no keyboard support beyond the implicit `<button>` Enter.

Tensions:
- **T1: Polling vs push.** A 3-second interval is wasteful when the main process could emit a `compact:status-changed` event. But adding a subscription requires preload + main-process changes; polling was the lazy MVP.
- **T2: Hand-rolled toggle vs native checkbox.** The custom switch looks better; native gets a11y + form integration for free. A wrapper around `<input type="checkbox">` styled visibly hidden + a `::before` thumb gives both.
- **T3: Local helpers vs primitives.** Five copies of `SectionHeader` and two copies of `StatCard` across the cluster — extraction is overdue.

## REFLECT

**Core insight:** CompactPanel is the heaviest user of every cross-panel pattern (header, stat card, polling, toggle), making it the natural inflection point for extracting a small `components/primitives/` directory that the rest of the cluster would adopt.

Resolved tensions:
- **T1 resolved:** Switch to a push model — main process emits `compact:status` on install/uninstall and during hook runs. Keep a 30-second polling fallback for "we missed an event" cases. Removes 9 IPC calls per minute.
- **T2 resolved:** Wrap a `<input type="checkbox" role="switch">` with `appearance: none` and the existing visual treatment. Free keyboard, a11y, and form-state for the same look.
- **T3 resolved:** Promote `PanelHeader`, `StatCard`, and a new `ToggleSwitch` to `components/primitives/`. CompactPanel shrinks ~80 lines.

Hidden assumptions:
- That `setInterval` will fire reliably while the panel is unmounted (it's cleared on unmount, but if the panel is hidden via tab switch and not unmounted, it keeps polling — depends on App.tsx pattern).
- That `getStatus()` is cheap; if it spawns a subprocess or reads from disk, 3-second polling could be expensive.
- That `status.sessionId` always exists when status exists (it's guarded with `?.`, so partial safety).

## SYNTHESIZE

**What it should become:**
- `useCompactStatus()` hook that owns the polling + push subscription, returning `{ status, config, isStale, refresh }`.
- `<ToggleSwitch>` primitive accepting `aria-label`, `checked`, `onChange`, `disabled`, `loading`.
- Add a spinner inside the toggle thumb when `toggling` is true.
- Copy-to-clipboard button next to session ID.
- Centralize `formatTokens` and `formatBytes` in `src/shared/format.ts`.

Actionable items:
1. Add `aria-label="Toggle Compact Optimization"` and `role="switch"` `aria-checked={enabled}` to `ToggleSwitch` button (line 171).
2. Add `.catch(err => console.warn('[compact] refresh failed', err))` to the Promise.all on line 10.
3. Visualize `toggling` with a small spinner overlaid on the thumb, not just `cursor: wait`.
4. Extract `PanelHeader` (lines 44-58) and merge `StatCard` (lines 200-227) with ResourcePanel's `MiniStat`.
5. Add a small "Copy" icon button beside the session ID monospace display (line 126).
6. Wire a push-based status event from the main process and reduce polling to 30 s as a fallback.

Risks:
- Switching to push requires main-process work and a new IPC contract — significant change.
- Wrapping `<input type="checkbox">` correctly while preserving the current visual means careful CSS; risk of regressions in the thumb translate animation.
- The 3-second polling, while wasteful, is also what gives the panel its "feels alive" quality; pushing alone may make it feel static if events are sparse.
