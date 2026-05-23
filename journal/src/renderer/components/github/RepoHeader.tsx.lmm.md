# LMM — src/renderer/components/github/RepoHeader.tsx

## RAW
RepoHeader is a pure presentational view over a single `GitHubRepoInfo` object. It has three render paths: loading skeleton, empty state, and the full card. The "loading-but-no-prior-data" pattern (line 10: `loading && !info`) is consistent across the four list components and is the right shape — once info exists, we keep showing it during a refresh instead of flashing a skeleton. The full card opens with a button-styled-as-link (lines 21-36) that opens the repo on GitHub; it's a proper `<button>`, not a div, which is good for accessibility. The stats row (lines 63-68) uses Unicode glyphs (★, ⑂) for stars/forks rather than icons — fine, but ⑂ is an unusual fork glyph and may not render in all fonts. The topics chip row (lines 70-84) only renders when topics exist, which is correct. The footer (lines 86-94) shows default branch and a date that's converted via `formatDate` on line 151 with a try/catch fallback to the raw ISO string — defensive. Open questions: (1) what if `info.htmlUrl` is empty or malformed — the button is still clickable and opens nothing, with no feedback; (2) the `description` rendering on lines 52-61 doesn't sanitize HTML or strip markdown — GitHub descriptions can contain emoji shortcodes and special characters but typically not HTML, and React's default text rendering escapes anyway, so XSS is moot — but the visual rendering of markdown like `**bold**` will be literal; (3) the date formatting uses `undefined` for locale (line 154) which respects the user's OS locale — good; (4) `info.openIssues` from GitHub includes PRs (REST API quirk), so the "issues" stat shown here will be inflated by open PR count — this is a well-known GitHub API gotcha; (5) why no copy-to-clipboard for `fullName` — common need when you want to share the repo.

## NODES
1. **Line 10 — loading-skeleton-only-if-no-data**: correct pattern; preserves stale view during refresh.
2. **Lines 21-36 — link rendered as button**: accessibility-correct; `cursor: pointer` and `title` attribute set.
3. **Lines 37-49 — private badge**: conditionally rendered; right-aligned via `justifyContent: 'space-between'`.
4. **Lines 52-61 — description rendering**: plain text only; markdown in description renders literally (minor).
5. **Lines 63-68 — Unicode-glyph stats**: ⑂ for fork is unusual; star ★ is universal.
6. **Line 66 — `info.openIssues` includes PRs**: GitHub REST behavior; not the component's fault but worth noting.
7. **Lines 70-84 — topics chips**: clean conditional render; topics get accent color treatment.
8. **Lines 86-94 — footer with default branch and updated date**: tidy two-column layout.
9. **Lines 99-117 — Stat helper**: clean sub-component; `accent` boolean toggles color.
10. **Lines 119-148 — Skeleton/Empty helpers**: virtually identical markup; could be one component with text prop.
11. **Lines 151-158 — formatDate with try/catch**: graceful degradation if `iso` is malformed.
12. **No `info.htmlUrl` validation**: clicking with a bad URL silently fails (main-process openExternal handles).
13. **No copy button for `fullName`**: common UX gap.

**Tensions**: (a) Skeleton vs Empty as separate components vs DRY — minor duplication, defensible. (b) Unicode glyphs vs SVG icons — visual consistency with WorkingDirCard's SVG approach is broken here.

## REFLECT
**Core insight**: this component is technically clean and uses the right loading pattern, but it inherits one notable GitHub API quirk (openIssues includes PRs) that will visibly mislead users who also see the PR count in the same panel. The user can do the math and notice the discrepancy. **Resolved tensions**: Skeleton and Empty are essentially the same JSX with different text — collapse them. The Unicode-vs-SVG inconsistency is small enough to leave for now but should be unified eventually for visual coherence with WorkingDirCard and the list components. **Hidden assumptions**: (1) `info.htmlUrl` is always a valid GitHub URL the main process will accept; (2) topic strings are short enough not to break layout (could overflow with a 50-char topic); (3) `info.updatedAt` is always ISO-8601 (true from REST API); (4) the user reads the "issues" stat as bug-issues-only when it actually means issues+PRs.

## SYNTHESIZE
**What it should become**: keep the structure, fix the issues-count semantics, unify the loading/empty helpers, and add a copy-fullName affordance.

**Actionable items**:
- Either label the stat "issues+PRs" or subtract `prs.length` (passed in as new prop) to show true issue count.
- Collapse `Skeleton` and `Empty` (lines 119-148) into one `<Placeholder>` component with a `text` prop.
- Add an inline copy-to-clipboard button next to `info.fullName` (line 35) using `navigator.clipboard.writeText`.
- Add an `aria-label` to the repo-name button like "Open ${info.fullName} on GitHub".
- Consider replacing ⑂ glyph with an SVG to match the rest of the cluster's icon strategy.
- Add a `max-height` and `text-overflow` on topic chips so an oversize topic doesn't break the row.
- If `info.htmlUrl` is empty or doesn't start with `https://github.com`, render plain text instead of a clickable button.

**Risks**: very low. Pure presentational, no side effects beyond opening a URL via openExternal. The misleading issues count is the one user-facing accuracy issue.
