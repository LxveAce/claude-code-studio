# Security & Soundness Review — Bootstrap Installer, Phase 3 (bundled runtime path)

**Phase reviewed:** `PtyManager.findClaudePath()` now prefers the bundled
runtime location in packaged builds, with graceful fall-through to legacy
candidates if bundled is missing.
**Artifacts:** `src/main/pty-manager.ts` (single-method change), `.gitignore`
(adds `dist/`).
**Reviewer:** assistant (self-red-team).
**Date:** 2026-05-23.

---

## CRITICALS

None.

## HIGHS

None.

## MEDIUMS

None. Path traversal is not a risk because `process.resourcesPath` is set by
Electron itself, not user input. The `path.join(...)` calls only ever resolve
inside the install directory's `resources/` folder.

## LOWS

### L1 — TOCTOU between `existsSync` and `spawn`

**Where:** `findClaudePath()` does `fs.existsSync(bundled)` then
`spawnWithPty()` calls `pty.spawn(claudePath, ...)`. A file deleted between
the check and the spawn would cause spawn to error.
**Risk:** Minimal — only an attacker with write access to the install dir
could create this race, and at that privilege level they have many easier
attacks. The existing `pty.spawn` error handling in `spawnWithPty` /
`spawnWithChildProcess` already emits an `'exit'` event the UI can react to.
No new failure mode introduced.
**Decision:** Accepted, not fixed. Doing this atomically would require
spawning even if the file is missing and trusting the spawn error — which is
more brittle than the existence check.

### L2 — `claude.cmd` vs `claude.exe` ambiguity

**Where:** Code accepts either `runtime/claude.cmd` or `runtime/claude.exe`.
**Risk:** Phase 4 NSIS bootstrap could produce either. If it produces both,
`claude.cmd` wins (checked first). Order is intentional: the npm-installed
CLI from `@anthropic-ai/claude-code` exposes itself as `claude` (via
`bin.claude = cli.js` in package.json), which on Windows npm installs
creates `claude.cmd` (a shim that invokes `node.exe cli.js`) — that's the
canonical case. `claude.exe` is the fallback if Phase 4 chooses a different
packaging approach (e.g., pkg/nexe single-file launcher).
**Decision:** Documented in code comment. Phase 4 must commit to one of the
two; this code accepts both for forward compatibility.

## Risks accepted (not findings)

- **Dev mode skips bundled check entirely.** `!app.isPackaged` falls through
  to legacy PATH lookup. Intentional — `process.resourcesPath` in dev points
  at Electron's own resources, not ours, so the bundled path wouldn't
  resolve. Dev workflow unchanged.
- **Bundled-missing degradation.** If the user manually deletes
  `resources/runtime/` (or the bootstrap failed), `findClaudePath()` falls
  through to legacy candidates. The user gets a "use whatever's on PATH"
  experience, which is strictly better than a hard "no CLI found" error.
  Phase 6 onboarding's `claude doctor` check will surface the configuration
  problem to the user.

## Phase 3 acceptance summary

- ✅ `findClaudePath()` checks bundled location first in packaged mode.
- ✅ Graceful fall-through to legacy candidates if bundled missing.
- ✅ Dev mode untouched.
- ✅ Single-file change isolated to pty-manager.ts.
- ✅ Build still passes (vite:build clean).
