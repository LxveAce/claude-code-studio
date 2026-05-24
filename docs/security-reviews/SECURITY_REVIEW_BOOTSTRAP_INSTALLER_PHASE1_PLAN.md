# Security & Soundness Review — Bootstrap Installer, Phase 1 (Plan)

**Phase reviewed:** Design lock-in (no code changes yet).
**Artifacts:** `docs/INSTALLER_REDESIGN.md`, `journal/config/INSTALLER_REDESIGN.lmm.md`.
**Reviewer:** assistant (self-red-team per project convention).
**Date:** 2026-05-23.

This is a **plan-phase** red-team — the goal is to surface defects in the
design *before* code starts, not to audit code (there is none yet). Findings
classified the same way as code reviews so they're cross-comparable: Critical
/ High / Medium / Low.

---

## CRITICALS — fix before Phase 2 starts

None. The plan as written is internally consistent and ships incrementally
behind a feature branch, so no immediate-blast-radius failure mode is baked in.

## HIGHS — fix before the relevant phase

### H1 — Online-only install is fragile in the worst install scenarios

**Where:** Design doc Fork 2, "Online" decision.
**Risk:** The install will fail on: (a) hotel WiFi with captive portals,
(b) corporate networks that proxy or block `registry.npmjs.org`, (c) flaky
home networks that drop mid-download (the npm install step is the longest
network-bound step). Failure here is a user-facing "the installer doesn't
work" experience with no obvious recovery path.
**Why it's a High not a Medium:** The user's stated goal is "one click and
done" — a flow where 5-10% of users hit an unrecoverable install error
violates the goal more than a larger download would.
**Fix (must be in Phase 4 design, not a "future pivot"):**
1. Phase 4 must ship with a `--offline` build flag from day one that bundles
   the pinned Node zip + a pre-fetched npm tarball of
   `@anthropic-ai/claude-code@2.1.150` inside the installer payload. The
   default release artifact stays online (~180 MB), but the offline variant
   (~310 MB) ships alongside it on the GitHub Release for users who report
   install failures.
2. The NSIS bootstrap must detect online-install failure (any non-zero exit
   from the download/install step) and surface a clear modal: "Download
   failed. Download the offline installer from <URL>". Do not silently roll
   back without telling the user where to go.

### H2 — SmartScreen warning is amplified by NSIS vs Squirrel

**Where:** Design doc, code-signing decision (deferred).
**Risk:** Squirrel's unsigned-install warning was already a UX wart, but
Squirrel installs auto-launch silently which lessens the visual impact.
NSIS installs surface SmartScreen's "Windows protected your PC / More info /
Run anyway" full-screen warning *before* the installer even opens. For users
unfamiliar with the warning, this looks like malware and they'll close it.
**Why it's a High:** This will hurt v1.1's first-impression more than v1.0's
did, and the user has explicitly asked for a "good looking" install
experience.
**Fix:** Phase 9 must include explicit documentation in the release notes
and README: a "Why does Windows warn me about this?" subsection with a
screenshot of the warning and the literal "click More info → Run anyway"
steps. **Acknowledge the deferral of code-signing** but mitigate the UX with
clear guidance. Add a v1.2 task for code-signing (Sectigo OV cert ~$70/yr or
EV cert ~$300/yr for instant trust).

### H3 — Claude Code CLI is at v2.1.150 and updates frequently; pinning is brittle

**Where:** Phase 4 design — pinned `@anthropic-ai/claude-code@2.1.150`.
**Risk:** The CLI auto-updates itself when invoked (Claude Code is designed
to self-update). A pinned-then-frozen install would either: (a) immediately
auto-update on first launch, defeating the pin, or (b) need its self-update
disabled, which is hostile to users who expect to get CLI features.
**Why it's a High:** Misaligned update behavior between the bundled CLI and
Anthropic's release cadence will produce confusing user states ("why is my
CLI different from what's documented?").
**Fix (must be in Phase 4):**
1. Verify whether `@anthropic-ai/claude-code` self-updates from npm on first
   launch (likely yes — `claude doctor` mentions update checks). If yes,
   accept that the bundled version is a *seed*, not a *floor*. Document this:
   "Studio bundles vX.Y.Z; the CLI may update itself to the latest on first
   run."
2. Design Phase 6 onboarding to also surface CLI version + "Update CLI"
   button so the user has explicit control.
3. In Studio's auto-updater (Phase 7), do NOT try to manage the CLI version
   — Studio updates Studio, the CLI updates itself.

## MEDIUMS — fix or document, doesn't block phase progression

### M1 — Credentials path is correct but not version-stable

**Where:** Phase 6 design, credential detection.
**Risk:** Detected via `%USERPROFILE%\.claude.json` per Anthropic docs at
time of design. If Claude Code changes its credentials storage in a future
version, our detection breaks → onboarding modal either reshows forever
(false negative on "logged in") or never shows (false positive).
**Fix:** Phase 6 detection should not just check file existence — it should
shell out to `claude doctor` and parse its output for the "authentication"
section. If `claude doctor` reports authenticated, skip onboarding. This
delegates the source of truth to Claude Code's own diagnostic, which is the
right layer.

### M2 — Node 22.22.3 install via zip skips MSI side effects

**Where:** Phase 4 — using portable Node zip.
**Risk:** The official Node MSI installs Visual C++ runtimes, adds Node to
PATH (system-wide), and registers the Windows installer for clean uninstall.
A zip-extract gives us none of that. Our use-case is fine for the
*bundled-runtime* design (we never want Node on system PATH; uninstall
removes the install dir), but the bundled npm in the zip needs the same VC++
runtimes the MSI would install.
**Fix:** Phase 4 must verify that `runtime\node.exe --version` works on a
clean Windows install without VC++ Redistributable already present.
Likely-fine because Node ships statically-linked CRT in recent versions, but
needs explicit verification, not assumption.

### M3 — Forge + builder coexistence may produce conflicting build artifacts

**Where:** Phase 2 design, "keep forge in place as escape hatch".
**Risk:** Both build pipelines write to `out/`. If a developer runs
`npm run make:forge` then `npm run make` they get mixed artifacts. Less of a
real issue and more a confusion vector.
**Fix:** Phase 2 must make builder output to a different directory than
forge (`dist/` is electron-builder's default — leave it there) so the two
pipelines never collide. Document in CONTRIBUTING which command produces
which artifact.

### M4 — NSIS bootstrap log location not specified

**Where:** Phase 4 design.
**Risk:** When (not if) a user reports "the installer crashed on my
machine", we need a log file to diagnose. NSIS doesn't write one by default.
**Fix:** Phase 4 NSIS script must `LogSet on` + write to
`%TEMP%\ccs-install.log` and reference that path in the failure modal.

### M5 — Build pipeline assumes Anthropic's npm registry is the source of truth

**Where:** Phase 4 — `npm install @anthropic-ai/claude-code`.
**Risk:** If a user's npm config points to a private registry mirror (corp
networks often do), the install may pull a different version or fail.
**Fix:** Phase 4 NSIS bootstrap must invoke npm with
`--registry=https://registry.npmjs.org/` explicitly, ignoring user's npmrc.

## LOWS — note and proceed

### L1 — `update-electron-app` was Phase 7b infrastructure; rip-and-replace loses some hardening

**Where:** Phase 7 design, updater swap.
**Risk:** The current updater-service has rate-limit gates, dev-mode gates,
and user-disable gates (per Phase 7b security review). The
`electron-updater` API differs; we'll have to re-implement those gates.
**Fix:** Phase 7 acceptance criteria must explicitly preserve those three
gates. Add as test checklist in Phase 7's red-team.

### L2 — Plan doesn't address what happens to the v1.0 `app-1.0.0` install dir on the user's machine

**Where:** Phase 8 / migration docs.
**Risk:** User's existing Squirrel install at
`%LocalAppData%\claude_code_studio\` doesn't get cleaned by the NSIS
installer (it installs to `Program Files` by default, which is a different
root). User ends up with both a dead Squirrel install AND a new NSIS install.
**Fix:** `MIGRATING_FROM_V1.md` should explicitly tell users to use
Programs & Features to uninstall the v1.0 entry first. Could automate via
NSIS pre-install check but adds complexity; manual instructions are
sufficient for the small user base.

### L3 — Phase numbering implies linear execution; phases 3 and 4 can parallelize

**Where:** Phase ordering.
**Risk:** Treating each phase as strictly sequential wastes time. Phase 3
(path resolution) and Phase 5 (branding assets) have no dependency on Phase
2 finishing — they could be done in parallel.
**Fix:** Acknowledge in `INSTALLER_REDESIGN.md` that phases 3 and 5 can be
done in parallel with phase 4 once phase 2 is committed.

## Risks accepted (not findings — documented for posterity)

- **Squirrel→NSIS migration cliff.** Users on v1.0 must uninstall + reinstall
  once. Accepted because the user base is currently one person.
- **Code-signing deferred.** SmartScreen warning will appear on first
  install. Accepted for v1.1; flagged as v1.2 follow-up.
- **Online install is default.** Hotel/corporate users may need the offline
  variant. Accepted; offline variant mitigates.

## Plan adjustments made as a result of this review

1. **Phase 4 design must include offline-variant build (H1)** — not a future
   pivot.
2. **Phase 9 must include SmartScreen UX documentation (H2)** — release
   notes + README screenshot.
3. **Phase 4/6 must accept that the bundled CLI is a seed, not a pin (H3)** —
   document the seed-vs-floor distinction; Studio updater does not manage
   CLI version.
4. **Phase 6 detection uses `claude doctor` not file existence (M1)** —
   delegate auth detection to Claude Code's own diagnostic.
5. **Phase 4 must verify Node-on-clean-VM works without VC++ runtime (M2)**.
6. **Phase 2 keeps builder output in `dist/`, forge in `out/` (M3)**.
7. **Phase 4 NSIS script writes install log to `%TEMP%\ccs-install.log` (M4)**.
8. **Phase 4 NSIS script pins npm registry explicitly (M5)**.
9. **Phase 7 acceptance must preserve rate-limit/dev-mode/user-disable
   gates (L1)**.
10. **`MIGRATING_FROM_V1.md` documents the Squirrel-uninstall step (L2)**.
11. **Document parallel-execution opportunity for phases 3/5 in design doc
    (L3)**.

These adjustments are reflected in updates to `INSTALLER_REDESIGN.md` and the
LMM journal Progress Log.
