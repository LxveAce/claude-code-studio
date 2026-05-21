# LMM: src/main/github-service.ts

> File: `src/main/github-service.ts` · LOC: 237 · Role: Octokit wrapper for GitHub repos/commits/branches/PRs/issues with `safeStorage`-encrypted PAT persistence

## Phase 1: RAW

This file does three things: persists a GitHub PAT (encrypted via Electron `safeStorage` when available, plaintext fallback otherwise), constructs an `Octokit` client on demand, and maps Octokit responses to the app's flat type shapes (`GitHubRepoInfo`, `GitHubCommit`, etc.). The token store is a JSON file in `app.getPath('userData')` with atomic tmp-then-rename writes.

My gut reaction: the encryption story is the headline concern. `safeStorage.isEncryptionAvailable()` returns false on Linux without a keyring (or in some headless contexts on macOS); when it does, the code silently writes the token *in plaintext* to a JSON file. That's documented nowhere in the user-visible UI. A user on a fresh Linux box might add their PAT and have no idea it's sitting on disk in cleartext. This is a meaningful security regression from "I typed my token into the app." At minimum the UI needs to surface "your token will not be encrypted on this system."

What scares me beyond that: `setToken` calls `octokit.users.getAuthenticated()` to validate, then persists. If the network call succeeds but `persistToken` throws (disk full, permission), the in-memory `octokit` is set but the on-disk store isn't — next launch, token is gone. Minor edge case, but the state machine has no recovery.

`clearToken` writes an empty `{}` store. This is correct, but combined with `persistToken` deleting *both* `encryptedToken` and `plainToken` before writing, the store has no notion of "I once had a token; here's when it was revoked." For auditing, that's fine; for "did I revoke it or did the file get clobbered?" it's not.

The mapping functions throw away data: PR `comments_url`, repo `homepage`, commit `verification` status, issue assignees. Today the UI doesn't need those, but each is a future "I need that" away from a wider Octokit refactor. The flat types in `shared/types.ts` are the right pattern; just expect to extend them.

No rate-limit handling. Octokit retries on 5xx by default but a hit secondary-rate-limit will bubble as an exception to `requireClient()` callers. The IPC layer has no error normalization, so the renderer will see whatever Octokit throws.

`USER_AGENT = 'claude-code-studio'` — good, satisfies GitHub's UA requirement.

Naive understanding: "GitHub wrapper class." First-instinct miss: this file is **the entire credential layer for the app's only third-party identity**, and its security claims are conditional in a way the user never sees.

### Open Questions
- How is the `safeStorage` availability surfaced to the user? (Looks like: it isn't.)
- Why does `listBranches` make TWO Octokit calls (branches + repo) just to mark which branch is default? Should be cached.
- What happens on token revocation? Octokit returns 401; nothing here clears the cached token.
- Is PAT the right approach long-term, or should this move to OAuth Device Flow?

## Phase 2: NODES

### Node 1: Conditional encryption with silent fallback
`safeStorage.isEncryptionAvailable()` gates encrypted vs plaintext persistence; no user signal.
Why it matters: A security claim ("we encrypt your token") that's sometimes false.

### Node 2: Atomic tmp-then-rename writes
`writeStore` uses the standard pattern.
Why it matters: Prevents torn writes on crash. Good.

### Node 3: Two-stage `setToken`: validate, then persist
Network call first, disk second. If disk fails, in-memory client is live but next launch has no token.
Why it matters: Tiny inconsistency window; recoverable but not signaled.

### Node 4: Lazy `octokit` construction
`requireClient` builds Octokit on first use after `setToken` or first call after process start.
Why it matters: Defers cost until needed. Sensible.

### Node 5: No rate-limit / 401 handling
Octokit throws; IPC layer surfaces error to renderer raw.
Tension with Node 4: Cached client may hold a now-invalid token across many requests; nothing invalidates it.

### Node 6: Mappers strip fields
Commit/PR/issue/branch mappers project to flat types; fields not in target are dropped.
Why it matters: Stable wire format, but every new UI need requires touching both `types.ts` and the mapper.

### Node 7: `listBranches` makes two calls
Calls `listBranches` + `repos.get` to determine `isDefault`. Doubles latency and rate-limit cost.
Tension with Node 1: For an app that wants to be conservative with rate limits (no per-user OAuth quota), every extra call matters.

### Node 8: `cachedAuth` updated in three places
Constructor, `setToken`, `clearToken`. All write the full object.
Why it matters: Mostly fine, but if a future method modifies one field it'll forget the others.

### Node 9: `commentCount: 0` hardcoded in PR mapper
`pulls.list` doesn't return comment count; the mapper hardcodes zero rather than calling for it.
Why it matters: UI shows "0 comments" on PRs that have hundreds. Misleading.

### Node 10: `clearToken` doesn't revoke
Removes local token but doesn't call GitHub to invalidate it.
Why it matters: User clicks "log out" expecting safety; revoked locally, still valid on github.com.

## Phase 3: REFLECT

### Core Insight
This file is a **competent SDK wrapper with one structural lie** — the encryption status is hidden from the user, so the security guarantee depends on a platform capability the UI never mentions.

### Resolved Tensions
- **Node 1 vs nothing (silent fallback)** → Resolution: extend `GitHubAuthState` with `encrypted: boolean`. Surface it in the UI as a badge ("Token stored encrypted" / "Token stored unencrypted — install keyring"). The user can then decide.
- **Node 5 vs Node 4 (cached client + no invalidation)** → Resolution: in the IPC error path, detect 401 from Octokit and call a new `invalidateToken()` that drops the cache and updates `cachedAuth.hasToken = false`. Emit an `auth-changed` event the renderer can listen for.
- **Node 7 vs Node 1 (two calls for `isDefault`)** → Resolution: cache `defaultBranch` per `(owner, repo)` for the session; first `getRepoInfo` or `listBranches` populates it. Future calls reuse.

### Hidden Assumptions
- Assumed: `safeStorage` failures are rare and acceptable. — Challenge: on Linux without a keyring, every install is plaintext; the UI never says so.
- Assumed: tokens don't expire / get revoked. — Challenge: classic PATs can; fine-grained PATs expire on a schedule. Octokit will 401 and the cached client will keep retrying.
- Assumed: rate-limit headers are unimportant. — Challenge: a user browsing a busy repo can burn 60 unauthenticated requests fast; even authenticated, 5000/hr is consumable. Headers in the response should drive UI throttling.
- Assumed: PAT is the right auth model. — Challenge: OAuth Device Flow avoids users pasting tokens at all and gets granular scopes. Worth considering before more code accretes on PAT.

## Phase 4: SYNTHESIZE

### What this file should become
A credential-aware service that's honest about its security posture: expose `encrypted` in auth state, invalidate the cached client on 401, cache `defaultBranch` to halve the `listBranches` cost, and either drop the misleading `commentCount: 0` or fetch real counts on demand. Long-term: prepare for OAuth Device Flow by isolating the token-acquisition step.

### Actionable items
- [ ] Add `encrypted: boolean` to `GitHubAuthState`; populate from `safeStorage.isEncryptionAvailable()` at `getAuthState()` time.
- [ ] On any Octokit 401 in `getRepoInfo`/`listCommits`/etc, call a new `invalidateToken()` that clears cache + updates auth state. Wrap each public method in a small helper to centralize.
- [ ] Cache `defaultBranch` per `(owner, repo)` in a Map; have `listBranches` consult the cache before making the second call.
- [ ] Either fetch real PR comment counts (one call per PR — expensive) OR remove `commentCount` from `GitHubPullRequest` until it's accurate.
- [ ] Surface rate-limit headers (`x-ratelimit-remaining`, `x-ratelimit-reset`) via a `getRateLimit()` method or include in `getAuthState()`.
- [ ] Add a `revoke` path that calls `applications.deleteAuthorization` when the user clicks "log out" (requires app credentials — may be out of scope for PAT model).
- [ ] Document in code that the plaintext fallback exists; emit a one-time main-process warning when it's used.
- [ ] Plan for OAuth Device Flow: extract token persistence into a `TokenStore` interface so the source-of-token can change without rewriting mappers.

### Risks
- Adding `encrypted` to `GitHubAuthState` changes the wire shape; renderer must handle the old shape during upgrade (default to `false`).
- Caching `defaultBranch` per session can go stale if the user changes the default branch elsewhere; cache for short TTL (e.g., 60s) or invalidate on `getRepoInfo` calls.
- Invalidating on 401 could fight a transient GitHub outage (which sometimes returns 401 incorrectly); consider a one-retry-then-invalidate policy.
- Removing `commentCount` is a breaking type change; coordinate with UI in one commit.
