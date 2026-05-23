# LMM — HANDOFF.md

## RAW

HANDOFF.md is dated 2026-05-21 — today — and claims to describe "Current State" but the headers below it are wrong in a way that only ground-truth file inspection reveals. The document is structured as: Current State → What's Working (Phases 1, 2, 3 + Commands Panel + Settings Panel + UI Design, all marked COMPLETE) → Known Issues (3 items) → What's Next (Phases 4 through 7 with bullet-point inventories) → Additional Scope → Project Structure (ASCII tree) → Setup on New Machine → GitHub Repo URL → Plan File pointer. The Phase 4 section reads as aspirational: it lists `src/main/github-service.ts`, `src/main/git-service.ts`, GitHub panel components (RepoInfo, CommitList, BranchList, PRList, IssueList), encrypted PAT storage, and auto-detect repo from CWD. But filesystem inspection shows ALL of those exist: `src/main/git-service.ts`, `src/main/github-service.ts`, and `src/renderer/components/github/{GitHubPanel, WorkingDirCard, ConnectGitHub, RepoHeader, CommitList, BranchList, PRList, IssueList}.tsx` are present on disk. Phase 4 has shipped (or is in active development on a branch) but the HANDOFF still calls it "What's Next." The Project Structure tree at the bottom omits the github/ component directory entirely — it lists commands, compact, resources, terminal, settings, layout but not github. The Setup on New Machine section recommends `npx electron-rebuild` (no devDep) and `node scripts/patch-node-pty.js` (good — covered in patch journal). The Plan File path `C:\Users\mmrla\.claude\plans\agile-painting-quill.md` references a username `mmrla` that doesn't match the current user `extra` — this file was written from a different machine and the path is now broken. The "Known Issues" section mentions a "Crash on close" that says "verify on home machine" — also written from elsewhere. Open questions: (1) Is the GitHub work on a branch (mentioned in the task list as `phase-4-github-integration`) and HANDOFF documents only `main`? (2) Where's the LMM/journal work documented — it's clearly in flight (this very file exists) but HANDOFF has no Phase 8 / journaling section? (3) Why is the plan file path absolute, hardcoded, and broken — should it be relative or a GitHub URL?

## NODES

1. **Phase 4 "What's Next" is actually shipped or in active development** — the eight GitHub-related source files exist on disk.
2. **Project Structure tree omits `components/github/`** — drift between described and actual layout.
3. **Plan file path `C:\Users\mmrla\...`** — references a different machine's username; broken on the current `C:\Users\extra` machine.
4. **"Crash on close ... verify on home machine"** — implies this file was authored on a non-home machine; tense is wrong for "current state on 2026-05-21."
5. **Setup section uses `npx electron-rebuild`** despite electron-rebuild not being a declared devDep — consistent with package.json reality but fragile (relies on npm registry resolve at every clone).
6. **No mention of the `journal/` directory** despite LMM being actively in progress.
7. **No mention of the compact-controller integration into Studio's own sessions** (task #16 completed) — HANDOFF is silent on dogfooding.
8. **Date stamp is current (2026-05-21)** but content is stale — the date update was either automatic or careless.
9. **No mention of a branch strategy** despite task list showing `phase-4-github-integration` branch and pending PR.
10. **No CI / testing section** — consistent with package.json gap.
11. **Phase 5 (Auth + Cloud Database) and Phase 6 (Vault Sync) are still aspirational and untouched** — that part of HANDOFF remains accurate.
12. **Phase 7 (Power User Features) is a wish list, not a plan** — 10 bullet items with no priority or sequencing.

**Tension A**: HANDOFF claims to be "current state" but mixes shipped work, in-flight work, and aspirational work without distinguishing them — a reader can't tell what's done.
**Tension B**: Documentation as ground-truth source vs documentation as planning artifact — this file tries to be both and fails at both during transitions between phases.

## REFLECT

Core insight: **HANDOFF.md is a snapshot doc that became a planning doc and is now neither** — the "Current State" label is a lie, and the "What's Next" sections are obsolete the moment work starts on them.

Tension A resolved: split HANDOFF into two files — a `STATE.md` (auto-generatable from filesystem + git tags) describing what's shipped, and a `ROADMAP.md` for what's planned. Or, less ambitiously, add an explicit "Phase Status" table at the top: ✓ shipped / ◐ in-progress / ○ planned. The current narrative format hides the truth.

Tension B resolved: the dual purpose is the bug. Snapshot docs go stale silently; planning docs invite edits. Combining them invites edits that drift the snapshot. Separation is the fix.

Hidden assumptions: (1) the author will manually update HANDOFF when phases ship (demonstrably false — Phase 4 shipped without HANDOFF being updated); (2) the username `mmrla` in the plan path doesn't matter because nobody else will read this; (3) the project structure tree is accurate enough; (4) the date stamp at top is meaningful even when content is stale; (5) Phase ordering will be respected (Phase 4 → 5 → 6 → 7) — but with GitHub already shipped, what's blocking Phase 5 isn't clear.

What's drifted since Phase 4:
- Eight source files for GitHub integration exist but aren't acknowledged.
- The `journal/` LMM work is invisible.
- The compact-controller-applied-to-our-own-sessions milestone (task #16) is missing.
- The branch `phase-4-github-integration` and a pending PR (task #14) aren't mentioned.
- The plan to integrate LMM into Studio app as a toggleable feature (task #17) is missing.

What's missing entirely:
- A "Recent Changes" or "Changelog" section.
- A note about Windows-only assumption (no `os` field, but no doc either).
- A pointer to the journal/ directory.
- A description of the actual branch strategy.
- An indication that this doc is human-authored and goes stale (vs auto-generated).

## SYNTHESIZE

What this should become:
- A short "Status" header with a table: Phase | State | Last Updated | Branch.
- A "Recent Changes" log appended at the top, append-only.
- "What's Next" demoted to a separate ROADMAP.md with no phase-as-current-state claims.
- A pointer to `journal/` for deeper reasoning artifacts.
- The Plan File path either removed (broken anyway) or replaced with a relative path / GitHub URL.
- A Known Issues section that distinguishes "verified on this machine" from "needs verification."

Actionable items:
1. Update Phase 4 section to reflect that the work exists in `src/main/{git,github}-service.ts` and `src/renderer/components/github/*.tsx`; mark it ◐ in-progress (on branch, PR pending) or ✓ if merged.
2. Add a `journal/` pointer with a one-line description.
3. Fix the broken plan-file path (remove, relativize, or point to GitHub).
4. Update the Project Structure tree to include `components/github/`.
5. Rewrite "Current State" lead to actually state today's status — including which branch is active.
6. Move Phase 7's bullet list into ROADMAP.md with priorities.
7. Add a "Recent Changes" section at top with reverse-chronological entries.

Risks if untouched: the next contributor (or the author returning after a break) will start re-implementing Phase 4 from the "What's Next" list, discover the files exist, lose 30 minutes to confusion, and trust HANDOFF less for everything else it claims. The doc's authority decays with every undocumented merge.
