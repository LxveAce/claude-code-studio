# Claude Code Studio

> A full desktop GUI for [Claude Code](https://claude.com/claude-code) — a real
> embedded terminal running `claude`, wrapped with resource monitoring, GitHub
> integration, compact optimization, cost tracking, and cloud sync.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6.svg)
![Electron](https://img.shields.io/badge/Electron-42-47848F.svg)

<p align="center">
  <img src="./docs/assets/CCS.gif" alt="Claude Code Studio — embedded terminal with sliding sidebar panels" width="800">
</p>

---

## Overview

Claude Code Studio embeds the Claude Code CLI in a polished Electron desktop
app. The core is a genuine terminal (node-pty + xterm.js) running `claude`, with
a sidebar of panels that add tooling around it — without getting in the way of
the terminal-first workflow.

## Features

- **Embedded terminal** — real PTY running `claude`, with split panes and
  session persistence.
- **Resource monitor** — live CPU / RAM / GPU, including per-Claude-process
  aggregation across panes.
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

v1.0 ships **Windows-only** (Squirrel.Windows installer + auto-update).
Development works on Linux and macOS; macOS and Linux packaging are on the
roadmap — see [`docs/BACKLOG.md`](./docs/BACKLOG.md).

## Installing (v1.0)

Download `Claude.Code.Studio-1.0.0.Setup.exe` from the
[v1.0.0 release](https://github.com/LxveAce/claude-code-studio/releases/tag/v1.0.0)
and double-click. v1.0 requires **Claude Code CLI already installed**:

```bash
npm install -g @anthropic-ai/claude-code
claude login          # one-time browser-based OAuth
```

> **v1.1 is in development** and replaces this with a one-click installer
> that bootstraps Node + the Claude CLI for you — no manual prereq install.
> See [`docs/INSTALLER_REDESIGN.md`](./docs/INSTALLER_REDESIGN.md) for the
> design and [`docs/MIGRATING_FROM_V1.md`](./docs/MIGRATING_FROM_V1.md)
> for the upgrade path when it ships.

## Building from source

### Developer prerequisites

- **Node.js `>=22.0.0 <24.0.0`** — Node 22 LTS is required (electron-packager
  is not yet compatible with Node 24). `package.json` pins `engines.node`.
  Windows users: see [`CONTRIBUTING.md`](./CONTRIBUTING.md#node-22-on-windows).
- **For node-pty native build on Windows:** Visual Studio Build Tools 2022
  with the C++ workload, plus the Windows 10/11 SDK (10.0.22621+).
- **For `npm run dist` (v1.1 NSIS installer build):** Windows Developer Mode
  enabled (Settings → Privacy & Security → For Developers). See
  [`docs/INSTALLER_REDESIGN.md`](./docs/INSTALLER_REDESIGN.md#build-prerequisite-windows-developer-mode).

### Getting started

```bash
git clone https://github.com/LxveAce/claude-code-studio.git
cd claude-code-studio
npm install            # runs the node-pty patch postinstall
npm start              # dev: Vite + Electron with HMR
```

### Build outputs

```bash
# v1.0 Squirrel pipeline (forge — kept as escape hatch during v1.1 transition)
npm run package        # unpacked app under out/
npm run make           # Squirrel installer under out/make/squirrel.windows/
npm run publish        # draft a GitHub release (requires GITHUB_TOKEN)

# v1.1 NSIS pipeline (electron-builder — adds bootstrap installer)
npm run dist:dir       # unpacked output under dist/win-unpacked/ (smoke test)
npm run dist           # NSIS Setup.exe under dist/  (needs Developer Mode)
npm run dist:publish   # build + publish to GitHub Releases as draft
```

> Both pipelines need Node 22 — see [Developer prerequisites](#developer-prerequisites).

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
