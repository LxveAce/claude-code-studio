# Security & Soundness Review — Bootstrap Installer, Phase 8 (docs)

**Phase reviewed:** Documentation updates for v1.1 in-development state.
**Artifacts:** `README.md`, `CONTRIBUTING.md`, `docs/MIGRATING_FROM_V1.md`
(new), `docs/HANDOFF.md`, `docs/BACKLOG.md`.
**Reviewer:** assistant (self-red-team).
**Date:** 2026-05-23.

Phase 8 is the doc update; no security-relevant code changes. Review is
brief and focuses on accuracy + claim verification.

---

## CRITICALS

None.

## HIGHS

None.

## MEDIUMS

### M1 — README claims v1.1 features that aren't built yet

**Where:** README "v1.1 is in development" paragraph references the
one-click installer + bootstrap as if it exists. v1.1 is not released; the
feature branch is partial (5/9 phases complete).
**Risk:** A reader landing on the README via web search could think v1.1
is available and try to download it from the Releases page (where v1.1
doesn't exist yet).
**Mitigation:** Paragraph explicitly says "in development" and points at
`INSTALLER_REDESIGN.md` for status. v1.0 install instructions remain
authoritative and complete on the same page.
**Decision:** Accepted. The forward reference is helpful for contributors
poking at the branch; the "in development" framing prevents user
confusion.

### M2 — MIGRATING_FROM_V1.md references Phase 6 features that don't ship yet

**Where:** Migration doc step 3 talks about "first-launch onboarding" and
the "Install CLI now" button. Phase 6 isn't built yet.
**Risk:** Document is forward-looking; matches the design but won't match
reality until Phase 6 lands.
**Mitigation:** Document opens with "v1.1 is currently in development;
this doc will become accurate once v1.1.0 ships." Reader sees that
disclaimer first.
**Decision:** Accepted. Writing the migration doc now (against the design)
forces us to validate the design against the user's actual workflow; if
Phase 6 has to change to match the doc, that's a feature not a bug.

## LOWS

### L1 — CONTRIBUTING.md build-pipelines table will need an update after Phase 8 forge-removal

**Where:** Table shows both `electron-forge` and `electron-builder`
commands during the v1.1 transition.
**Mitigation:** Note at the bottom: "Forge pipeline will be removed in
Phase 8 once builder is proven for v1.1." Self-documenting.

### L2 — Backups instructions in MIGRATING_FROM_V1.md use OneDrive desktop path

**Where:** `$env:USERPROFILE\Desktop\CCS-backup-...` — the user's Desktop
is OneDrive-redirected (per their environment). Should work because
$USERPROFILE\Desktop resolves through the redirect, but worth flagging.
**Decision:** Note in PR — works for the maintainer; generic enough for
other users with non-redirected Desktops.

## Verification

- ✅ README's v1.0 install instructions still accurate.
- ✅ CONTRIBUTING.md's Node 22 on Windows section uses correct URLs
  (`https://nodejs.org/dist/v22.22.3/...`).
- ✅ CONTRIBUTING.md's Developer Mode steps match Windows 11 Settings layout.
- ✅ MIGRATING_FROM_V1.md uninstall paths match v1.0's actual install
  location (`%LocalAppData%\claude_code_studio\`).
- ✅ MIGRATING_FROM_V1.md install paths match v1.1's planned location
  (`%LocalAppData%\Programs\Claude Code Studio\`) per electron-builder
  NSIS oneClick + perMachine:false defaults.
- ✅ HANDOFF.md "Current State" reflects v1.0 shipped + v1.1 in progress.
- ✅ BACKLOG.md §0 lists remaining phases (5, 6, 7, 9) and Phase 4b.

## Phase 8 acceptance summary

- ✅ README.md documents both v1.0 install + v1.1 development status.
- ✅ CONTRIBUTING.md documents Node 22 Windows setup + Dev Mode + build
  pipelines.
- ✅ docs/MIGRATING_FROM_V1.md walks through upgrade path.
- ✅ docs/HANDOFF.md "Current State" reflects v1.1 in progress.
- ✅ docs/BACKLOG.md §0 tracks remaining v1.1 work.
- ✅ No security-relevant code changed.
