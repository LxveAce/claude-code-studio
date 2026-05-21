# LMM: src/renderer/components/resources/ResourcePanel.tsx

## RAW

This 127-line file is the right-side panel for the "Resources" sidebar tab. It subscribes to a single IPC stream `electronAPI.resources.onUpdate` on mount (lines 8-12) which feeds it a `ResourceSnapshot` typed object containing `system` and `claude` sub-objects with CPU/RAM/GPU percentages. While `snapshot` is null (lines 14-36), it renders a fade-in spinner with the text "Collecting system data..."; once data arrives, it renders three `<GaugeBar>` components for CPU, Memory, GPU (lines 42-58), followed by a two-column grid of `<MiniStat>` cards for "Claude Processes" and "Claude Memory" (lines 60-74). The file defines two local helper components: `SectionHeader` (lines 79-99) which is the gradient-bar-plus-title pattern reused across CompactPanel, CommandsPanel, SettingsPanel; and `MiniStat` (lines 101-126) which is the same shape as `StatCard` in CompactPanel.tsx (lines 200-227).

The GPU gauge (lines 53-58) passes `claudePercent={0}` unconditionally and an `unavailable` flag derived from `snapshot.system.gpuPercent === null` — which only works because the `??` on line 55 already swapped `null` for `0`. So `unavailable` is the truthful signal; `systemPercent={0}` is a harmless lie when GPU is unavailable.

Open questions:
- The IPC `onUpdate` (line 9) registers a listener but the cleanup function returned from `useEffect` is empty — same subscription-leak suspicion as TerminalPanel.
- `SectionHeader` is defined locally here, in CompactPanel (lines 44-58), CommandsPanel (lines 89-103), and SettingsPanel (lines 115-129) — four copies. Why hasn't it been extracted?
- The "Claude Memory" stat (line 71) shows MB, but the system memory bar shows percent + GB. Inconsistent units.
- Where is `--gauge-grey` defined? GaugeBar uses it (lines 64, 102) and so does CompactPanel's ToggleSwitch (line 181) — not in the theme presets in SettingsPanel.
- Why is the polling cadence not displayed? The user has no idea how often "Collecting system data..." will resolve.

## NODES

1. **Repeated `SectionHeader` pattern** (lines 79-99) — four copies across panels. The 3x14 gradient bar + 13px 600-weight title is a clear primitive.
2. **Local `MiniStat` vs CompactPanel's `StatCard`** — same idea, different name, different padding (10/12 vs 10/12 — actually identical), different `lineHeight`. Trivially mergeable.
3. **Untracked IPC listener** (lines 9-11) — same as TerminalPanel; cleanup is missing.
4. **GPU "unavailable" double-signal** (lines 55, 57) — `??` and `=== null` both encode availability; one is enough.
5. **Loading state branch** (lines 14-36) — duplicates the SectionHeader call (line 17), then duplicates again on the main return (line 40). Header could live above the conditional.
6. **Spinner via inline keyframe** (line 29) — references global `pulse` animation; spinner is a `border-top` half-circle which is non-standard.
7. **No "last updated" timestamp** — user sees gauges move but cannot tell if data is stale.
8. **MiniStat uses `--accent-light` for the value** (line 112) — couples value typography to accent theme; will brighten with theme but may lose contrast.
9. **Hardcoded MB unit** (line 72) — assumes Claude RAM is always representable in MB; for huge sessions a GB rollover would look like "12345 MB".
10. **No error state** — what if `electronAPI.resources` throws or never emits? Loading state would persist forever.

Tensions:
- **T1: Local helpers vs shared primitives.** Every panel reinvents `SectionHeader` and stat cards. The friction to extract is low; the friction to keep duplicating is also low. The codebase is at the inflection point where duplication becomes worse than abstraction.
- **T2: Loading state vs missing state.** A spinner says "data coming" but doesn't recover from "data never coming." A timeout to surface an error would help.
- **T3: Theme coupling.** Using `--accent-light` for big number typography means the resource panel changes color tone when the user picks a new theme — that may be desirable (consistent app feel) or undesirable (CPU usage shouldn't change color with personalization).

## REFLECT

**Core insight:** ResourcePanel is the cleanest panel in the cluster, which makes its small redundancies (local `SectionHeader`, untracked IPC subscription) the clearest case for extracting a shared `<PanelHeader>` and a `useElectronSubscription()` hook.

Resolved tensions:
- **T1 resolved:** Extract `PanelHeader` to `components/primitives/PanelHeader.tsx` — used here, in CompactPanel, CommandsPanel, SettingsPanel. Four panels collapse 4 x 20 lines into one import each.
- **T2 resolved:** Add a 5-second timeout that flips to an error state with "Resource data not arriving — check resource monitor process" so the user is not stuck staring at a spinner forever.
- **T3 resolved:** Decide explicitly: keep `--accent-light` (the big numbers feel personalized) but document the choice in the design system; or switch to `--text-primary` for content typography (numbers are content, not chrome).

Hidden assumptions:
- That `snapshot.system.gpuPercent === null` is the only signal for GPU unavailability (not e.g. `undefined`, not `NaN`).
- That MB is always the right unit for Claude memory (a long-running Opus session can plausibly exceed 4 GB).
- That the snapshot's freshness is implicit; user trusts the gauges are live.

## SYNTHESIZE

**What it should become:**
- `PanelHeader` lifted to `components/primitives/PanelHeader.tsx`.
- `StatCard` (the merged version of MiniStat + CompactPanel's StatCard) lifted to `components/primitives/StatCard.tsx`.
- `useElectronSubscription(channel, handler)` hook that returns the unsubscribe in cleanup.
- A `useStaleData(snapshot, ttlMs)` hook that flips to a stale flag after N seconds without update.
- A `formatBytes(mb)` util so memory readouts switch to GB when above 1024 MB.

Actionable items:
1. Extract `PanelHeader({ title })` to a shared primitive; replace local copy on lines 79-99 with import.
2. Merge `MiniStat` (here) and `StatCard` (CompactPanel) into a single `StatCard` primitive with optional `align: 'left' | 'center'`.
3. Wrap the IPC subscription on line 9 in a cleanup-returning hook; ensure the preload provides an unsubscribe.
4. Add a unit-aware formatter: `${ramMB >= 1024 ? (ramMB/1024).toFixed(1) + ' GB' : ramMB + ' MB'}`.
5. Add a 5-second timeout that surfaces an error placeholder if `snapshot` never arrives.

Risks:
- Extracting `PanelHeader` will touch 4 files at once; coordinate the change with the styling diff to avoid visual regressions.
- The unit switch (MB to GB) is a number-formatting change that may affect screenshots in docs.
- Adding an error state requires confirming the IPC contract — if `electronAPI.resources.onUpdate` cannot fail silently, the timeout will fire on slow systems and feel like a false alarm.
