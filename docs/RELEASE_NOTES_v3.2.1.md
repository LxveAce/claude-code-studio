# Claude Code Studio v3.2.1

**Released:** 2026-05-28 (testing repo)
**Theme:** Polish pass — 8 user-reported bugs + the new Accessibility section

---

## Headline

This is a polish release driven by user-reported issues in the live
v3.2.0 build.  No new headline features; everything here either fixes
something that didn't work, makes something easier to use, or surfaces
a workflow that was hidden.  A new top-level **Accessibility** section
joins Settings, with ten persisted toggles.

Full plan + per-item file paths in
`docs/PLAN_2026-05-28_10-items.md`.

---

## Fixed

### "Get a key →" link works for every provider
The OpenAI / Gemini / OpenRouter / Anthropic key portal links inside
the `ApiKeyModal` were silently blocked by the `openExternal` IPC
allowlist (which only knew about model registries).  Hosts are now
listed explicitly; blocked URLs log a console warning so the next
omission is loud instead of silent.

### Auto-updater no longer 404s with a stack trace
Two-part fix.  In the main process, `UpdaterService.on('error')` now
detects `HttpError 404` on `latest*.yml` specifically and demotes it
to a one-line console warn with no UI state.  In CI, the release
workflow now uploads `dist/latest.yml` (Windows), `dist/latest-mac.yml`
(macOS), and `dist/latest-linux.yml` (Linux AppImage) alongside the
installers — those were excluded back in v2.0 and never re-added, so
every v3.x release shipped without the auto-updater manifest.

### API Models tab shows all providers
The persisted catalog on upgraded installs only kept entries
present at first install.  `SEED_VERSION` bumped 2 → 3 so the
existing seed-merge migration runs on next launch, pulling in
Claude Chat / Gemini / Aider / OpenRouter and the new
GPT-4o-mini entry for users whose registry is stuck on a
smaller set.  Also renamed `Aider (multi-provider)` →
`OpenAI GPT-4o (via Aider)` and added a new force-refresh
mechanism for display-only fields so renames propagate to
existing users without overwriting their customisations.

### Copy command actually copies
`handleCopyCommand` previously called `navigator.clipboard.writeText`
async-without-await and swallowed any rejection.  New
`IPC.APP_CLIPBOARD_WRITE` uses Electron's main-process clipboard
(reliable regardless of focus state); the renderer falls back to
`navigator.clipboard` for dev mode, then `alert()` with the command
line if both fail.  Successful copy flashes the button green
"✓ Copied!" for 2 seconds.

### Search bar is usable
Previously 140px wide, font-size 11, padding 4×8 — and hidden on the
API tab.  Now 280px+ wide, font-size 13, padding 8×12, with a
matching radius and visible on both Local and API tabs.  Tier / role
filters stay gated to Local (they don't apply to API entries).
A new `models.focus-search` hotkey (default `Ctrl+F`) opens the
Models panel and focuses + selects the search input from anywhere.

### LMM panel focus-aware, "+ New cycle" actually opens
- Both `LMMPanel` and `CompactPanel` now accept an `activeFamily`
  prop (derived from the focused terminal tab).  Non-Claude
  families get a dashed "switch to a Claude tab" hint, and LMM's
  `+ New cycle` button is disabled for them.  Both panels
  `refresh()` whenever the active family changes.
- `+ New cycle` no longer uses `window.prompt()` — replaced with
  an in-app modal (input + Create/Cancel, Enter submits, Esc
  cancels, errors surface via the existing `ErrorBanner`).

### Pop-out + chat-skin sync
- `MODELS_POPOUT` IPC now takes a 3rd `profile` arg, URL-encoded
  into the popout window.  App.tsx parses `?profile=` and
  threads it to `PopoutView` → `EmbeddedTerminal` →
  `ChatSkinOverlay`.  Chat-mode profiles keep their stream-json
  renderer in popouts instead of falling back to the TUI
  sanitizer.
- `[paneId not found]` no longer cold-flashes on popouts that
  just hadn't seen listRunning settle.  Probe at 1.5s, retry at
  +2.5s if empty, only declare the PTY dead after the second
  negative.  Cleanup cancels pending probes on unmount.
- Chat-skin toggle syncs across windows for the same paneId via
  the localStorage `storage` event.

### "+" button opens the profile picker
The "+" tooltip claimed `Ctrl+Shift+T` for years even though no
binding existed and the button hard-coded a new Claude tab.  Now
`+` opens the same `ProfilePicker` that the ▼ arrow opens; the
picker's search input handles Enter on empty query as
"pick Claude" so `Ctrl+Shift+T` → Enter still creates a Claude
tab in one hand-off.  New `terminal.new-profile` hotkey wired
with `Ctrl+Shift+T` as its real default.

---

## Added

### Accessibility section under Settings
Brand-new section with ten persisted toggles:

1. **High contrast** — WCAG-AAA palette override (overrides theme)
2. **Font size** — 90 / 100 / 115 / 130 % multiplier
3. **Reduce motion** — disables animations + transitions
4. **Large focus ring** — 3px gold outline on focused elements
5. **Large click targets** — 44px min-height (WCAG-AAA touch spec)
6. **Dyslexia font** — OpenDyslexic stack with Comic Sans fallback
7. **Screen reader mode** — data-attr hook; aria-live wiring in follow-up
8. **Keyboard hints overlay** — floating list of active hotkeys
9. **Color-blind palette** — SVG color-matrix filters
   (protanopia / deuteranopia / tritanopia)
10. **Audio captions** — placeholder for v4.0.0 HF audio integration

Persisted at `<userData>/accessibility.json` via the atomic
tmp+rename pattern shared with cli-flags / compact-controller.
Renderer applies prefs to `document.documentElement` on
hydration + on every change, so toggles take effect without a
reload.  Defaults: everything OFF — no behavior change for
existing users until they opt in.

---

## Catalog changes

- New entry **OpenAI GPT-4o-mini (via Aider)** for cost-sensitive
  iterative runs through the same Aider CLI as GPT-4o.
- Rename: `api.aider.multi` → display name **OpenAI GPT-4o (via Aider)**
  (force-refreshed on existing installs via the new
  `FORCE_REFRESH_DISPLAY_IDS` migration).

---

## Verification

- `npx tsc --noEmit` clean.
- `npm run vite:build` clean.
- `node scripts/runtime-verify.mjs` — runs against the previously
  shipped assertions; visual-only Accessibility toggles will be
  added to the verifier in a follow-up PR.
- Manual smoke against the 8 user-reported issues across the
  shipped UI.

---

## Pull requests in this release

| PR | Title |
|---|---|
| #28 | docs(plan): two-phase delivery for 10-item ideas list |
| #29 | fix(ipc): allow PROVIDER_KEY_URL hosts in openExternal allowlist |
| #30 | fix(updater): demote missing-latest.yml 404 + restore CI yml uploads |
| #31 | feat(models): API tab providers + OpenAI clarity + Copy command toast |
| #32 | feat(models): larger search bar, on both tabs, Ctrl+F to focus |
| #33 | feat(lmm,compact): focus-aware panels + in-app New Cycle modal |
| #34 | fix(popout): thread profile, soft retry, sync chat-skin toggle |
| #35 | feat(tabs): + opens profile picker + Ctrl+Shift+T hotkey |
| #36 | feat(a11y): Accessibility section under Settings with 10 features |
