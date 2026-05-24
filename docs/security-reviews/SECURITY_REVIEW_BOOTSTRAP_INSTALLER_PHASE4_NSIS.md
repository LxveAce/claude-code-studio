# Security & Soundness Review — Bootstrap Installer, Phase 4 (NSIS bootstrap)

**Phase reviewed:** Custom NSIS macros that download Node 22 + install
`@anthropic-ai/claude-code` into `$INSTDIR\resources\runtime\` at install
time, with progress UI, SHA256 verification, soft-fail on CLI install,
hard-fail on Node download/verify.
**Artifacts:** `build/installer.nsh`, `electron-builder.yml` (added
`nsis.include: build/installer.nsh`).
**Reviewer:** assistant (self-red-team).
**Date:** 2026-05-23.

**Scope note:** Phase 4 ships the ONLINE installer only. The offline
variant required by Phase 1 red-team H1 is deferred to Phase 4b (post-v1.1,
based on user-reported install-failure rate). Rationale: zero install
failures reported yet (userbase of one); ONLINE-first is sufficient to
validate the architecture; OFFLINE can ship in a v1.1.x point release if
needed without a v1.2 cycle. The "redirect to offline" message in the
install-failure modal still references a placeholder URL; that message
becomes accurate once Phase 4b ships.

---

## CRITICALS

None. The download is integrity-verified before extraction, the npm
install is registry-pinned, and PowerShell shell-outs use no user-supplied
strings.

## HIGHS

### H1 — Offline installer variant deferred (was Phase 1 H1)

**Where:** Phase 4 ships online-only.
**Risk:** Users behind corporate proxies, captive-portal hotel WiFi, or
flaky home networks will hit the "Couldn't download Node.js" modal and
have no recovery path (the message points at a `releases/latest` URL that
doesn't yet have an offline asset).
**Mitigation accepted for v1.1 alpha:** userbase is one person; the
maintainer is on a stable network; install-failure rate empirically
unknown but likely zero in the immediate term. Failure modal directs to
the GitHub Releases page (where Phase 4b's offline variant will appear).
**Tracked:** Phase 4b in BACKLOG (added post-v1.1 release). Trigger to
implement: any user-reported install failure due to network issues.

### H2 — SmartScreen warning likely amplified vs Squirrel

**Where:** Setup.exe is unsigned and downloads + executes a portable Node
runtime + runs npm. From SmartScreen's perspective this is a high-risk
unsigned installer.
**Risk:** Users get the "Windows protected your PC" full-screen warning
before the installer even runs, with no obvious "Yes I trust this" path
unless they click "More info → Run anyway". This was already a known risk
(Phase 1 red-team H2) but Phase 4's network+exec behavior amplifies it —
SmartScreen reputation systems flag unsigned installers that fetch +
execute payloads as higher risk.
**Mitigation:** Phase 9 documents the warning + literal steps in README +
release notes. Code-signing tagged for v1.2 (~$70/yr OV cert).

## MEDIUMS

### M1 — `$TEMP\node-v22.22.3-win-x64.zip` is a predictable temp path

**Where:** Step 1 downloads to a fixed `$TEMP\` filename. An attacker with
write access to `$TEMP\` could pre-create a malicious zip and race the
download.
**Mitigation:** SHA256 verification in Step 2 catches any tampered file
regardless of how it got there. If an attacker writes a valid Node zip,
they've achieved nothing. If they write a tampered one, the install
aborts. The race is essentially harmless given the SHA gate.
**Decision:** Accepted. Could be hardened by using a random temp filename,
but the SHA gate makes it not worth the added NSIS complexity.

### M2 — npm install runs unsandboxed with whatever the bundled CLI's
postinstall scripts decide to do

**Where:** Step 4 — `npm install @anthropic-ai/claude-code`.
**Risk:** npm executes lifecycle scripts (`preinstall`, `install`,
`postinstall`) from the installed package and any of its transitive
dependencies. We trust Anthropic's package, but a compromise of the npm
registry or Anthropic's publishing pipeline could ship a malicious
postinstall.
**Mitigations in place:**
- `--registry=https://registry.npmjs.org/` ignores user's `.npmrc`
  (catches malicious local mirrors).
- We do NOT pin `@anthropic-ai/claude-code` to a specific version (CLI is
  a seed, not a floor — see Phase 1 H3) so we always get the latest
  Anthropic-signed publish. This means we get fixes faster but also any
  poisoned publishes faster. Net trust delegation to Anthropic.
**Could add:** `--ignore-scripts` to npm to refuse postinstall scripts —
but Claude Code likely DOES need lifecycle scripts for its own setup, so
this would break the install.
**Decision:** Accepted. Trust boundary is the npm registry + Anthropic's
publishing controls; if those are compromised, all Claude Code installs
worldwide are compromised, not just ours.

### M3 — PowerShell shell-out command construction is hand-built strings

**Where:** Every `nsExec::ExecToStack 'powershell ...'` line.
**Risk:** If any of the interpolated NSIS variables (`$INSTDIR`, `$TEMP`,
`${INSTALL_LOG}`) ever contained user-controlled content with PowerShell
metacharacters (`'`, `;`, `$`, backticks), we'd have injection.
**Mitigation:** NSIS variables in oneClick mode come from:
- `$INSTDIR`: fixed `%LocalAppData%\Programs\<productName>\` because
  `allowToChangeInstallationDirectory: false`. Not user-supplied.
- `$TEMP`: environment-derived, not user-input.
- `${INSTALL_LOG}`: preprocessor-defined literal.
None of these can carry attacker-controlled metacharacters in normal use.
**Edge case:** A user account with `;` in the username would have a
`$TEMP` that includes `;`. PowerShell single-quoted strings don't
interpret `;` though, so even that wouldn't escape.
**Decision:** Accepted as low realistic exposure. If we ever let
`allowToChangeInstallationDirectory: true`, revisit and add proper escape
of `$INSTDIR` before interpolation.

### M4 — PowerShell `Expand-Archive` is slow on large archives

**Where:** Step 3 extracts the ~30 MB Node zip.
**Risk:** Cosmetic — Expand-Archive can take 30+ seconds on slow disks,
during which the installer shows "Extracting Node.js runtime..." with no
percentage. User may think the installer froze.
**Mitigation:** Acceptable for v1.1 alpha. If user feedback is "installer
felt slow", swap Expand-Archive for the bundled 7za in
node_modules/7zip-bin/ during a v1.1.x point release.
**Decision:** Defer; document in `BACKLOG`.

### M5 — Soft-fail on npm install leaves user in a weird state

**Where:** Step 4's `npm_ok` branch. If npm install fails, we show a
message and continue with Studio install. The user gets a working Studio
app but no bundled CLI; Phase 6 onboarding's `claude doctor` will then
prompt them to install the CLI.
**Risk:** Phase 6 doesn't exist yet (it's the next phase). If the user
installs v1.1 today, hits npm failure, they see "install CLI manually"
modal then a Studio that has a broken terminal panel and no recovery UI.
**Mitigation:** Phase 4 must commit BEFORE Phase 6, but the v1.1 RELEASE
must include both. Sequencing in Phase 9 acceptance: don't tag v1.1.0-rc1
until Phase 6 is shipped.
**Decision:** Documented dependency on Phase 6.

## LOWS

### L1 — $TEMP\ccs-install.log not cleaned up on success

Intentional. Leaving the log lets users send it for debugging if the app
behaves weirdly post-install. Persists across runs; each install appends.
Could rotate on size if it ever became a problem; <100 KB per install in
practice.

### L2 — TLS 1.2 pinning may need 1.3 in 5 years

`[Net.ServicePointManager]::SecurityProtocol = Tls12` excludes 1.0/1.1
explicitly (good — nodejs.org rejects those) but doesn't enable 1.3.
PowerShell on Windows 10/11 will negotiate 1.3 if the server offers it,
so this is fine today; if .NET deprecates the Tls12 enum value, revisit.

### L3 — Bundled npm version is tied to whatever Node 22.22.3 ships

Currently npm ~10.x. If Node bumps to 22.x.y with a broken npm, our
install breaks. Mitigation: SHA256 pin to a known-good Node release
already locks us to a tested npm; bumping Node requires re-testing.

## Risks accepted

- Offline variant deferred (H1).
- SmartScreen warning unchanged from v1.0 baseline (H2 — but documented
  in Phase 9 release notes).
- Trust boundary at Anthropic + npm registry (M2).
- Predictable temp filename mitigated by SHA gate (M1).

## Plan adjustments

1. **Phase 9 acceptance MUST not tag v1.1.0-rc1 until Phase 6 ships** — soft-
   fail on npm install requires Phase 6 onboarding's "install CLI now"
   recovery flow (M5).
2. **Phase 4b added to BACKLOG** for offline installer variant (H1).
3. **Phase 4b also covers `Expand-Archive` → 7za swap** if speed feedback
   warrants (M4).

## Phase 4 acceptance summary

- ✅ NSIS `customInstall` macro downloads + verifies + extracts Node + installs
  `@anthropic-ai/claude-code`.
- ✅ Hard-fail aborts install on network/integrity failure with clear modal.
- ✅ Soft-fail proceeds on CLI install failure with clear modal (Phase 6
  onboarding will recover).
- ✅ All operations logged to `$TEMP\ccs-install.log`.
- ✅ `customUnInstall` cleans up bundled runtime.
- ✅ electron-builder.yml `nsis.include` wired.
- ⚠️ NOT YET TESTED end-to-end (Dev Mode env required for full NSIS build —
  Phase 2 H1). User must enable Dev Mode and run `npm run dist` to validate.
