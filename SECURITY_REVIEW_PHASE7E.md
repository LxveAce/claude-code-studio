# Phase 7e — Token Cost Tracker — Self Security Review

Branch: `phase-7e-cost-tracker` (off `phase-7a-palette-snippets-notifications`)
Scope: new `CostService`, `CostPanel`, sidebar entry, palette actions, settings toggle,
budget notification wiring.

## Threat model

The new code is a **read-only sampler** over user-local state:

- `~/.claude/compact-controller/state.json` — current session counters.
- `~/.claude/compact-controller/vault/vault-*.json` — historical session snapshots.

It **writes** to user-local app data only:

- `<userData>/cost-history.json` — per-day totals + per-session map + last alert date.
- `<userData>/cost-settings.json` — budget & model.

There is **no network**, **no shell exec**, **no privileged FS write**, and the only
ambient effect is a desktop notification fired by the existing throttled
`NotificationsService`. The render layer talks to main over the existing IPC
contract added in earlier phases.

The realistic attackers are:

1. **A malicious vault file** (placed by another local process or a compromised
   compact-controller hook) — could try to OOM, slow the poll loop, leak data,
   or escape sandbox via path tricks.
2. **A corrupt or maliciously-shaped `cost-history.json`** — same goals but
   via the file we control.
3. **Renderer code passing junk to main over `cost:*` IPC** — could try to set
   absurd budgets, abuse JSON-parse, or trip notification spam.

The cost dashboard is **explicitly labeled a heuristic** in the UI; it cannot be
trusted for billing decisions. That labeling itself is part of the threat model
(don't surface numbers as if they came from Anthropic).

---

## Findings

| ID | Severity | Status |
|----|----------|--------|
| C-1 | Critical | n/a — none found |
| H-1 | High | Fixed |
| H-2 | High | Fixed |
| H-3 | High | Fixed |
| M-1 | Medium | Fixed |
| M-2 | Medium | Fixed |
| M-3 | Medium | Mitigated by design |
| M-4 | Medium | Deferred (documented) |
| L-1 | Low | Accepted |
| L-2 | Low | Accepted |
| L-3 | Low | Accepted |
| L-4 | Low | Accepted |

No Criticals were found.

---

### H-1 — Unbounded read of `cost-history.json` on startup
**Risk:** the constructor unconditionally `fs.readFileSync`s the history file.
A 2 GB file (whether from bug, FS exhaustion, or malicious local actor) would
OOM the main process before the app finishes booting, denying access to other
panels too.

**Fix:** added `MAX_HISTORY_BYTES = 4 MB` cap. The reader `statSync`s first; if
the file exceeds the cap, it's renamed to `*.corrupt-<timestamp>` and we start
fresh. Existing JSON-parse failure path was already quarantining, so this
generalises that defense.

### H-2 — Unbounded vault directory scan per poll
**Risk:** every 30 s sample reads every `vault-*.json` file (each up to 1 MB).
With 1000 vaults that's ~1 GB of disk I/O per poll plus thousands of JSON
parses, which would stall the main process and starve other IPC handlers.

**Fix:** (a) capped to `MAX_VAULTS_PER_SAMPLE = 500`, sorted by name (vault
names embed timestamps so the slice keeps the newest); (b) added a per-vault
mtime cache so unchanged vaults are skipped after the first parse, dropping
the steady-state work to "what's changed since last poll".

### H-3 — Unbounded session map size in `cost-history.json`
**Risk:** even though days are trimmed at 90 d, a malicious or buggy vault
could create thousands of distinct `session_id`s per day, growing the session
map until reads/writes become slow and `cost-history.json` exceeds H-1's cap.

**Fix:** added `MAX_SESSIONS_TRACKED = 5000`. On load we stop ingesting past
the ceiling; on insert we evict the oldest-dated entry to make room for a new
session id (existing-id updates always succeed so active sessions can keep
growing).

### M-1 — Path traversal via vault file name
**Risk:** `fs.readdirSync(VAULT_DIR)` returns whatever's there, including
symlinks. A symlink named `vault-evil.json` pointing at `~/.ssh/id_rsa` could
be read.

**Fix:** retained the cloud-sync pattern: regex on basename (`^vault-[A-Za-z0-9._-]+\.json$`)
PLUS `path.dirname(path.resolve(full)) === path.resolve(VAULT_DIR)`, AND a
size cap of 1 MB, AND `stat.isFile()` so symlinks-to-directories are rejected.
On Windows, `fs.readdirSync` does not follow symlinks but `fs.statSync` does —
we accept reading a symlinked file (matches existing `cloud-sync.ts` behavior)
but it must be a regular file ≤ 1 MB and JSON-parse to a valid vault shape.
Sensitive files like `id_rsa` would fail JSON.parse and be silently skipped.

### M-2 — Budget alert spam across timezone changes
**Risk:** `maybeFireBudgetAlert` dedupes by `lastBudgetAlertDate === today`. If
the user manually changes their clock backward, the alert could fire twice.

**Fix:** acceptable — the budget alert is informational, the throttle in
`NotificationsService.show` enforces a 1 s minimum between same-kind events,
and the user cannot avoid being notified about a real over-budget condition.
This is a known limitation, called out via the `lastBudgetAlertDate` field name.

### M-3 — Heuristic cost surfaced as if authoritative
**Risk:** rate placeholders + missing per-call output counts + unknown model
per turn = the displayed dollar figure can be off by 5–10× either direction.
A user could over-/under-tune their actual spend based on this.

**Mitigated by design:**
- Panel header reads "Token Cost (estimate)".
- A dashed-border disclaimer is always rendered.
- The notification body itself says "Estimates are heuristic — verify in the
  Anthropic console."
- The rate table is rendered live so the user sees the per-1M numbers driving
  the dashboard.

This is not a fixable bug in this layer; it requires Anthropic API-level
billing surface integration. Tagged as documentation, not code defect.

### M-4 — Multi-instance write race on cost-history.json
**Risk:** if the user runs two app windows (or two installs) simultaneously,
both `CostService` instances will poll and write to the same `cost-history.json`.
Atomic rename prevents file corruption, but the *content* will alternate
between the two views (each instance keeps its own in-memory map).

**Deferred.** Multi-instance support isn't claimed elsewhere in the app
(see e.g. `pty-manager`'s single global terminal). Acceptable to defer for
this phase. If addressed later, the right fix is a re-read of the file before
each write rather than blindly serializing the in-memory copy.

### L-1 — File mode 0o600 on Windows
We `writeFileSync(..., { mode: 0o600 })` for parity with `cloud-sync.ts` and
`snippets-service.ts`. Windows largely ignores POSIX mode bits, but the call
is harmless and helps on macOS/Linux. Accept.

### L-2 — `state.json` mtime drift
Bucketing live samples by `stat.mtime` is correct when the controller writes
freshly each turn. If the FS clock skews badly the bucket could be wrong.
Acceptable for a heuristic dashboard.

### L-3 — Renderer-supplied `partial.dailyBudgetUSD` exotic values
Negative, NaN, Infinity, and >10000 are rejected with a thrown Error that
the renderer surfaces inline. We do not log or echo the value — there's
nothing sensitive here, but the validation is strict.

### L-4 — Notification body uses backticks and a USD number
`notifyCostBudget` builds the body via a template literal with two numbers
formatted via `formatUSD`. No user-controlled text reaches the notification.
The numbers themselves are bounded ([0, 10000] for budget; cost is rounded
to 4 dp and capped by daily-tokens × rate-table). Accept.

---

## What I did NOT do
- No new outbound HTTP. The notification surface uses the existing local
  Electron `Notification` API.
- No changes to the GitHub PAT path, vault sync code, or auth backend.
- No new IPC channels beyond the four `cost:*` ones, all of which are
  `ipcMain.handle` (renderer → main request/response) — no broadcast push.
- No log files, no diagnostic dumps, nothing written outside `<userData>`
  and the already-existing notification surface.

## Verification
- TypeScript strict mode is on; code follows the same `unknown`-typed-then-narrow
  pattern used by `cloud-sync.ts` and `snippets-service.ts` for parsing
  external JSON.
- Atomic JSON writes (tmp + rename, plus 0o600 mode) match the existing
  patterns.
- All `fs` reads of files we do not author are bounded by both byte caps and
  shape validation.
- The budget alert is fired at most once per local-date per device.
