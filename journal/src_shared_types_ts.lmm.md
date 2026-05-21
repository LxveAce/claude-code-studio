# LMM: src/shared/types.ts

> File: `src/shared/types.ts` · LOC: 128 · Role: Shared TypeScript domain types for IPC payloads (resources, compact, git, github) plus a partial `ElectronAPI` interface.

## Phase 1: RAW

This file is the payload half of the IPC contract. `ipc-channels.ts` names the wires; this file describes what travels over them. There are 9 exported interfaces — `ResourceSnapshot`, `CompactStatus`, `CompactConfig`, `GitRepoState`, `GitHubRepoInfo`, `GitHubCommit`, `GitHubBranch`, `GitHubPullRequest`, `GitHubIssue`, `GitHubAuthState` — and one `ElectronAPI` interface at lines 119-127 that is suspiciously thin. It only types `terminal` (5 methods) and omits `resources`, `compact`, `git`, `github`, and `window`. That single fact is the loudest signal in the file: `ElectronAPI` here is stale, while `declarations.d.ts` lines 45-109 carries the full, current shape that the renderer actually consumes via `window.electronAPI`. Two definitions of the same surface, one truthful and one not.

The domain types themselves are well-shaped. `ResourceSnapshot` (1-16) cleanly separates system vs. claude buckets and uses `number | null` for gpu — honest about iGPU limitations (HANDOFF.md known issue). `CompactStatus` and `CompactConfig` use snake_case fields (`vault_max_entries`, `vault_transcript_tail_bytes`, `log_enabled`) because they're a thin wire-mirror of the Python compact-controller's JSON files — pragmatic but inconsistent with the rest of the file, which is camelCase. `GitRepoState` (34-48) is detailed enough to power a status bar without follow-up queries. The GitHub types mirror Octokit responses but trimmed to the fields the UI actually paints (good — keeps the contract narrow).

Notable absences: no `TerminalEvent`, no `ResourceUpdatePayload` alias, no error envelope type. Handlers in `main/index.ts` either succeed and return the typed thing or throw, with no shared error shape. There is also no discriminator on `GitHubPullRequest.state` for the third `'all'` filter value — the type only allows `'open' | 'closed'` for the response but preload/main accept `'all'` as the request filter; that's fine for response typing but worth noting as an asymmetry.

### Open Questions
- Why does `ElectronAPI` (119-127) exist at all if `declarations.d.ts` re-declares it more fully? Is it leftover from Phase 1?
- Should snake_case `CompactConfig` field names be normalized to camelCase at the IPC boundary, or is the wire-fidelity-with-Python intentional?
- Should there be a `Result<T, E>` envelope so rejected `invoke` calls have a typed error surface?
- Are these types ever imported by the renderer directly? (Check `useElectronAPI` patterns.)

## Phase 2: NODES

### Node 1: 10 domain interfaces, all single-purpose
Lines 1-117. Each type maps cleanly to one IPC response. Easy to evolve.

### Node 2: ElectronAPI here is incomplete
Lines 119-127 type only `terminal`. The renderer ground truth lives in `declarations.d.ts:45-109` and includes `resources`, `compact`, `git`, `github`, `window`. Direct, structural drift.

### Node 3: snake_case island in a camelCase ocean
`CompactConfig` (28-32) and `CompactStatus.lastVaultFile` are mixed. Reflects wire-format pragmatism but breaks lint-style consistency.

### Node 4: PR state asymmetry
`GitHubPullRequest.state` and `GitHubIssue.state` are `'open' | 'closed'` (line 87, 103) but the request filter accepts `'open' | 'closed' | 'all'` (preload.ts:59, 64). Correct in spirit (`'all'` is a query, not a response value) but undocumented.

### Node 5: No error envelope
Every IPC handler can throw, and rejection surfaces as a raw `Error` on the renderer. No `IpcError` type, no error codes.

### Node 6: No mapping from channel to payload
Same gap as `ipc-channels.ts`. Knowing `IPC.GIT_DETECT` returns `GitRepoState` requires reading three files.

### Node 7: GitHubAuthState is the only stateful auth type
Lines 113-117. Notably there is no `User`, `Session`, or `AuthToken` type — the future Phase 5 auth surface is unrepresented even though channels exist for it in `ipc-channels.ts:34-37`.

### Node 8: All types are plain interfaces, no branded primitives
`owner: string`, `repo: string`, `sha: string` everywhere. No `Sha`, `RepoOwner` brands. Cheap typo surface.

### TENSION A: One source of truth for ElectronAPI vs. two definitions
`types.ts:119-127` and `declarations.d.ts:45-109` both define `electronAPI`. Editing one without the other is the most likely future bug in this cluster.

### TENSION B: Pragmatic wire-fidelity (snake_case) vs. internal style consistency (camelCase)
Forcing camelCase would require a translation layer in `compact-controller.ts`; keeping snake_case leaks Python style into TS.

## Phase 3: REFLECT

### Core Insight
This file holds correct domain types but a stale `ElectronAPI` — the bridge between "what the wire carries" and "what the window exposes" lives in two files instead of one, and only one is being maintained.

### Resolved Tensions
- **A (two ElectronAPI defs):** Delete `ElectronAPI` from `types.ts` and import the canonical shape from `declarations.d.ts`, OR vice versa — define `ElectronAPI` here fully and have `declarations.d.ts` reference it via `import('./shared/types').ElectronAPI`. The second is cleaner because `types.ts` is a real module and easier to reason about than ambient `.d.ts`.
- **B (snake vs camel):** Keep snake_case for `CompactConfig` since it round-trips to a Python-owned JSON file. Add a `// snake_case mirrors compact-controller state.json` comment so it isn't "fixed" by a future contributor.

### Hidden Assumptions
- That the renderer will use `declarations.d.ts`'s ambient `Window` type and ignore the local `ElectronAPI` in `types.ts`. True today, fragile tomorrow.
- That `'open' | 'closed'` is a complete enumeration for PR/issue state. GitHub also has `merged` (modeled separately for PRs as a bool) but not `'closed' & merged=false` vs `'closed' & merged=true` discrimination at the type level.
- That all IPC failures are exceptional. No graceful "repo not found" sentinel.

## Phase 4: SYNTHESIZE

### What this file should become
The canonical home for every IPC payload type AND the canonical `ElectronAPI` interface, with `declarations.d.ts` reduced to: `interface Window { electronAPI: import('./shared/types').ElectronAPI }`.

### Actionable items
- [ ] Expand `ElectronAPI` in this file to match the full shape in `declarations.d.ts:46-108` (resources, compact, git, github, window namespaces).
- [ ] Rewrite `declarations.d.ts`'s `Window` block to import `ElectronAPI` from `./shared/types` instead of re-declaring inline.
- [ ] Add a comment header above `CompactConfig` explaining the snake_case wire-fidelity rationale.
- [ ] Introduce a `PullRequestStateFilter = 'open' | 'closed' | 'all'` alias and reuse it in preload + main signatures.
- [ ] Optional: add `IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }` and migrate one handler as a pilot.
- [ ] Add `AuthSession` / `AuthUser` placeholder types so Phase 5 has a typed landing pad.

### Risks
- Moving `ElectronAPI` to be the canonical source means the renderer must rely on `declarations.d.ts` re-export; if Vite/tsconfig include order is wrong, `window.electronAPI` could lose typing. Test in `App.tsx` immediately after.
- Adding `IpcResult` retroactively is a wide change; do as an opt-in for new handlers only.
- Branding primitives (`Sha`, `RepoOwner`) is tempting but high-friction; skip unless typo bugs actually appear.
