# Contributing to Claude Code Studio

Thanks for your interest in improving Claude Code Studio! This guide covers the
local setup, the branch/PR workflow, and the conventions this project follows.

## Development setup

1. **Use Node 22 LTS.** `package.json` pins `engines.node` to
   `">=22.0.0 <24.0.0"` — newer majors break electron-packager.
   - **macOS/Linux** with [nvm](https://github.com/nvm-sh/nvm):
     ```bash
     nvm install 22 && nvm use 22
     ```
   - **Windows:** see [Node 22 on Windows](#node-22-on-windows) below.
2. Install and run:
   ```bash
   npm install            # runs the node-pty patch postinstall
   npm start              # Vite + Electron with hot reload
   ```
3. On Windows, the node-pty native build needs VS Build Tools 2022 (C++ workload)
   and the Windows 10/11 SDK. See [`README.md`](./README.md#developer-prerequisites).

### Node 22 on Windows

The official Node installer (MSI) goes system-wide; if you're already on
Node 24 for other projects, swap with one of:

- **[nvm-windows](https://github.com/coreybutler/nvm-windows)** — manages
  multiple versions, similar to unix nvm but on a different codebase:
  ```powershell
  nvm install 22.22.3
  nvm use 22.22.3
  ```
- **Portable zip side-by-side** — no installer, no system change:
  ```powershell
  Invoke-WebRequest 'https://nodejs.org/dist/v22.22.3/node-v22.22.3-win-x64.zip' `
    -OutFile "$env:TEMP\node22.zip"
  Expand-Archive "$env:TEMP\node22.zip" "$env:USERPROFILE\nodejs-22"
  # then before any build:
  $env:PATH = "$env:USERPROFILE\nodejs-22\node-v22.22.3-win-x64;$env:PATH"
  ```

### Linux build host (for `npm run dist:linux`)

Producing the full set of Linux installers (AppImage + .deb + .rpm)
needs a few system packages on the build host (or CI runner):

- **`libfuse2`** — AppImage's squashfs runtime uses FUSE.
  ```bash
  sudo apt install libfuse2
  ```
- **`rpm`** — to build the .rpm package on a non-Fedora host (Ubuntu
  build hosts don't ship rpm by default).
  ```bash
  sudo apt install rpm
  ```
- `dpkg-deb` for .deb — preinstalled on Debian/Ubuntu.

GitHub Actions `ubuntu-latest` has `libfuse2` installed by default;
`rpm` is installed via the CI workflow if needed (or skip the rpm
target there).

### Windows Developer Mode (for `npm run dist`)

The v1.1 NSIS installer build (`npm run dist`) needs **Windows Developer
Mode enabled** on the build host. electron-builder downloads winCodeSign
helpers that include macOS dylib symlinks; 7za on Windows can't extract
those without `SeCreateSymbolicLinkPrivilege`, which Developer Mode grants.

**Enable once:** *Settings → Privacy & Security → For Developers →
Developer Mode → On.* No restart required.

`npm run dist:dir` (unpacked output for smoke-testing) does NOT need
this — only the full installer creation does.

### CI installer builds (no Dev Mode needed)

If you don't want to enable Windows Developer Mode locally just to test
the NSIS installer, the GitHub Actions CI workflow at
`.github/workflows/ci.yml` builds Setup.exe on every push to `master` or
a `feature/*` branch. The artifact is downloadable for 30 days from the
CI run under the name `claude-code-studio-windows-installer`.

The CI build runs the same `npm run dist` we use locally — runners just
have the symlink privilege by default, so the winCodeSign extraction
issue doesn't occur there.

### Build pipelines

This repo carries two build pipelines during the v1.1 transition:

| Command | Tool | Output | Notes |
|---|---|---|---|
| `npm start` | electron-forge | (HMR dev server) | Same as v1.0 |
| `npm run package` | electron-forge | `out/` (unpacked) | v1.0 escape hatch |
| `npm run make` | electron-forge | `out/make/squirrel.windows/` | Squirrel installer (v1.0 format) |
| `npm run publish` | electron-forge | GitHub release | Squirrel publish |
| `npm run vite:build` | vite (standalone) | `.vite/` | Used internally by `dist` |
| `npm run dist:dir` | electron-builder | `dist/win-unpacked/` | NSIS smoke test |
| `npm run dist` | electron-builder | `dist/*.exe` | NSIS installer (v1.1 format, needs Dev Mode) |
| `npm run dist:publish` | electron-builder | GitHub release | NSIS publish |

Forge pipeline will be removed in Phase 8 once builder is proven for v1.1.

## Branch & PR workflow

- Branch from `master` using a descriptive prefix: `fix/…`, `feat/…`,
  `chore/…`, or `docs/…`.
- **External contributors** (without push access) work from a fork and open a
  cross-fork pull request into `LxveAce/claude-code-studio:master`.
- Keep a PR focused on one concern. Open separate PRs for unrelated changes.
- Fill in the pull request template and describe how you verified the change.

## Commit messages

- Imperative, present tense: "Fix terminal resize loop", not "Fixed…".
- A concise subject line; wrap the body at ~72 columns and explain the *why*.

## Conventions

- **Code style:** TypeScript throughout. Match the surrounding code — naming,
  comment density, and idioms. Prefer small, readable diffs over churn.
- **Platform parity (v2.0+):** Studio ships on Windows, macOS, and Linux.
  Any change to main-process source must consider all three. Path resolution
  for bundled runtime / CLI goes through
  [`src/main/runtime-paths.ts`](./src/main/runtime-paths.ts) — never hard-
  code platform-specific paths in feature code. When adding a feature that
  uses external binaries or platform APIs, gate with `process.platform`
  and verify the non-Windows branches at least compile (CI catches the
  rest via per-platform smoke builds).
- **LMM journaling:** non-trivial work is thought through with the Lincoln
  Manifold Method and recorded under [`journal/`](./journal/) — one
  `<source-path>.lmm.md` analysis per file.
- **Security self-review:** substantial features get a self-red-team pass
  recorded under [`docs/security-reviews/`](./docs/security-reviews/), with
  Criticals + Highs fixed in the same change set and Mediums documented as
  deferred. See [`SECURITY.md`](./SECURITY.md).

## Verifying changes

There are no automated tests yet, so verify by **running the app** and
exercising the affected behavior (`npm start`). For renderer/layout changes,
confirm the terminal and any touched panels still work. Note in your PR what you
checked and on which platform — the shipped build is Windows, so flag anything
verified only on Linux/macOS.

## Reporting bugs & requesting features

Open an issue using the relevant template under `.github/ISSUE_TEMPLATE/`.
Known bugs and spitballed ideas also live in [`docs/BACKLOG.md`](./docs/BACKLOG.md).
