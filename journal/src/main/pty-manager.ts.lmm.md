# LMM: src/main/pty-manager.ts

> File: `src/main/pty-manager.ts` · LOC: 125 · Role: Spawns and manages the Claude Code child process, preferring `node-pty` with a `child_process` fallback

## Phase 1: RAW

A focused class that owns one job: launch `claude(.exe)` and pipe its IO to the renderer. The dual-path design (PTY when available, plain `child_process` otherwise) is pragmatic — HANDOFF.md mentions that `node-pty` requires VS Build Tools and Spectre-mitigated MSVC libraries, so a graceful fallback prevents a useless app on machines without the native build deps.

My gut reaction: clean, but the fallback path is a lie. `spawnWithChildProcess` uses `shell: true` and pipes stdout/stderr, but Claude Code is an interactive TUI — it almost certainly expects a real TTY for arrow keys, line editing, color sequences. The fallback will "work" in the sense of "process starts and emits some bytes," but anything beyond `claude --help` will be broken. Worse, the fallback emits `ready` immediately and pretends parity with the PTY branch. A user on a fresh Windows machine without build tools will see a "ready" terminal that doesn't behave like a terminal, with no signal that anything is wrong.

What scares me: `findClaudePath()` returns `'claude'` if nothing is found and lets `spawn` deal with it. On Windows without `claude` on PATH, this errors silently inside the child — `emit('exit', 1)` fires with no context. The `_pid` is reset to 0 on exit, but consumers (`ResourceMonitor.setClaudePid`) are never told. So if Claude crashes and respawns, the monitor still tracks the dead PID until the next `ready` event re-sets it. Actually, looking again — `ready` fires on `spawn`, so this is fine *if* the renderer triggers a restart. It's not fine if the process dies and nobody restarts.

The `env` for the PTY branch passes raw `process.env`; the fallback adds `TERM` and `FORCE_COLOR`. Asymmetry. Both should set these explicitly; relying on the parent's `TERM` is fragile on Windows where it may be unset.

`kill()` calls `.kill()` with no signal. On Windows `node-pty` translates this; on POSIX it's SIGTERM. There's no force-kill timeout — a hung Claude process blocks shutdown.

Naive understanding: "spawns claude, pipes IO." First-instinct miss: the fallback's existence creates a class of broken-but-not-obviously-broken user experiences.

### Open Questions
- Should the fallback be removed entirely in favor of a clear error message that prompts the user to install build tools?
- What happens to listeners across multiple `spawn()` calls — does the renderer accumulate listeners on `data`/`exit`?
- Why no `removeAllListeners()` in `kill()`, and is that safe across the IPC bridge?
- Should `kill()` wait for `exit` before resolving, or is fire-and-forget intentional?

## Phase 2: NODES

### Node 1: Dual spawn paths
`spawnWithPty` and `spawnWithChildProcess` both implement the same interface but with different fidelity.
Why it matters: One produces a working terminal; the other produces a degraded one with no warning.

### Node 2: Optional `node-pty` import
`require('node-pty')` inside a try/catch with a silent fallback.
Tension with Node 1: Silence is the bug. The user has no way to know which path they got.

### Node 3: `findClaudePath()` with weak fallback
Three candidates, last is bare `'claude'` (PATH lookup).
Why it matters: Failure mode = exit code 1 with no message. Hard to diagnose.

### Node 4: Hard-coded `cols: 120, rows: 30`
Initial size; renderer must `resize()` to match its actual viewport.
Tension with Node 1: The fallback ignores resize entirely (`resize` only acts on `ptyProcess`).

### Node 5: `_pid` reset on exit, no notification beyond `exit` event
ResourceMonitor stays subscribed to the old PID until next `ready`.
Why it matters: Brief window of stale telemetry. Probably visible as "Claude using 0% CPU" right after crash.

### Node 6: `kill()` is fire-and-forget, no timeout
No `setTimeout` then `SIGKILL`. Hung processes survive.
Why it matters: Index.ts calls this in `window-all-closed`; the Electron app may hang on shutdown.

### Node 7: `env` asymmetry between branches
PTY gets bare `process.env`; child_process gets `TERM` + `FORCE_COLOR` added.
Tension with Node 4: PTY branch should also force `TERM=xterm-256color` to match the `name` field passed to `pty.spawn`.

### Node 8: EventEmitter without typed events
`emit('data', string)` is untyped; consumers in `index.ts` annotate inline.
Why it matters: Drift risk. A future `emit('error', err)` would be invisible to TypeScript.

### Node 9: No re-spawn or watchdog
If Claude exits unexpectedly, the manager goes quiet. Renderer must manually restart.
Why it matters: Defines the lifecycle contract (renderer = supervisor). Should be documented.

## Phase 3: REFLECT

### Core Insight
The `child_process` fallback **trades a noisy failure for a quiet wrong-answer**, which is worse than the failure it was trying to prevent.

### Resolved Tensions
- **Node 1 vs Node 2 (dual paths, silent selection)** → Resolution: keep the fallback only as a diagnostic — when `node-pty` is missing, throw on `spawn()` with a message like "node-pty not loaded; run `node scripts/patch-node-pty.js && npx electron-rebuild`". Surface this to the renderer as a first-class error state.
- **Node 4 vs Node 7 (resize doesn't work in fallback / env asymmetry)** → Resolution: both are symptoms of the fallback not being a real terminal. Removing the fallback resolves both.

### Hidden Assumptions
- Assumed: a user without `node-pty` would rather have a half-working terminal than no terminal. — Challenge: this app's value proposition is "Claude Code in a GUI." A non-functional terminal is worse than a clear "install build tools" error.
- Assumed: the renderer will always restart on exit. — Challenge: there is no contract — if the renderer forgets, the app sits in a zombie state with no UI hint.
- Assumed: `kill()` will always succeed quickly. — Challenge: Windows `taskkill` can take seconds; without a timeout the close handler in `index.ts` may block the app from quitting.

## Phase 4: SYNTHESIZE

### What this file should become
A single-path PTY manager with hard failure when `node-pty` is unavailable, plus a small supervisor surface: `spawn`/`write`/`resize`/`kill`/`isAlive`, typed events (`data`, `exit`, `ready`, `error`), and a `kill` that escalates to force-kill after N ms. The "fallback to child_process" should become a setup-time check, not a runtime branch.

### Actionable items
- [ ] Delete `spawnWithChildProcess` and emit a structured `error` event when `node-pty` failed to load, with installation instructions in the message.
- [ ] Add a typed `Events` interface so `emit`/`on` are checked by TS.
- [ ] In `kill()`, capture a `Promise<void>` that resolves on `exit`; race it against a 2-second `SIGKILL` fallback.
- [ ] Have `setClaudePid(0)` be called on the `exit` event from `index.ts` (or move that coupling into the manager itself).
- [ ] Make `findClaudePath()` return `null` when nothing exists, and have `spawn` emit an `error` instead of silently spawning a bare `'claude'` that may not exist.
- [ ] Force `TERM=xterm-256color` and `FORCE_COLOR=1` in the PTY env explicitly; do not rely on inheritance.
- [ ] Document the supervisor contract: who restarts on exit, and under what conditions.

### Risks
- Removing the fallback could break the app on machines that successfully built without node-pty but where the dev hadn't realized. Mitigation: keep the optional import, but make failures explicit.
- Adding a force-kill timeout could mask a legitimate "Claude is doing important shutdown work" case; 2 seconds is generous but Claude Code may need to flush vault state.
- Typed events require touching every emitter call site; do it in one pass to avoid drift.
