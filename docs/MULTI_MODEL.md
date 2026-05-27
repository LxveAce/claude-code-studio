# Multi-model catalog (v3.0)

**Status:** Built. Landed on `feature/multi-model-scaffold` on 2026-05-26.

This doc covers the why + what + how of the multi-model catalog. The
33-model seed data lives in `src/main/model-catalog-seed.ts`; that file
is the source of truth for model facts (sizes, licenses, strengths).
This doc is for the architecture around it.

---

## Why this exists

Studio shipped wrapping a single CLI (Anthropic's `claude`). Users on
modern hardware can run real coding models locally for free — Qwen2.5
Coder 32B at Q4 is at Claude Sonnet 3.5 quality on single-file work as
of May 2026, and runs on a 24 GB consumer GPU. There is no good reason
to keep the GUI single-model when the underlying PTY abstraction can
spawn anything.

The catalog gives users:

1. A curated list of what's actually worth running locally (not just
   "everything on the Ollama library").
2. Hardware-aware recommendations so a 16 GB laptop user doesn't try
   to pull a 70B model and watch it OOM.
3. License visibility — some popular models (Llama, Gemma) have
   commercial-use restrictions that matter for app distribution.
4. Project-aware suggestions — a Python/Django repo should surface
   different defaults than a React/Tailwind project.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Renderer: ModelsPanel.tsx                           │
│   filters, search, recommendations, pull/launch UI  │
└────────────┬────────────────────────────────────────┘
             │ electronAPI.models / .ollama / .hardware
             ▼
┌─────────────────────────────────────────────────────┐
│ Main (index.ts wires these together)                │
│                                                      │
│  ModelRegistry         OllamaService                │
│   - 33-model seed       - detect (PATH + dirs)      │
│   - persist user        - list installed            │
│     additions           - pull (streaming progress) │
│   - recommend()         - cancel / delete           │
│                                                      │
│  HardwareDetection     ProjectLanguageDetect        │
│   - RAM / GPU probe     - cwd → frontend/backend/   │
│   - tier classify         data/etc.                 │
│                                                      │
│  PtyRegistry (generalized)                          │
│   - now accepts arbitrary command + args            │
│   - spawned with model.command + model.args         │
│   - paneId = "model:<id>-<timestamp>"               │
└─────────────────────────────────────────────────────┘
```

### Files added this push
- `src/main/model-catalog-seed.ts` — 33-model curated catalog
- `src/main/ollama-service.ts` — CLI wrapper (detect / list / pull / delete)
- `src/main/hardware-detection.ts` — RAM/VRAM probe + tier classifier
- `src/main/project-language-detect.ts` — cwd → project role(s)

### Files modified this push
- `src/main/model-registry.ts` — uses seed, adds recommend() algorithm
- `src/main/pty-manager.ts` + `pty-registry.ts` — accept arbitrary command/args
- `src/main/index.ts` — wires new services + IPC handlers
- `src/shared/types.ts` — expanded `ModelDefinition` with catalog metadata
- `src/shared/ipc-channels.ts` — added Ollama / hardware / project channels
- `src/preload/preload.ts` — exposed new namespaces
- `src/declarations.d.ts` — ambient types for new namespaces
- `src/renderer/components/models/ModelsPanel.tsx` — full UI rewrite
- `build/installer.nsh` — Ollama bootstrap (detect + curl install)

A timestamped backup of all 15 modified files lives at
`_backups/2026-05-26-pre-fullscope/`.

---

## The recommend() algorithm

`ModelRegistry.recommend(hardware, project)` returns up to 12 ranked
local models with a `reason` string each. Scoring is additive:

| Signal | Score |
|---|---|
| Curated default for `role:tier` (e.g. `frontend:high` → `qwen2.5-coder:32b`) | +4 |
| Featured + role matches project's primary role | +5 |
| Any role matches project's roles | +3 |
| Featured + tier matches host tier exactly | +3 |
| Tier matches host tier exactly | +2 |
| Tier below host tier (model fits comfortably) | +1 |
| Featured (catch-all) | +1 |
| Model needs higher tier than host | −3 |
| License has commercial-use restrictions | −2 |

The defaults table lives in `model-catalog-seed.ts:ROLE_TIER_DEFAULTS`
and encodes "if no other signal applies, this is the consensus pick for
your hardware + project type." It's deliberately curated, not derived
— see the research notes in commit history for justification.

---

## Hardware tiers

The tier-classify logic in `hardware-detection.ts` favors VRAM over
RAM, because moving a model off-GPU collapses throughput.

```
workstation:  64+ GB RAM AND (48+ GB VRAM OR multi-GPU)
              → 70B at Q4-Q6, large MoE
high:         32+ GB RAM AND 16+ GB VRAM
              → 32-34B at Q4, or 70B at heavy quant
mid:          16+ GB RAM AND 8+ GB VRAM (or 24+ GB RAM with weak GPU)
              → 13-14B at Q4, or 7-8B at Q8
low:          8+ GB RAM
              → 7-8B at Q4_K_M
toaster:      anything less
              → 1-3B at heavy quant
```

---

## Ollama install (in-app, not in the installer)

**Updated 2026-05-26 post-beta.1:** The NSIS-bundled Ollama download was
removed. The installer is now detection-only — it logs whether Ollama is
present on the machine so the in-app UI starts in the right state, but
never downloads OllamaSetup.exe itself.

### Why it was removed

Beta.1's installer downloaded + silently installed Ollama as the last
NSIS step. Ollama's installer turned out to be ~2 GB (not the ~700 MB
initially estimated), and the NSIS UI has no progress bar for a single
`curl` call. The window just sat on "Setting up Ollama…" for 5+ minutes
while bytes streamed in `%TEMP%`. A first-time user has no way to tell
"silently downloading 2 GB" from "stuck." Even with proof it was
working, the UX was bad enough that we pulled it.

### What replaces it

- **NSIS step 5** (`build/installer.nsh`) is now detection-only. It
  probes `$LOCALAPPDATA\Programs\Ollama\ollama.exe`, `$PROGRAMFILES\
  Ollama\ollama.exe`, and `$PROGRAMFILES64\Ollama\ollama.exe`. Logs the
  result. Never downloads.
- **In-app:** the FirstRunPicker + ModelsPanel detect Ollama at runtime
  via the same `OllamaService.getVersion()` probe (used on all
  platforms). If not present, both surfaces render an "Install Ollama"
  link to `ollama.com/download`. User-initiated, visible progress in the
  browser, fully cancelable.

### If the bundled flow ever needs to come back

Pre-beta.2 versions of `installer.nsh` are in
`_backups/2026-05-26-pre-fullscope/build/installer.nsh` (initial scaffold)
and `_backups/2026-05-26-redteam-v3/build/installer.nsh` (the version
that bundled the download). Copy step 5 back if requirements change.

---

## Now shipped (the "follow-up features" push, 2026-05-26)

### In-panel xterm viewer — DONE
`EmbeddedTerminal` component mounts an xterm inline in the Models
panel, attached to the selected running model's paneId. The PTY was
already spawned by `MODELS_LAUNCH`; this just attaches a renderer.
Auto-selects the most recent launch.

### Pop-out windows — DONE
`models:popout` IPC creates a new `BrowserWindow` with `?popout=<paneId>&label=<name>`.
The renderer's App.tsx detects the popout param and short-circuits to
`PopoutView`, which renders only an `EmbeddedTerminal` for that paneId.
Popout windows are tracked in `popoutWindows` map keyed by paneId so a
second pop-out request focuses the existing window instead of dupli-
cating. All popouts are destroyed in `before-quit` before PTYs die.

### "Add custom model" form — DONE
`AddModelModal` component, opened from the Models panel footer. Same
ID regex as the registry so the add succeeds on first try. Catches
duplicate IDs via the existing `ModelRegistry.add` error.

### First-run model picker — DONE
`FirstRunPicker` modal, gated by `FirstRunService` persistence at
`<userData>/models-onboarding.json`. Opens automatically on first
launch when the flag is unset. Pre-selects the top recommendation;
"Pull N models" kicks off parallel `ollama pull` calls. "Skip for now"
still marks the flag so it doesn't reshow. A footer button re-opens
the picker on demand.

### Auto-pull from first-run — DONE
Folded into FirstRunPicker — selecting models + clicking "Pull" calls
`ollama:pull-start` for each. Progress shows in the regular Models
panel once the modal closes.

### Disk-quota check before pull — DONE
`disk:info` IPC probes available bytes at the Ollama models dir
(`%USERPROFILE%\.ollama\models` or `~/.ollama/models`). Before any
pull, `handlePull` checks `freeBytes < 1.5 * sizeBytes` and prompts
confirmation. Skipped gracefully if the probe fails — Ollama's own
error surfaces if disk runs out mid-pull.

### Cross-platform Ollama first-launch detection — DONE
The existing `OllamaService.getVersion()` works on win32, darwin, and
linux (well-known paths + PATH probe). FirstRunPicker surfaces a
prominent "Install Ollama" link with the official URL when not
installed. On macOS / Linux, this replaces the installer-time bundle
we don't have for those platforms (DMG / AppImage / .deb / .rpm
postinstall hooks aren't a good fit for ~700 MB chained installers).

### Per-model resource monitoring — PARTIAL
The existing `ResourceMonitor.setClaudePids()` is called with
`ptyRegistry.allPids()` after every spawn/exit, which already includes
launched model PTYs. The aggregated "Claude" CPU/RAM number in the
Resources panel therefore already reflects ollama-run processes
launched via the catalog. The UI label is now slightly misleading
("Claude" should probably read "Models" — UI rename deferred).

True per-model VRAM measurement is still out — that requires querying
the Ollama daemon's `/api/ps` endpoint or vendor GPU SDKs. Deferred.

## Still deferred (not in this push)

### Per-provider API key entry

The API tab today only knows about Anthropic's `claude`. To add OpenAI,
Gemini, OpenRouter etc., we need:
- Auth UI generalization (existing `AuthPanel` is Anthropic-specific)
- Per-provider credential storage via `safeStorage`
- Provider-specific CLI shimming

Catalog has slots for these (`ModelDefinition.category === 'api'`) but no
UI to enter keys yet. Probably ~3-4 days of focused work.

### Model comparison view (same prompt to N models)

UI requires parallel pane management + a synced-input mode + a result-
diff view. Substantial component work. Defer until the catalog has
seen real use and we know which comparison axes matter.

### Embedding-RAG over past sessions

The catalog now includes Qwen3 Embedding 0.6B + BGE-M3 + Nomic. A real
RAG flow needs: vault index → chunking → embedding → vector store →
query UI. Probably ~1-2 weeks. Worth its own dedicated push.

---

## How to extend the catalog

Edit `src/main/model-catalog-seed.ts`. The schema is in
`src/shared/types.ts:ModelDefinition`. Bump `SEED_VERSION` in
`model-registry.ts` if you add models — the registry will merge
additions into existing user catalogs without clobbering user edits.

Minimum required fields for a new entry:
```typescript
{
  id: 'ollama.your-model',
  name: 'Your Model Name',
  category: 'local',
  provider: 'Ollama',
  command: 'ollama',
  args: ['run', 'your-model:tag'],
  ollamaName: 'your-model:tag',
}
```

To be useful in the catalog UI, also add: `paramsB`, `vramGB`,
`contextTokens`, `license`, `roles`, `hardwareTiers`, `recommendedFor`.

To get into the "Recommended" section, set `featured: true` and add a
short `badge`. Reserve this for genuine consensus best-in-class picks
— if everything is featured, nothing is.

---

## Catalog snapshot (May 2026)

33 models across 9 role-categories and 5 hardware tiers. See the seed
file for the full list. Headline picks per tier per the research:

| Tier | General | Coding | Reasoning | Vision |
|---|---|---|---|---|
| toaster | llama3.2:3b | — | — | — |
| low | qwen3:8b | qwen2.5-coder:7b | deepseek-r1:8b | qwen2.5vl:7b |
| mid | qwen3:14b | qwen2.5-coder:14b | deepseek-r1:14b | qwen2.5vl:7b |
| high | qwen3:32b | qwen2.5-coder:32b | qwq:32b | qwen3-vl:32b |
| workstation | llama3.3:70b | qwen3-coder | qwen3:32b | qwen3-vl:32b |

These are baked into `ROLE_TIER_DEFAULTS` in the seed file — the
recommend() algorithm gives them a +4 boost so they end up first in
their context.
