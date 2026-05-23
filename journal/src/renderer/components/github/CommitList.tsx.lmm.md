# LMM — src/renderer/components/github/CommitList.tsx

## RAW
CommitList is the first of four list components and sets the pattern that BranchList, PRList, and IssueList all echo. It is a flat list of clickable rows, each opening the commit on GitHub via openExternal. The structure: loading/empty guard (lines 10-11), then a column of buttons. Each row shows an avatar (image with text fallback), commit message (single-line ellipsis), short SHA, author, and a relative timestamp. The avatar fallback (line 48) takes the first character of authorLogin or authorName — but if both are absent (rare but possible for ancient commits with no GitHub-linked author), it'd be `''.slice(0,1).toUpperCase()` which evaluates to empty string, rendering an empty colored circle. Probably fine but unguarded. The hover effect uses inline `onMouseEnter`/`onMouseLeave` mutating `e.currentTarget.style.borderColor` (lines 35-36) — this works but is the JS-implementation of a `:hover` CSS rule, and it bypasses React's reconciliation. Functionally identical, philosophically inferior. Open questions: (1) what is the upper bound on `commits.length` — github-service probably caps it at 30 or 100, but no pagination affordance exists in this component, so a 30+ commit history is just truncated silently; (2) the `formatRelative` function on line 118 caps at "y ago" with no upper bound (a 10-year-old commit would render as "10y ago" correctly); (3) the avatar image lacks `loading="lazy"` — for a list of 30 avatars all loading eagerly, that's 30 network requests on tab switch even for off-screen rows; (4) the alt text on line 42 uses login or name, but if both null, it'd be the literal string "null" or undefined — minor a11y issue; (5) the commit message is single-line truncated, but the title attribute is "Open on GitHub" — the message itself isn't a tooltip, so users can't read truncated messages without clicking.

## NODES
1. **Lines 10-11 — guard pattern**: identical to BranchList, PRList, IssueList; intentional duplication.
2. **Line 22 — openExternal on click**: standard pattern across cluster.
3. **Lines 35-36 — JS-driven hover**: works but bypasses CSS; not idiomatic React.
4. **Lines 39-49 — avatar with fallback**: handles missing avatarUrl gracefully.
5. **Line 48 — fallback char**: `(authorLogin ?? authorName).slice(0,1)` — if both empty/null after `??`, slice(0,1) of empty string is empty string; circle renders blank.
6. **Lines 51-59 — single-line ellipsis on commit message**: truncated text has no tooltip showing full message.
7. **Line 67 — shortSha as `<code>`**: monospace styled; nice touch.
8. **Lines 102-116 — Loader sub-component**: identical markup to other lists; ripe for shared component extraction.
9. **Lines 118-132 — formatRelative**: simple, robust; cascades through s/m/h/d/mo/y.
10. **Line 120 — early return on empty `iso`**: defensive.
11. **No `loading="lazy"` on avatars**: bandwidth waste on long lists.
12. **No pagination/load-more**: silent truncation at github-service's default limit.
13. **No keyboard nav between rows**: buttons are focusable individually but no roving tabindex pattern.

**Tensions**: (a) Pattern duplication with the three sibling lists vs. abstraction overhead — the intentional duplication is a v1 stance, will require extraction at v2. (b) Inline JS hover vs CSS — pragmatic but not idiomatic.

## REFLECT
**Core insight**: the truncated commit message *without* a tooltip is the highest-leverage UX defect in this otherwise solid component — users will see "fix: ..." truncated to "fix: i..." and have no way to read the rest short of opening GitHub. Adding `title={c.message}` to the message element is one line and a massive improvement. **Resolved tensions**: the duplication-vs-abstraction tension is fine for now; the four list components are *similar* but not identical (avatar layout, badges, labels all differ), so a single abstraction would have many props. Wait until a fifth list appears before extracting. The inline-hover approach is a stylistic complaint with no functional impact. **Hidden assumptions**: (1) avatar URLs are always reachable from the renderer process (no CSP issue with `avatars.githubusercontent.com`); (2) `Date.now() - new Date(iso).getTime()` won't go negative for future-dated commits (clock skew between user and GitHub — could happen, would render as "0s ago" actually no, negative seconds would render as a negative number); (3) the list fits on screen and pagination is unneeded; (4) `authorLogin` or `authorName` is always present (the null-coalesce on line 42/48 covers null but empty strings would slip through).

## SYNTHESIZE
**What it should become**: same shape, with tooltips on truncated text, lazy-loaded avatars, and a "load more" button when results are capped.

**Actionable items**:
- Add `title={c.message}` to the commit-message div (line 58) so users see full message on hover.
- Add `loading="lazy"` to the avatar `<img>` (line 41).
- Guard the avatar fallback against empty string: `((c.authorLogin || c.authorName) ?? '?').slice(0, 1).toUpperCase()`.
- Guard `formatRelative` against negative diff (future timestamps): return "just now" or "in Ns" if diff < 0.
- Replace inline JS hover (lines 35-36) with a CSS-in-JS hover or a small wrapper component.
- Add `aria-label` to each row button like "View commit ${c.shortSha}: ${c.message}".
- When `commits.length` equals github-service's default limit, render a hint like "showing first N — open on GitHub for more".
- Extract `Loader` to a shared `components/github/_Placeholder.tsx` once a second list appears (already true — four lists share it).

**Risks**: very low. Read-only display, no destructive ops. The biggest user-visible risk is the truncated-message-no-tooltip issue.
