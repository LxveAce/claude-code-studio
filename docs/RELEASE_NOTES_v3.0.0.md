# Claude Code Studio v3.0.0

The multi-model release. Three months of work landing in one push: a
33-model curated catalog of local + API models with hardware-aware
recommendations, a file directory navigator, accurate per-bucket
resource monitoring, a `--dangerously-skip-permissions` toggle, an
in-app Danger Zone for Reset / Uninstall, and a long list of red-team
fixes from beta testing.

Cross-platform: Windows (NSIS), macOS (DMG), and Linux (AppImage,
.deb, .rpm) all built from the same source.

## Download

| OS | File | Notes |
|---|---|---|
| Windows | `Claude-Code-Studio-3.0.0-Windows.exe` | One-click NSIS installer. Bundles Node + Claude CLI. |
| macOS (Apple Silicon) | `Claude-Code-Studio-3.0.0-Mac.dmg` | Drag to Applications. First launch bootstraps Node + Claude CLI. |
| Linux Universal | `Claude-Code-Studio-3.0.0-Linux-Universal.AppImage` | Portable single-file build. Works on any distro. |
| Linux Debian / Ubuntu | `Claude-Code-Studio-3.0.0-Linux-Debian.deb` | `sudo apt install ./Claude-Code-Studio-3.0.0-Linux-Debian.deb` |
| Linux Fedora / RHEL | `Claude-Code-Studio-3.0.0-Linux-Fedora.rpm` | `sudo dnf install ./Claude-Code-Studio-3.0.0-Linux-Fedora.rpm` |

## What's new in v3.0.0

### Multi-model catalog
- **33 curated local + API models** (Qwen, DeepSeek, Llama, Gemma, Granite, Phi, Mistral, embeddings) — see `docs/MULTI_MODEL.md` for the full list and selection criteria.
- **Hardware-aware recommendations** — auto-detects your tier (toaster / low / mid / high / workstation) based on RAM + VRAM and surfaces the right defaults.
- **Project-aware suggestions** — scans your cwd for `package.json`, `pyproject.toml`, `Cargo.toml`, etc. and weights recommendations by detected role (frontend / backend / data / systems / mobile / devops).
- **In-panel terminal viewer** — see the launched model's PTY output without leaving the Models tab.
- **Pop-out windows** — separate `BrowserWindow` per model for side-by-side workflows.
- **First-run picker** — auto-opens after install with top 3 recommendations for your hardware; pre-pulls them via Ollama.
- **Disk-quota check** — warns before pulling if free disk space is less than 1.5× the model size.
- **License disclosure** — restricted-license models (Llama, Gemma, BigCode) prompt before launch.
- **Add custom model** — form to register your own model with the catalog.

### File directory navigator (new sidebar panel)
- Lazy-loaded tree, one folder level per IPC call. Opening a project with `node_modules` doesn't freeze the renderer.
- Recent projects list, persists across launches.
- Show / hide dotfiles toggle.

### Resource monitoring rebuilt
- **Three separate buckets**: Claude PTYs, model PTYs, Ollama daemon. Pre-v3 the "Claude" gauge silently aggregated everything spawned via PtyRegistry — accurate numbers only when you weren't running local models.
- **O(n) process-tree walk** (was O(n²)) — handles big multi-model setups smoothly.
- **Ollama daemon detection** via process-name scan — picks up the persistent daemon + its model-loader children even when no model PTYs are spawned by Studio.

### Cost accuracy
- **Rates updated** to current Anthropic pricing (Haiku $1/$5, Sonnet $3/$15, Opus $15/$75 per 1M tokens). Verified against `anthropic.com/pricing`.
- **Local models are free + not counted** — disclaimer made explicit.

### GitHub error handling
- 401 / 403 / 404 / network errors get **one-line actionable messages** instead of raw stack traces. Rate-limit errors include the reset time when present.

### Settings additions
- **`--dangerously-skip-permissions` toggle** in Claude CLI section. When on, the Claude CLI launches with permission prompts bypassed automatically. Applies only to Claude PTYs, never to local models.
- **Danger Zone** with two buttons:
  - **Reset user data** — wipes 18 known JSON / JSONL files (settings, history, model registry, debug logs); leaves Chromium profile state intact.
  - **Uninstall Claude Code Studio** — Windows spawns the NSIS uninstaller; macOS opens Finder at /Applications with drag-to-Trash instructions; Linux detects install format and surfaces the right `apt` / `dnf` / `rm` command.
- **Status bar shows current git branch** + dirty indicator. Polls every 30s + on window focus.
- **Single source of truth for version** — title bar, status bar, and About row all read from `app.getVersion()`. Pre-v3 each was hardcoded and drifted (the v2 build shipped with `v1.0.0` in the title bar).

### Sign-in flow
- **Sign In button now sends `/login`** (Claude's in-session slash command) instead of `claude login` (which the running Claude session interpreted as chat text). Caught during beta testing.

### NSIS installer (Windows)
- **Ollama is no longer bundled in the installer.** Beta.1 silently downloaded + installed Ollama (~2 GB) during install with no progress UI; users reasonably thought it was stuck. v3 detects Ollama at runtime instead and offers a one-click install link via the FirstRunPicker.
- **Uninstaller prompts** to also remove the user-data JSON files (defaults to No so a planned reinstall keeps settings).

### Auto-updater
- **Skips beta builds entirely** so beta testers don't get a 404 stack trace from electron-updater looking for `latest.yml` on a release that doesn't have one. Stable v3.0.0 builds auto-update normally.

## Upgrading

**From v1.0.0** — uninstall via Windows Settings → Apps first. v1 used Squirrel; v3 uses NSIS. The two installers don't know about each other.

**From v2.0.0** — Windows: uninstall via Settings → Apps (the v3 installer's "remove userData?" prompt will offer to preserve your settings). macOS/Linux: drag to Trash / `apt remove` and reinstall.

**From v3.0.0-beta.x** — same uninstall-and-reinstall pattern. Settings are forward-compatible.

## Known limitations

- **Per-provider API keys** (OpenAI, Gemini, OpenRouter) — only Anthropic auth is wired. Other API models in the catalog need manual `claude`-style env-var setup.
- **Model comparison view** (run same prompt against multiple models) — not built. Workaround: use pop-out windows.
- **Embedding-RAG over past sessions** — catalog includes embedding models (Qwen3 Embedding, BGE-M3) but the indexing pipeline isn't built.
- **VRAM per loaded model** — Resource panel shows RAM by bucket but not VRAM per model (requires vendor GPU SDKs).
- **macOS code signing** — unsigned build. First launch may show "App is damaged" — right-click → Open → Open. To fix permanently, set up Apple Developer Program ($99/yr) + osxSign config.

## Credits

Multi-model catalog research compiled May 2026 against:
- Ollama Library, Hugging Face GGUF index
- LMSYS Chatbot Arena, HumanEval / MBPP, MMLU-Pro, EvalPlus, BigCodeBench leaderboards
- Independent reviews: InsiderLLM 2026, RTX 5070 benchmarks (Pooya Golchian), index.dev reviews

Built with Electron 42, React 19, Vite, node-pty, xterm.js, Octokit.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
