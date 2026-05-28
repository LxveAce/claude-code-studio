# Catalyst UI v4.0.0 — formerly Claude Code Studio

**Released:** 2026-05-28 (testing repo)
**Theme:** Rebrand + Hugging Face Hub integration

---

## What this release is

v4.0.0 is the **Catalyst UI** release.  The app you've been using as
"Claude Code Studio" since v1 is now called **Catalyst UI** —
reflecting the broader scope: a single desktop workbench for Claude,
Hugging Face, Ollama, Aider, Gemini, and OpenRouter, with every panel
built around the same terminal-first workflow.

**Nothing was removed.**  The Claude Code CLI is still the centrepiece;
your settings, snippets, GitHub PAT, model registry, LMM journal, cost
history, and theme all carry forward automatically.  See
`docs/MIGRATING_FROM_CCS.md` for the full walk-through.

---

## Headline: Hugging Face panel

A new sidebar panel (smiley glyph) opens the Hugging Face Hub:

### Browse
- Search the 1M+ Hub models live (text query + optional task filter).
- **GGUF only** checkbox on by default — surfaces models you can run
  locally via Ollama.
- Result cards show downloads, likes, pipeline tag, tags, license,
  gated status.
- Expand a card → loads the full model info + GGUF variants with
  quant tags (Q4_K_M, Q8_0, F16, etc.) and file sizes.
- **Import to Ollama** button on every GGUF variant — synthesises a
  catalog entry (`hf.<repo>.<quant>`) and spawns
  `ollama run hf.co/<repo>:<quant>` via the shared MODELS_LAUNCH
  pipeline.  Entry persists in the Models panel under Local with a
  "HF Import" badge.
- Fallback **Copy ollama cmd** button for users who want to paste
  the command elsewhere.

### Cached
- Lists the resolved cache directory (prefers `~/.cache/huggingface/hub`
  if you already have one, falls back to `<userData>/hf-cache`).
- Per-repo size + Remove button.
- Refresh.

### Research
- Disabled by default.  Behind an explicit opt-in disclaimer
  (community-curated uncensored / experimental catalogs).
- Once enabled, same search surface as Browse but seeded with
  research-leaning queries (`uncensored`, etc.); Import button uses
  `research:true` which adds a "Research" badge + a
  `hf-research.<repo>.<quant>` prefix so you can tell them apart in
  Models.
- **Audit log** panel (collapsible, persistent at
  `<userData>/huggingface-research-audit.jsonl`) records every
  research launch (timestamp / repoId / quant).  Clear button.

---

## Resizable right panel

The right-side panel was a fixed 320 px wide.  v4.0.0 bumps it to a
default **420 px** (HF + Models both want more room as cards get
richer) and adds a 4 px drag handle on the left edge.

- Drag to resize between 280 and 800.
- Choice persists in `localStorage`.
- Double-click the handle resets to default.

Implemented as a generic `PanelResizeHandle` so future layouts can
reuse it.

---

## The rebrand (what changes, what doesn't)

### Identity changes
| Surface | Before | After |
|---|---|---|
| Product name | Claude Code Studio | Catalyst UI |
| Installer artifact | `Claude-Code-Studio-...` | `Catalyst-UI-...` |
| TitleBar | Claude Code Studio | Catalyst UI (fka Claude Code Studio) |
| StatusBar | Claude Code Studio vX.Y.Z | Catalyst UI vX.Y.Z |
| Popout title | `<label> — Claude Code Studio` | `<label> — Catalyst UI` |
| Start-menu shortcut | Claude Code Studio | Catalyst UI |
| Tray tooltip | Claude Code Studio | Catalyst UI |
| Onboarding modal | Welcome to Claude Code Studio | Welcome to Catalyst UI |
| Settings copy | references "Claude Code Studio" | references "Catalyst UI" |
| `package.json` name | `claude-code-studio` | `catalyst-ui` |
| GitHub repo | `LxveAce/claude-code-studio` | `LxveAce/catalyst-ui` |
| Testing repo | `claude-code-studio-testing` | `catalyst-ui-testing` |

### Preserved (so your install upgrades in place)
- **Windows `appId`** stays `com.lxveace.claude-code-studio` — NSIS
  uses appId to decide upgrade-vs-parallel-install; we want upgrade.
- **`userData` directory** still
  `%APPDATA%/Claude Code Studio` (Windows), 
  `~/Library/Application Support/Claude Code Studio` (macOS),
  `~/.config/Claude Code Studio` (Linux).  Anchored via
  `app.setPath()` on `whenReady`.  Nothing in your state directory
  moves or gets renamed.

---

## Auto-update path

Users on v3.2.1 will see v4.0.0 via the in-app updater (Settings →
Updates → Check for updates).  The v3.2.1 update fix (Item 2 of the
v3.2.1 polish pass) is exactly what makes this work — `latest.yml`
now ships with every release.

GitHub maintains permanent redirects from the old repo URL to the new
one, so v3.2.1 binaries' baked-in `LxveAce/claude-code-studio` updater
endpoint continues to resolve after the lockstep repo rename.

---

## Verification

- `npx tsc --noEmit` clean
- `npm run vite:build` clean
- All 8 Phase B PRs merged and verified individually on testing-master:

| PR | Title |
|---|---|
| #38 | feat(hf): @huggingface/hub backend service + IPC + types |
| #39 | feat(hf): HFPanel UI — Browse / Cached / Research sub-tabs |
| #40 | feat(hf): GGUF → Ollama bridge (Import button + shared launcher) |
| #41 | feat(hf): Research catalogs + audit log + research-mode imports |
| #42 | feat(layout): resizable right panel + 420 default + persist width |
| #43 | chore(rename): Catalyst UI (formerly Claude Code Studio) |
| #44 | release(v4.0.0): bump version + CHANGELOG + release notes |

---

## What's next

- `docs/MIGRATING_FROM_CCS.md` — what carries over and what's new.
- Issue tracker moves to the new repo: <https://github.com/LxveAce/catalyst-ui/issues>.
