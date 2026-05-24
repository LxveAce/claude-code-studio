# Migrating from v1.0 to v1.1

v1.1 changes the installer format (Squirrel → NSIS) and introduces a
bootstrap installer that includes Node + the Claude Code CLI. **Existing
v1.0 users must uninstall once before installing v1.1.** This is a one-time
tax; v1.1 → v1.1.x → v1.2 → … all use the new NSIS auto-updater going
forward.

This document covers the upgrade path. v1.1 is currently **in development**;
this doc will become accurate once v1.1.0 ships.

## Why the manual reinstall

Squirrel and NSIS use fundamentally different install layouts and update
mechanisms:

- **v1.0 (Squirrel)** installed to `%LocalAppData%\claude_code_studio\` with
  a `Update.exe` stub and versioned `app-1.0.0\` directory.
- **v1.1 (NSIS)** installs to `%LocalAppData%\Programs\Claude Code Studio\`
  with a flat layout and a separate Uninstall entry in Programs & Features.

The two cannot auto-migrate to each other — they're different applications
from Windows' perspective. Building a Squirrel→NSIS bridge updater is
technically possible but expensive engineering for a one-time event, so
we're documenting the manual path instead.

## Step 1 — Back up your data (probably not needed, but)

Your settings, snippets, vault sync state, GitHub PAT, etc. all live in
`%AppData%\Claude Code Studio\` (NOT in the install directory). The
uninstaller does NOT touch this folder, so your data survives the upgrade
automatically.

If you want a safety copy anyway:

```powershell
Copy-Item "$env:APPDATA\Claude Code Studio" `
  "$env:USERPROFILE\Desktop\CCS-backup-$(Get-Date -Format yyyyMMdd)" `
  -Recurse
```

## Step 2 — Uninstall v1.0

1. Open **Settings → Apps → Installed apps**
   (or *Control Panel → Programs and Features*).
2. Find **Claude Code Studio** in the list.
3. Click *Uninstall*. The Squirrel uninstaller runs silently and removes
   `%LocalAppData%\claude_code_studio\`.

> If the v1.0 install is already broken (Squirrel left a `.dead` marker or
> the `app-1.0.0\` folder is missing key files), the Apps list entry may
> not appear. In that case, just delete `%LocalAppData%\claude_code_studio\`
> manually with Explorer or:
>
> ```powershell
> Remove-Item "$env:LOCALAPPDATA\claude_code_studio" -Recurse -Force
> ```

## Step 3 — Install v1.1

1. Download `Claude.Code.Studio-1.1.0-Setup.exe` from the
   [v1.1.0 release](https://github.com/LxveAce/claude-code-studio/releases).
2. Double-click. The NSIS installer shows a real progress UI:
   - "Setting up Claude Code runtime..."
   - "Downloading Node.js (~30 MB)..."
   - "Installing Claude Code CLI..."
   - "Done."
3. The app launches automatically once setup completes.

**First-launch onboarding** (new in v1.1): if `claude login` hasn't been
run yet, Studio detects this via `claude doctor` and offers a "Sign in to
Claude" button that opens the browser-based OAuth flow. Click through it
once and the prompt never shows again.

## Verifying the upgrade

After v1.1 launches:

1. The embedded terminal should show `claude` running with no PATH setup.
2. Your previous settings (theme, panel positions, GitHub PAT, snippets)
   should all be intact — they came from `%AppData%\Claude Code Studio\`.
3. The compact-controller toggle should remember its previous state.
4. If you used vault sync in v1.0, the sync repo connection should still
   work.

## What if the v1.1 install fails

The NSIS bootstrap can fail at four points:

| Failure | What you see | Recovery |
|---|---|---|
| Network blocked / offline | "Couldn't download Node.js" modal | Use the offline installer from the Releases page (Phase 4b — ships after the first feedback) |
| SHA256 mismatch (network tampering) | "Failed integrity check" modal | Investigate your network; do NOT bypass. Likely a misconfigured corporate proxy. |
| Zip extract failure (antivirus / disk full) | "Couldn't extract" modal | Free disk space; exempt the installer in AV |
| npm install failure | Modal saying CLI must be installed manually | Studio still installs; open Settings → CLI → Install CLI (Phase 6 onboarding handles this) |

All four failures write a full log to `%TEMP%\ccs-install.log` — include
that in any bug report.

## Rolling back to v1.0

Not recommended (v1.0 has known bugs the v1.1 path fixes), but possible:

1. Uninstall v1.1 via Settings → Apps → Installed apps.
2. Download v1.0 Setup.exe from the
   [v1.0.0 release](https://github.com/LxveAce/claude-code-studio/releases/tag/v1.0.0).
3. Re-install Claude CLI manually:
   `npm install -g @anthropic-ai/claude-code`.

Your data in `%AppData%\Claude Code Studio\` is forward-compatible — v1.0
will read v1.1's settings file shape (we never broke the schema).
