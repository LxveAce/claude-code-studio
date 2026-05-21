# LMM: src/renderer/components/resources/GaugeBar.tsx

## RAW

This 124-line file is a single presentational component rendering a labeled progress bar with overlaid "system total" and "Claude only" fills. It accepts `label`, `systemPercent`, `claudePercent`, optional `detail`, and optional `unavailable` (lines 3-9). The bar uses absolute positioning to stack two `<div>`s inside the same 6-px track (lines 49-81): the grey bar represents total system usage, and the gradient bar represents Claude's share, both clamped via `Math.min(x, 100)` (lines 63, 73) so values over 100% (e.g. spiky CPU) don't overflow visually. The legend below (lines 83-110) labels both fills with their numeric values, or shows "GPU monitoring unavailable" when `unavailable` is true. The 0.6 s cubic-bezier transition (lines 66, 76) smooths value changes from the resource update stream.

Open questions:
- The Claude bar is drawn *on top of* the system bar with `position: absolute; left: 0` (lines 68-72) — so if Claude is using 5% and system is at 50%, the visual is "5% gradient over 50% grey," which is correct but counterintuitive (one might expect Claude's share to start where it ends in the system bar, not overlap it).
- `Math.min(systemPercent, 100)` (line 63) silently truncates spike values — should the bar flash red or shake at 100%+?
- `unavailable` is the only branching state; what about `loading` (e.g. before first sample)?
- The transition is `width 0.6s` — at 1 Hz polling that's most of the interval, so the bar is always in motion. Is that intentional liveness or visual noise?
- The legend dot uses `var(--accent)` (line 95) and `var(--gauge-grey)` (line 102) — but the bar uses `var(--accent-gradient)` (a multi-stop gradient). The dot doesn't visually match the gradient, just its starting hue.

## NODES

1. **Overlaid bars** (lines 56-80) — Claude on top of system, not concatenated. Visual semantics need a legend to disambiguate.
2. **Hardcoded 100% clamp** (lines 63, 73) — values over 100 are common for multi-core CPU; the cap hides genuine info.
3. **Boolean `unavailable` flag** (line 8) — extensible to `loading`, `error` states by becoming `status: 'ok' | 'loading' | 'unavailable' | 'error'`.
4. **Inline glow shadow on Claude bar** (line 77) — `'0 0 8px rgba(124,58,237,0.3)'` — hardcoded purple, breaks on non-purple themes (Blue, Emerald, etc. would still have a purple glow).
5. **Transition timing 0.6 s** (lines 66, 76) — close to polling cadence; can feel laggy or busy.
6. **Magnetic 6 px track height** (line 50) — design choice; consistent with sidebar geometry (4-px gap, 7-px dot).
7. **`var(--gauge-grey)` for system bar** (line 64) — separate from `--bg-secondary` etc.; lives in some global stylesheet not visible here.
8. **No `role="progressbar"`** — semantically a progress indicator, but rendered as plain divs; no `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.
9. **Legend dot vs bar disagreement** (lines 93-96 vs 73-75) — dot is solid `--accent`, bar is `--accent-gradient`. Subtle but real.
10. **`detail` is render-as-string** (lines 112-120) — no formatting opinion; ResourcePanel passes pre-formatted GB strings (ResourcePanel.tsx line 51). Couples the formatter to the parent.

Tensions:
- **T1: Glow hardcoded vs themed.** Line 77's purple rgba does not move with theme; the rest of the bar does. One pixel of purple glow on an emerald theme is incorrect.
- **T2: Visual liveness vs semantic accuracy.** 0.6 s transitions look alive but make instantaneous spikes invisible. A "peak indicator" notch would preserve information.
- **T3: Overlay vs stack metaphor.** Two bars overlapping in the same track is space-efficient but ambiguous; a stacked bar (Claude grey, rest empty) or a split bar (Claude solid, system overlay tinted) might be clearer.

## REFLECT

**Core insight:** GaugeBar is a clean primitive whose only debt is the hardcoded purple glow — every other coupling is intentional, and addressing the glow drift unlocks safe theme switching across the resource panel.

Resolved tensions:
- **T1 resolved:** Replace `'0 0 8px rgba(124,58,237,0.3)'` (line 77) with a `--shadow-claude-bar` CSS variable, updated by `applyTheme()` in SettingsPanel.tsx with a per-theme glow value.
- **T2 resolved:** Add a small "peak" tick that holds the last 2 seconds' max value via a separate state; the smooth bar shows the current value, the tick shows the spike. Or shorten transition to 0.3 s.
- **T3 resolved:** Keep the overlay metaphor (space-efficient on a narrow sidebar) but make Claude's bar slightly translucent (`opacity: 0.95`) so the underlying system fill leaks through, hinting at the layering.

Hidden assumptions:
- That `systemPercent >= claudePercent` always (Claude is a subset of system) — true for CPU and RAM, but a user might pass arbitrary numbers and break the visual.
- That a 6-px track height is enough to convey two overlapping bars; that's tight on HiDPI.
- That `Math.round` (line 45, 97, 104) for display percentages is precise enough; users monitoring CPU rarely care about decimals.

## SYNTHESIZE

**What it should become:**
- A11y: add `role="progressbar"`, `aria-valuenow={systemPercent}`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-label={label}`. Optionally a hidden text summary for the Claude share.
- Theme-aware glow via `--shadow-claude-bar` variable.
- Status enum instead of boolean `unavailable`: `status: 'ok' | 'loading' | 'unavailable' | 'error'`.
- Optional `peak` prop for spike retention.

Actionable items:
1. Add `role="progressbar"` and aria attributes to the outer track div (line 49).
2. Replace inline glow shadow (line 77) with `var(--shadow-claude-bar)`; add the variable to SettingsPanel's `applyTheme()`.
3. Change `unavailable?: boolean` to `status?: 'loading' | 'unavailable'`; update ResourcePanel call sites.
4. Make legend dot use `var(--accent-gradient)` via `background-image` so it matches the bar's stop.
5. Document in a comment that "system" includes Claude's share, so the bars are intentionally overlaid.

Risks:
- Changing the `unavailable` API is a breaking change for ResourcePanel; coordinate.
- Adding `role="progressbar"` makes screen readers announce continuous changes — throttle announcements with `aria-live="off"` and a separate manual announcement if useful.
- The glow variable must be defined per theme; adding 6 new tokens to SettingsPanel's `applyTheme` increases the surface area of theming.
