# LMM — src/renderer/components/github/WorkingDirCard.tsx

## RAW
WorkingDirCard is the most physically interactive component in the cluster — it has an editable text input, a folder-picker button, a refresh button, and a derived status pill row. The state is small (`editing`, `draft`) and the useEffect on line 16 syncs `draft` to `cwd` whenever the parent updates cwd, which is the right pattern to avoid stale drafts after an external change (like `git.pickDir()` resolving). The control destructures git fields with safe defaults (lines 20-24), so a `null` git won't crash the UI. The pill row at lines 102-138 is information-dense: branch chip, optional ahead/behind counts, dirty/clean indicator, refresh icon button — and they handle wrapping via `flexWrap: 'wrap'`. The form on line 64 calls `void onSetCwd(draft)` and closes the editor synchronously before the promise resolves — meaning a failed setCwd will leave the editor closed and the user staring at unchanged cwd with no error message at all. That is a meaningful UX bug. Open questions: (1) what happens if the user types a non-existent path and submits — does git-service silently fail or throw, and where would the error surface (it doesn't, currently); (2) why are the two folder-icon SVGs (lines 40, 56) identical but the second one represents "browse" — should they visually differ; (3) should "dirty" tell you how dirty (the GitRepoState carries staged/modified/untracked but they're discarded here); (4) the input placeholder hardcodes `C:\\path\\to\\repo` which is Windows-specific — is the app Windows-only or should this adapt; (5) the edit toggle button uses a pencil SVG with no aria-label, only a `title` attribute. Accessibility-wise the icon-only buttons rely entirely on `title` tooltips which screen readers may or may not announce.

## NODES
1. **Lines 13-14 — local `editing`/`draft` state**: standard form state pattern; minimal and correct.
2. **Lines 16-18 — sync draft to cwd**: prevents stale drafts after external cwd change; resets edits silently if user is mid-typing (potential annoyance, but uncommon).
3. **Lines 20-24 — defensive defaults**: `git?.found ?? false`, etc. — null-safe, but discards the actual unset signal (you can't tell "git not detected yet" from "git not found").
4. **Lines 30 — border color reflects found state**: nice subtle affordance.
5. **Lines 46-60 — icon-only buttons with `title`**: accessibility is title-only, no `aria-label`.
6. **Lines 63-80 — edit form**: closes editor before promise resolves on line 68; swallows any error from `onSetCwd`.
7. **Line 67 — `void onSetCwd(draft)`**: explicit void; intentional fire-and-forget; no error propagation path.
8. **Line 75 — Windows-specific placeholder**: `C:\\path\\to\\repo`.
9. **Lines 102-119 — branch chip with SVG**: special-cases empty branch as 'detached', good UX.
10. **Lines 120-121 — ahead/behind chips only when >0**: clean conditional rendering.
11. **Lines 122-126 — dirty/clean inversion**: shows red dot for dirty, gray "clean" otherwise; readable.
12. **Discards 3 of 6 git fields**: staged/modified/untracked from GitRepoState (types.ts:34) are never surfaced; only `dirty` boolean is.
13. **Refresh icon (line 127)**: pushed to right with `marginLeft: 'auto'`; placement is good, but it duplicates the parent's refresh path.
14. **Lines 144-189 — inline style constants at module level**: smart — avoids re-allocating per render; only `pill()` is a factory.

**Tensions**: (a) silent failure on `onSetCwd` vs. minimal/clean form code — error handling adds bulk but is needed. (b) data-rich GitRepoState vs. UI simplification — keeping it simple hides useful detail.

## REFLECT
**Core insight**: this component is shaped like a Git status header, but it discards half of the GitRepoState it receives — the staged/modified/untracked counts are exactly what makes the "dirty" badge informative, and they're thrown away. **Resolved tensions**: the form-closes-immediately pattern is a real bug; closing on success only is one extra line and gives the user feedback. The Windows-specific placeholder is fine *for this app* (Electron on Windows is the primary target per env), but could be `e.g. path/to/repo` to be neutral. **Hidden assumptions**: (1) the user trusts the path they typed and never makes typos; (2) icon meaning is obvious from glyph alone (browse vs. folder icon is ambiguous); (3) `void` is sufficient error handling for setCwd; (4) the ahead/behind/dirty visual is more useful than concrete counts of staged files.

## SYNTHESIZE
**What it should become**: a fuller Git status card that surfaces the staged/modified/untracked counts on hover or as a secondary line, with proper error feedback on path entry.

**Actionable items**:
- Wrap `onSetCwd` call (line 67) in try/catch; show inline error and keep editor open on failure.
- Add `aria-label` to each icon button (lines 46, 56, 127), not just `title`.
- Surface `git.staged/modified/untracked` either as a tooltip on the "dirty" pill or as a secondary text line.
- Differentiate the edit and browse glyphs visually (current pencil-vs-folder is okay, but the section header folder icon at line 40 also exists, creating triple-folder confusion).
- Consider a debounced auto-refresh when window regains focus (the manual refresh button is fine, but git state stales fast).
- Replace hardcoded `C:\\path\\to\\repo` placeholder with platform-detected example.

**Risks**: very low. This is a self-contained card with no destructive operations beyond changing the working directory pointer (which git-service should validate). The silent-failure UX bug is the highest priority.
