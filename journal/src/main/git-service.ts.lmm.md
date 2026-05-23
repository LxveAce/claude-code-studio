# LMM: src/main/git-service.ts

> File: `src/main/git-service.ts` · LOC: 153 · Role: Shells out to local `git` to detect repo state (branch, upstream, ahead/behind, dirty counts); parses GitHub URLs

## Phase 1: RAW

Clean and well-scoped. Holds a current working directory, walks up to find `.git`, runs five git commands in parallel, returns a flat `GitRepoState`. The `parseGitHubUrl` helper handles SSH, HTTPS, and `ssh://` forms with separate regexes. Easy to read.

My gut reaction: this is the strongest file in the cluster. It does one thing, it's testable (the helper is exported), error handling is consistent (`runText` returns `''` on failure), and the data shape it produces matches `GitRepoState` cleanly. If everything in this codebase were at this quality level, I'd have little to say.

But the things I'd flag: `setCwd` silently ignores nonexistent paths and returns the current cwd. From the renderer's perspective, `setCwd('/bogus')` looks identical to `setCwd(currentCwd)` — both return the same string. The renderer can't tell if its request was honored. Same in the constructor: invalid `initialCwd` silently falls back to homedir. This is a "be helpful" pattern that hides bugs.

`runText` returns `''` on error, conflating "command failed" with "command produced empty output." For `rev-parse --abbrev-ref @{u}` this is mostly fine (no upstream → empty), but for `rev-list --count` an empty string could mask a real git failure (`git` not installed, permission error, repo corrupt). The caller `aheadBehind` defaults to `{ ahead: 0, behind: 0 }` on empty — so a broken repo looks identical to a clean repo. Bad signal.

`findRoot` walks up via `path.dirname` until it hits the filesystem root. On Windows, this is fine (`C:\` becomes itself). On a path inside a submodule or worktree, `.git` may be a *file* (containing `gitdir: ../.git/worktrees/...`), not a directory. `fs.existsSync` returns true for both files and directories, so this works by accident — but the `root` returned is the worktree path, not the repository root. Git commands still work from the worktree path, so it's correct enough.

`statusCounts` parses `--porcelain=v1`. The logic counts staged as "X is not space/?" and modified as "Y is not space/?". For an untracked file, both are `?`. For a "DD" conflict, both are `D` (non-space), so it counts as 1 staged + 1 modified — that's debatable but probably correct semantics for a UI.

No timeout on the git commands. A hung `git status` on a giant repo blocks the promise forever.

### Open Questions
- Should `setCwd` throw or return a boolean for "did it work" rather than always returning a string?
- Is the lack of timeout intentional, or just an oversight given that `execFile` doesn't time out by default?
- Why does `parseGitHubUrl` use three separate regexes instead of one? Readability or genuine semantic difference?
- Does `git` need to be on PATH on every supported machine? What's the fallback?

## Phase 2: NODES

### Node 1: Five parallel git commands per `detect`
`Promise.all` over `rev-parse`, `rev-parse @{u}`, `config remote.origin.url`, `rev-list`, `status --porcelain`.
Why it matters: Latency-friendly. ~one round of git startup overhead instead of five.

### Node 2: Silent fallback on bad cwd
`setCwd('/bogus')` returns current cwd unchanged.
Why it matters: Renderer can't detect a typo or stale path.

### Node 3: `runText` returns `''` on error
Conflates "git failed" with "empty output."
Tension with Node 1: Parallel execution hides which command failed; the caller can't surface it.

### Node 4: No timeout on `execFile`
Default Node behavior: wait forever.
Why it matters: A hung repo (network filesystem, lock contention) hangs the UI silently.

### Node 5: `parseGitHubUrl` is exported and pure
Three regex branches: SSH, HTTPS, `ssh://`. Pure function.
Why it matters: Testable in isolation. Good design.

### Node 6: `findRoot` works for worktrees by accident
`.git` may be a file or directory; `existsSync` accepts both.
Why it matters: Right answer for the wrong reason — fine today, fragile to changes.

### Node 7: `EMPTY_STATE` is a constant
Spread on the not-found path. Avoids object allocation pitfalls.
Why it matters: Spreading guards against shared mutation. Good hygiene.

### Node 8: `statusCounts` parses porcelain v1
Hardcoded to v1 format; v2 is more verbose but unambiguous.
Why it matters: v1 is stable. Fine for the foreseeable future.

### Node 9: `windowsHide: true`
Prevents console flashes on Windows. Small but correct touch.
Why it matters: User-perceived polish.

## Phase 3: REFLECT

### Core Insight
This file is **clean and well-bounded, but its error semantics confuse "absent" with "broken"** — a missing upstream and a crashed git binary produce identical output.

### Resolved Tensions
- **Node 2 vs Node 3 (silent cwd fallback + silent run failures)** → Resolution: introduce a small discriminated result type for both `setCwd` (`{ ok, cwd, reason? }`) and `runText` (`{ ok, stdout } | { ok: false, code }`). The detect path can still default missing values to nulls, but the wire signals failure when git itself is unhappy.
- **Node 1 vs Node 4 (fast parallel calls, no timeout)** → Resolution: wrap `Promise.all` with `Promise.race` against a 5s timeout; if any single command exceeds it, return a partial state with a `degraded` flag.

### Hidden Assumptions
- Assumed: `git` is always on PATH. — Challenge: a packaged desktop app on a fresh Windows machine may not have git installed; all five calls will error and the user sees "no repo" with no diagnostic.
- Assumed: filesystem traversal is cheap. — Challenge: on network mounts, `existsSync` per directory level can be slow; cache results per `findRoot` call.
- Assumed: porcelain v1 output is stable. — Challenge: it is, but documenting "we depend on v1" prevents a well-meaning refactor to v2 from silently changing the count semantics.
- Assumed: there's only one current working directory ever. — Challenge: Phase 7 mentions split panes; each pane might want its own git context.

## Phase 4: SYNTHESIZE

### What this file should become
Mostly what it already is, plus three changes: (1) distinguish "git unavailable / errored" from "empty output," (2) timebox git commands, (3) signal cwd-change success/failure to the renderer. Keep `parseGitHubUrl` exactly as is — it's the right shape.

### Actionable items
- [ ] Change `runText` to return `{ ok: boolean; stdout: string; error?: string }`. Update callers; default missing values where semantically meaningful (e.g., no upstream).
- [ ] Add `timeout: 5000` to `execFile` options and surface the timeout case in the result.
- [ ] Have `setCwd` return `{ ok: boolean; cwd: string }`; the renderer can show a toast on `ok: false`.
- [ ] Add a one-time `git --version` check at service construction; cache the result and expose it via a `getDiagnostics()` method.
- [ ] Document (in a comment) that `findRoot` works for worktrees because `.git` may be a file containing `gitdir:`.
- [ ] Add a unit test file for `parseGitHubUrl` covering: trailing slash, `.git` suffix, with PAT in URL, gist URLs (should return null), enterprise GitHub (should return null — does it today?).
- [ ] When supporting split panes (Phase 7), allow per-pane `GitService` instances or make `cwd` a parameter rather than state.

### Risks
- Changing `runText`'s return shape touches every caller in the file; do it in one commit.
- Adding timeouts could surface flakiness on slow disks; pick a value that errs on the side of patience (5s feels right).
- Returning `{ ok, cwd }` from `setCwd` changes the IPC contract; coordinate with `IPC.GIT_SET_CWD` consumers in the renderer.
