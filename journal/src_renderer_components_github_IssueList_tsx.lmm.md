# LMM — src/renderer/components/github/IssueList.tsx

## RAW
IssueList is the most visually rich of the four list components — it renders state badge, issue number, title, an optional row of up to 4 labels with each label's GitHub-provided color, and a meta row with author avatar/login and optional comment count. The label colors are interesting: GitHub returns hex color strings like `"d73a4a"` without the leading `#`, so the component prepends `#` in three places (lines 60, 61, 62) to construct background, border, and text colors. The color math is intentionally simple — same color for background (with `20` alpha suffix), border (with `50` alpha suffix), and text (full opacity). For light-colored labels (e.g., `"ffff00"` yellow), the label text will be near-invisible against the white-tinted background. There's no contrast check. The `slice(0, 4)` on line 53 caps visible labels at four, but there's no "+N more" affordance — additional labels are silently hidden, and the user only sees the truncation if they open the issue on GitHub and compare. Open questions: (1) what about the rare label name with a slash or special char that breaks the `key={l.name}` uniqueness (labels can have any UTF-8 name); (2) the IssueBadge maps state→color but the parent only fetches `state: 'open'`, so the closed branch (purple, line 102) is dead code like PRList; (3) `i.labels` is destructured as `{ name; color }[]` per shared types — no description, so we lose helpful tooltips; (4) the author avatar gets `width=14` and no lazy load — same concern as CommitList/PRList; (5) `i.commentCount` is the only activity signal — no reactions, no last-activity timestamp. Open questions also: should issues that are also PRs (GitHub's API quirk — every PR is an issue) be filtered out, or does github-service already do that?

## NODES
1. **Lines 10-11 — guard pattern**: standard; "No open issues" copy assumes parent fetches `open` only (correct per panel).
2. **Lines 16-32 — button row**: same interaction pattern as CommitList/PRList.
3. **Lines 31-32 — inline JS hover**: same anti-pattern.
4. **Lines 35-49 — header row**: state badge + number + title; title truncates without tooltip.
5. **Lines 51-69 — label row**: only renders if any labels; caps at 4 visible.
6. **Line 53 — `.slice(0, 4)` with no "+N more"**: silent truncation; users can't tell.
7. **Lines 60-62 — color math with `#` prefix and alpha suffix**: simple but no contrast check; light labels become illegible.
8. **Line 55 — `key={l.name}`**: assumes unique label names per issue (true in GitHub).
9. **Lines 71-94 — meta row**: avatar, login, comment count; no last-activity timestamp.
10. **Lines 101-117 — IssueBadge with dead 'closed' branch**: parent fetches only open today.
11. **Line 102 — `state === 'open' ? '#10b981' : '#7c3aed'`**: binary; doesn't handle weird future states.
12. **`i.commentCount` only**: no reaction count, no last-activity time.
13. **GitHub API quirk**: issues endpoint returns PRs too unless filtered server-side — needs to be handled in github-service or here.

**Tensions**: (a) Label visibility cap (4) vs. completeness — silent truncation hides info. (b) Color fidelity (GitHub's exact label color) vs. accessibility (contrast).

## REFLECT
**Core insight**: the label rendering is the most ambitious piece of visual work in the cluster — it honors GitHub's label color choices — and it's also where accessibility most quietly breaks. A bright yellow label on the tinted-yellow background is invisible. This is a known hard problem (GitHub itself uses a contrast calculation to flip text color), and the component punts. **Resolved tensions**: the 4-label cap is a reasonable space-saving choice; just add a "+N more" indicator. The contrast issue is solvable with one helper that picks white or black text based on the label's luminance. **Hidden assumptions**: (1) `i.labels[].color` is always 6-char hex without `#` (true per REST); (2) labels with low contrast against the tinted background are still readable (false for yellow/white labels); (3) the issues endpoint doesn't include PRs in github-service's response (needs verification); (4) the user knows that not all labels are shown (no visual cue today); (5) comment count is the only activity signal users want.

## SYNTHESIZE
**What it should become**: same shape, with smarter label color (luminance-based text color, "+N more" overflow indicator), tooltip on truncated title, and verification that PRs are filtered server-side.

**Actionable items**:
- Add `title={i.title}` to the title span (line 47) for full-text-on-hover.
- Compute label text color via luminance (`(0.299*r + 0.587*g + 0.114*b) > 128 ? '#000' : '#fff'`) and use the raw `#${color}` as background; current alpha-blend approach is what kills contrast.
- When `i.labels.length > 4`, render a `+${labels.length - 4}` chip after the visible ones.
- Add `loading="lazy"` to the author avatar (line 79).
- Verify in `src/main/github-service.ts` that the issues endpoint filters out PRs (set `pull_request === undefined`); if not, filter here.
- Add `aria-label` to each row button: `View issue #${i.number}: ${i.title}`.
- Show last-activity timestamp (`i.updatedAt`) as a secondary signal alongside comment count.
- Consider a labels-tooltip when truncated showing the hidden label names.
- Mirror the eventual PRList state-filter improvements so closed-issue rendering becomes reachable.

**Risks**: low. Read-only display. The accessibility risk (low-contrast label text on light colors) is the most defensible concrete defect.
