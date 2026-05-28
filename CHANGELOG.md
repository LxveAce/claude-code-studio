# Changelog

All notable changes to Claude Code Studio. Dates are when the tag was
pushed to origin. Detailed per-release notes live in
`docs/RELEASE_NOTES_v{version}.md` and are attached to each GitHub
release; this file is the at-a-glance summary.

The project follows [semver](https://semver.org/) loosely — major bumps
mean breaking install/migration changes (v1 → v2 = Squirrel → NSIS;
v2 → v3 = multi-model surface).

---

## [4.0.3] — 2026-05-28

Bug-fix release.  v4.0.2 shipped with four issues users surfaced in
the dev build — one was an unhandled main-process exception that
popped a modal error dialog.  Strictly fixes only, no new features.

### Fixed
- **`Cannot resize a pty that has already exited` crash.**  When a
  PTY exited (Claude (Chat) fast-exit, Ollama tab close, etc.) and
  the renderer's ResizeObserver / panel re-flow fired a delayed
  resize, `PtyManager.resize` called into node-pty on the dead
  handle — which throws a synchronous exception that surfaced as
  a JavaScript-error modal dialog at the user.  `PtyManager` now
  clears `ptyProcess` / `childProcess` in the `onExit` handler so
  subsequent resize/write calls short-circuit; defensive try/catch
  in `PtyManager.resize` and `PtyRegistry.resize` for the (rare)
  case the handle is torn down mid-call.
- **Claude (Chat) yellow stream-json diagnostic was invisible.**
  v4.0.2 added a fast-exit detector in `EmbeddedTerminal` that
  surfaces a yellow `claude --version` / npm-upgrade hint when the
  CLI rejects the stream-json flags — but the diagnostic was gated
  on `profile === 'api.anthropic.claude-chat'`, and `ModelsPanel`
  wasn't passing `profile` to its `EmbeddedTerminal`.  Now passed
  via `running.find(...).modelId`, so the diagnostic fires both
  in the in-panel embed and the popout window.  Side effect: the
  generic "fast exit suggests the CLI rejected something" hint
  (any non-claude profile, ms < 3000) now fires too — useful for
  the curated-research Import path when Ollama isn't running.
- **Commands panel "Stream-JSON mode" empty-state had no way out.**
  When the active tab is Claude (Chat), the Commands panel just
  showed the empty-state message with no actionable affordance.
  Added a CTA banner at the top: "+ Switch to a plain Claude tab"
  which spawns a new Claude tab and switches the panel to
  Terminal — the same flow as the `+` button in TerminalTabs.

### Internal
- All five audit harnesses re-run green at 132/132 after the fixes.
- Inline-style longhand triplet (`borderWidth` / `borderStyle` /
  `borderColor`) on the new CTA banner avoids React's
  "shorthand-mixed-with-longhand" reconciler warning.

---

## [4.0.2] — 2026-05-28

Second hotfix.  v4.0.1's HF fix went too aggressive in dropping
`additionalFields`, breaking the GGUF filter; plus the Research tab
needed a curated starting list; plus the Claude (Chat) "exit code 1"
that v4.0.1's cli-resolver fix uncovered deserved a real diagnostic.

### Fixed
- **HF Browse / Research GGUF Only returned 0 results.**  The v4.0.1
  hotfix removed `additionalFields: ['tags', 'pipeline_tag']` to dodge
  the API's `expand[N] contains a duplicate value` error.  But `tags`
  is what the GGUF filter inspects — without it every model was
  filtered out.  Restored `additionalFields: ['tags']` alone
  (`pipeline_tag` was the actual duplicate; the SDK already includes
  it in defaults).  GGUF Only now correctly surfaces GGUF models.
- **GGUF Only default flipped to OFF.**  The filter is useful when
  you know you'll Import to Ollama, but defaulting to ON hid the
  broader Hub.  Tooltip now explains "GGUF = the quantized weight
  format llama.cpp / Ollama consume."
- **Claude (Chat) "exit code 1" diagnostic.**  v4.0.1 fixed the
  "File not found" by adding `claude` to the cli-resolver, but if
  the local CLI doesn't recognise `--input-format=stream-json`, it
  exits fast with code 1 and the user just saw the bare exit code.
  EmbeddedTerminal now detects fast-exits on that specific profile
  and surfaces a yellow hint pointing at `claude --version` and the
  npm upgrade command.

### Added
- **Curated research-model list** at the top of the Research tab.
  Eight well-known uncensored / abliterated GGUF models pre-packaged
  with size tier badges and Import buttons so the tab has something
  runnable on day one even before the live search settles.
  Includes the failspy abliterated Llama 3 8B / 70B, Dolphin 2.9
  Llama 3 8B, Dolphin 2.5 Mixtral 8x7B, Wizard-Vicuna uncensored
  7B / 13B, Hermes 3 Llama 3.1 8B, and Dolphin 2.9.4 Llama 3.1 8B.
- **In-UI details by default + explicit "Web ↗" button.**  Clicking
  the model name (or "Details") on any HF Browse / Research result
  now toggles the in-app details panel — the click no longer leaves
  the app.  A new "Web ↗" button on each card is the explicit opt-in
  for opening huggingface.co in the OS browser.

### Fixed (amended)
- **modelInfo "expand[7] must be one of" error.**  Clicking Details
  on a result triggered a follow-on API rejection because
  `description` isn't a valid expand field per the Hub API (only the
  values listed in the API's own error message are accepted).
  Dropped `description` from `additionalFields`; details panel now
  loads without the description block (the README body isn't
  surfaced through that endpoint — "Web ↗" remains the path to the
  full model card).

---

## [4.0.2] — 2026-05-28

Hugging Face integration deep-iteration release.  Driven by the user
brief "make this thing good — 0 bugs, ease of use, make sure every
button works."  Service rewritten against the API's actual behaviour
(measured, not assumed), every interactive control verified by a
scripted audit, and a comprehensive feature pass.

### Added
- **Hardware-aware FitBadge** on every GGUF variant.  Auto-detects
  your VRAM + RAM and tags each variant green / yellow / orange /
  red so you can see at a glance what will fit.
- **★ rec badge** picks the largest quant whose 1.25× file size fits
  in your GPU; falls back to Q4_K_M / Q5_K_M defaults when hardware
  is unknown.  Recommended variant is sorted to the top of the list.
- **`gguf` metadata badges** on every result card: 🏛 architecture,
  📏 context length, 💾 total file size.  No more guessing.
- **Sort dropdown**: Downloads, Likes, Trending, Recently updated,
  Recently created.
- **License quick-filter chips**: Apache 2.0, MIT, Llama 3 / 3.1 /
  3.2, Gemma, CC-BY.  One click drills into the matching catalog.
- **Clickable tag / author / pipelineTag chips** on every result —
  re-runs search by that value.
- **Empty-state suggestion chips** (`llama gguf`, `qwen 2.5`,
  `mistral 7b`, etc.) when a search returns zero results, plus a
  "clear the GGUF Only filter" shortcut.
- **`hf:download` IPC** — direct GGUF file streaming download into
  Catalyst's local HF-hub cache layout (separate from Ollama's
  cache).  ⬇ Download button per variant; in-row progress bar shows
  bytes / speed / ETA; **✕ cancel** aborts mid-stream; subsequent
  downloads of the same file skip the network entirely.
- **Per-cached-entry actions**: Open ↗ (file explorer), Copy path
  (clipboard), Remove.
- **Chat template viewer** in the expanded model details — surfaces
  the Jinja template + BOS/EOS tokens baked into the GGUF, with a
  Copy template button.
- **Curated research-catalog list** expanded to 18 well-known
  uncensored / abliterated GGUF models, all empirically verified
  accessible and ranked by adoption (DeepSeek-R1-Distill-Qwen-32B
  abliterated leads at ~40 k downloads/mo).  No restrictions or
  filters beyond the existing opt-in disclaimer + audit log.
- **Sidebar tooltips** with one-line descriptions for every panel.
  Hover descriptions added on Models, LMM, Compact buttons.

### Changed
- **HuggingFaceService.search / .modelInfo** rewritten against
  measured behaviour.  Default expand list is fixed at
  `pipeline_tag, private, gated, downloads, lastModified, likes` —
  any additional value already in that set was returning
  `expand[N] contains a duplicate value`.  `license` and
  `description` aren't valid expand values per the API; license now
  read from `cardData.license`, description deliberately omitted
  (it isn't surfaced through this endpoint — use Web ↗ for the full
  card).
- **GGUF detection** switched from tag-string matching to the
  authoritative `m.gguf != null` signal returned by the API.
- **Per-file size data** now comes from `listFiles` (primary) merged
  with `siblings` (fallback).  Previously the refactor had switched
  to siblings-only, which dropped sizes and broke the FitBadge.
- **Quant tag regex** now handles 20 real-world filename patterns
  (dot / dash / underscore separators; upper- and lower-case;
  Q-quants, I-quants, Q4_0_4_4 multi-segment, short `_q4` forms,
  F16 / BF16 / F32).  Tested in `scripts/test-quant-regex.mjs`.

### Fixed
- **Empty-state chip click did nothing** — closure captured the old
  query; new `runSearch({ query })` form passes overrides inline.
- **modelInfo "expand[7] must be one of …" error** when expanding
  Details on any card — caused by passing `description` (not in the
  API's allowed expand list).  Dropped.
- **Sidebar status bar still read "Claude Code Studio"** in two
  places — fixed in v4.0.1; verified again here.

### Verified
Five scripted CDP-driven audits run against the live renderer:

| Script | Asserts | Result |
|---|---|---|
| `scripts/hf-cdp-test.mjs` | 32 | 32 / 32 |
| `scripts/hf-button-audit.mjs` | 32 | 32 / 32 |
| `scripts/lmm-audit.mjs` | 19 | 19 / 19 |
| `scripts/models-audit.mjs` | 21 | 21 / 21 |
| `scripts/multi-panel-audit.mjs` | 28 | 28 / 28 |

Total: **132 / 132** assertions pass.  Zero renderer exceptions,
zero `console.error` across the full audit.

---

## [4.0.1] — 2026-05-28

Hotfix release.  Four bugs found in v4.0.0 once it was installed and
smoke-tested against a real environment.  Also serves as the first
test of the auto-update channel restored in v3.2.1.

### Fixed
- **Claude (Chat) profile failed to launch** with `File not found`.
  `cli-resolver` didn't have a case for `claude`, so the MODELS_LAUNCH
  path for the catalog's chat-mode profile (`api.anthropic.claude-chat`)
  couldn't resolve the bare `claude` command for node-pty.  Vanilla
  Claude terminal tabs worked because they used the separate
  `pty-manager.findClaudePath` route; only catalog-launched chat-mode
  was affected.  `cli-resolver` now mirrors those candidates: bundled
  runtime first (NSIS-installed `claude.cmd`), then `%APPDATA%/npm/claude.cmd`,
  then `~/.local/bin/claude.exe`.
- **Hugging Face search failed** with `expand[N] contains a duplicate
  value`.  The `@huggingface/hub` SDK auto-includes a default set of
  expand fields (pipeline_tag / private / disabled / downloadsAllTime /
  gated / lastModified / likes), and our `additionalFields` passed
  `pipeline_tag` again — the API rejected the duplicate.  Dropped the
  collision; HF Browse + Research search now work.
- **Right panel resize barely moved** (only a few pixels).  The
  `panelEnter` CSS keyframe ended at `width: 320px` with `fill-mode: both`,
  which froze the outer wrapper at 320 forever — the inner panel's
  inline `width: panelWidth` had no effect because `overflow: hidden`
  clipped it.  Animation now only fades opacity; width is fully
  driven by inline style.
- **StatusBar still read "Claude Code Studio"** instead of "Catalyst UI"
  in the bottom-right corner.  Missed update in the rename PR.
  `index.html`'s `<title>` had the same issue and is also fixed.

### Notes
- This is the first release shipped through the public repo's
  auto-update channel (v3.2.1 fixed the missing `latest.yml`; v4.0.0
  was the first build with the manifest; v4.0.1 is the first build
  v4.0.0 users will see as an in-app update offer).

---

## [4.0.0] — 2026-05-28

The **Catalyst UI** release.  Renames the app (formerly **Claude Code
Studio**), folds in a first-class Hugging Face Hub browser, and lets
the right panel resize.  No code paths were removed; the Claude Code
CLI experience is unchanged.

Full notes: `docs/RELEASE_NOTES_v4.0.0.md`.  Migration walk-through:
`docs/MIGRATING_FROM_CCS.md`.

### Added
- **Hugging Face panel** in the sidebar with three sub-tabs:
  - **Browse** — live search the HF Hub, filter by task + GGUF-only,
    expand any model card to see quants + the "Copy ollama cmd"
    fallback.
  - **Cached** — local cache directory listing, per-repo size,
    Remove button, Refresh.
  - **Research** — disclaimer-gated opt-in tab for community-curated
    uncensored / experimental catalogs, with a per-launch audit log
    (`<userData>/huggingface-research-audit.jsonl`).
- **Import to Ollama** button on every GGUF variant.  Synthesises a
  `hf.<repo>.<quant>` (or `hf-research.<repo>.<quant>`) catalog
  entry, registers it in the Models panel with a "HF Import" /
  "Research" badge, and launches via the shared `MODELS_LAUNCH`
  pipeline — same paneId surface as any other model tab.
- **Resizable right panel** — default width bumped from 320 to **420
  px**; drag handle on the left edge (4 px hit area) lets the user
  resize between 280 and 800.  Double-click resets to default.
  Choice persists in `localStorage`.

### Changed
- **App renamed to Catalyst UI** (formerly Claude Code Studio).
  Product name + installer artifacts + start-menu shortcut +
  TitleBar + StatusBar + popout titles + tray + About + Settings
  Danger Zone copy + NSIS MessageBoxes all updated.  TitleBar
  carries a small "(fka Claude Code Studio)" subtitle so users
  arriving from v3.x recognise the rebrand.
- **`package.json`** `name` and `productName` changed; `version` 4.0.0;
  description expanded.
- **`electron-builder.yml`** `productName`, `artifactName` pattern
  (`Catalyst-UI-x.y.z-*`), `shortcutName`, and `publish.repo`
  (`catalyst-ui`) updated.  Windows `appId` deliberately preserved
  as `com.lxveace.claude-code-studio` so v3.2.1 → v4 is an in-place
  upgrade.

### Preserved (deliberately)
- **`userData` directory** still anchored at `%APPDATA%/Claude Code
  Studio` via `app.setPath()` on `whenReady`.  All v3.x settings,
  snippets, GitHub PAT, model registry, LMM journal, etc. carry
  forward without any user action.
- **Windows `appId`** unchanged — in-place upgrade.
- **NSIS uninstaller candidate list** still tries the v3 spelling
  (`Uninstall Claude Code Studio.exe`) so users staying on v3 keep
  uninstalling normally.

### Migration
- See `docs/MIGRATING_FROM_CCS.md` for the full walk-through.
- Auto-update from v3.2.1 → v4.0.0 lands via the same in-app
  updater path that v3.2.1 fixed (now that `latest.yml` ships in
  every release).

---

## [3.2.1] — 2026-05-28

Polish pass driven by user-reported issues in the live v3.2.0 build,
plus a brand-new Accessibility section under Settings.  No new
headline features; this release fixes things that didn't work,
makes things easier to use, and surfaces hidden workflows.

Full notes: `docs/RELEASE_NOTES_v3.2.1.md`.

### Added
- **Accessibility section under Settings** — ten persisted toggles:
  high-contrast palette, 90/100/115/130 % font scale, reduce motion,
  large focus ring, 44 px click targets, dyslexia-friendly font,
  screen-reader mode hook, keyboard-hints overlay, color-blind palette
  (protanopia / deuteranopia / tritanopia SVG filters), and an audio
  captions placeholder for v4.0.0.  Persisted at
  `<userData>/accessibility.json`; applied via `data-*` attributes on
  `<html>` so the entire app reacts without prop-plumbing.  Defaults
  every accommodation OFF.
- **`Ctrl+F` to focus Models search** + **`Ctrl+Shift+T` to open the
  profile picker** — two new hotkey actions (`models.focus-search`,
  `terminal.new-profile`).
- **OpenAI GPT-4o-mini (via Aider)** catalog entry for cost-sensitive
  iterative runs.
- **`+` tab button now opens the profile picker** (previously
  hard-coded to a new Claude tab).
- **In-app "New LMM cycle" modal** replaces `window.prompt()`.

### Changed
- **Models search bar** bumped from 140 / 11 / 4-8 to 280 / 13 / 8-12
  with radius 6.  Visible on both Local and API tabs.
- **`api.aider.multi`** display name renamed to **OpenAI GPT-4o (via Aider)**
  so the OpenAI use case is obvious.  Existing installs pick up the
  rename via new `FORCE_REFRESH_DISPLAY_IDS` migration tied to
  `SEED_VERSION` 2 → 3 (also pulls in any missing seed API entries on
  registries stuck on the older set).
- **`MODELS_POPOUT`** IPC takes a 3rd `profile` arg; popouts now
  render chat-mode profiles with the stream-json renderer instead of
  falling back to the TUI sanitizer.
- **LMM + Compact panels** are focus-aware — they accept an
  `activeFamily` prop and show a "switch to a Claude tab" hint when
  the focused tab is non-Claude.

### Fixed
- **"Get a key →"** link inside `ApiKeyModal` now opens for OpenAI /
  Gemini / OpenRouter / Anthropic (host allowlist extended).  Blocked
  URLs log a console warning.
- **Auto-updater 404 stack trace** demoted to a one-line console warn
  when `latest*.yml` is missing from the latest release.  CI release
  workflow now uploads `dist/latest*.yml` alongside installers — those
  were excluded in v2.0 and never re-added, so every v3.x release
  shipped without the auto-updater manifest.
- **Copy command** in Models tab now uses Electron's main-process
  clipboard via IPC (reliable regardless of window focus), falls back
  to `navigator.clipboard`, then `alert()` with the command line if
  both fail.  Successful copy flashes the button green "✓ Copied!".
- **`[paneId not found]` cold flash** on popouts replaced with a
  re-attaching spinner + 2.5 s retry; only declares the PTY dead
  after a second negative probe.
- **Chat-skin toggle** now syncs across windows via the localStorage
  `storage` event — toggling in main or popout updates the other.

### CI
- `.github/workflows/release.yml` upload globs include
  `dist/latest.yml`, `dist/latest-mac.yml`, `dist/latest-linux.yml`.
  Users on v3.2.0 will receive the v3.2.1 update via auto-updater
  once this release is published (electron-updater pulls `latest.yml`
  from the LATEST release, not the running version's).

---

## [3.2.0] — 2026-05-27

The tab + structured-chat release. Replaces the split-pane terminal
with a Windows-Terminal-style tab strip; adds a Claude (Chat) profile
that runs Claude in non-interactive JSONL mode for a real chat UI;
the Commands sidebar now mirrors the active tab's CLI.

Full notes: `docs/RELEASE_NOTES_v3.2.0.md`.

### Added
- **TerminalTabs** — Windows-Terminal-style tab strip with profile
  picker (Claude / Ollama / Aider / Gemini / BitNet). Replaces the
  prior split-pane layout. Per-tab popout windows, status dots, +
  button, profile dropdown.
- **Claude (Chat) profile** — runs `claude --print
  --input-format=stream-json --output-format=stream-json --verbose`.
  Pairs with the chat skin to render structured messages: text
  bubbles, tool_use cards, tool_result cards, thinking blocks.
- **Stop button** in chat-mode — replaces Send while a response
  streams, sends SIGINT to halt generation.
- **CLI capability probe** — `claude --help` parsed on app startup;
  Claude (Chat) entry in the picker shows a yellow "CLI flags?"
  badge when stream-json isn't supported locally.
- **Commands sidebar profile families** — 6 curated CLI command
  families surface per active tab.
- **Renderer-side `MAX_TABS = 32`** cap with dismissable banner.
- **Extended runtime verifier** — 30 assertions (12 sidebar panels
  + 18 tab/picker/palette/family-chip gestures).

### Changed
- **Session schema v1 → v2** — `tabs[] + activeTabId` replaces
  `layout: SplitNode`. Automatic migration on first launch (first
  pane of old layout becomes single Claude tab on same paneId).
- **Aider Quick Actions** — `/add `, `/drop `, `/ask `, `/code `,
  `/architect `, `/run ` no longer auto-submit empty arguments;
  they land in the composer for you to finish typing. Active
  terminal auto-focuses.
- **EmbeddedTerminal** wired with `registerSender` + `onPidChange`
  + `active` props so model tabs participate in the snippet /
  palette / StatusBar PID system equally to Claude tabs.
- **CLI onboarding modal** routes `/login` to a Claude tab when
  the active tab is non-Claude.

### Fixed
- StatusBar PID footer now shows real PID for model tabs (was 0).
- Chat-mode user-message echo dedup uses whitespace-normalized
  comparison (no more double-rendered bubbles when Claude
  normalizes text).
- Image content in tool_result shows media_type + source kind +
  size instead of bare `[image]`.
- Race in TerminalTabs `addClaudeTab` / `addModelTab` / `closeTab`
  that dropped concurrently-added tabs during a model-launch await.

### Removed
- `SplitLayout.tsx` (replaced by `TerminalTabs.tsx`).
- The 5 split-pane CommandPalette actions (split-horizontal,
  split-vertical, close-pane, focus-next-pane, focus-prev-pane,
  reset-layout) — repurposed as tab actions.

---

## [3.0.0] — 2026-05-26

The multi-model release. Local + API model catalog, file directory
navigator, accurate per-bucket resource monitoring, cross-platform
uninstall flow, and the full beta.1 → beta.2 → beta.3 fix log folded
into one stable.

### Added
- **Multi-model catalog** — 33 curated local + API models (Qwen,
  DeepSeek, Llama, Gemma, Granite, Phi, Mistral, embeddings) with
  hardware-aware recommendations + cwd-aware project suggestions.
- **Ollama integration** — in-app detection, pull with streaming
  progress, cancel, delete. Install prompt links to `ollama.com/download`
  (not bundled in the installer).
- **In-panel terminal viewer** for launched models + **pop-out windows**
  (separate `BrowserWindow` per model).
- **First-run picker** — auto-opens after install with top
  recommendations for your hardware.
- **File directory navigator** — new sidebar panel, lazy folder tree,
  recent projects, show/hide dotfiles, path-traversal guarded.
- **Add custom model form** — register your own model in the registry.
- **License disclosure** for restricted-license models (Llama, Gemma,
  BigCode) before pull.
- **Per-bucket resource monitoring** — Claude / Models / Ollama tracked
  separately; O(n) process-tree walk (was O(n²)).
- **`--dangerously-skip-permissions` toggle** in Settings → Claude CLI.
  Auto-injects the flag when spawning Claude; never affects model PTYs.
- **Danger Zone in Settings** — Reset User Data (wipes JSON state files,
  keeps Chromium profile) + Uninstall (cross-platform: Windows NSIS,
  macOS Finder, Linux pkg-mgr hint).
- **Status bar git branch** with dirty indicator.
- **App version IPC** — title bar, status bar, and About row all read
  from `app.getVersion()` (no more hardcoded drift).
- **NSIS uninstaller** prompts to also remove userData JSON.

### Changed
- Cost rates updated to May 2026 Anthropic pricing (Haiku $1/$5, was
  $0.8/$4). Sonnet $3/$15 and Opus $15/$75 unchanged.
- Cost disclaimer made explicit: local models via Ollama are free and
  never counted.
- GitHub Octokit errors classified into friendly one-line messages
  (401 token revoked / 403 rate limit with reset time / 404 / network).
- Sign-in flow now sends `/login` (Claude's in-session slash command)
  instead of `claude login` (which the running Claude session was
  treating as chat text).
- `CliService.getStatus` heuristic loosened — only flips `authenticated:
  false` when stderr explicitly mentions auth phrases (was failing on
  any non-zero `claude doctor` exit, popping the modal needlessly).
- Auto-updater skips beta builds entirely (no more `latest.yml` 404
  stack trace).

### Removed
- Ollama bundle from the NSIS installer (was downloading ~2 GB silently
  with no progress UI — users thought the installer was stuck). In-app
  detection + opt-in install link replaces it.

### Known deferred (own pushes later)
- Per-provider API key entry (OpenAI, Gemini, OpenRouter)
- Model comparison view (parallel pane + synced input + diff)
- Embedding-RAG over past sessions
- Per-loaded-model VRAM tracking (requires vendor GPU SDKs)
- macOS code signing + notarization

---

## [2.0.0] — 2026-05-24

Cross-platform release. Windows + macOS + Linux from a single source
tree.

### Added
- macOS DMG (Apple Silicon native, Intel via Rosetta)
- Linux AppImage (portable, any distro) + .deb (Debian/Ubuntu) + .rpm
  (Fedora/RHEL)
- Cross-platform first-launch Node + Claude CLI bootstrap (macOS/Linux
  uses in-app modal; Windows uses NSIS install-time download)
- Per-OS README install sections + SmartScreen/Gatekeeper workarounds

### Changed
- Build pipeline migrated from electron-forge + Squirrel → electron-
  builder + NSIS (Windows) / DMG (Mac) / AppImage/.deb/.rpm (Linux)
- Auto-updater migrated from `update-electron-app` (Squirrel-tied) to
  `electron-updater` (cross-platform via `latest.yml`)
- Tag-driven CI release workflow (matrix build on push of `v*.*.*`)

### Fixed
- npm install MODULE_NOT_FOUND node-gyp/bin/node-gyp.js (added
  `--ignore-scripts` to the bootstrap npm install)
- Sign In button submit (PTY readline needs `\r`, not `\n`)
- Vite `path.join is not a function` browser-stub crash (added explicit
  `external: [...builtinModules]` to vite.main.config)

### Migration from v1
v1 used Squirrel.Windows for Windows-only delivery. v2 uses NSIS which
doesn't know about Squirrel's metadata. v1 users: uninstall via Windows
Settings → Apps, then run the new installer. See
`docs/MIGRATING_FROM_V1.md`.

---

## [1.0.0] — initial release

Single-platform (Windows) Electron app wrapping the Claude Code CLI in
an embedded terminal (node-pty + xterm.js). Resource monitor, GitHub
panel, compact-controller integration, LMM journaling panel,
auth/sync, snippets, hotkeys, system tray.

Built with electron-forge + Squirrel.Windows. Auto-updates via
`update-electron-app`.
