; ============================================================================
; Catalyst UI (formerly Claude Code Studio) — NSIS bootstrap installer macros
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
; Implementation note: we use Windows-builtin tools only — no PowerShell.
; PowerShell.exe is sometimes blocked by Defender/AV during installer
; execution, which broke v2.0.0 on real users' machines. The alternatives
; ship with Windows 10 1803+ (April 2018) and are present on every
; supported Windows install:
;   - curl.exe          → downloads (TLS 1.2+ by default)
;   - tar.exe           → extracts .zip (libarchive-based, handles zip)
;   - certutil.exe      → SHA256 file hash
;   - cmd  (move/del)   → file system ops
;
; Failure behavior:
;   - Hard failures (network drop, SHA mismatch, extract fail) abort the
;     install AND embed the actual captured stderr in the user-facing
;     MessageBox so you don't need to hunt for the log file.
;   - Soft failures (CLI install fails but Node OK) install Studio anyway
;     and tell the user to install the CLI manually via the in-app
;     onboarding modal.
;
; Logging: every step DetailPrints to NSIS's install log, AND we append
; to $TEMP\ccs-install.log via a simple `>>` redirect for postmortem.
; ============================================================================

!define NODE_VERSION  "22.22.3"
!define NODE_ZIP      "node-v${NODE_VERSION}-win-x64.zip"
!define NODE_URL      "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}"
; SHA256 of node-v22.22.3-win-x64.zip from nodejs.org/dist/v22.22.3/SHASUMS256.txt
; (re-verify on each Node version bump).
!define NODE_SHA256   "6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33"

!define CLAUDE_PKG    "@anthropic-ai/claude-code"
!define INSTALL_LOG   "$TEMP\ccs-install.log"

; Cat 8 — opt-in Ollama install during the NSIS wizard. The bundled flow
; was rolled back in beta.1 because it was silent and ~2 GB; this version
; ASKS the user first via a MessageBox at the start of customInstall and
; shows progress via standard NSIS DetailPrint (no separate "is anything
; happening?" mystery). MB_YESNO is intentionally simple — a custom
; nsDialogs page would look nicer but requires hooking into a
; electron-builder-specific page-insertion macro whose name varies
; across builder versions. The MessageBox is portable across versions.
!define OLLAMA_URL    "https://ollama.com/download/OllamaSetup.exe"
!define OLLAMA_TMP    "$TEMP\OllamaSetup-ccs.exe"

; "1" if the user picked Yes on the Ollama prompt, "0" otherwise.
; Read by step 5 to decide whether to run the install.
;
; NSIS warning 6001 ("Variable not referenced or never set, wasting memory!")
; is a false positive here because the only references live inside the
; `customInstall` macro, which the script-scanner can't see at declaration
; time. electron-builder compiles with /WX (warnings-as-errors), so we
; disable just this one warning rather than the whole class.
!pragma warning disable 6001
Var OllamaWantsInstall

; ----------------------------------------------------------------------------
; Helper: log to both NSIS detail view and $TEMP\ccs-install.log.
; Uses cmd /c echo + redirect — no PowerShell needed.
; Usage: !insertmacro CCSLog "message text"
; ----------------------------------------------------------------------------
!macro CCSLog msg
  DetailPrint "${msg}"
  nsExec::Exec 'cmd /c echo [%date% %time%] ${msg} >> "${INSTALL_LOG}"'
  Pop $R9
!macroend

; ----------------------------------------------------------------------------
; customInstall — the bootstrap.
;
; Runs after electron-builder copies the app files into $INSTDIR but
; before shortcuts are created. If we Abort, the whole install rolls back.
; ----------------------------------------------------------------------------
!macro customInstall
  !insertmacro CCSLog "===== Catalyst UI bootstrap start ====="
  !insertmacro CCSLog "INSTDIR = $INSTDIR"

  ; --- Step 0 (Cat 8): Opt-in Ollama install prompt ---
  ; Ask BEFORE the bootstrap so the user understands the choice up front,
  ; not as a surprise during the install. /SD IDNO defaults to skip on
  ; silent installs (someone running with /S on CI doesn't expect a 2 GB
  ; surprise download).
  StrCpy $OllamaWantsInstall "0"
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 \
    "Install Ollama for local AI models?$\n$\n\
Catalyst UI works fully without it — Claude/Gemini/OpenAI run \
fine via the cloud. But if you want to run local models (Qwen, DeepSeek, \
Llama, etc.), Ollama is the runtime that makes that possible.$\n$\n\
Choose Yes to download + install Ollama now (~2 GB download). The app \
will work either way; you can always install Ollama later from the in-app \
Models panel.$\n$\n\
You can skip this if you only plan to use Claude or other API-based models." \
    /SD IDNO \
    IDNO ollama_choice_skip
  StrCpy $OllamaWantsInstall "1"
  !insertmacro CCSLog "User opted IN to Ollama install."
  Goto ollama_choice_done
  ollama_choice_skip:
    !insertmacro CCSLog "User skipped Ollama install (Cloud only)."
  ollama_choice_done:

  ; --- Step 1: Download Node.js portable runtime via curl ---
  !insertmacro CCSLog "Downloading Node.js ${NODE_VERSION} (~30 MB)..."
  ; curl.exe ships with Windows 10 1803+. Less commonly blocked by
  ; Defender than PowerShell.
  ;   -L      follow redirects (nodejs.org may redirect to a CDN)
  ;   -f      fail with non-zero exit on HTTP 4xx/5xx
  ;   --show-error  print error on stderr (captured by nsExec)
  ;   -o      output file
  ;   --connect-timeout 30   per-connection cap
  ;   --max-time 300         total operation cap
  nsExec::ExecToStack 'curl.exe -L -f --show-error -o "$TEMP\${NODE_ZIP}" --connect-timeout 30 --max-time 300 "${NODE_URL}"'
  Pop $0
  Pop $1
  IntCmp $0 0 download_ok
    !insertmacro CCSLog "Node.js download FAILED (curl exit $0)"
    !insertmacro CCSLog "curl error: $1"
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Couldn't download the Node.js runtime.$\n$\ncurl exit code: $0$\n$\nError details (from curl):$\n$1$\n$\nIf the error mentions SSL/TLS, certificate, or proxy, your network may be intercepting HTTPS.$\nIf it mentions 'access denied' or similar, an antivirus may be blocking the download.$\n$\nFull log: ${INSTALL_LOG}"
    Abort
  download_ok:
  !insertmacro CCSLog "Node.js download OK"

  ; --- Step 2: Verify SHA256 via certutil ---
  !insertmacro CCSLog "Verifying Node.js download integrity (SHA256)..."
  ; certutil -hashfile prints the hex hash on its own line (no spaces
  ; between bytes in Win10+). We use `findstr` to look for the expected
  ; hash literal in the output — findstr exit code is 0 when found,
  ; non-zero when not. The hash is hex-only so it's safe to use as a
  ; literal pattern (no regex special chars).
  ;
  ; cmd /c "..." with embedded quoted path: cmd strips the outer pair
  ; and runs the contents as the command. The pipe is interpreted by
  ; cmd, not by nsExec.
  nsExec::ExecToStack 'cmd /c "certutil -hashfile "$TEMP\${NODE_ZIP}" SHA256 | findstr /i ${NODE_SHA256}"'
  Pop $0
  Pop $1
  IntCmp $0 0 sha_ok
    !insertmacro CCSLog "Node.js SHA256 MISMATCH (findstr exit $0)"
    !insertmacro CCSLog "expected: ${NODE_SHA256}"
    Delete "$TEMP\${NODE_ZIP}"
    MessageBox MB_ICONSTOP|MB_OK \
      "The Node.js download failed its integrity check.$\n$\nExpected SHA256: ${NODE_SHA256}$\n$\nThis usually means a corrupted download or that something on your network is tampering with HTTPS responses to nodejs.org.$\n$\nInstall aborted for safety. Full log: ${INSTALL_LOG}"
    Abort
  sha_ok:
  !insertmacro CCSLog "Node.js SHA256 OK"

  ; --- Step 3: Extract via tar.exe ---
  !insertmacro CCSLog "Extracting Node.js runtime..."
  CreateDirectory "$INSTDIR\resources\runtime"
  ; tar.exe in Windows 10 1803+ is libarchive-based and handles .zip
  ; transparently. -x extract, -f file, -C change directory.
  nsExec::ExecToStack 'tar.exe -x -f "$TEMP\${NODE_ZIP}" -C "$INSTDIR\resources\runtime"'
  Pop $0
  Pop $1
  IntCmp $0 0 extract_ok
    !insertmacro CCSLog "Extract FAILED (tar exit $0): $1"
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Couldn't extract the Node.js runtime.$\n$\ntar exit code: $0$\n$\nError:$\n$1$\n$\nUsually means antivirus quarantined the zip or your disk is full.$\n$\nFull log: ${INSTALL_LOG}"
    Abort
  extract_ok:

  ; Node's zip puts everything inside node-vX.Y.Z-win-x64/. Flatten so
  ; PtyManager's path resolution finds claude.cmd at runtime/ directly.
  ; Plain cmd: xcopy + rmdir.
  !insertmacro CCSLog "Flattening Node directory layout..."
  nsExec::ExecToStack 'cmd /c "if exist "$INSTDIR\resources\runtime\node-v${NODE_VERSION}-win-x64" (xcopy /E /Y /Q "$INSTDIR\resources\runtime\node-v${NODE_VERSION}-win-x64\*" "$INSTDIR\resources\runtime\" && rmdir /S /Q "$INSTDIR\resources\runtime\node-v${NODE_VERSION}-win-x64")"'
  Pop $0
  Pop $1

  Delete "$TEMP\${NODE_ZIP}"
  !insertmacro CCSLog "Node.js runtime ready"

  ; --- Step 4: Install Claude Code CLI via bundled npm ---
  !insertmacro CCSLog "Installing Claude Code CLI (${CLAUDE_PKG})..."
  ; Notes on flags:
  ; --loglevel=error — quiet on success, verbose stderr on failure.
  ; --ignore-scripts — skip pre/post-install lifecycle hooks. A
  ;   transitive dep of @anthropic-ai/claude-code has a postinstall
  ;   that requires node-gyp, but Node.js's portable Windows zip ships
  ;   npm WITHOUT the node-gyp/bin/node-gyp.js entry point that npm's
  ;   internal @npmcli/run-script tries to require. With --ignore-
  ;   scripts npm doesn't try to run any postinstall, so node-gyp is
  ;   never needed. Claude Code CLI itself is JS-only and works fine
  ;   without lifecycle scripts; transitive native builds that ARE
  ;   needed at runtime ship as prebuilds via node-gyp-build or
  ;   prebuild-install (those don't run as lifecycle scripts).
  nsExec::ExecToStack '"$INSTDIR\resources\runtime\node.exe" "$INSTDIR\resources\runtime\node_modules\npm\bin\npm-cli.js" install --prefix "$INSTDIR\resources\runtime" --registry=https://registry.npmjs.org/ --no-save --no-package-lock --no-audit --no-fund --ignore-scripts --loglevel=error ${CLAUDE_PKG}'
  Pop $0
  Pop $1
  IntCmp $0 0 npm_ok
    !insertmacro CCSLog "npm install FAILED (exit $0): $1"
    ; SOFT failure — Studio installs but no bundled CLI. The first-launch
    ; onboarding modal detects this via `claude doctor` and offers
    ; "Install Claude CLI" using the bundled Node.
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Catalyst UI will install, but the Claude CLI couldn't be installed automatically.$\n$\nnpm exit code: $0$\nError: $1$\n$\nThe app's first-launch screen has an 'Install Claude CLI' button that retries this. Or install manually:$\nnpm install -g @anthropic-ai/claude-code$\n$\nFull log: ${INSTALL_LOG}"
    Goto bootstrap_done
  npm_ok:
  !insertmacro CCSLog "Claude Code CLI installed"

  ; --- Step 5: Ollama detection + optional install (Cat 8) ---
  ;
  ; History: beta.1 bundled the Ollama install unconditionally (~2 GB
  ; surprise download, silent, no progress). Rolled back post-beta.1
  ; to detection-only. Cat 8 restores the install path but ONLY when
  ; the user explicitly opted in via the Step 0 MessageBox. So:
  ;   - $OllamaWantsInstall = "1" AND Ollama not detected → download + install.
  ;   - $OllamaWantsInstall = "0" → detection only (legacy behavior).
  ;   - $OllamaWantsInstall = "1" AND Ollama already present → log + skip.
  ;
  ; In-app ModelsPanel still surfaces the "Install Ollama" link as a
  ; fallback when local models are pulled later without Ollama present.
  !insertmacro CCSLog "Probing for Ollama..."
  IfFileExists "$LOCALAPPDATA\Programs\Ollama\ollama.exe" ollama_present 0
  IfFileExists "$PROGRAMFILES\Ollama\ollama.exe" ollama_present 0
  IfFileExists "$PROGRAMFILES64\Ollama\ollama.exe" ollama_present 0

  ; Not present — branch on the opt-in flag.
  StrCmp $OllamaWantsInstall "1" ollama_do_install ollama_skip_install

  ollama_present:
    !insertmacro CCSLog "Ollama detected — local-model catalog ready immediately"
    Goto bootstrap_done

  ollama_skip_install:
    !insertmacro CCSLog "Ollama not present — user opted out at install time"
    Goto bootstrap_done

  ollama_do_install:
    ; Download OllamaSetup.exe via curl. Same pattern as Step 1's Node fetch.
    !insertmacro CCSLog "Downloading Ollama (~2 GB) — user opted in..."
    nsExec::ExecToStack 'curl.exe -L -f --show-error -o "${OLLAMA_TMP}" --connect-timeout 30 --max-time 1800 "${OLLAMA_URL}"'
    Pop $0
    Pop $1
    IntCmp $0 0 ollama_dl_ok
      !insertmacro CCSLog "Ollama download FAILED (curl exit $0): $1"
      ; SOFT failure — Studio installs anyway, in-app ModelsPanel surfaces
      ; the install link as a fallback.
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "The Ollama installer download failed.$\n$\ncurl exit code: $0$\nError: $1$\n$\nCatalyst UI will install without it. You can install Ollama later from inside the app's Models panel.$\n$\nFull log: ${INSTALL_LOG}"
      Goto bootstrap_done
    ollama_dl_ok:

    !insertmacro CCSLog "Running OllamaSetup.exe..."
    ; /SILENT runs the Ollama installer without user UI; /NORESTART
    ; prevents an unexpected reboot mid-flow. Ollama's installer accepts
    ; both flags (Inno Setup conventions).
    nsExec::ExecToStack '"${OLLAMA_TMP}" /SILENT /NORESTART'
    Pop $0
    Pop $1
    Delete "${OLLAMA_TMP}"
    IntCmp $0 0 ollama_install_ok
      !insertmacro CCSLog "Ollama installer exited with $0: $1"
      ; SOFT failure again — don't abort our install on a third-party tool's hiccup.
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "The Ollama installer didn't complete cleanly (exit $0).$\n$\nCatalyst UI will install regardless. You can rerun the Ollama installer from inside the app's Models panel.$\n$\nFull log: ${INSTALL_LOG}"
      Goto bootstrap_done
    ollama_install_ok:
    !insertmacro CCSLog "Ollama installed successfully."

  bootstrap_done:
  !insertmacro CCSLog "===== Catalyst UI bootstrap complete ====="
!macroend

; ----------------------------------------------------------------------------
; customUnInstall — clean up the bundled runtime + (optionally) user data.
;
; Without this, uninstall would orphan ~150 MB of node_modules in
; $INSTDIR\resources\runtime\.
;
; 3.0.0-beta.3 — also prompts to remove the user-data JSON files we wrote
; under %APPDATA%\Claude Code Studio. NSIS's electron-builder uninstaller
; never touches those by default (they're outside $INSTDIR), so an
; uninstall-then-reinstall used to leave the user's old settings,
; registries, debug logs, etc. floating around. Now we ask once at
; uninstall time and (if confirmed) wipe them too. The Chromium profile
; dirs (Cache, Local Storage, etc.) are left alone — they're rebuilt on
; first launch and have nothing the user needs to lose.
; ----------------------------------------------------------------------------
!macro customUnInstall
  ; Step 1 — the bundled Node + Claude CLI runtime.
  RMDir /r "$INSTDIR\resources\runtime"

  ; Step 2 — prompt for user data wipe. MB_YESNO returns IDYES (6) on yes.
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 \
    "Also remove your Catalyst UI settings, history, model registry, debug logs, and other JSON state?$\n$\nThese files live under %APPDATA%\Claude Code Studio\ (the original user-data directory we preserved across the rename) and are written by the app itself (not the installer). Choose Yes to wipe them, No to keep them for a future reinstall.$\n$\nThe Claude CLI's own data (~\.claude\), the Ollama install, and any pulled models are NEVER touched here." \
    /SD IDNO \
    IDNO skip_userdata

  ; Wipe each of the files Studio writes. Listed explicitly rather than
  ; nuking the whole %APPDATA%\Claude Code Studio\ folder so we don't
  ; accidentally delete Chromium profile state (Cache/, Local Storage/,
  ; etc.) which lives in the same dir and is harmless to keep.
  Delete "$APPDATA\Claude Code Studio\session.json"
  Delete "$APPDATA\Claude Code Studio\cost-history.json"
  Delete "$APPDATA\Claude Code Studio\cost-settings.json"
  Delete "$APPDATA\Claude Code Studio\github-auth.json"
  Delete "$APPDATA\Claude Code Studio\cloud-sync-settings.json"
  Delete "$APPDATA\Claude Code Studio\cli-onboarding.json"
  Delete "$APPDATA\Claude Code Studio\cli-flags.json"
  Delete "$APPDATA\Claude Code Studio\hotkeys.json"
  Delete "$APPDATA\Claude Code Studio\tray-settings.json"
  Delete "$APPDATA\Claude Code Studio\notif-settings.json"
  Delete "$APPDATA\Claude Code Studio\snippets.json"
  Delete "$APPDATA\Claude Code Studio\lmm-settings.json"
  Delete "$APPDATA\Claude Code Studio\updater-settings.json"
  Delete "$APPDATA\Claude Code Studio\model-registry.json"
  Delete "$APPDATA\Claude Code Studio\models-onboarding.json"
  Delete "$APPDATA\Claude Code Studio\recent-projects.json"
  Delete "$APPDATA\Claude Code Studio\debug-dump.jsonl"
  RMDir /r "$APPDATA\Claude Code Studio\lmm-journal"

  skip_userdata:
!macroend
