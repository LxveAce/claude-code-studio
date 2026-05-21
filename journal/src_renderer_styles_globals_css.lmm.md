# LMM: src/renderer/styles/globals.css

> File: `src/renderer/styles/globals.css` · LOC: 126 · Role: Design-token registry, global resets, scrollbar/selection/focus chrome, and the named-animation vocabulary the renderer relies on.

## Phase 1: RAW

This is the *only* CSS file in the renderer — App.tsx, Sidebar.tsx, and every panel use inline styles that reference these CSS variables. The file is organized as: universal reset (lines 1-5), a `:root` token block (lines 7-62), global element styles (lines 64-74), scrollbar styling (76-92), selection (94-98), focus ring (100-104), and named keyframes (106-126).

The token system is deeply opinionated. Backgrounds are a 4-step purple-tinted dark ramp (`#0f0f1a` → `#252540`, lines 9-12) plus a hover overlay that's *not* a darker shade but a translucent accent purple (`rgba(124,58,237,0.08)`, line 13) — meaning hover states feel like the brand color seeping through, not a value shift. This is a sophisticated choice that ties hover affordance directly to identity.

The accent system has *seven* purple variants (lines 16-21): `--accent` (#7c3aed, brand violet), `--accent-light` (#a78bfa, content-on-accent), `--accent-dim` (15% alpha for tag backgrounds), `--accent-glow` (25% alpha for shadow halos), and *two* gradients — `--accent-gradient` (full-opacity 3-stop violet→deep violet→indigo, used for active sidebar buttons and h3 accent bars) and `--accent-gradient-soft` (the same hue family at 10-20% alpha, used for the empty-state icon backdrop in PlaceholderPanel). The 3-stop gradient (rather than 2) gives a richer transition; the `135deg` angle is consistent across both gradients for visual coherence.

Text is a 3-step grey ramp (lines 24-26): `#ececf1` (primary, near-white with a hint of warmth), `#8e8ea0` (secondary, grey-purple), `#565669` (muted, deep grey-purple). Borders are *translucent white* (`rgba(255,255,255,0.06)`), not a dark grey — this means borders modulate naturally on top of any background without needing per-surface adjustment.

Glassmorphism tokens (lines 42-44) are defined but no current component appears to use them (grep would confirm). They're future-proofing for a glassy panel option. Shadows include a `--shadow-glow` (line 50) used by the active sidebar button — accent-colored shadow as part of the active-state language.

Animations: four keyframes — `fadeIn`, `slideIn`, `pulse`, `shimmer`. `fadeIn` and `slideIn` are referenced by inline styles in App.tsx (`animation: 'slideIn 0.2s ease'` line 74, `'fadeIn 0.3s ease'` line 135) and Sidebar.tsx (tooltip `fadeIn 0.15s`). `pulse` and `shimmer` aren't visibly used in the files I've read but exist as a vocabulary for loading indicators.

The scrollbar is 6px and uses `--border` for the thumb — minimal, in-keeping with the dark aesthetic. `::-webkit-scrollbar` is Chromium-only, which is fine for Electron.

### Open Questions
- Are `--glass-bg`/`--glass-border`/`--glass-blur` referenced anywhere yet, or are they preemptive tokens?
- Why is Inter listed first in `font-family` (line 70) without being self-hosted or web-imported? Will it actually load on most users' machines?
- The `pulse` and `shimmer` keyframes — defined but possibly unused. Dead code or a vocabulary contract for future loading states?

## Phase 2: NODES

### Node 1: Universal box-sizing reset
Lines 1-5 normalize box model and zero margins/padding. Standard, but worth noting it's the *only* reset — no opinionated typography reset (Tailwind preflight would do more).

### Node 2: 4-step background ramp + accent-overlay hover
Lines 9-13 establish a depth hierarchy in dark purple, with hover defined via accent overlay rather than value shift — a brand-coherent affordance choice.

### Node 3: Seven-variant accent system
Lines 16-21 cover solid, light-on-accent, dim, glow, gradient, and soft-gradient. The dual-gradient pattern (full + soft) is a recurring UI motif in App.tsx (active button vs empty-state backdrop).

### Node 4: Translucent borders
`--border: rgba(255,255,255,0.06)` (line 29) works on any background. `--border-active` (line 30) shifts to a translucent accent — visual state correspondence to background hover.

### Node 5: Status colors (success/warning/danger)
Lines 38-40. Standard semantic palette. Not yet tied to any component visible in the cluster but available for future status indicators.

### Node 6: Glassmorphism tokens (currently dormant)
Lines 42-44. `--glass-bg`, `--glass-border`, `--glass-blur` define a sheet-of-glass surface treatment not yet applied. Future-facing vocabulary.

### Node 7: 4-tier radius scale
Lines 53-56: sm 6px, md 10px, lg 14px, xl 20px. Used extensively in App.tsx (`var(--radius-md)`, `var(--radius-lg)`, `var(--radius-xl)`).

### Node 8: Three-speed transition vocabulary
Lines 59-61: 150/250/400ms with a consistent cubic-bezier. Sidebar uses `var(--transition-fast)` for hover.

### Node 9: Locked viewport (overflow:hidden on html/body/#root)
Line 67. The app is single-screen with internal scrolling per panel — no document-level scroll. Important for the Electron chrome to feel native.

### Node 10: Focus ring as accessibility commitment
Lines 100-104. `:focus-visible` with a 2px solid accent ring and 2px offset — the *only* accessibility-specific style in the file. Good baseline, but no `prefers-reduced-motion` override on the animations.

### Node 11: Named-animation contract
Lines 107-125. Four keyframes define the renderer's animation vocabulary; inline `animation` strings in TSX must use these names. Adding a new animation requires editing this file.

### Tensions
- **T1 (Inline styles vs CSS file):** The CSS file contains *only* globals and tokens; every component re-implements layout in inline styles. The CSS file becomes a glossary, not a style sheet.
- **T2 (Dormant tokens vs lean CSS):** Glassmorphism vars and `pulse`/`shimmer` keyframes exist without consumers — vocabulary cost without current benefit.
- **T3 (No reduced-motion override):** The four keyframes run unconditionally; users with vestibular sensitivity get no opt-out.

## Phase 3: REFLECT

### Core Insight
globals.css is functioning as a *design-token contract and animation namespace* rather than a stylesheet — its job is to be the dictionary that inline-styled components quote, and its quality is measured in how richly that dictionary describes the brand (which it does well: hover-as-brand-tint, dual-gradient accent, translucent borders).

### Resolved Tensions
- **T1:** The split is fine *because* CSS vars + `:focus-visible` + `::-webkit-scrollbar` cannot be done inline — globals.css owns exactly the things inline styles can't, and that's a coherent division.
- **T2:** Pre-defining glassmorphism and pulse/shimmer tokens is cheap *iff* they're truly part of an intended design language; if they sit unused for months, prune.
- **T3:** A `@media (prefers-reduced-motion: reduce)` block overriding the keyframes to `animation: none` is a 5-line accessibility win.

### Hidden Assumptions
- That Inter is desirable as primary font despite not being shipped — most users see Segoe UI fallback, which is a different feel than the design likely intends.
- That the user is on a dark-mode-tolerant display (no light theme option).
- That `::-webkit-scrollbar` is sufficient (true in Electron Chromium; would need `scrollbar-color` for cross-browser).
- That the animation vocabulary (fade/slide/pulse/shimmer) is exhaustive — any new motion requires a globals.css edit.

## Phase 4: SYNTHESIZE

### What this file should become
A clean design-token contract that (a) self-hosts Inter or removes the Inter reference, (b) adds a `prefers-reduced-motion` opt-out, (c) deletes dormant tokens until they're needed, and (d) optionally moves color tokens into a `[data-theme="dark"]` block to leave room for a future light theme.

### Actionable items
- [ ] Either self-host Inter (add `@font-face` with a woff2 in `src/renderer/styles/fonts/`) or drop it from the font-family stack so the cascade defaults to Segoe UI on Windows deterministically.
- [ ] Add a `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }` block at the bottom of the file.
- [ ] Audit usage of `--glass-bg`/`--glass-border`/`--glass-blur` and `@keyframes pulse`/`shimmer`. If unused after Phase 4, comment them out with a `/* reserved for Phase N */` marker so they're rediscoverable but not noise.
- [ ] Move the `:root` color block into `:root, [data-theme="dark"]` and add a stub `[data-theme="light"]` block (even with placeholder values) so a future theme toggle has a structural home.
- [ ] Add a top-of-file comment block listing the named-animation contract (`fadeIn`, `slideIn`, `pulse`, `shimmer`) so contributors know which strings inline `animation:` styles can reference.
- [ ] Consider `scrollbar-color: var(--border) transparent;` and `scrollbar-width: thin;` as Firefox fallbacks for the day this app is ever rendered outside Electron's Chromium.

### Risks
- Self-hosting Inter adds ~200KB to the bundle per weight; only do it if the typographic difference is intentional.
- A reduced-motion override that uses `!important` is heavy-handed but necessary because the animations are declared inline; without `!important` the inline `animation` styles win.
- Renaming or removing tokens like `--accent-gradient-soft` will break inline styles in App.tsx (line 163) silently — CSS var fallbacks would gracefully degrade but not warn.
- Splitting into `[data-theme]` blocks without an actual theme switcher adds indirection for no near-term benefit; defer until the Settings panel is real.
