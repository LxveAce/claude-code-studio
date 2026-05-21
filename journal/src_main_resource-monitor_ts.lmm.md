# LMM: src/main/resource-monitor.ts

> File: `src/main/resource-monitor.ts` · LOC: 117 · Role: Polls system + Claude-process CPU/RAM/GPU every 2s and emits snapshots

## Phase 1: RAW

A simple poller. Uses `systeminformation` (optional, loaded via try/require like `node-pty`), starts a `setInterval`, and on each tick computes a `ResourceSnapshot` from `currentLoad`, `mem`, `graphics`, and `processes`. The Claude-attribution path walks the process tree from `claudePid` via BFS, summing CPU and RSS across the tree. Reasonable approach.

My gut reaction: this is the right shape, but the implementation has a subtle accuracy problem. `si.processes()` is *expensive* (it shells out to `tasklist` on Windows, `ps` on POSIX) and returns CPU as a percentage of one core, not normalized to all cores. Summing CPU across processes in a tree can produce values >100% — that's expected on multi-core but the UI labels it "Claude CPU %" which users will interpret as a percentage of total. The dashboard math in `index.ts` doesn't normalize either, so a 4-core machine could show "Claude: 380%" when it's pinning 4 cores. That's "correct" by the systeminformation contract but misleading.

What scares me: `claudeRam` accumulates `mem_rss` across the tree, but RSS double-counts shared pages between parent/child processes that share libraries. For Node.js + child PTYs this overcounting is real and persistent. Not catastrophic — RAM gauges are approximate — but the "Claude RAM MB" number will be optimistically high (or rather, pessimistically high — making Claude look heavier than it is).

The `getProcessTree` BFS is fine and correctly uses a `visited` set to avoid cycles (theoretical on Windows but possible). However it does a linear `list.find` and a linear filter per iteration — O(N²) over the full process list. With 300 processes and a tree of 5 nodes, that's 1500 array scans every 2 seconds. Not a problem now, but if the polling interval drops or the tree grows, it'll be measurable. Easy fix: build a `Map<pid, proc>` and a `Map<parentPid, child[]>` once per poll.

The silent catch on the entire poll is concerning — `systeminformation` errors get swallowed, so a permission issue or a `tasklist` hang shows as "stale snapshot" with no diagnostic.

Naive understanding: "polls system stats every 2s." First-instinct miss: the *quality* of the Claude-attribution numbers depends on assumptions (CPU normalization, RSS double-counting) that aren't documented anywhere.

### Open Questions
- Why does `start()` ignore the request if `si` is null instead of emitting an error or a degraded snapshot?
- Should the interval be adaptive (slow down when window is hidden)?
- Is the `getProcessTree` BFS visiting children correctly? It looks like the same children get pushed multiple times before being visited.
- Does `setClaudePid(0)` ever happen? Looks like the PID is set but never reset on Claude exit.

## Phase 2: NODES

### Node 1: Optional `systeminformation`
`si` may be `null`; `start()` silently no-ops in that case.
Why it matters: Renderer sees no `update` events with no signal as to why.

### Node 2: 2-second poll interval, fixed
Hard-coded default; no backoff when window hidden or app idle.
Why it matters: Constant `tasklist` calls on Windows = constant minor CPU cost from the monitor itself.

### Node 3: Process tree BFS
Walks descendants from `claudePid` summing CPU and RSS.
Why it matters: This is the entire "Claude usage" calculation. Correctness here is load-bearing.

### Node 4: CPU sum is per-core, not normalized
`si` returns CPU as % of one core. Summing across processes can exceed 100%.
Tension with Node 3: BFS sum is mathematically correct but the UI label "cpuPercent" implies % of system.

### Node 5: RSS sum double-counts shared memory
`mem_rss` includes shared pages; summing across parent+child inflates total.
Tension with Node 3: Same accuracy issue, different metric.

### Node 6: O(N²) tree walk
`list.find` + filter per BFS node, across the full process list each iteration.
Why it matters: Fine today, latent perf bug at scale.

### Node 7: Silent error swallow
`catch {}` on the entire poll body.
Why it matters: Real failures (permissions, OS errors) are invisible.

### Node 8: `claudePid` never cleared
`setClaudePid` is called only on `ready`. If Claude exits and isn't restarted, the monitor keeps trying to find a dead PID, returning zeros.
Tension with Node 7: Silent failure of the attribution path, indistinguishable from "Claude isn't using anything right now."

### Node 9: GPU is best-effort
`gpu.controllers[0]` only, and only if `utilizationGpu` is numeric. Intel iGPUs return `undefined`.
Why it matters: Documented in HANDOFF; the renderer must handle `null` gracefully (it does).

## Phase 3: REFLECT

### Core Insight
The monitor is **honest about what it polls and dishonest about what those numbers mean** — accuracy concerns (CPU per-core, RSS double-counting, stale PID) are buried in the implementation while the snapshot interface promises clean percentages.

### Resolved Tensions
- **Node 4 vs Node 3 (per-core sum vs UI label)** → Resolution: divide the summed Claude CPU by `os.cpus().length` to normalize to system percent, OR rename the field to `cpuCoresUsed` and let the UI render "3.2 cores" instead of "320%". Either way, name and value must agree.
- **Node 7 vs Node 8 (silent failure of dead-PID attribution)** → Resolution: when `claudePid` is set but never found in the process list, emit an `update` with `claude.pidCount=0` AND a `staleness` flag. The renderer can show "Claude not running" instead of misleading zeros.

### Hidden Assumptions
- Assumed: the Claude process tree is the right unit of attribution. — Challenge: Claude spawns subagents and may share workers with the user's shell; a strict process-tree walk misses workers and may include unrelated grandchildren.
- Assumed: `systeminformation` is fast enough that a 2-second interval is harmless. — Challenge: `si.processes()` on Windows can take >500ms on cold runs; if a poll overlaps the next, intervals slip.
- Assumed: RSS is a useful proxy for "RAM usage." — Challenge: PSS (proportional set size) or USS would be more honest for shared libraries; systeminformation doesn't expose PSS, but at least documenting the limitation matters.

## Phase 4: SYNTHESIZE

### What this file should become
A monitor that owns its accuracy claims — either normalize CPU and document RSS overcounting, or rename fields to match what they actually measure. Add a single per-tick `Map`-backed lookup for the process tree to remove the O(N²). Add a "monitor health" indicator (running, idle, error, stale-pid) that the UI can surface so users know whether to trust the numbers.

### Actionable items
- [ ] Normalize Claude CPU by `os.cpus().length` (or expose both raw and normalized values in the snapshot).
- [ ] Build `pidMap` and `childrenMap` once per poll in `getProcessTree` to drop to O(N).
- [ ] Detect dead `claudePid` (PID set but not found in process list) and emit a stale flag.
- [ ] Replace `catch {}` with a counter + last-error stored on the monitor; expose via a `getHealth()` method or include in snapshots.
- [ ] Pause polling when `mainWindow.isVisible()` is false to save power on a hidden window.
- [ ] Document the RSS double-counting caveat in `ResourceSnapshot` JSDoc on `types.ts`.
- [ ] Have `pty-manager` notify the monitor on `exit` so `claudePid` resets to 0 explicitly.

### Risks
- Normalizing CPU changes the meaning of a field consumers (UI) already read; coordinate with the renderer change in one commit.
- Pausing on hidden window may hide a runaway process the user wants to catch; consider a slower poll (10s) when hidden instead of full pause.
- Switching to `Map` lookups touches the only nontrivial logic in the file; keep the BFS shape and just swap the lookups.
