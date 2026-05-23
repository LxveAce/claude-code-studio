# LMM: src/renderer/components/layout/StatusBar.tsx

## RAW

This 41-line file is the simplest in the cluster: a single fixed-height (28 px, line 10) horizontal bar at the bottom of the app that shows a connection status indicator (green/red dot + "Connected"/"Disconnected" label, lines 22-31), a conditional PID display (lines 32-36), and a right-aligned version string "Claude Code Studio v1.0.0" (line 38). It accepts a single prop `pid: number` (line 4) and treats `pid > 0` as the entire definition of "connected" (line 27). The status dot uses `var(--success)` and `var(--danger)` tokens (line 27) but the matching glow shadows are raw RGB literals `rgba(34,197,94,0.4)` and `rgba(239,68,68,0.4)` (line 28), which means a theme change won't propagate to the glow.

Open questions:
- Should "Connected" really mean "the PID is > 0"? What about Claude crashing but the PID still being live, or the connection being slow/degraded?
- The version string "Claude Code Studio v1.0.0" (line 38) is the third hardcoded copy of the app name (also in TitleBar line 40, line 50). Why not centralize?
- There's no click handler on the PID — should it be copyable, or open a process inspector?
- No status for the resource collector, compact controller, GitHub auth, or any other subsystem — should the status bar aggregate multiple sources?
- The bar uses `userSelect: 'none'` (line 19) which means the PID number cannot be selected/copied with the mouse — is that intentional? PIDs are exactly the kind of thing you'd want to copy.

## NODES

1. **Binary connected/disconnected** (line 27) — collapses many possible states (starting, exiting, crashed-but-pid-known, healthy) into a boolean.
2. **Raw RGB glow literals** (line 28) — drift from `var(--success)` / `var(--danger)` tokens used on the same line. Theme rebrand will leave a green halo on a red dot.
3. **Hardcoded version + product name** (line 38) — duplicates TitleBar lines 40 + 50.
4. **`userSelect: 'none'` blocks copy** (line 19) — PID is a developer artifact users want to copy when filing bugs.
5. **No icon for status** — only a dot. A wifi-off icon, plug icon, or text-only label could improve a11y.
6. **No `aria-live` region** — the connection state can change asynchronously (terminal exits) but a screen reader will not be notified.
7. **No `role="status"` or `role="contentinfo"`** on the bar itself.
8. **PID hidden when 0** (line 32) but no equivalent affordance to retry/restart from the status bar.
9. **No clickable affordances** — the bar is purely passive; a click could surface the terminal panel or restart.

Tensions:
- **T1: Token vs literal for the same color.** Lines 27 and 28 disagree on whether success/danger come from tokens; one variable change leaves the other behind.
- **T2: Block selection vs allow copy.** `userSelect: none` is correct for chrome but wrong for the PID number.
- **T3: Passive vs interactive status.** Today the status bar tells you the state but offers no actions. VSCode/IntelliJ status bars are clickable; should ours be?

## REFLECT

**Core insight:** The status bar is honest about what it knows (pid > 0 means alive) but pretends that knowledge is enough state for the user, when in practice users want to copy the PID, see additional subsystem health, and act on a degraded state.

Resolved tensions:
- **T1 resolved:** Replace the literal `rgba(34,197,94,0.4)` and `rgba(239,68,68,0.4)` with CSS variables `--success-glow` and `--danger-glow`, defined in the same place as `--success` and `--danger`. One source of truth per color.
- **T2 resolved:** Wrap the PID `<span>` (line 33-35) in a child with `userSelect: 'text'` overriding the parent rule. Or replace with a small "copy" button that copies to clipboard on click and shows a tooltip "Copied".
- **T3 resolved:** Keep the bar passive for v1, but design the next iteration as a slotted container that other subsystems push status into (compact controller could push "indexing", GitHub could push "auth needed", resource monitor could push "high CPU"). For now, document the intent.

Hidden assumptions:
- `pid: number` is a sufficient health signal — but it's a snapshot from the renderer's perspective, not a heartbeat. The terminal process could be deadlocked with a valid PID.
- The bar will never overflow — no logic for what happens if status text exceeds the bar width on a narrow window.
- The version always matches what TitleBar shows. If the bar reads from a different source, they could diverge.

## SYNTHESIZE

**What it should become:**
- A slotted `<StatusBar>` that accepts `<StatusItem>` children, each with `icon`, `label`, `tone: 'ok' | 'warn' | 'error' | 'muted'`, and optional `onClick`.
- Connection status becomes one such item, owned by the terminal subsystem.
- PID becomes copyable (click-to-copy with toast feedback).
- Version reads from shared `APP_VERSION` constant.
- Outer container gets `role="status"` and an `aria-live="polite"` region for state changes.

Actionable items:
1. Define `--success-glow` and `--danger-glow` CSS variables in the global stylesheet, replace literals on line 28.
2. Replace the version string (line 38) with `{APP_VERSION}` imported from `src/shared/version.ts`.
3. Add `aria-live="polite"` to the connection-status container (lines 22-31) so the change to "Disconnected" is announced.
4. Add a click-to-copy handler on the PID `<span>` (line 33), or wrap it in a child div with `style={{ userSelect: 'text' }}`.
5. Consider extracting a `ConnectionDot` primitive (used here + potentially elsewhere when adding sync/auth status).

Risks:
- `aria-live="polite"` may produce noisy announcements during normal start/stop cycles; throttle or only announce on unexpected exits.
- Adding clickable PID may confuse users who expect a status bar to be passive; pair with subtle hover affordance.
- Extracting a `StatusItem` slot pattern is over-engineering for one bar; defer until at least 3 subsystems want to push status.
