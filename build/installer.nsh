; ============================================================================
; Claude Code Studio — NSIS bootstrap installer macros
; ============================================================================
;
; Hooked into electron-builder via `nsis.include` in electron-builder.yml.
; Runs as part of the standard NSIS install flow:
;
;   1. electron-builder lays down the app files into $INSTDIR.
;   2. customInstall (below) runs: downloads Node 22 portable, verifies
;      its SHA256, extracts to $INSTDIR\resources\runtime\, then uses the
;      bundled npm to install @anthropic-ai/claude-code into that runtime
;      directory.
;   3. NSIS creates shortcuts and the app launches.
;   4. PtyManager (src/main/pty-manager.ts) prefers
;      $INSTDIR\resources\runtime\claude.cmd over system PATH.
;
; Failure behavior (per Phase 1 red-team H1):
;   - Hard failures (network drop, SHA mismatch) abort the install and
;     point the user at the offline-installer release asset.
;   - Soft failures (CLI install fails but Node OK) install Studio anyway
;     and tell the user to install the CLI manually.
;
; Logging: every step DetailPrints to NSIS's install log, AND we append to
; $TEMP\ccs-install.log via Write-Output so failures are diagnosable after
; the installer closes.
;
; All network + filesystem operations shell out to PowerShell. This avoids
; depending on third-party NSIS plugins (inetc, nsisunz, crypto) and uses
; only what ships in Windows 10+:
;   - Invoke-WebRequest for downloads (supports TLS 1.2/1.3 by default)
;   - Get-FileHash for SHA256 verification
;   - Expand-Archive for zip extraction
;   - Move-Item / Remove-Item for filesystem cleanup
;
; ============================================================================

!define NODE_VERSION  "22.22.3"
!define NODE_ZIP      "node-v${NODE_VERSION}-win-x64.zip"
!define NODE_URL      "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}"
; SHA256 of node-v22.22.3-win-x64.zip from nodejs.org/dist/v22.22.3/SHASUMS256.txt
; (captured 2026-05-23). Verify before each release bump.
!define NODE_SHA256   "6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33"

!define CLAUDE_PKG    "@anthropic-ai/claude-code"
!define OFFLINE_URL   "https://github.com/LxveAce/claude-code-studio/releases/latest"
!define INSTALL_LOG   "$TEMP\ccs-install.log"

; ----------------------------------------------------------------------------
; Helper: log to both NSIS detail view and $TEMP\ccs-install.log
; Usage: !insertmacro CCSLog "message text"
; ----------------------------------------------------------------------------
!macro CCSLog msg
  DetailPrint "${msg}"
  nsExec::Exec 'powershell -NoProfile -WindowStyle Hidden -Command "Add-Content -Path ''${INSTALL_LOG}'' -Value (''[{0:yyyy-MM-dd HH:mm:ss}] {1}'' -f (Get-Date), ''${msg}'')"'
  Pop $R9
!macroend

; ----------------------------------------------------------------------------
; customInstall — the bootstrap.
;
; Runs after electron-builder copies the app files into $INSTDIR but
; before shortcuts are created. If we Abort, the whole install rolls back.
; ----------------------------------------------------------------------------
!macro customInstall
  !insertmacro CCSLog "===== Claude Code Studio bootstrap start ====="
  !insertmacro CCSLog "INSTDIR = $INSTDIR"

  ; --- Step 1: Download Node.js portable runtime ---
  !insertmacro CCSLog "Downloading Node.js ${NODE_VERSION} (~30 MB)..."
  ; Pin TLS 1.2 explicitly — some Windows 10 builds default to TLS 1.0/1.1
  ; which nodejs.org no longer accepts.
  ; -UseBasicParsing for compatibility with restricted PowerShell modes.
  nsExec::ExecToStack 'powershell -NoProfile -WindowStyle Hidden -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri ''${NODE_URL}'' -OutFile ''$TEMP\${NODE_ZIP}'' -UseBasicParsing -TimeoutSec 300; exit 0 } catch { Write-Error $_.Exception.Message; exit 1 }"'
  Pop $0
  Pop $1
  IntCmp $0 0 download_ok
    !insertmacro CCSLog "Node.js download FAILED (exit $0): $1"
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Couldn't download the Node.js runtime.$\n$\nThis usually means your network is offline, blocking nodejs.org, or behind a proxy that intercepts HTTPS.$\n$\nPlease retry, or use the offline installer (no network needed during install):$\n${OFFLINE_URL}$\n$\nDetails written to ${INSTALL_LOG}"
    Abort
  download_ok:
  !insertmacro CCSLog "Node.js download OK"

  ; --- Step 2: Verify SHA256 ---
  !insertmacro CCSLog "Verifying Node.js download integrity (SHA256)..."
  nsExec::ExecToStack 'powershell -NoProfile -WindowStyle Hidden -Command "$h = (Get-FileHash -Algorithm SHA256 -Path ''$TEMP\${NODE_ZIP}'').Hash.ToLower(); if ($h -eq ''${NODE_SHA256}'') { exit 0 } else { Write-Error \"got $h\"; exit 1 }"'
  Pop $0
  Pop $1
  IntCmp $0 0 sha_ok
    !insertmacro CCSLog "Node.js SHA256 MISMATCH: $1"
    Delete "$TEMP\${NODE_ZIP}"
    MessageBox MB_ICONSTOP|MB_OK \
      "The Node.js download failed its integrity check.$\n$\nThis could mean a corrupted download, or that something on your network is tampering with HTTPS responses to nodejs.org.$\n$\nInstall aborted for safety. Details written to ${INSTALL_LOG}"
    Abort
  sha_ok:
  !insertmacro CCSLog "Node.js SHA256 OK"

  ; --- Step 3: Extract to $INSTDIR\resources\runtime\ ---
  !insertmacro CCSLog "Extracting Node.js runtime..."
  CreateDirectory "$INSTDIR\resources\runtime"
  ; Expand-Archive on Windows 10+ is built into PowerShell.
  ; Force overwrites if a previous extraction left orphans.
  nsExec::ExecToStack 'powershell -NoProfile -WindowStyle Hidden -Command "try { Expand-Archive -Path ''$TEMP\${NODE_ZIP}'' -DestinationPath ''$INSTDIR\resources\runtime'' -Force; exit 0 } catch { Write-Error $_.Exception.Message; exit 1 }"'
  Pop $0
  Pop $1
  IntCmp $0 0 extract_ok
    !insertmacro CCSLog "Extract FAILED (exit $0): $1"
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Couldn't extract the Node.js runtime.$\n$\nThis usually means antivirus quarantined the download or your disk is full.$\n$\nDetails written to ${INSTALL_LOG}"
    Abort
  extract_ok:

  ; Node's zip puts everything inside node-vX.Y.Z-win-x64/. Flatten so
  ; PtyManager's path resolution finds claude.cmd at runtime/ directly.
  !insertmacro CCSLog "Flattening Node directory layout..."
  nsExec::ExecToStack 'powershell -NoProfile -WindowStyle Hidden -Command "$src = ''$INSTDIR\resources\runtime\node-v${NODE_VERSION}-win-x64''; if (Test-Path $src) { Get-ChildItem -Path $src -Force | Move-Item -Destination ''$INSTDIR\resources\runtime\'' -Force; Remove-Item -Path $src -Recurse -Force }"'
  Pop $0
  Pop $1

  Delete "$TEMP\${NODE_ZIP}"
  !insertmacro CCSLog "Node.js runtime ready"

  ; --- Step 4: Install Claude Code CLI via bundled npm ---
  !insertmacro CCSLog "Installing Claude Code CLI (${CLAUDE_PKG})..."
  ; --registry pinned to npmjs.org (ignores user .npmrc per Phase 1 red-team M5).
  ; --prefix installs into the runtime dir, producing
  ;   $INSTDIR\resources\runtime\node_modules\@anthropic-ai\claude-code\
  ;   $INSTDIR\resources\runtime\claude.cmd  (the bin shim PtyManager looks for)
  ; --no-save / --no-package-lock keeps the runtime dir clean (no stray
  ; package.json modifications).
  nsExec::ExecToStack '"$INSTDIR\resources\runtime\node.exe" "$INSTDIR\resources\runtime\node_modules\npm\bin\npm-cli.js" install --prefix "$INSTDIR\resources\runtime" --registry=https://registry.npmjs.org/ --no-save --no-package-lock --no-audit --no-fund --silent ${CLAUDE_PKG}'
  Pop $0
  Pop $1
  IntCmp $0 0 npm_ok
    !insertmacro CCSLog "npm install FAILED (exit $0): $1"
    ; SOFT failure — Studio installs but no bundled CLI. The first-launch
    ; onboarding (Phase 6) detects this via `claude doctor` and offers a
    ; "Install CLI now" button using the bundled Node.
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Claude Code Studio will install, but the Claude CLI couldn't be installed automatically.$\n$\nStudio's first-launch screen can install it for you, or you can install it manually with:$\nnpm install -g @anthropic-ai/claude-code$\n$\nDetails written to ${INSTALL_LOG}"
    ; Fall through — DO NOT Abort. Soft failure.
    Goto bootstrap_done
  npm_ok:
  !insertmacro CCSLog "Claude Code CLI installed"

  bootstrap_done:
  !insertmacro CCSLog "===== Claude Code Studio bootstrap complete ====="
!macroend

; ----------------------------------------------------------------------------
; customUnInstall — clean up the bundled runtime.
;
; Without this, uninstall would orphan ~150 MB of node_modules in
; $INSTDIR\resources\runtime\.
; ----------------------------------------------------------------------------
!macro customUnInstall
  RMDir /r "$INSTDIR\resources\runtime"
!macroend
