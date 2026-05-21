# LMM — src/renderer/components/github/GitHubPanel.tsx

## RAW
This is the orchestrator for the entire GitHub side of Phase 4. It owns seven pieces of independent state (auth, cwd, git, repoInfo, commits, branches, prs, issues, tab, loading, err) and three loaders (`refreshAuth`, `refreshGit`, `loadRemote`). The top-level component is doing a lot — it is simultaneously a state container, a layout shell, a tab router, and the home of `SignedInBar` and `extractError`. The fan-out happens at line 58: a single `Promise.all` of five GitHub REST calls fires whenever owner/repo/hasToken changes via the `loadRemote` dependency on line 75. That's an honest, simple approach but it means every auth toggle, every cwd change that resolves a different remote, every refresh kicks off five parallel network calls — and a single failed call (one 404 on issues, say) sinks the whole batch into the catch on line 70 and we lose the other four results. Open questions: (1) what happens to in-flight requests when the user picks a new directory mid-load — there is no abort controller, so state could be written by a stale resolution; (2) why is the tab state never persisted, so every panel mount snaps back to 'repo'; (3) why is `SignedInBar` defined in this file at line 243 rather than as its own file given the rest of the cluster's one-file-per-component discipline; (4) what does the panel render when `git` is `null` (initial load) — the WorkingDirCard handles it gracefully but the gating chain on line 144/148/166 treats `null` auth and missing token identically as "show ConnectGitHub", which is correct but accidental. The `useEffect` chain on lines 48-79 is two-stage: mount triggers auth+git, and any change to git owner/repo or hasToken triggers loadRemote. That's clean reactive flow but it does mean a token validation in `handleConnect` (line 95) implicitly causes a remote fetch on the next render — invisible coupling.

## NODES
1. **Lines 22-32 — state explosion**: 11 useState hooks. Even with related state, a `useReducer` or a single `view` object would express intent better.
2. **Lines 34-46 — paired auth/git loaders**: clean separation of concerns; auth and git refresh are independent.
3. **Line 58 — Promise.all all-or-nothing**: five endpoints batched; one failure blanks all five UI sections via the catch on 70.
4. **Line 70 — global err state**: single error string for all five queries; user can't tell which call failed.
5. **Lines 77-79 — implicit reload on auth change**: `loadRemote` deps include `auth?.hasToken`, so connect/disconnect retriggers fetches without an explicit call.
6. **Line 100-108 — handleDisconnect manual cleanup**: nulls all five caches, but a stale in-flight `loadRemote` from before the disconnect could still write data after.
7. **Lines 110-116 — count UI from cached arrays**: counts reflect length of last successful fetch, not server truth; cosmetic but could mislead.
8. **Lines 119-241 — inline styles everywhere**: ~120 lines of `style={{}}` props; no CSS module, no styled-component, no theme abstraction beyond CSS vars.
9. **Lines 178-212 — tab buttons**: proper `<button>` elements with hover/active styling; accessible.
10. **Lines 243-323 — SignedInBar inline component**: violates the file-per-component pattern visible elsewhere in cluster.
11. **Lines 234-237 — error-state copy doubles as help text**: nice touch — when owner/repo unresolved, it tells the user exactly what command to run.
12. **Line 286 — scopes leakage**: scopes are rendered in plaintext; not a security issue but worth noting it confirms what the token can do.
13. **No request cancellation**: changing cwd while a fetch is in flight creates a race; last-write-wins on state, but it could be the older write that wins.

**Tensions**: (a) Single error state vs five independent endpoints — simplicity wins, completeness loses. (b) File-per-component discipline vs SignedInBar living inline — small enough to inline, but inconsistent.

## REFLECT
**Core insight**: this is a *coordinator* component pretending to be a *presentational* one — the inline `SignedInBar` and inline tab-bar markup hide that fact behind 120 lines of styling, but the real job is orchestrating five IPC streams against two auth states and a working-directory state. **Resolved tensions**: the all-or-nothing `Promise.all` is acceptable *for now* because the five endpoints share auth and a 404 on any of them likely means a wider failure (rate limit, network), but it should evolve to `Promise.allSettled` with per-tab error placeholders before this ships to users with flaky networks. The SignedInBar inlining is fine for v1 — extract when it grows. **Hidden assumptions**: (1) IPC handlers never throw silently — they propagate; (2) the user will not change directories faster than `loadRemote` completes; (3) cached counts on tab buttons are good enough; (4) the Promise.all parallelism doesn't blow GitHub's secondary rate limits even for small repos (likely safe, but no backoff exists).

## SYNTHESIZE
**What it should become**: a thin shell that delegates to a `useGitHubPanel()` hook owning state and a `useGitHubRemote(owner, repo, hasToken)` hook owning the five fetches with `Promise.allSettled` and an AbortController.

**Actionable items**:
- Replace `Promise.all` (line 58) with `Promise.allSettled` and store per-section errors so one failed endpoint doesn't blank the others.
- Add an AbortController to `loadRemote`; abort on dep change and on unmount.
- Extract `SignedInBar` (lines 243-323) to its own file for consistency.
- Persist `tab` to localStorage so panel re-mount preserves it.
- Replace 11 useState with one `useReducer` keyed on intent (auth_change, git_change, remote_loaded, remote_failed).
- Add a `aria-label` to the tab container and `role="tablist"`/`role="tab"` for screen readers.

**Risks**: low — this is a side panel, not on the critical path. Main risk is the race on cwd change writing stale data into the wrong repo's panel (very confusing if it happens).
