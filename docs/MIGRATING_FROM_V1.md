# Migrating from v1.0 to v2.0

v2.0 changes the installer format (Windows: Squirrel → NSIS; new
macOS DMG + Linux AppImage/deb/rpm) and introduces a one-click
installer that bundles Node + the Claude Code CLI. **Existing v1.0
Windows users must uninstall once before installing v2.0.** This is a
one-time tax; v2.0 → v2.0.x → v2.1 → … all use the new auto-updater
going forward.

> v2.0 is currently **in development**; this doc becomes accurate once
> v2.0.0 ships.

## Why the manual reinstall (Windows users)

Squirrel and NSIS use fundamentally different install layouts and update
mechanisms:

- **v1.0 (Squirrel)** installed to `%LocalAppData%\claude_code_studio\` with
  a `Update.exe` stub and versioned `app-1.0.0\` directory.
- **v2.0 (NSIS)** installs to `%LocalAppData%\Programs\Claude Code Studio\`
  with a flat layout and a separate Uninstall entry in Programs &
  Features.

The two cannot auto-migrate to each other — they're different
applications from Windows' perspective. Building a Squirrel→NSIS bridge
updater is technically possible but expensive engineering for a one-time
event, so we're documenting the manual path instead.

> **macOS and Linux users:** v1.0 was Windows-only. You have nothing to
> migrate from — just install v2.0 fresh per the README.

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

## Step 3 — Install v2.0

1. Download `Claude.Code.Studio-2.0.0-Setup.exe` from the
   [v2.0.0 release](https://github.com/LxveAce/claude-code-studio/releases).
2. Double-click. The NSIS installer shows a real progress UI:
   - "Setting up Claude Code runtime..."
   - "Downloading Node.js (~30 MB)..."
   - "Installing Claude Code CLI..."
   - "Done."
3. The app launches automatically once setup completes.

**First-launch onboarding** (new in v2.0 on all platforms): if
`claude login` hasn't been run yet, Studio detects this via
`claude doctor` and offers a "Sign in to Claude" button that opens the
browser-based OAuth flow. Click through it once and the prompt never
shows again.

## Verifying the upgrade

After v2.0 launches:

1. The embedded terminal should show `claude` running with no PATH setup.
2. Your previous settings (theme, panel positions, GitHub PAT, snippets)
   should all be intact — they came from `%AppData%\Claude Code Studio\`.
3. The compact-controller toggle should remember its previous state.
4. If you used vault sync in v1.0, the sync repo connection should still
   work.

## What if the v2.0 install fails

The NSIS bootstrap can fail at four points:

| Failure | What you see | Recovery |
|---|---|---|
| Network blocked / offline | "Couldn't download Node.js" modal | Use the offline installer from the Releases page (Phase 4b — ships after the first feedback) |
| SHA256 mismatch (network tampering) | "Failed integrity check" modal | Investigate your network; do NOT bypass. Likely a misconfigured corporate proxy. |
| Zip extract failure (antivirus / disk full) | "Couldn't extract" modal | Free disk space; exempt the installer in AV |
| npm install failure | Modal saying CLI must be installed manually | Studio still installs; open Settings → Claude CLI → "Re-show CLI onboarding" → "Install Claude CLI" (the Phase 6 onboarding handles this) |

All four failures write a full log to `%TEMP%\ccs-install.log` — include
that in any bug report.

### Re-showing the first-launch onboarding modal

If you clicked "Don't show again" on the first-launch onboarding and
later need to recover (e.g., reinstall the CLI or sign in again), use
**Settings → Claude CLI → Re-show CLI onboarding**. Close + reopen the
app and the modal will reshow if `claude doctor` reports missing or
unauthenticated.

Manual reset (any platform):

```powershell
# Windows
Remove-Item "$env:APPDATA\Claude Code Studio\cli-onboarding.json"
```

```bash
# macOS
rm "$HOME/Library/Application Support/Claude Code Studio/cli-onboarding.json"

# Linux
rm "$HOME/.config/Claude Code Studio/cli-onboarding.json"
```

## Rolling back to v1.0

Not recommended (v1.0 has known bugs the v2.0 path fixes), but possible:

1. Uninstall v2.0 via Settings → Apps → Installed apps.
2. Download v1.0 Setup.exe from the
   [v1.0.0 release](https://github.com/LxveAce/claude-code-studio/releases/tag/v1.0.0).
3. Re-install Claude CLI manually:
   `npm install -g @anthropic-ai/claude-code`.

Your data in `%AppData%\Claude Code Studio\` is forward-compatible — v1.0
will read v2.0's settings file shape (we never broke the schema).
