# Migrating from Claude Code Studio to Catalyst UI

**TL;DR — your settings, history, GitHub PAT, model registry, snippets,
LMM journal, and cost data all carry over automatically.  Install v4.0.0
on top of any v3.x build (or fresh) — there is nothing you need to do.**

---

## What changed

v4.0.0 renames the app from **Claude Code Studio** to **Catalyst UI**.
The rebrand reflects the expanded scope: alongside the embedded Claude
Code CLI, the app now ships:

- A first-class **Hugging Face Hub** browser (Browse / Cached / Research
  catalogs) with a GGUF → Ollama bridge.
- A new **Accessibility** section under Settings (10 toggles, all
  default off).
- A user-resizable right panel with a wider 420 px default.
- Refined provider plumbing (OpenAI / Gemini / OpenRouter alongside
  Anthropic / Aider).

Nothing was removed.  The Claude Code CLI experience is unchanged —
this is purely a name + scope expansion.

## What carries over automatically

On first launch, v4.0.0 anchors `userData` to the existing
`%APPDATA%/Claude Code Studio` directory (Windows) /
`~/Library/Application Support/Claude Code Studio` (macOS) /
`~/.config/Claude Code Studio` (Linux).  That folder name stays the
same forever so:

- **Settings + theme**
- **Cost + token history**
- **GitHub PAT + Octokit cache**
- **Snippets**
- **Hotkeys**
- **LMM journals**
- **Model catalog (incl. custom-added entries)**
- **CLI flags / `--dangerously-skip-permissions` toggle**
- **Compact controller config**
- **Cloud sync settings**

...all carry forward without any action on your part.  Your existing
Claude session state lives outside the app at `~/.claude` and is
entirely untouched.

## Auto-update path

Users on v3.2.1 will be offered the v4.0.0 update via the in-app
updater (Settings → Updates → Check for updates).  The installer
detects the in-place upgrade via the stable `appId`
(`com.lxveace.claude-code-studio`) and replaces the binary without
prompting for an install location.

## GitHub repo rename

Alongside v4.0.0 we renamed the GitHub repos:

- `LxveAce/claude-code-studio` → `LxveAce/catalyst-ui`
- `LxveAce/claude-code-studio-testing` → `LxveAce/catalyst-ui-testing`

GitHub maintains permanent redirects from the old URLs, so any
bookmarks, links in old docs, and the auto-updater config baked into
v3.2.1 binaries all continue to work.

## App identity changes

| Thing | Before (v3.2.1) | After (v4.0.0) |
|---|---|---|
| Product name | Claude Code Studio | Catalyst UI |
| App display | Claude Code Studio | Catalyst UI (fka Claude Code Studio) |
| Installer file | `Claude-Code-Studio-...` | `Catalyst-UI-...` |
| Start-menu shortcut | Claude Code Studio | Catalyst UI |
| Window title | Claude Code Studio | Catalyst UI |
| Tray tooltip | Claude Code Studio | Catalyst UI |
| `package.json` name | `claude-code-studio` | `catalyst-ui` |
| `productName` | Claude Code Studio | Catalyst UI |
| Windows `appId` | `com.lxveace.claude-code-studio` | `com.lxveace.claude-code-studio` (unchanged for in-place upgrade) |
| `userData` dir name | `Claude Code Studio` | `Claude Code Studio` (unchanged so settings carry) |

The userData directory name stays as **Claude Code Studio** forever.
That's deliberate — it's the technical state path that all your
existing settings depend on.  The product name visible to you in the
UI is "Catalyst UI".

## If you're a developer

- Clone URL changes:
  ```
  git remote set-url origin https://github.com/LxveAce/catalyst-ui.git
  ```
  (Old URL still works via GitHub redirect, but updating is tidier.)
- `package.json` `name` changes from `claude-code-studio` to
  `catalyst-ui` — affects npm-style references.
- Bundle identifier / `appId` stays the same.
- Installer artifact naming changes (`Catalyst-UI-x.y.z-*` instead of
  `Claude-Code-Studio-x.y.z-*`).

## Fresh install vs upgrade

Both paths land at the same state directory.  A fresh install of
v4.0.0 on a machine that has never run Claude Code Studio creates the
`Claude Code Studio` `userData` folder on first launch — that's the
canonical path going forward, regardless of how you arrived there.

## Questions?

File an issue at the new repo: <https://github.com/LxveAce/catalyst-ui/issues>.
