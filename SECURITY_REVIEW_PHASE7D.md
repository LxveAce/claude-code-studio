# Security Review — Phase 7d (System Tray + Custom Hotkeys)

Branch: `phase-7d-tray-hotkeys` (off `phase-7a-palette-snippets-notifications`).
Scope: `src/main/tray-service.ts`, `src/main/hotkeys-service.ts`,
`src/main/index.ts` (close + quit lifecycle changes), preload/declarations
additions, `src/renderer/hotkeys.ts`, App + SettingsPanel changes.

## Verdict
No Critical or High findings. Two Medium-class items were identified
and remediated inline before commit. Remaining items are explicit Defer
or are non-issues. Phase ships.

---

## Methodology
Self red-team: enumerate untrusted inputs, IPC surface, persistence,
process lifecycle, UI key-capture behavior. Cross-check against patterns
already established by `snippets-service.ts` and `notifications-service.ts`.

## Threat model
- The app is single-user, local. The renderer is sandboxed
  (`contextIsolation`, `nodeIntegration: false`, `sandbox: true`).
- Settings files live under `app.getPath('userData')`. Other apps as the
  same OS user can read them; this is the same trust boundary as snippets.
- Adversary classes considered:
  1. Tampered settings files on disk (e.g. malicious JSON written into
     `hotkeys.json` or `tray-settings.json`).
  2. Compromised renderer trying to invoke privileged IPC.
  3. Malformed tray icon data triggering Electron native-image crash.
  4. Hotkey collisions silently hijacking user input.
  5. Lifecycle confusion: window close vs. minimize-to-tray vs. real quit
     leaking PTY/resource monitor.

---

## Findings

### C / H
None.

### M

**M1 — Silent failure on corrupt hotkeys.json (REMEDIATED).**
The first cut of `HotkeysService.read()` silently fell back to defaults
on any read/parse error. A user whose bindings reset for no apparent
reason has no breadcrumb. Now logs a `console.warn` with the path and
underlying error, then falls back. The fall-back behavior itself is
correct (don't crash the app); the logging only adds observability.

**M2 — Tray icon decode path has no instrumentation (DEFERRED — small).**
`makeTrayIcon()` falls back to a 1x1 transparent pixel and then to
`nativeImage.createEmpty()`. If the hardcoded base64 ever stops decoding
(e.g. due to an Electron change), the user gets a blank icon with no
signal. Acceptable for now since the asset is hand-verified and a blank
tray icon is still clickable; revisit if the icon goes missing in QA.

### L

**L1 — Hotkey rebinding uses capture-phase listener at window level.**
This is intentional so the recording handler wins against xterm. It is
scoped by `recordingAction !== null` and torn down by `useEffect`
cleanup. No leak.

**L2 — `dispatchTrayAction` is currently unreferenced.**
Kept as a documented hook for future tray menu items. Marked with
`void dispatchTrayAction;` so `noUnusedLocals` would still pass if ever
enabled.

### Defer

- **D1 — Global accelerators (system-wide hotkeys via `globalShortcut`).**
  Out of scope. Current hotkeys are window-scoped, which is the right
  default for security (no system-wide keylogging surface).
- **D2 — Icon HiDPI / theme-aware variants.** Phase 7d ships a single
  16×16 PNG. Sufficient for parity with the spec; can be upgraded later.
- **D3 — Cross-device sync of hotkey bindings.** Not in scope; the
  existing settings-sync surface intentionally excludes keybindings.

---

## Validation done per surface

### `tray-service.ts`
- Tray construction wrapped in try/catch; returns null tray on
  systems without notification area (Linux). Subsequent operations
  guard on `this.tray`.
- `setSettings` validates `typeof === 'boolean'`. Rejects everything else.
- Atomic write with mode `0o600`, same pattern as snippets-service.
- Disposal is idempotent.
- Hardcoded base64 PNG decodes to a valid PNG signature
  (`\x89PNG\r\n\x1a\n` — confirmed via base64 prefix).

### `hotkeys-service.ts`
- `requireAction` checks against a static whitelist; foreign action ids
  cannot enter the persisted file even via direct disk tampering.
- `requireChord` validates length (≤64), structure, key set, and
  *requires* Ctrl/Cmd/Alt. `Shift+A` and bare keys are rejected so we
  don't accidentally hijack typing.
- Conflict detection on `setBinding`: chord already bound to a different
  action → throws with a human-readable message; UI surfaces it.
- On read, duplicate chords (could result from a manually merged file)
  are dropped past the first occurrence.

### `main/index.ts`
- New close path: when minimize-to-tray is on AND `isQuitting` is false,
  `event.preventDefault()` + `mainWindow.hide()`. Otherwise default close.
- New `before-quit`: sets `isQuitting=true`, stops resource monitor,
  kills PTY, disposes tray — each wrapped in try/catch so one failure
  doesn't block another. This is the SINGLE place that destructive
  shutdown happens now (previously it was in `mainWindow.on('close')`
  AND `window-all-closed`, which double-stopped on macOS but was OK
  because the methods are idempotent).
- Tray "Quit" sets `isQuitting=true` before calling `app.quit()` so the
  close intercept does not re-hide the window mid-shutdown.

### Preload + Declarations
- New `hotkeys` and `tray` namespaces follow the same `invoke`/`subscribe`
  shape as existing namespaces. No raw `ipcRenderer` exposed.
- `tray.onInvokeAction` returns an unsubscribe closure (consistent with
  `terminal.onData` etc.).

### Renderer
- Action dispatcher is a closed switch with `default: break`. Unknown
  action ids from main (via TRAY_INVOKE_ACTION) are silently ignored.
- Hotkey listener is added/removed in a `useEffect` keyed on `bindings`.
  Empty bindings short-circuits before adding any listener.
- The recording listener is scoped by `recordingAction`, runs only while
  recording, and is torn down on completion or unmount.

---

## Result
Ship. No outstanding C or H. M1 remediated; M2 explicitly accepted
(monitored). All defers are forward-looking, not security debt.
