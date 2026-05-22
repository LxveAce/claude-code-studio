# Security & Correctness Review — Phase 5 (Auth)

> Reviewed: 2026-05-21 · Branch: phase-5-auth · Reviewer: red-team agent

## Summary

Phase 5 ships a thoughtful two-mode auth surface (local scrypt-stub + HTTP-contract) that inherits the sandbox/CSP hardening from prior phases, validates credentials in main, and explicitly excludes the GitHub PAT from sync. The new attack surface lands one real cross-account data-leak on first install in default config (local-stub `pullSettings` is not scoped by user — register two local users and B sees A's "synced" theme/LMM), plus an expired-session-stays-valid bug when `expiresAt` is malformed/missing, plus a handful of mediums around session-file shape validation, scrypt verify trusting attacker-controlled keylen, no per-user atomic-tmp suffix, and email Unicode normalization. No RCE paths; auth IPC is sandbox-safe and bearer tokens are never logged.

## Critical (fix before merge)

### [C1] Local-stub `pullSettings`/`pushSettings` are **not scoped by user** → second local account silently reads (and overwrites) the first account's "synced" settings

**Where:**
- `src/main/auth-service.ts:30` (`const SYNC_FILE = 'auth-synced-settings.json';` — single shared file)
- `src/main/auth-service.ts:197-212` (`pullSettings` reads `this.syncPath` with no userId in the path)
- `src/main/auth-service.ts:214-225` (`pushSettings` writes the same `this.syncPath`)
- `src/main/auth-service.ts:148-160` (`register` happily creates a second `StoredUser` with a distinct `id` and email)

**Issue:** The local-stub backend is sold to the user as a multi-account simulator of the HTTP contract ("Local-stub mode: accounts and 'sync' are stored in this app's userData on this device only" — `AuthPanel.tsx:373-376`). But there is exactly one `auth-synced-settings.json` per installation, with no `userId` in the filename, the JSON key, or the read/write path. Concretely:

1. Register `alice@example.com`, push your theme + LMM settings → file contains `{theme: "Synthwave", lmm:{enabled:true, variant:"deep"}, updatedAt: ...}`.
2. Log out, register `bob@example.com` (any password).
3. Bob clicks "Pull settings" → service returns Alice's settings; renderer writes Alice's theme name into `localStorage.setItem('claude-studio-theme', 'Synthwave')` (`AuthPanel.tsx:80-82`) and surfaces "Pulled settings (theme: Synthwave, LMM: deep on)" — Bob never had any settings.
4. If Bob now pushes, Alice's file is silently overwritten with Bob's state, no merge, no warning.

The LMM `variant` flag is the highest-fidelity leak: it tells Bob whether Alice prefers "deep" or "quick" mode, which is a (mild) behavioral signal. The theme name is low-sensitivity but the precedent is what matters — the sync surface advertises per-account isolation and silently provides none.

**Exploit/scenario:** This is the default config on first install (`config.mode === 'local-stub'`). No attacker needed — any user who registers a second account on the same device for any reason (testing, family member, dev/staging split) trips it. Phase 6 will plausibly extend `SyncedSettings` to include more sensitive fields (vault sync metadata, model preferences, etc.); cementing the unscoped-file pattern now makes that future expansion silently leak more.

**Fix:** Key the sync file (or the JSON inside it) by `session.userId`:

```ts
private syncPathFor(userId: string): string {
  // userId is a UUID from crypto.randomUUID() — already filesystem-safe,
  // but assert the shape to defend against a hand-edited users.json.
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error('Invalid userId for sync path');
  }
  return path.join(app.getPath('userData'), `auth-synced-settings.${userId}.json`);
}
```

Then in `pullSettings`/`pushSettings`, use `this.syncPathFor(this.session!.userId)`. For the HTTP mode the backend is responsible for scoping by bearer-token identity, so this change is local-stub-only. Optionally migrate the existing single-file `auth-synced-settings.json` into the first user's keyed file on first run (or just delete it and surface a one-time "local sync reset" banner).

### [C2] Expired sessions with malformed `expiresAt` stay valid forever (NaN comparison)

**Where:** `src/main/auth-service.ts:83-85` (constructor expiry check).

**Issue:**
```ts
if (this.session && Date.parse(this.session.expiresAt) < Date.now()) {
  this.clearSession();
}
```
`Date.parse("not-a-date")` returns `NaN`, and `NaN < Date.now()` is `false` (NaN compares false with everything). So a session file whose `expiresAt` is `""`, `undefined` (after `JSON.stringify` of an unset prop would be missing, but a hand-crafted file or a future schema migration that renames the field would surface as `undefined → NaN`), `"null"`, `"forever"`, or any non-ISO string is treated as **never expiring**. The session token continues to authenticate the user (and in http mode, continues to be sent as a bearer token to the backend) past its intended 30-day TTL.

A concrete first-install bug path that hits this without an attacker: a future Phase-6 schema migration renames `expiresAt` to `expires_at`. After the migration, every existing `auth-session.json` on disk has `expiresAt === undefined` → `NaN < now → false` → the constructor leaves the (now structurally-broken) session in place. `getState()` then publishes a session with `expiresAt: undefined` to the renderer, which `JSON.stringify`s in IPC as missing field, and the UI shows "Signed in" indefinitely.

**Exploit/scenario:** No remote attacker required for the data-loss path: anyone who edits `auth-session.json` (or anyone running the app after a future schema migration) silently extends their own session. For the local-stub mode the token never reaches the network, so the impact is "session does not expire." For HTTP mode the stale bearer is sent on every `pullSettings`/`pushSettings` until the backend rejects it — which the current code does NOT auto-handle (no 401 → clearSession path; see L4 below). So a stolen `auth-session.json` (e.g., from a cloud-backed-up userData directory, see L1) plus this bug means the attacker's session never expires client-side.

**Fix:** Treat NaN as expired, and validate the parsed timestamp is finite:
```ts
if (this.session) {
  const exp = Date.parse(this.session.expiresAt);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    this.clearSession();
  }
}
```
Same fix mirrored anywhere else `expiresAt` is consulted (currently only the constructor — `getState` exposes it but does not enforce it; consider also re-checking expiry on every `pullSettings`/`pushSettings`/`logout` entry).

## High (fix soon)

### [H1] `scryptVerify` derives a key length from attacker-controlled `expectedHex.length` → DoS, memory blow-up, and `keylen=0` collision

**Where:** `src/main/auth-service.ts:250-254`.

```ts
private scryptVerify(password: string, saltHex: string, expectedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const candidate = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(candidate, expected);
}
```

The keylen passed to `scryptSync` is derived from the length of the stored hash, not pinned to the `SCRYPT_KEYLEN = 64` constant used at hash time. This couples a security primitive to a value sourced from `auth-users.json`. Three concrete failure modes:

1. **`hash: ""` (empty hex)** → `expected.length === 0` → `scryptSync(pw, salt, 0)` either throws or returns a zero-length Buffer (Node's behavior is implementation-defined but historically returned the empty buffer). If it returns empty, `timingSafeEqual(empty, empty)` is `true`, so **any password matches that user account**. An attacker who can write a single byte to `users.json` (`"hash":""`) turns it into a no-password backdoor for that email. Local-stub deployment makes this a low-likelihood exploitation path on its own — but combined with the schema-migration class of bugs (a future codepath that "repairs" a missing hash field by writing `""`), this becomes a real first-install regression.

2. **`hash: "ffff…ff"` (huge hex)** → `expected.length` is `expectedHex.length / 2`. A 1 GB hex string makes scrypt try to derive 500 MB of key material on every login attempt — pegs CPU, blows main-process RSS, and on OOM kills the Electron process (taking the PTY child with it — losing Claude session state). One login attempt per attack.

3. **Non-hex characters in `expectedHex`** → `Buffer.from(badHex, 'hex')` silently truncates at the first invalid pair, producing a shorter buffer than the writer intended. Login fails for legitimate users (denial-of-service against the account) with no surface to the renderer that the on-disk file is corrupt.

**Exploit/scenario:** All three require local FS write to `<userData>/auth-users.json`. That's a high bar — but it's the same bar as reading the file, and the on-disk format is the integrity boundary here. A defensive `scryptVerify` removes the primitive at zero cost.

**Fix:** Pin the keylen to the constant and validate the hash shape on read:
```ts
private scryptVerify(password: string, saltHex: string, expectedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(expectedHex) || expectedHex.length !== SCRYPT_KEYLEN * 2) {
    return false; // refuse malformed stored hash — caller surfaces generic "invalid credentials"
  }
  if (!/^[0-9a-f]+$/i.test(saltHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const candidate = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}
```
Bonus: extend `readUsers` to validate each `StoredUser` (id is UUID, email is string, salt is 32 hex chars, hash is `SCRYPT_KEYLEN*2` hex chars) and refuse to load (same "refuse to use" pattern as the existing `readUsers` catch arm at `:413-418`) if any record is malformed. This matches the prior-review's "distinguish ENOENT from parse failure" pattern.

### [H2] `readSession` accepts arbitrary JSON shape — a hand-crafted `auth-session.json` impersonates any user

**Where:** `src/main/auth-service.ts:425-433` (`readSession`), consumed by `getState` `:88-95` and `sessionToPublic` `:321-332`.

**Issue:** `readSession` does `JSON.parse(raw)` and casts to `StoredSession` with zero shape validation. Anyone with write access to `<userData>/auth-session.json` can plant:
```json
{
  "userId": "00000000-0000-0000-0000-000000000000",
  "email": "victim@example.com",
  "issuedAt": "2099-01-01T00:00:00Z",
  "expiresAt": "2099-01-01T00:00:00Z",
  "plainToken": "anything"
}
```
…and on next launch, `getState()` returns `signedIn: true, session: {user: {email: "victim@example.com", ...}}` to the renderer. The renderer trusts the email field (it's displayed in `SignedInView` and used as the avatar initial). In HTTP mode, that planted `plainToken` is then sent as `Authorization: Bearer anything` on the next push/pull — if the attacker also controls / has phished credentials to the HTTP backend, the renderer is now operating as the attacker's account while displaying the victim's email.

Combined with **C2**, the planted session never expires.

For local-stub mode, the impact is narrower because `pullSettings` only reads the shared (and per C1 unscoped) sync file — but the local-stub still treats the impersonated session as authoritative for `pushSettings`, so the attacker can overwrite the local sync file as the victim.

**Exploit/scenario:** Requires local FS write, same caveat as H1. The "OS keychain unavailable → tokens stored as plaintext" warning in the UI already discloses one half of this; the other half (the session metadata itself is unauthenticated JSON) is silent. Cloud-synced userData (OneDrive's "Documents" backup, corporate roaming profiles) is a real and common amplifier — sessions roam across machines without re-authentication, and `email` rides along.

**Fix:** Validate `StoredSession` shape in `readSession`, mirroring the rigor `acceptHttpSession` already applies to the network response:
```ts
private readSession(): StoredSession | null {
  let raw: string;
  try { raw = fs.readFileSync(this.sessionPath, 'utf8'); }
  catch (e) { return null; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.userId)) return null;
  if (typeof p.email !== 'string' || !EMAIL_RE.test(p.email)) return null;
  if (typeof p.issuedAt !== 'string' || !Number.isFinite(Date.parse(p.issuedAt))) return null;
  if (typeof p.expiresAt !== 'string' || !Number.isFinite(Date.parse(p.expiresAt))) return null;
  if (p.encryptedToken !== undefined && typeof p.encryptedToken !== 'string') return null;
  if (p.plainToken !== undefined && typeof p.plainToken !== 'string') return null;
  return p as unknown as StoredSession;
}
```
Bonus: in local-stub mode, additionally require `this.users[p.email]?.id === p.userId` before accepting — i.e. the session must reference a user that actually exists in `users.json`. This rejects the "no users exist, but planted session impersonates someone" case entirely.

### [H3] `attachToken` plaintext fallback has no user opt-in (same anti-pattern as Phase-4 C2)

**Where:** `src/main/auth-service.ts:292-298`.

**Issue:** When `safeStorage.isEncryptionAvailable()` is `false`, the service silently writes `session.plainToken = token` to `<userData>/auth-session.json`. The UI does surface the warning ("OS keychain unavailable — session tokens will be stored as plaintext" at `AuthPanel.tsx:379-392`), but only at register/login time and only as a banner — there is no opt-in toggle. The prior review's C2 required `allowPlaintext: boolean` to be passed explicitly to `github.setToken` (see `src/main/index.ts:159-161`); the auth service has no equivalent gate.

For local-stub mode, the "plain token" is a 32-byte hex string that authenticates only against this device's local-stub — so its disclosure is harmless on its own. For HTTP mode, the plain token is the **backend bearer**, with the same exfiltration consequences described in Phase-4 C2 — any process running as the user can read `auth-session.json` and impersonate against the configured HTTP backend until its server-side TTL expires.

**Exploit/scenario:** Same as Phase-4 C2 (browser extension native messaging hosts, malicious npm postinstall, multi-user machines without per-user ACL). The only thing limiting blast radius today is that no real HTTP backend exists yet — Phase 6+ will fix that.

**Fix:** Mirror the Phase-4 C2 remediation pattern:
1. Add `allowPlaintextToken: boolean` to `AuthCredentials` (or as a separate setting on `setBackend`).
2. In `attachToken`, when `safeStorage` is unavailable AND `allowPlaintextToken !== true`, throw `Error('OS keychain unavailable and plaintext storage not authorized — set allowPlaintextToken: true to override.')`.
3. Surface a checkbox in `AuthPanel.tsx`'s SignedOutView when `!encryptionAvailable`; default unchecked. Wire it through `register`/`login`.
4. Harden the `<userData>/auth-session.json` ACL on Windows after `renameSync` (see prior-review M6 for the GitHub-store equivalent). `fs.chmodSync(file, 0o600)` is silently ignored on Windows; `icacls "%file%" /inheritance:r /grant:r "%USERNAME%:F"` via `child_process.execFile` is the real fix.

## Medium (track as tech debt)

### [M1] Email comparison is byte-exact lowercase; no Unicode normalization (NFC/NFKC) → register/login mismatch and account-doubling

**Where:** `src/main/auth-service.ts:143` (`register` lowercase+trim), `:172` (`login` lowercase+trim), `:33` (`EMAIL_RE`).

**Issue:** `creds.email.toLowerCase().trim()` doesn't normalize Unicode. The classic case:
- User registers `andré@example.com` typed with U+00E9 (precomposed é, NFC).
- Later on another keyboard, types `andré@example.com` using U+0065 + U+0301 (decomposed, NFD).
- `.toLowerCase().trim()` does not collapse these. Login fails ("Invalid email or password"), or worse — `register` succeeds as a **second** account with the same human-readable email, and the user has two ghost accounts. In local-stub mode the second register call hits the "An account with email X already exists" path only when the *bytes* match.

Combined with `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`, the regex also accepts `é@é.é` (any non-whitespace, non-@ unicode codepoint), so the surface for normalization mismatches is larger than ASCII email validation would suggest.

**Exploit/scenario:** Pure UX / data-integrity bug, not a security exploit. But cross-device sync makes it bite — push from one keyboard, can't pull from another.

**Fix:**
```ts
const email = creds.email.normalize('NFKC').toLowerCase().trim();
```
Applied in both `register` and `login`. Optionally also normalize the local-part separately and apply IDNA (`punycode.toASCII`) to the domain part, but NFKC is the cheap 80% fix.

### [M2] Username-enumeration via `register` error message

**Where:** `src/main/auth-service.ts:144-146`.

**Issue:** `throw new Error(\`An account with email ${email} already exists locally\`)` discloses whether an email is registered. `login` is correctly generic ("Invalid email or password" at `:174, :176`). The asymmetry lets an attacker iterate `register({email: candidate, password: 'x'.repeat(8)})` against a list of emails — failures with the "already exists" message confirm registered accounts. The brief acknowledges this tension and lands on the disclosure side; making it explicit in the review.

For local-stub the impact is "attacker on this filesystem can enumerate which accounts exist on this device" — but they can already read `users.json` directly, so the leak is moot locally. For HTTP mode, the same string is produced by the backend (per the documented contract) and a real Cloudflare Worker implementation would inherit the leak unless the contract is changed.

**Exploit/scenario:** Account enumeration is the classic precursor to credential-stuffing. Worth fixing before any real backend reuses this contract.

**Fix:** Make `register` return the same generic error on collision: `throw new Error('Could not create account')`. On the happy path, the user knows it worked because `getState()` returns signed-in. The downside is users who genuinely forgot they already registered won't get a useful hint — soften with "If you already have an account, try signing in." in the renderer's catch handler rather than in the service message.

### [M3] `writeJsonAtomic` uses a fixed `.tmp` suffix — same race as Phase-4.5 M2, but now spanning two backends sharing one process

**Where:** `src/main/auth-service.ts:459-464`. Same anti-pattern as Phase-4.5 M2 (`lmm-service.ts` `writeCycle`).

**Issue:** All four auth files (`auth-users.json`, `auth-session.json`, `auth-synced-settings.json`, `auth-config.json`) share the same `<target>.tmp` naming. A `register` (writes users) racing with a `pushSettings` (writes sync) racing with a `setBackend` (writes config) — different files, no collision. But a concurrent `register` and `login` from the same renderer (UI gates this with `busy`, so unlikely in normal flow) could both call `writeUsers` → both write `users.json.tmp` → second wins, first's atomicity invariant is broken if the rename interleaves. And a crash between `writeFileSync(tmp, …)` and `renameSync(tmp, target)` leaves `auth-users.json.tmp` next to `auth-users.json` forever — silently.

Lower severity than the Phase-4.5 instance because the auth files are written less frequently. Filing as M for consistency.

**Fix:** Same as Phase-4.5 M2: random suffix + cleanup on error, or sweep `*.tmp` on startup. Sharing the existing `writeJsonAtomic` across services is fine, just bake the suffix into the helper.

### [M4] `acceptHttpSession` overrides server-supplied expiry with `now + 30d` — server-side rotation/short TTLs are invisible to the client

**Where:** `src/main/auth-service.ts:280-290`.

**Issue:** The HTTP contract documented at `auth-service.ts:14-26` says `POST /auth/login → { user, token }` — no `expiresAt` in the response. The client locally minted `expiresAt = now + 30d` regardless. If the backend rotates tokens hourly or enforces a 1-hour absolute TTL, the renderer's `getState().session.expiresAt` will lie by ~29 days, and the UI may show "Signed in" while every API call gets 401. There's also no auto-clear on 401 — see L4.

**Fix:** Two-step:
1. Extend the documented contract to optionally return `{ expiresAt?: string }` (ISO-8601), and use it in `acceptHttpSession` when present, falling back to `now + SESSION_TTL_MS` only when the backend omits it.
2. On any HTTP request, if `res.status === 401`, call `this.clearSession()` (or surface a structured "session-expired" error the renderer can handle).

### [M5] No schema-version field on `users.json` / `auth-session.json` / `auth-config.json` / `auth-synced-settings.json`

**Where:** All four `interface Stored*` declarations (`auth-service.ts:39-61`).

**Issue:** No `version: 1` field. A future change (e.g., the C1 fix adding per-user sync, or adding `scryptParams: {N, r, p}` to `StoredUser` so the cost can be tuned per-record) requires either manual migration code or a "load defaults on parse failure" fallback that loses the previous user's data. The Phase-4 review's C1 made exactly this point about `~/.claude/settings.json`. Cheap to add now, painful to retrofit later.

**Fix:** Add `version: 1` to each persisted shape; in each `read*` method, branch on version and either migrate forward or refuse-and-surface-error.

### [M6] `users.json` parse failure throws on construction → app cannot reach `AuthPanel` to let the user recover

**Where:** `src/main/auth-service.ts:412-418` (good defensive throw), but `:79` (constructor) calls `readUsers()` unconditionally.

**Issue:** The "refuse to use a corrupt users.json" pattern is right (matches Phase-4 review's C1 remediation), but it throws inside the `AuthService` constructor, which is called lazily from `getAuth()` (`src/main/index.ts:38-41`) on the first IPC call (`AUTH_STATE`). The renderer's `AuthPanel.refresh()` does `await window.electronAPI.auth.state()`, the IPC rejects, the panel sets `state = null` and shows the SignedOutView — but every subsequent auth call also throws constructor-init errors. The user has no in-app way to recover (the panel doesn't expose "reset auth files"); they must manually delete the file from disk.

**Fix:** Catch the throw inside `getAuth()` and surface a structured error state (e.g., a fourth field on `AuthState`: `error: string | null`). The panel can then render a "Local auth store is corrupt — open folder / reset" affordance, similar to how the GitHub panel handles missing-token.

### [M7] `clearSession` on backend switch is correct, but local user accounts become inaccessible without warning when switching local-stub → http and back

**Where:** `src/main/auth-service.ts:124-127` (`setBackend` clearSession), `:443-453` (`readConfig`).

**Issue:** Switching backend mode does NOT clear `users.json` (correct — local users should persist). But the UX is: a user registers Alice locally, switches to http, registers Alice on the backend, switches back to local-stub — and Alice's local password works again. From the user's perspective they have "two Alices" with no UI to disambiguate. The panel surfaces this slightly via the "Local only" / hostname label in SignedInView (`AuthPanel.tsx:213-215`), but only post-login.

**Fix:** In the BackendBlock, when `signedIn === false`, surface a one-liner like "Local accounts on this device: N" so the user knows what state they're switching into.

## Low / nits

- **L1 — Tokens stored under cloud-synced userData:** `<userData>` on Windows defaults to `%APPDATA%\<appName>`, which OneDrive's "Documents/Desktop backup" can be configured to roam (`%APPDATA%` itself is not roamed by default, but a managed-policy machine may redirect it). `auth-session.json` (plaintext-token path in H3) and `auth-users.json` (scrypt hashes — much lower risk) could ride along. Not a bug in this code, but documenting the assumption in a comment near `app.getPath('userData')` would help future Phase-6 PII-in-userData decisions.
- **L2 — `email.slice(0,1).toUpperCase()` for avatar (`AuthPanel.tsx:207`):** safe today because `validateCredentials` rejects empty email, so `session.user.email` is always non-empty. But if H2's session-shape validation lands (per its fix), an unvalidated `email` could be empty string and `''.slice(0,1).toUpperCase()` is `''` (not undefined — `slice` on an empty string returns empty string, not undefined). So actually safe even in the malformed case. **Verified-OK** rather than a real nit. Left here because the brief flagged it.
- **L3 — `state.session!.user` non-null assertion (`AuthPanel.tsx:187`):** the SignedInView is only rendered when `state?.signedIn === true` (`:135-136`). The service contract pairs `signedIn: this.session !== null` with `session: this.session ? sessionToPublic(...) : null`. So the assertion holds for any state produced by `getState()`. A third party producing an `AuthState` with `signedIn: true, session: null` would crash the panel — but the only producer is `AuthService.getState()`. Trust contract documented in the issue brief.
- **L4 — No 401 → clearSession handling:** `httpRequest` (`auth-service.ts:363-404`) treats any non-2xx as an `Error`. A 401 (expired/revoked token) leaves the local session intact — the user keeps seeing "Signed in" and every subsequent push/pull errors. See M4 fix #2.
- **L5 — No exponential backoff on 5xx:** by design per the brief, but a single transient 503 during `pullSettings` surfaces as a hard error to the user. Consider one retry with jitter (≤500ms) for `GET /settings` only — pushes and credentials should not auto-retry.
- **L6 — `httpRequest` error message includes the URL (`:386, :401`):** info leak only if the user pastes errors into a public bug report. URL is user-controlled (it's their backend), so the disclosure boundary is the user's own choice. Document, don't change.
- **L7 — `acceptHttpSession` accepts `b.token` of arbitrary length:** the brief raised this. Bearer is only used in `Authorization: Bearer <token>` headers and stored encrypted; never rendered. A multi-MB token would balloon every HTTP request and the encrypted session file, but the impact is "user's own backend is hostile to user" — they will notice. Optionally cap at e.g. 4 KB to fail fast.
- **L8 — `scrypt` cost = Node defaults (N=16384, r=8, p=1):** roughly 60–80ms per hash on modern hardware. Adequate for a desktop client with `MIN_PASSWORD_LEN=8` and a 256-char cap, but if Phase 6 ever exposes this service as a server endpoint, retune via `crypto.scrypt(..., { N: 2**15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })` and store the params per-record (see M5 — schema version is the prerequisite).
- **L9 — `register` succeeds with weak passwords (`12345678`):** `MIN_PASSWORD_LEN=8` is the only check. No allowlist/denylist, no zxcvbn-style entropy scoring. UX choice, not a bug. Brief acknowledged.
- **L10 — "Continue without login" button (`AuthPanel.tsx:276-285`) sets `mode='idle'`:** doesn't hide the register/login tabs below (`:299-328`). So the button is a no-op when `mode` is already `'idle'` (the default state on first open). Mild UX as the brief noted.
- **L11 — `clearSession` `fs.unlinkSync` on Windows with a held read handle:** Windows file locking would `EBUSY`. The catch arm swallows all errors so a stuck file just means the session JSON persists on disk until next launch — and the constructor's expiry check eventually re-clears it. Benign.
- **L12 — `writeUsers` is called on first register before any user gesture has confirmed file creation:** acceptable for the local-stub model (the user clicked "Create account" — that IS the gesture), but worth noting that on a corporate-managed machine where userData is on a redirected/locked share, the first registration silently fails (caught in IPC handler, thrown to renderer, surfaced in banner). The error message in that case is the raw `EPERM: …` — consider wrapping in a friendlier "Could not save account on this device."

## Verified-OK (explicitly checked, no issue)

- **HTTPS enforcement** (`auth-service.ts:119-121`): `setBackend` rejects non-`https:` baseUrls except localhost. URL is parsed via `new URL()` so injection of `javascript:` / `data:` / `file:` URIs is rejected at parse or protocol check. Trailing-slash stripped consistently (`:122`).
- **AbortController on fetch** (`auth-service.ts:375-389`): correctly wired with `clearTimeout` in `finally`. No leaked timers. 10s timeout.
- **Bearer token never logged:** searched all `console.*` and the only network-error path (`:386`, `:401`) includes URL and HTTP status/error message but not the token or request body. Token is also never rendered in the UI (no JSX that displays `session.encryptedToken`/`plainToken` or the decrypted token).
- **Tokens never sent to the renderer:** `sessionToPublic` (`:321-332`) maps `StoredSession` → `AuthSession` excluding both `encryptedToken` and `plainToken`. The full `StoredSession` never crosses the IPC bridge. `AuthState.session` is the public-only shape.
- **Theme name allowlist defuses XSS-via-synced-theme:** `pushSettings` accepts any 64-char-max string as `theme`, but `SettingsPanel.tsx:99` runs `THEME_PRESETS.find((p) => p.name === saved)` and only calls `applyTheme(preset)` if it matches — so a planted `<script>` or `red;background-image:url(...)` theme name never reaches the DOM as CSS. `AuthPanel.tsx:80-82` also only writes to `localStorage`, not innerHTML.
- **`sanitizeSyncedSettings` shape-narrows `lmm.variant`:** `:341` `input.lmm.variant === 'deep' ? 'deep' : 'quick'` — exact allowlist, no string fall-through.
- **`sanitizeSyncedSettings` always overwrites `updatedAt`** (`:344`): server-side-of-truth pattern, prevents renderer-supplied skew. Trade-off (race-clobber) noted in brief; acceptable for v1.
- **CSP / sandbox / nav lockdown inherited from prior phases:** `src/main/index.ts:51-57` sets `contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true`. `:258-274` `web-contents-created` handler denies `window.open` and `will-navigate` away from devUrl/file. The auth IPC adds no `shell.openExternal` call and no new navigation surface.
- **No `dangerouslySetInnerHTML` anywhere in `AuthPanel.tsx`** (or anywhere in `src/renderer/`): grep returned zero hits.
- **No new npm dependencies:** `auth-service.ts` imports only `electron`, `node:crypto`, `node:fs`, `node:path`, and the shared types. No `bcrypt`, no `jose`, no `axios` — fetch is the global Node 20+ implementation.
- **No `eval` / `Function()` / dynamic `import()`** in any Phase 5 file.
- **`logout` in http mode is fail-open** (`auth-service.ts:182-195`): network failure on `POST /auth/logout` is caught and local clear proceeds. Correct — the user said "sign out," that intent must succeed locally.
- **Session token entropy:** `crypto.randomBytes(32).toString('hex')` = 256 bits, well above the 128-bit floor for opaque session tokens.
- **scrypt salt entropy:** `crypto.randomBytes(16).toString('hex')` = 128 bits, sufficient against rainbow-table reuse.
- **`pushSettings` rejects when not signed in** (`:215`): no anonymous writes to the sync file.
- **`pullSettings` rejects when not signed in** (`:198`): no anonymous reads. (But see C1 — being signed in doesn't scope the read by user.)
- **IPC handlers use `ipcMain.handle`** (request/response), not `ipcMain.on`: no fire-and-forget paths where the renderer can spam-trigger expensive work without backpressure.
- **`setBackend` clears session on mode OR baseUrl change** (`:125-127`): correct — a token issued by `https://a.workers.dev` must not be sent to `https://b.workers.dev`.
- **No new `terminal.sendInput` reachable surface:** the auth panel makes zero terminal calls. The C3-class "renderer XSS → PTY shell" pivot is not extended by Phase 5.
- **`AUTH_*` channels are namespaced under `auth:`** (`src/shared/ipc-channels.ts:34-41`): no collision with `compact:`, `lmm:`, `github:`, or the pre-existing `SYNC_*` placeholders.
- **`SyncedSettings` deliberately excludes GitHub PAT:** confirmed in `src/shared/types.ts:174-183` (comment is explicit). `pushSettings` body in `AuthPanel.tsx:100-104` only sends `theme` + `lmm`, not any `github.*` field.
- **Password length cap of 256** (`auth-service.ts:239-241`): prevents the scrypt-cost-amplification class of attack via huge passwords (scrypt cost is keylen-bound but processing the input string still allocates).
- **`scryptHash` does not log password or derived key.**
- **`writeJsonAtomic` `mode: 0o600`** (`:462`): correct intent. POSIX-honored, Windows-ignored — see H3 fix #4 for the Windows ACL hardening.
- **No prototype-pollution sink:** `JSON.parse` returns a plain object; `this.users[email]` uses bracket-access on a Record. `__proto__` as an email would `?.createdAt → undefined` and fall back to `session.issuedAt` (`sessionToPublic:325`) — no inherited-prop confusion.
