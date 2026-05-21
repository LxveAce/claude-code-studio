# LMM — src/renderer/components/github/PRList.tsx

## RAW
PRList is structurally similar to CommitList and IssueList — clickable buttons that openExternal to the PR URL — but with denser per-row content: a state badge (open/closed/merged/draft), the PR number, title, author with avatar, head and base ref arrows, and comment count if any. The PRBadge sub-component (lines 84-111) maps state combinations to label+color: merged wins over closed, closed wins over draft, default open. That ordering is sensible because `merged === true` is a stronger signal than `state === 'closed'` (a merged PR is technically closed). The base→head display uses two `<code>` styled refs separated by an arrow (lines 68-70) — readable. Open questions: (1) the parent panel only fetches `state: 'open'` (GitHubPanel.tsx:62), so the merged/closed/draft branches of PRBadge will never trigger in the current code path — dead code unless the panel later adds a state filter; (2) the comment count uses an emoji 💬 (line 74) which is fun but emoji rendering varies wildly across OS/font; (3) the head/base ref display is correct but for cross-fork PRs the head ref might include `owner:branch` syntax which would look weird in a monospace pill; (4) there's no "label" rendering for PRs, even though GitHub PRs can have labels (only IssueList renders labels); (5) the title attribute is "Open on GitHub" but the PR title itself isn't a tooltip — same truncation issue as CommitList; (6) `pr.commentCount` from REST includes both issue comments AND review comments? It's actually just issue-style comments per GitHub REST; review comments are separate. Worth noting because the count may look smaller than what users expect.

## NODES
1. **Lines 10-11 — guard with "No open pull requests" copy**: assumes parent only fetches open PRs; accurate for current usage.
2. **Lines 16-32 — button row**: identical interaction pattern to CommitList/IssueList.
3. **Lines 31-32 — inline JS hover**: same anti-pattern as CommitList.
4. **Lines 35-49 — header row**: badge + #number + title; title truncates with ellipsis, no tooltip.
5. **Lines 50-77 — meta row**: author avatar, login, headRef → baseRef, optional comment count.
6. **Lines 57-65 — author avatar with `width=14`**: very small; not lazy-loaded.
7. **Lines 68-70 — base/head ref display**: `headRef → baseRef` direction is *PR-style* (from→to), correct.
8. **Lines 84-111 — PRBadge state logic**: merged > closed > draft > open precedence; correct semantically.
9. **Dead-code branches in PRBadge**: parent only fetches `state: 'open'`, so closed/merged labels never appear today.
10. **Lines 71-75 — emoji `💬`**: cross-platform emoji rendering inconsistent.
11. **No labels rendered**: GitHub PRs can have labels, but PRList omits them (IssueList renders them).
12. **Lines 113-120 — `refStyle` constant**: monospace, dim background. Tidy.
13. **`pr.commentCount` semantics**: REST's `comments` field is issue-comments only; doesn't include code review comments.

**Tensions**: (a) Filter is hardcoded to "open" at parent — PRBadge supports states that can't currently be reached. (b) PR has labels in REST but they're not surfaced; IssueList does surface labels. Inconsistency.

## REFLECT
**Core insight**: PRBadge is over-engineered for the *current* parent that only ever passes open PRs — but it's exactly the right shape if the panel later adds a state filter (which it should). Build for the close-future API, not just today's. **Resolved tensions**: the dead-code branches are forward-looking and harmless; flag them in a comment so a future maintainer doesn't trim them prematurely. The PR-without-labels inconsistency vs. IssueList-with-labels is worth aligning — labels are useful on PRs too (e.g., "needs-review", "blocked"). **Hidden assumptions**: (1) headRef and baseRef are always short branch names, not cross-fork `user:branch` syntax (will overflow if it happens); (2) the comment count is a complete signal for "activity on this PR" (it isn't — reviews and review-comments are separate); (3) the user's eye finds the colored state badge before the title, which is the intended scan order (depends on contrast); (4) PR title length will fit single-line on typical sidebar width.

## SYNTHESIZE
**What it should become**: same shape, with labels, a state filter at the parent level (so the dead-code branches actually fire), and tooltip on truncated title.

**Actionable items**:
- Add `title={pr.title}` to the title span (line 47) so users can read truncated titles.
- Add a labels row (like IssueList lines 51-69) for PRs that have labels.
- Add `loading="lazy"` to the avatar img (line 58).
- In GitHubPanel, expose a state filter dropdown (open/closed/all) that drives the `listPullRequests` call's third arg — would make PRBadge branches reachable.
- Truncate or wrap long `headRef`/`baseRef` strings (cross-fork PRs render `user:branch` which can be long).
- Consider showing review state alongside comment count (REST exposes review_comments and requested_reviewers via separate endpoints, so this is non-trivial — defer).
- Add `aria-label` to each row button: `View PR #${pr.number}: ${pr.title}`.
- Replace inline-JS hover with CSS-driven hover for consistency with the rest of the cluster's eventual refactor.

**Risks**: very low. Read-only display. The biggest user complaint will be truncated titles with no tooltip and missing labels.
