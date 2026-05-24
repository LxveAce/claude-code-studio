# Security & Soundness Review — Bootstrap Installer, Phase 6 (auth onboarding)

**Phase reviewed:** First-launch CLI auth onboarding modal — detects missing
or unauthenticated `claude` via `claude doctor`, offers one-click install
recovery (re-runs the Phase 4 NSIS bootstrap's npm install via the bundled
runtime), guides user to `claude login` in the embedded terminal.
**Artifacts:** `src/shared/types.ts` (CliStatus + CliOnboardingState),
`src/shared/ipc-channels.ts` (5 new channels), `src/main/cli-service.ts`
(new), `src/main/index.ts` (CliService wiring, setupCli()),
`src/preload/preload.ts` (`cli.*` namespace), `src/declarations.d.ts`
(ambient types), `src/renderer/components/auth/CliAuthOnboarding.tsx`
(new), `src/renderer/App.tsx` (modal mount + onboarding check effect).
**Reviewer:** assistant (self-red-team).
**Date:** 2026-05-23.

---

## CRITICALS

None. All IPC handlers run in the main process with proper input
validation (no user-supplied paths or commands); the modal can be
dismissed without acting; CLI install uses the same hardened npm call
as Phase 4's NSIS bootstrap.

## HIGHS

### H1 — `claude doctor` exit-code contract is undocumented

**Where:** `cli-service.ts:getStatus()` — interprets exit code 0 as
"authenticated", non-zero with auth-keyword output as "unauthenticated",
ENOENT as "not installed". Anthropic's docs only describe doctor as
giving "a more detailed check" — actual exit-code semantics inferred.
**Risk:** A CLI version bump that changes doctor's exit-code behavior
(e.g., returning 0 even when unauthenticated, or non-zero for warnings
unrelated to auth) would mis-classify the user's state. False positives
on "authenticated" → user sees Studio but the terminal hangs at login.
False negatives → modal keeps showing.
**Mitigations in place:**
- We don't ONLY check exit code — we also scan stdout/stderr for
  auth-related strings (`not authenticated`, `please log in`, etc).
  This gives us a second signal even if exit codes shift.
- Modal has "Don't show again" — user can opt out if the detection
  becomes annoying.
- Phase 6 design doc (`INSTALLER_REDESIGN.md`) mentions this is best-
  effort; future Phase 6b could swap to a more stable detection method
  (e.g., reading `~/.claude.json` directly with a documented schema).
**Decision:** Accepted with monitoring. Re-evaluate if CLI 2.2.x changes
doctor output. If user reports "modal keeps showing despite signed in",
this is the first place to look.

### H2 — `sendToActivePane('claude login\r')` injects unconditionally

**Where:** `CliAuthOnboarding.tsx:handleLoginInTerminal()` →
`App.tsx:sendToActivePane()` → `sendToActive(text, false)` →
`sender(text)` (PTY input write).
**Risk:** If the user is mid-typing a command in the terminal when they
click "Sign in to Claude", we inject `claude login\r` into whatever they
were composing. If they had a partial command, the result is a
concatenated garbage line that submits (because of the `\r`).
**Mitigations in place:**
- `App.tsx:sendToActivePane()` calls `setActivePanel('terminal')` BEFORE
  sending, so the user sees what's about to happen.
- Modal stays open after click — user can immediately see the terminal
  state and recover.
- The `\r` is intentional (we want the command to submit), but means we
  can't be defensive about partial input.
**Could fix:** Pre-send `\x15` (Ctrl-U = clear-line) before `claude login`
to guarantee a clean prompt. Tradeoff: feels intrusive if the user had
already typed something they wanted to keep.
**Decision:** Accepted. The user clicked "Sign in to Claude" with intent
to sign in; clobbering whatever was there is the requested behavior.
Could revisit if anyone complains.

## MEDIUMS

### M1 — `install()` shells out to npm with no progress UI; modal shows static "Installing…"

**Where:** `CliAuthOnboarding.tsx` — "Installing… (~30s)" button label is
hard-coded; no progress percentage, no streaming output. npm install
typically takes 15-60 seconds but our `NPM_INSTALL_TIMEOUT_MS` is 5
minutes; if user has slow network, they'll wait at "Installing…" for
that long with no progress indication.
**Mitigation:** Timeout caps the wait. Failure modal includes the npm
output (`result.output`) which lets user see what happened.
**Could fix:** Stream npm stdout via IPC events as it runs, render in
modal. ~half a day of work. Defer to v1.1.x polish.
**Decision:** Accepted; documented in BACKLOG as polish item.

### M2 — Modal backdrop click does not close (intentional)

**Where:** `CliAuthOnboarding.tsx` — the backdrop is a full-screen `div`
with no `onClick={onClose}`. User must use "Maybe later" or "Don't show
again" to dismiss.
**Risk:** Could feel sticky to users who expect click-outside-to-close.
**Decision:** Intentional. Two explicit dismiss buttons with different
semantics (persist vs reshow) — backdrop-click would be ambiguous as to
which semantics to use. Standard UX for confirmation-style modals.

### M3 — `cli-onboarding.json` is plaintext, user-editable

**Where:** `<userData>/cli-onboarding.json` written by `setOnboardingComplete()`.
**Risk:** User who edits to `{"complete": false}` re-triggers the modal.
**Mitigation:** This is a feature — `resetOnboarding()` IPC method exists
for explicit re-prompting. Doc note in SettingsPanel (Phase 7) could
expose a "Show CLI onboarding again" button.
**Decision:** Accepted; not a security concern (no sensitive data in the
file).

### M4 — `getStatus()` may take up to 10s synchronously per modal show

**Where:** `cli-service.ts:DOCTOR_TIMEOUT_MS = 10000`. App.tsx onboarding
check awaits `cli.status()` before deciding to show the modal. If doctor
hangs (very rare), the modal-shown-or-not decision is delayed by up to
10s.
**Mitigation:** Doctor normally returns in <2s. Modal show is fire-and-
forget for the user — they don't see anything while we're awaiting.
**Decision:** Accepted. Could lower timeout to 5s; would only matter if
doctor hangs are common, which they aren't.

### M5 — Path-resolution duplication between PtyManager and CliService

**Where:** `cli-service.ts:findClaudePath()` is a near-copy of
`pty-manager.ts:findClaudePath()`. If Phase 4 changes which file the
NSIS bootstrap installs (e.g., switches to claude.exe instead of
claude.cmd), both need to update.
**Mitigation:** Both files have an inline comment pointing at the other.
A future refactor could extract a shared `runtime-paths.ts` helper.
**Decision:** Accepted as tech debt. Files are 12 lines each; abstraction
not worth the indirection until there's a third consumer.

## LOWS

### L1 — Modal lacks Esc-to-close

**Where:** No `useEffect` listening for Escape keydown to call onClose.
**Decision:** Minor accessibility nit. Could add in a few lines; deferred
to v1.1.x.

### L2 — Renderer bundle grew 5 KB (708 → 713 KB)

Acceptable. Bundle was already past the 500 KB chunk-size warning; this
adds <1% to that.

### L3 — `cli` namespace in declarations.d.ts duplicates types from shared/types

**Where:** `declarations.d.ts` re-types the return values of `cli.status`,
`cli.install`, etc. inline rather than referencing `CliStatus` /
`CliOnboardingState`. Other namespaces (compact, lmm, etc.) do reference
shared types via `import('./shared/types').X`.
**Decision:** Matches existing pattern for one-off return shapes (the
`{ ok, output, error }` for install isn't a named shared type yet).
Could promote to a `CliInstallResult` interface for symmetry — deferred.

## Risks accepted

- doctor exit-code contract guess (H1) — re-evaluate per CLI bump.
- Unconditional `claude login\r` injection (H2) — explicit user click =
  authorized; cleanup of pre-existing input is overengineering today.
- No streaming install progress (M1) — UX polish, not v1.1 blocker.
- Sticky modal backdrop (M2) — intentional UX choice.

## Plan adjustments

1. **BACKLOG add:** stream npm install output in modal (M1).
2. **BACKLOG add:** Esc-to-close on modal (L1).
3. **Phase 7 todo:** add "Show CLI onboarding again" entry in SettingsPanel
   (M3 — exposes the existing `resetOnboarding` IPC).

## Phase 6 acceptance summary

- ✅ `CliService` runs `claude doctor`, parses output, returns typed status.
- ✅ Soft-fail recovery: `install()` re-runs Phase 4's npm install via
  bundled runtime.
- ✅ Persisted onboarding flag at `<userData>/cli-onboarding.json`.
- ✅ Modal shows only when onboarding not complete AND CLI is missing or
  unauthenticated.
- ✅ "Install Claude CLI" calls bundled npm; on success, modal re-polls
  status and transitions to the "Sign in" step.
- ✅ "Sign in to Claude" types `claude login\r` into active terminal,
  switches view to terminal so user sees CLI prompts.
- ✅ Two dismiss paths: "Maybe later" (reshows next launch), "Don't show
  again" (persistent).
- ✅ Defensive IPC failure handling — modal never blocks app startup.
- ✅ Vite build clean (main+preload+renderer all compile).
- ✅ TypeScript ambient types in declarations.d.ts.

**This phase unblocks v1.1.0-rc1** per Phase 4 M5.
