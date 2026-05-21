# LMM: src/main/compact-controller.ts

> File: `src/main/compact-controller.ts` · LOC: 190 · Role: Reads/writes `~/.claude/settings.json` to install/uninstall compact-controller hooks; surfaces vault and state telemetry

## Phase 1: RAW

This is a thin facade over the filesystem-based contract between Claude Code and the external `claude-compact-controller` tool. The Studio app reads `state.json` (live token/turn counts) and `config.json` (vault tunables) and toggles three hooks (`Stop`, `PreCompact`, `PostCompact`) in `~/.claude/settings.json`. It's a UI for an external thing that already works on its own.

My gut reaction: the install/uninstall logic is the load-bearing part and it's *almost* right. The atomic write (write to `.tmp` + `rename`) is good. The "does a compact-controller hook already exist?" check uses `h.command.includes('compact-controller')` — a substring match. If a user has a custom hook with `compact-controller` in its path for unrelated reasons (e.g., they named their project that), this will refuse to install or, on uninstall, delete their custom hook. Substring matching on user data is always wrong; this should match the specific script paths we wrote.

What scares me: there is no schema validation on `~/.claude/settings.json` before mutating it. If a user has malformed settings, `JSON.parse` throws, `readSettings()` returns `{}`, and then `writeSettings({})` *clobbers the user's entire settings file* with an empty object. That is a destructive failure mode disguised as a graceful fallback. The atomic rename does not help here — it atomically destroys.

Hook installation hardcodes `node "${def.script}"` — assumes `node` is on PATH. For a desktop app installed by a non-dev, that's not safe. Should detect or bundle a Node runtime, or use Electron's own embedded Node via a different invocation.

The `getConfig` returns defaults when the file is missing — fine — but `setConfig` merges shallowly. If a user adds a nested config key in a future version of compact-controller, Studio's `setConfig` will preserve it on write because of spread, but only at top level. Today that's fine because `CompactConfig` is flat.

Naive understanding: "wraps three filesystem files." First-instinct miss: this file *mutates a user-owned config file shared with another tool and the Claude Code CLI itself.* The blast radius of a bug here is high.

### Open Questions
- What's the contract for `state.json` schema — does compact-controller version it?
- Why is the install check a substring match instead of script-path equality?
- Should `readSettings` distinguish "file missing" from "file malformed"? The latter must NOT trigger a write of `{}`.
- Does Electron's renderer process invoke `getStatus` on a poll? The HANDOFF says 3s; if so, every poll re-reads three files synchronously on the main thread.

## Phase 2: NODES

### Node 1: Three filesystem dependencies
`STATE_FILE`, `CONFIG_FILE`, `SETTINGS_FILE` — different directories, different owners (Studio, compact-controller, Claude CLI).
Why it matters: Three contracts to keep in sync; one schema drift breaks the UI.

### Node 2: Substring match for "is this our hook?"
`h.command.includes('compact-controller')` — matches the literal string anywhere in the command.
Why it matters: False positives delete user-authored hooks; false negatives duplicate install entries.

### Node 3: Read-then-clobber on malformed JSON
`readSettings()` returns `{}` on parse error. `writeSettings({})` overwrites the user's file.
Tension with Node 1: Tools that share a settings file MUST refuse to write if they can't safely read.

### Node 4: Atomic write via tmp + rename
Standard pattern, correctly implemented.
Why it matters: Prevents torn writes — the one safety net in the file.

### Node 5: Hardcoded `node` invocation
`command: \`node "${def.script}"\`` — assumes Node on PATH.
Tension with Node 1: External tool dependency not enforced or detected at install time.

### Node 6: Synchronous filesystem ops
`readFileSync`, `writeFileSync`, `readdirSync`, `mkdirSync`, `renameSync`. All blocking.
Why it matters: Polled at 3s from the renderer (per HANDOFF); blocks main thread for the duration of three file reads each tick.

### Node 7: Defaults baked in
`getConfig` returns `{ vault_max_entries: 10, vault_transcript_tail_bytes: 50000, log_enabled: false }` if file missing.
Tension with Node 1: Defaults must match compact-controller's defaults exactly, or Studio shows different values than what the tool uses.

### Node 8: `install` returns `false` if hooks dir missing
Silent no-op disguised as a result. UI shows "install failed" with no reason.
Why it matters: Users can't self-diagnose missing compact-controller install.

### Node 9: Path normalization with `replace(/\\/g, '/')`
Forces forward slashes for cross-platform command strings.
Why it matters: Reasonable on Windows; on POSIX it's a no-op. Worth a comment.

## Phase 3: REFLECT

### Core Insight
This file is a **shared-config editor without a transaction model** — it reads, mutates, and writes a file owned by other tools, with a fallback path that silently destroys data when reads fail.

### Resolved Tensions
- **Node 2 vs Node 3 (substring match + read-then-clobber)** → Resolution: store the exact script paths we wrote in our own state file, and match on path equality on uninstall. Never write the settings file if the read failed to parse — surface an error instead.
- **Node 1 vs Node 7 (three contracts + duplicated defaults)** → Resolution: don't hold defaults at all. Have `getConfig` return `null` when the file is missing and let the UI render "compact-controller not installed yet." Defaults are compact-controller's job, not Studio's.

### Hidden Assumptions
- Assumed: a malformed settings file is a transient condition that defaults will recover from. — Challenge: malformed = manual edit or another tool's bug. Overwriting is worse than failing loudly.
- Assumed: `node` is on PATH everywhere this app runs. — Challenge: packaged Electron apps on Windows often don't have a system Node; install will succeed but hooks will fail at runtime with cryptic errors.
- Assumed: 3-second polling of three sync file reads is free. — Challenge: it's ~1ms per file on warm cache but tens of ms on cold. Adds up over hours.
- Assumed: `getStatus()` is read-only and idempotent. — Challenge: it is, but the doc/types don't say so; future maintainers might add a write.

## Phase 4: SYNTHESIZE

### What this file should become
A defensive editor with three rules: (1) never write what you couldn't safely read, (2) match installed hooks by exact path stored in Studio's own state, not by substring, (3) move polling reads to async fs so the main thread stays responsive. The defaults block goes away; the UI shows "not installed" when files are missing.

### Actionable items
- [ ] Add a `STUDIO_STATE_FILE` recording the exact hook script paths Studio installed; use those for uninstall matching.
- [ ] Make `readSettings()` return a discriminated union: `{ ok: true, settings } | { ok: false, reason }`. Refuse to `writeSettings` when prior read was not ok.
- [ ] Detect `node` availability at install time; if absent, surface a clear error to the renderer instead of installing broken hooks.
- [ ] Convert `readFileSync`/`writeFileSync` to async (`fs.promises`) — the IPC handlers are already async-friendly.
- [ ] Drop the defaults in `getConfig`; return `null` and let the UI handle "not configured."
- [ ] In `install`, when hooks dir is missing, return a structured error (`{ ok: false, reason: 'hooks-dir-missing' }`) instead of `false`.
- [ ] Add a watcher (`fs.watch`) on `state.json` so the UI doesn't have to poll at all.

### Risks
- Changing the install-detection logic could orphan hooks installed by previous versions; add a migration that detects substring-matched legacy hooks once and rewrites them with path-equality match.
- `fs.watch` is notoriously flaky on Windows network drives; keep polling as a fallback.
- Removing defaults moves the "what should the UI show?" question to the renderer; coordinate the change.
