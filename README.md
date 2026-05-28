# Catalyst UI

> **Formerly Claude Code Studio.**  Multi-vendor AI workbench in a single
> desktop app.  Embedded terminal for Claude Code, plus integrated panels
> for Hugging Face model discovery, Ollama local models, multi-provider
> API keys (OpenAI / Gemini / OpenRouter), resource monitoring, GitHub,
> compact optimization, cost tracking, accessibility, and cloud sync.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Windows](https://img.shields.io/badge/Windows-0078D6.svg)
![macOS](https://img.shields.io/badge/macOS-000000.svg)
![Linux](https://img.shields.io/badge/Linux-FCC624.svg)
![Electron](https://img.shields.io/badge/Electron-42-47848F.svg)

<p align="center">
  <img src="./docs/assets/CCS.gif" alt="Catalyst UI — embedded terminal with sliding sidebar panels" width="800">
</p>

---

## Quick install

Download from the [**latest release**](https://github.com/LxveAce/claude-code-studio/releases/latest)
and double-click. The installer downloads Node + the Claude CLI for you and
launches the app — sign in to Claude in the first-launch modal, done.

- **Windows:** `Claude-Code-Studio-3.0.0-Windows.exe` (NSIS one-click silent install)
- **macOS Apple Silicon:** `Claude-Code-Studio-3.0.0-Mac.dmg` (drag to Applications)
- **Linux:** `Claude-Code-Studio-3.0.0-Linux-Universal.AppImage` (portable),
  `-Linux-Debian.deb` (Debian/Ubuntu), or `-Linux-Fedora.rpm` (Fedora/RHEL)

Per-platform install details, SmartScreen/Gatekeeper workarounds, and the
build-from-source instructions are in [Installing v3.0](#installing-v30) below.

---

## Overview

Catalyst UI (formerly Claude Code Studio) embeds the Claude Code CLI in a
polished Electron desktop app, alongside an integrated Hugging Face Hub
browser and Ollama bridge.  The core is a genuine terminal (node-pty +
xterm.js) running `claude` — the sidebar adds tooling around it without
getting in the way of the terminal-first workflow.

## Features

- **Embedded terminal** — real PTY running `claude`, with split panes and
  session persistence.
- **Multi-model catalog (v3.0)** — 33-model curated catalog of local +
  API models (Qwen, DeepSeek, Llama, Gemma, Granite, Phi, Mistral,
  embeddings). Hardware-tier auto-detect, cwd-aware recommendations
  (frontend vs backend), in-panel terminal + pop-out windows for
  launched models, first-run picker that pre-pulls your hardware's
  defaults. Ollama is detected at runtime; if missing, the app surfaces
  a one-click install link (not bundled in the installer). See
  [docs/MULTI_MODEL.md](./docs/MULTI_MODEL.md).
- **File directory navigator (v3.0)** — sidebar panel with lazy folder
  tree, recent projects, show/hide dotfiles. Path-traversal guarded.
- **Resource monitor** — live CPU / RAM / GPU; v3.0 splits the per-process
  bucket into Claude PTYs, model PTYs, and the Ollama daemon so the
  numbers stay accurate when running local models.
- **`--dangerously-skip-permissions` toggle (v3.0)** — Settings → Claude
  CLI. Auto-injects the flag when spawning Claude; never touches model
  PTYs. Off by default; turn on only in trusted projects.
- **Danger Zone (v3.0)** — Settings → bottom. Reset User Data wipes the
  JSON state files Studio wrote (keeps Chromium profile). Uninstall is
  cross-platform: Windows spawns NSIS uninstaller, macOS opens Finder
  at /Applications, Linux detects pkg format and shows the right hint.
- **Compact controller** — reads/toggles the compact-controller hooks and state.
- **GitHub integration** — repos, commits, branches, PRs, and issues; PAT stored
  encrypted via Electron `safeStorage`.
- **LMM journaling** — in-app panel for the Lincoln Manifold Method workflow.
- **Auth + settings sync** — optional account with cross-device settings sync.
- **Vault sync** — push compact-controller vaults to a private GitHub repo.
- **Command palette, snippets & notifications** — fuzzy palette, snippet store,
  desktop notifications.
- **Auto-updater, system tray & rebindable hotkeys.**
- **Token cost tracker** — per-session estimates with a daily budget.
- **Theming** — dark base with six accent presets.

See [`docs/HANDOFF.md`](./docs/HANDOFF.md) for the per-phase breakdown.

## Platform support

v3.0 ships on **Windows**, **macOS** (Apple Silicon), and **Linux**
(AppImage / .deb / .rpm). All three include the same bootstrap that
installs Node + the Claude CLI for you — no manual prereqs.

v1.0 was Windows-only via Squirrel.Windows. v1.0 users see
[`docs/MIGRATING_FROM_V1.md`](./docs/MIGRATING_FROM_V1.md) for the
one-time uninstall + reinstall path (same migration applies whether
you're moving to v2 or jumping straight to v3 — both use the new
electron-builder pipeline).

## Installing v3.0

Download the right asset for your OS from the
[latest release](https://github.com/LxveAce/claude-code-studio/releases/latest)
and follow the per-platform steps below.

### Windows

1. Download `Claude-Code-Studio-3.0.0-Windows.exe`.
2. Double-click. The NSIS installer downloads Node + the Claude CLI,
   then launches Studio. ~30 seconds total. No further setup needed.

**SmartScreen warning** (first install, until code-signing is added in
a future release):
- Click "More info" → "Run anyway".
- Appears once per machine; subsequent launches are clean.

### macOS (Apple Silicon, Intel via Rosetta)

1. Download `Claude-Code-Studio-3.0.0-Mac.dmg` (Apple Silicon native;
   runs on Intel Macs via Rosetta).
2. Open the DMG, drag **Claude Code Studio** into **Applications**.
3. Eject the DMG, open Studio from Launchpad / Spotlight.
4. First launch: an onboarding modal downloads Node + the Claude CLI
   into `~/Library/Application Support/Claude Code Studio/runtime/`.
   Click **Sign in to Claude** — the in-session `/login` command opens
   your browser to complete OAuth.

**Gatekeeper warning** (first launch, until notarization is added in a
future release):
- macOS may say *"Claude Code Studio cannot be opened because the
  developer cannot be verified."*
- Right-click the app icon → **Open** → confirm in the dialog. Required
  only once.

**Apple Silicon vs Intel:** use the arm64 build on M-series chips for
~30% better performance. Both run on either chip (Rosetta translates),
but native is faster.

### Linux

Three install formats are published per release. Pick whichever matches
your distro.

#### AppImage (works on any distro, no install needed)

1. Download `Claude-Code-Studio-3.0.0-Linux-Universal.AppImage`.
2. Make it executable and run:
   ```bash
   chmod +x Claude-Code-Studio-3.0.0-Linux-Universal.AppImage
   ./Claude-Code-Studio-3.0.0-Linux-Universal.AppImage
   ```
3. First launch: onboarding modal downloads Node + Claude CLI into
   `~/.config/Claude Code Studio/runtime/`. Sign in via the modal.

If you want a desktop entry + menu integration, drop the AppImage into
`~/Applications/` and use [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher).

#### Debian / Ubuntu

```bash
wget https://github.com/LxveAce/claude-code-studio/releases/latest/download/Claude-Code-Studio-3.0.0-Linux-Debian.deb
sudo dpkg -i Claude-Code-Studio-3.0.0-Linux-Debian.deb
sudo apt-get install -f   # resolve missing deps if any
```

Launch from your applications menu. First-launch bootstrap is the same
modal as the AppImage.

#### Fedora / RHEL / CentOS

```bash
wget https://github.com/LxveAce/claude-code-studio/releases/latest/download/Claude-Code-Studio-3.0.0-Linux-Fedora.rpm
sudo dnf install ./Claude-Code-Studio-3.0.0-Linux-Fedora.rpm
```

(Or `sudo rpm -i` if you prefer rpm directly.)

**Linux node-pty native build:** the prebuild that ships with node-pty
covers `linux-x64` with glibc 2.17+. If you're on a very old distro
(CentOS 7 era) and the embedded terminal won't spawn, that's the issue
— file an issue with `ldd --version` output.

### All platforms: what the first launch does

Every install path ends at the same first-launch flow:

1. Studio checks for an existing Claude CLI on PATH or bundled runtime.
2. If missing: onboarding modal shows **Install Claude CLI** button.
   Click → modal streams the install log → ~30-60 seconds → done.
3. If unauthenticated: modal shows **Sign in to Claude**. Click →
   `/login` is sent to the running Claude session in the embedded
   terminal → Claude opens your browser → complete OAuth → modal
   dismisses. (v3 switched from `claude login` to `/login` because the
   PTY auto-spawns Claude — sending the bare shell command would just
   be chat text the running Claude session would respond to.)
4. Subsequent launches skip the modal entirely (unless the CLI is
   broken or `~/.claude.json` is gone).

## Building from source

### Developer prerequisites

- **Node.js `>=22.0.0 <24.0.0`** — Node 22 LTS is required (electron-packager
  is not yet compatible with Node 24). `package.json` pins `engines.node`.
  Windows users: see [`CONTRIBUTING.md`](./CONTRIBUTING.md#node-22-on-windows).
- **For node-pty native build on Windows:** Visual Studio Build Tools 2022
  with the C++ workload, plus the Windows 10/11 SDK (10.0.22621+).
- **For `npm run dist` (NSIS installer build, Windows-only):** Windows
  Developer Mode enabled (Settings → Privacy & Security → For
  Developers). Without it, the 7za extraction of electron-builder's
  `winCodeSign-2.6.0.7z` fails on macOS dylib symlinks. CI runners
  enable Dev Mode explicitly in `release.yml`; local builds need it
  on or the 7za wrapper at `docs/SESSION_LOG_2026-05-26_v3.0.0_release.md`.

### Getting started

```bash
git clone https://github.com/LxveAce/claude-code-studio.git
cd claude-code-studio
npm install            # runs the node-pty patch postinstall
npm start              # dev: Vite + Electron with HMR
```

### Build outputs

The build pipeline is electron-builder with per-OS targets. forge is
kept in scripts as a legacy escape hatch (the Squirrel.Windows pipeline
used for v1.0). Slated for removal once enough users have migrated past
v3.0.

```bash
# Cross-platform
npm run dist:dir            # unpacked output under dist/ — quick smoke test
npm run vite:build          # just the renderer/main bundles

# Per-OS local builds
npm run dist                # Windows NSIS Setup.exe (needs Dev Mode)
npm run dist:mac            # macOS DMG + zip (must run ON a Mac)
npm run dist:linux          # Linux AppImage + deb + rpm

# Cross-build all 3 (Linux build host can produce Windows + Linux;
# macOS build needs a Mac)
npm run dist:all

# Publish to GitHub Releases (draft)
npm run dist:publish        # Windows
npm run dist:publish:mac    # macOS
npm run dist:publish:linux  # Linux

# Legacy forge pipeline (v1.0 Squirrel — escape hatch)
npm run package             # unpacked under out/
npm run make                # Squirrel installer under out/make/squirrel.windows/
npm run publish             # forge publish — Squirrel only
```

> All pipelines need Node 22 — see [Developer prerequisites](#developer-prerequisites).

## Tech stack

Electron 42 · React 19 · Vite · TypeScript · node-pty · xterm.js ·
systeminformation · Octokit · electron-forge.

## Project structure

```
src/        Application source (main / preload / renderer / shared)
scripts/    Build helpers (node-pty patch)
docs/       Documentation — HANDOFF, BACKLOG, ship cert, security reviews
journal/    Per-source-file LMM analyses (one .lmm.md per source file)
```

## Documentation

- [`docs/HANDOFF.md`](./docs/HANDOFF.md) — development handoff & current state
- [`docs/BACKLOG.md`](./docs/BACKLOG.md) — post-v1.0 ideas & known bugs
- [`docs/SHIPPING_CERTIFICATION.md`](./docs/SHIPPING_CERTIFICATION.md) — v1.0 ship certification
- [`docs/security-reviews/`](./docs/security-reviews/) — per-phase self-red-team reviews
- [`journal/`](./journal/) — per-source-file LMM analyses (one `.lmm.md` per file)

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Security

To report a vulnerability, see [`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) © LxveAce
