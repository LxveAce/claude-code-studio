# LMM — src/renderer/components/github/BranchList.tsx

## RAW
BranchList is the odd one out in the four-list family: it renders `<div>` rows instead of `<button>` rows because branches are not clickable — there's no "open branch on GitHub" action. That's a defensible product decision but it's inconsistent with the click-to-open pattern of CommitList/PRList/IssueList. The component sorts branches client-side (lines 13-17) putting the default branch first, then alphabetical. The sort creates a new array via spread, which is correct (the prop array is not mutated) but allocates every render — a `useMemo` would help on large branch lists, but with most repos having <100 branches it's a non-issue. The row shows an SVG branch icon, the branch name in monospace, optional "default" and "protected" tags, and the short SHA. Open questions: (1) why no click-to-open — branch URLs do exist on GitHub (e.g., `/owner/repo/tree/branch`) and would be natural; (2) the protected tag uses amber color (#f59e0b) which connotes warning — but "protected" is a *good* state usually meaning branch rules are enforced. The color choice may signal danger when it should signal safety; (3) what if two branches have the same name with different casing on a case-insensitive filesystem — `localeCompare` will collate them but the keys (line 23: `key={b.name}`) will collide as React keys if names are identical; (4) the SHA display truncates to 7 chars but commits.shortSha already does this server-side — inconsistency in where truncation happens; (5) there's no filter/search affordance for repos with many branches.

## NODES
1. **Lines 10-11 — guard pattern**: identical loader fallback to other lists.
2. **Lines 13-17 — client-side sort**: spread to avoid mutation, default first, then alphabetical.
3. **Line 13 — sort allocates per render**: fine for typical N; consider `useMemo` for hundreds.
4. **Lines 22-32 — `<div>` rows, not buttons**: branches are not interactive; departs from the pattern of sibling lists.
5. **Lines 35-40 — inline SVG branch icon**: visual consistency with branch chip in WorkingDirCard (same SVG path) — good.
6. **Lines 53-58 — default/protected tags**: protected gets amber (warning color), which may confuse semantics.
7. **Line 59 — `b.sha.slice(0,7)`**: client-side truncation; commits.shortSha does this server-side. Inconsistent.
8. **No click-to-open**: branches have GitHub URLs but no action is wired.
9. **No protection icon or text explaining "protected"**: tag alone may be opaque to new users.
10. **No filter input**: repos with 100+ branches become a long scroll.
11. **Lines 67-86 — module-level style constants and `tag()` factory**: tidy, no re-allocation.
12. **Lines 88-102 — Loader sub-component**: identical to sibling lists.
13. **`b.protected` typed as boolean in shared types (types.ts:80)**: simple, no granularity about *which* protections are enabled.

**Tensions**: (a) `<button>` consistency vs. accurate semantics (no action = no button) — the current choice is more accurate. (b) Color semantics — amber for "protected" reads as warning when it should read as "safety enabled".

## REFLECT
**Core insight**: the absence of click-to-open on branches is a UX gap that subtly trains users that this panel is a *snapshot* of branches rather than a *navigation tool* — and then they have to mentally context-switch when they click a commit and it opens GitHub. Consistency in interaction grammar matters. **Resolved tensions**: rendering `<div>` instead of `<button>` is correct when there's no action; the right fix is to *add* the action (open branch tree on GitHub) rather than fake-button a div. The amber-for-protected concern is real but conventional in dev tools — GitHub itself uses amber/yellow for branch protection rule warnings, so users may already associate the colors. **Hidden assumptions**: (1) branch names are unique within the response (true per Git); (2) the default branch is always one of the returned branches (true unless the response is paginated and the default falls outside the first page); (3) `b.protected` from REST API correctly reflects current protection state (true); (4) users care about "protected" status visually (true for maintainers, not so much for contributors).

## SYNTHESIZE
**What it should become**: same row layout, with rows clickable to open branch tree on GitHub, and a simple search filter when branch count exceeds ~20.

**Actionable items**:
- Make rows `<button>` and `onClick={() => openExternal(\`https://github.com/owner/repo/tree/\${b.name}\`)}` — requires plumbing owner/repo as props (currently not passed).
- Memoize the sort: `const sorted = useMemo(() => [...branches].sort(...), [branches])`.
- Add a protected-branch tooltip or icon explaining what protection means (e.g., title="Branch protection rules enforced").
- Consider a neutral color (blue, gray) for the protected tag if the warning palette is misleading.
- Add a simple `<input>` filter at the top when `branches.length > 20`.
- Sanity-check the dedup of `key={b.name}` — if duplicates ever occur (theoretical), React will warn; not actionable without a real bug report.
- Extract the Loader sub-component to a shared file shared with CommitList/PRList/IssueList.

**Risks**: very low. Read-only display. The "no click action" is the strongest pattern inconsistency in the cluster.
