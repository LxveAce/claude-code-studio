# Security & Correctness Review — Phase 7a (Command Palette + Snippets + Notifications)

> Reviewed: 2026-05-21 · Branch: phase-7a-palette-snippets-notifications · Reviewer: red-team agent

## Summary

Phase 7a is a UX-surface phase, not a data-handling phase. Snippets are local-only (not synced — confirmed by `SyncedSettings` in `src/shared/types.ts:237-246`), notifications are an Electron `Notification` wrapper, and the palette is a renderer-side action dispatcher. There are no remote-attacker paths and no exploit that exfiltrates data on a default config. The most interesting findings are operational: a documented UX promise ("you press Enter to submit") that is violated by snippets containing `\r`, a self-throttling notification surface that silently drops sync-error notifications when a PTY exit happened within the prior second, and an `Enter`-key handler scoped to `window` that fires the palette's active action even when other globally-listening surfaces are added later. Nothing requires immediate remediation; all findings are in the High/Medium/Low range.

## Critical

_None._ Snippets are local-only and never traverse the network; notification content is OS-rendered plain text; the palette can only invoke renderer-side handlers that already existed. The PAT, vault contents, auth credentials, and remote sync state are unchanged by Phase 7a.

## High

### [H1] Snippet help text lies: a snippet body containing `\r` auto-submits on insert, contradicting the in-UI promise

**Where:** `src/renderer/components/palette/SnippetEditorModal.tsx:112` (label says "Inserted as plain text — you press Enter to submit") and `src/renderer/App.tsx:40-44` (`handleSendToTerminal(text, submit)` — palette passes `submit=false` from `CommandPalette.tsx:93`).

**Issue:** The renderer treats "submit=false" as "the snippet body bytes are sent verbatim, with no trailing `\r`." But the body itself can contain `\r` characters — either typed via newline (some editor configurations / paste from Windows clipboard normalize CRLF), or pasted in literally (the `<textarea>` accepts any char). When the snippet is "inserted," each `\r` byte is passed to `ptyManager.write(data)` (`src/main/index.ts:136-138`), which forwards them to the PTY. Claude's interactive prompt treats `\r` as submit. Consequence: a snippet whose body is a multi-paragraph prompt with embedded CRs auto-submits the first paragraph as soon as the first `\r` is seen, then the remainder is typed into a fresh prompt — possibly auto-submitting parts of it too.

The UI's reassurance ("you press Enter to submit. Max 64 KB.") trains the user to expect a deterministic two-step flow (insert → review → press Enter). The actual behavior depends on whatever line-ending convention happened to land in the snippet body. Most users will never realize this until a snippet "fires early" and they wonder why Claude jumped on a half-prompt.

**Exploit/scenario:** User saves a snippet by pasting from a Windows-native editor (CRLF line endings normalized to CR-only on some clipboard paths). Snippet body is now `paragraph 1\rparagraph 2\rparagraph 3`. User invokes from palette → first `\r` submits paragraph 1 immediately; paragraph 2 and 3 become input to a new turn. Not exploitable by a remote attacker, but a real footgun and a violation of the displayed contract. Bigger downside: if the snippet body contains `--dangerously-skip-permissions` or `/bash <cmd>` after a `\r`, the user has no chance to review before the prefix submits.

**Fix:** Either (a) strip/normalize all `\r` (and `\r\n` → `\n`, or just drop CRs) in `requireBody` at save time and in the render-side insert path; (b) honor the promise by replacing `\r` with a visible escape on insert; or (c) remove the misleading help text and prominently warn "snippet bodies may submit if they contain newlines." Option (a) is the simplest and matches the displayed contract.

---

### [H2] Notifications throttle silently swallows sync-error notifications behind a recent PTY exit (or vice versa)

**Where:** `src/main/notifications-service.ts:85-99` — `private show()` returns early when `now - this.lastShownAt < MIN_INTERVAL_MS` (1000 ms).

**Issue:** The 1-second throttle is shared across ALL notification kinds (PTY exit, sync error, fire-test). There is no queue and no per-channel cooldown. When a PTY exit fires a notification at `t=0ms`, a vault sync error arriving at `t=300ms` is silently dropped. The user is never told. Specifically: cloud-sync's `syncNow` fires `this.onSyncError(this.lastError)` at the end of every failed run (`src/main/cloud-sync.ts:362-368`). If the user's previous Claude session crashed (PTY exit notification fires at t=0), and the watcher debounce was already armed to fire the post-sync at t=500ms with a 403 from GitHub, the user gets the "exited" toast but never sees "vault sync error." The most actionable failure mode (sync broken) is the one most likely to be hidden.

This is also order-dependent and racy: whichever event happens to win the 1-second slot wins, and the loss is invisible. There's no log line either — `show()` just returns.

**Exploit/scenario:** User restarts via palette ("Terminal: restart" — see `CommandPalette.tsx:117-125`). This kills+respawns the PTY (`src/main/index.ts:144-147`). PTY emits `exit` → `notifyPtyExit` fires → notification shown at t=0. Simultaneously, compact-controller had flushed a vault that the watcher debounced; sync now runs and fails (e.g., PAT scope problem). `onSyncError` at t=400ms → throttled, dropped. User sees "Claude exited" (which they caused on purpose) and never learns sync is broken until the next sync error (which may not arrive for hours, especially if no new vaults land).

**Fix:** Either (a) maintain a tiny FIFO and re-show on the next tick, (b) per-kind throttle (one bucket for PTY, one for sync, one for test), or (c) drop the throttle entirely and rely on per-event gating (sync errors are 1-per-`syncNow` already, and PTY exits are 1-per-spawn — natural rate-limit). Option (b) is the right shape for v1.

---

### [H3] Palette-initiated terminal restart raises an unwanted "Claude exited" notification

**Where:** `src/renderer/components/palette/CommandPalette.tsx:117-125` (palette action) + `src/main/index.ts:122-129` (PTY `exit` handler unconditionally calls `notifyPtyExit`).

**Issue:** The palette exposes "Terminal: restart" — explicitly user-initiated. The handler in main fires `notifyPtyExit(code)` on **every** exit event, including those caused by `ipcMain.on(IPC.TERMINAL_RESTART, ...)` which we just sent ourselves seconds ago. The user gets an OS notification ("Claude Code exited") for an action they intentionally took.

This is worse than just "annoying": users are conditioned to believe notifications mean unsolicited events. Falsely flagging user-initiated restarts as exits dilutes the signal of the genuinely unsolicited PTY death notification — exactly the thing the toggle is for.

**Exploit/scenario:** User invokes "Terminal: restart" three times in 10 seconds to recover from a hang. Gets three OS notifications. Most are throttled (see H2), but the first one fires. Notification feels broken / spammy. User disables notifications globally to make it stop, losing the genuine-exit alert.

**Fix:** When `ipcMain.on(IPC.TERMINAL_RESTART)` fires, set a flag (`expectedExit = true`); in the PTY exit handler, if `expectedExit` is set, clear it and skip `notifyPtyExit`. Or: pass an opt-in `silent` flag through to `ptyManager.kill()` and check it in the exit handler.

---

## Medium

### [M1] `CommandPalette` keydown effect re-registers on every render (deps include `visible`, a new array each render)

**Where:** `src/renderer/components/palette/CommandPalette.tsx:158-180` — `useEffect(..., [open, visible, activeIdx])`. `visible` is computed as `filtered.slice(0, 50)` (line 152), a fresh array reference each render.

**Issue:** Every keystroke into the palette input (a) re-runs the `useMemo` for `filtered` (deps `[actions, query]`), (b) yields a new `visible` slice, (c) re-renders CommandPalette, (d) the `useEffect` sees a new `visible` dep, (e) removes the prior `keydown` listener and adds a fresh one. This is `addEventListener`+`removeEventListener` thrash on every keystroke, every arrow-key, every hover (since `onMouseMove → setActiveIdx`).

There is no functional bug today — `removeEventListener` is paired correctly, and the latest handler reads the latest closure. But this is a small but constant DOM workload, and worse, it is a footgun: any future change that forgets the cleanup, or any rapid succession of effect re-runs that races browser microtask scheduling, can leak handlers. It also makes "is there a stale listener registered?" hard to reason about during debugging.

**Exploit/scenario:** Not exploitable. But: if a future contributor wraps the handler in `useCallback` while forgetting to update the deps, or attaches a transitive piece of state to the closure, the symptom (intermittent missed Enters) will be very hard to bisect.

**Fix:** Move the keydown logic into a ref-stable handler. Either (a) `useEffect(..., [open])` only, and read `visible`/`activeIdx` via refs that you keep in sync via separate effects, or (b) split into a stable handler that reads from refs. The clean shape is `const visibleRef = useRef(visible); useEffect(() => { visibleRef.current = visible; }); useEffect(() => { /* register once per open */ }, [open]);`.

---

### [M2] `Enter` and Arrow keys captured at `window` level — palette will steal Enter from any other globally-listening surface added later

**Where:** `src/renderer/components/palette/CommandPalette.tsx:160-180` registers `Escape`, `ArrowDown`, `ArrowUp`, `Enter` on `window`.

**Issue:** When the palette is open, these keys are claimed at the top level and `preventDefault`'d. Today the only globally-listening surface is the App's Ctrl+Shift+P handler (`src/renderer/App.tsx:51-63`), which doesn't conflict. But this pattern means:

1. Pressing `Enter` anywhere — including on a non-palette modal or dialog that happens to be open behind the palette (e.g., `window.confirm` in `SnippetEditorModal.tsx:35`) — will trigger the palette's active-action `runAction`. Today the snippet editor modal renders at `z-index: 1100` on top of the palette at `z-index: 1000`, but the editor doesn't open over an active palette (the palette closes when editor opens via `onClose` cascade from `runAction`). Still, anything else added later (a global toast, an auto-update dialog) that needs Enter will collide.

2. The handler fires regardless of `e.defaultPrevented`. Stacked listeners that already consumed the event still see the palette react.

3. Mac users with `Cmd+Enter` in some keyboard layouts may have unexpected behavior — the handler matches `e.key === 'Enter'` with no modifier check.

**Exploit/scenario:** Future phase adds a "save now" toast that listens for Enter to confirm. Palette is open behind it. User presses Enter — the action *behind* the toast fires (palette runs its active action), not the visible toast's. Confusing and hard to diagnose.

**Fix:** Either (a) scope the keydown to the palette's container div via `onKeyDown` on the input/list, not `window`; (b) check `document.activeElement` before reacting (only react if focus is in the palette); or (c) check `e.defaultPrevented` and bail.

---

### [M3] `snippets-service.read()` silently discards invalid records — inconsistent with cloud-sync's "loud refuse" pattern

**Where:** `src/main/snippets-service.ts:125-138` — invalid records are silently skipped (no log, no UI signal); `cloud-sync.ts:574-579` throws on bad JSON ("Refusing to use… Fix or delete to restore defaults").

**Issue:** Snippets storage silently discards any record that fails any of: missing/empty id, non-string name, non-string body, oversize body, oversize name. There is no warning surfaced to the user — the snippet just disappears from the list. If the user hand-edits the file (or a sync tool corrupts a single record), they will lose snippets silently. Worse: the `read()` path also returns `{ snippets: [] }` (line 122/124) for any non-object/non-array root, masking total corruption.

This is inconsistent with the rest of the codebase: `cloud-sync.ts:574` and `snippets-service.ts:117-120` (the JSON-parse error case) both `throw` with "Refusing to use…" messages. Only the per-record validation in `read()` is silent.

**Exploit/scenario:** Local-only. User notices "snippet vanished" after a sync issue. No log, no UI banner. Hard to debug.

**Fix:** Two reasonable options: (a) keep silent skip but log to `console.warn` so the dev console shows it, and add a "X snippets were invalid and skipped" UI banner; or (b) move closer to cloud-sync's pattern — if ANY record fails validation, throw with the offending record identifier so the user can fix it.

---

### [M4] `Notifications.fireTest()` ignores both `enabled` AND per-event flags by design — invocable from the palette even with notifications disabled

**Where:** `src/main/notifications-service.ts:73-81` (intentionally ignores `enabled`); palette exposes "Notifications: send test" with no preflight (`src/renderer/components/palette/CommandPalette.tsx:127-135`).

**Issue:** This is documented as intentional ("Manual smoke-test fired from the settings UI. Ignores enabled flag.") so the user can prove notifications work before enabling them. But the SettingsPanel only renders the "Send test" button when `notifSupported && notif !== null` (`SettingsPanel.tsx:180-194`) — it's contextualized inside the Notifications block. The palette has no such context. From the palette, "Notifications: send test" is just another action, invokable from any panel, with no preflight check of `notifications.supported()`. On a system where notifications are blocked at the OS level, the test will silently no-op (`show()` returns early when `!isSupported()`). User sees no notification, doesn't know whether the toggle is off, OS-blocked, throttled, or genuinely broken.

Also: bypassing `enabled` via the palette undermines the toggle as a quiet-hours / "stop bothering me" control. A user who turned notifications off can be surprised by a stray test notification if they fat-finger the palette action.

**Exploit/scenario:** No security exploit. UX-only: user disables notifications, later accidentally triggers the palette's "Notifications: send test" (it scores against the query `notif`), and gets a toast they thought they had silenced.

**Fix:** Either (a) make the palette action respect `enabled` (return early if disabled, with a console warning), (b) gate the action item out of the palette when `enabled === false`, or (c) make `fireTest` return a structured result that distinguishes "fired", "OS-not-supported", "throttled" so the palette can show a follow-up toast if needed.

---

### [M5] `SettingsPanel.updateNotif` swallows IPC errors, leaves toggle UI in inconsistent state

**Where:** `src/renderer/components/settings/SettingsPanel.tsx:36-39`.

**Issue:** `const next = await window.electronAPI.notifications.setSettings(patch); setNotif(next);` — if `setSettings` throws (e.g., disk full, EACCES on the settings file, or `setSettings(partial)` rejects a bad type that somehow slipped through), the promise rejects with no `try/catch`. The toggle reverts to whatever React last rendered (the old value), but the user has no feedback. Worse: the click handlers are `() => void updateNotif(...)`, so the rejection becomes an unhandled promise rejection — only visible in the dev console.

There is no error state in `SettingsPanel` for notifications (compare with `SnippetEditorModal.tsx:14` which has an `err` state). Users see a non-responsive toggle and no clue why.

**Exploit/scenario:** Local-only, low-severity. Settings dir is read-only, or user has hit a disk-quota; toggle clicks do nothing; user thinks the app is broken.

**Fix:** Add `try/catch` around the `await`; on failure, set an error state and render a small banner ("Couldn't save notification settings: …"). Pattern matches `SnippetEditorModal`.

---

### [M6] Palette's `Ctrl+Shift+P` handler matches `e.key === 'P' || 'p'` — dead-code redundancy hides a layout-sensitivity question

**Where:** `src/renderer/App.tsx:54` — `if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p'))`.

**Issue:** With `shiftKey` true on a layout where unshifted P is `p`, the browser reports `e.key === 'P'` (uppercased by the modifier). The `|| e.key === 'p'` branch never fires under normal conditions. It's not a bug — just dead code that suggests the author wasn't sure of the contract. The real question the redundancy papers over: on non-Latin layouts (e.g., a Cyrillic layout where the physical key under "P" produces "З"), `e.key` is `З`/`з`, not `P`. The handler does NOT fire. The shortcut becomes invisible on those layouts with no fallback.

Use `e.code === 'KeyP'` (physical key, layout-independent) plus the modifiers for a proper global accelerator. xterm.js, for what it's worth, also uses `code` for chord detection.

**Exploit/scenario:** Non-US-layout users cannot open the palette via the documented shortcut. The Settings panel's "Shortcuts" row (`SettingsPanel.tsx:209`) advertises `Ctrl+Shift+P` regardless of layout.

**Fix:** `if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyP')`. Drop the `e.key` checks entirely.

---

### [M7] `SnippetEditorModal` can set state after unmount when backdrop is clicked mid-save

**Where:** `src/renderer/components/palette/SnippetEditorModal.tsx:16-31, 49-50`.

**Issue:** The backdrop has `onClick={onClose}` (line 50). The parent's `onClose` (`CommandPalette.tsx:289-293`) calls `setEditorOpen(null)`, unmounting the modal. If the user clicks Save and then clicks backdrop while the IPC call is in flight, `handleSave`'s `await` resolves on an unmounted component. The subsequent `setBusy(false)`, `setErr(...)`, or `onSaved()` calls fire on a stale closure. React 18 generally tolerates this silently but logs warnings; React 19 may behave differently. More importantly: a successful save still calls `onSaved()` → `refreshSnippets()` on the parent (which IS mounted) — that's fine. But on save FAILURE, `setErr(...)` runs on a dead component and the user never sees the error, so they may think the snippet saved.

Also: `handleDelete` has the same pattern — backdrop click during delete confirmation → modal unmounts → delete IPC resolves → no feedback.

**Exploit/scenario:** Local-only. User saves a snippet, accidentally clicks backdrop, save fails server-side, no feedback. User believes snippet was saved; it wasn't.

**Fix:** Track an `isMountedRef` and short-circuit setState after unmount, OR disable the backdrop-click-to-close while `busy === true`. The latter is simpler and matches the disabled Cancel button (line 133).

---

### [M8] `SnippetEditorModal` onClose comment claims it "re-opens the palette" but the code does nothing

**Where:** `src/renderer/components/palette/CommandPalette.tsx:289-293`.

**Issue:**
```ts
onClose={() => {
  setEditorOpen(null);
  // re-open the palette so the user can keep going
  if (!open) return;
}}
```
The comment promises a behavior the code does not perform. `if (!open) return;` is a no-op early-return that does nothing useful. There is no `setPaletteOpen(true)` (and from `CommandPalette` there's no way to set it — that state lives in `App.tsx`). After closing the editor (via Cancel or backdrop), if the palette was previously closed (because `runAction` called `onClose()` to close it before opening the editor), the user is dumped back to the previous panel with no palette and no editor — they have to press Ctrl+Shift+P again.

Either the comment lies or the feature is missing. Either way, future maintainers will look at this and either (a) try to "fix" it by adding state-thread-through they don't need or (b) be misled about the intended UX.

**Exploit/scenario:** None. UX-only.

**Fix:** Remove the misleading comment AND the dead `if (!open) return;` line, OR plumb a `onReopen` callback from App.tsx and actually re-open the palette as the comment promises.

---

## Low

### [L1] Palette theme apply does not refresh `SettingsPanel.activeTheme` indicator

**Where:** `src/renderer/components/settings/SettingsPanel.tsx:13, 18-29`.

**Issue:** Confirmed by review prompt. SettingsPanel reads the theme from `localStorage` exactly once on mount. If the user applies a theme via the palette while SettingsPanel is already mounted, the check-mark indicator on the active theme button does not update — even though the CSS variables (and thus the rest of the UI) do. Cosmetic. Listen on a `storage` event or expose a tiny event bus to keep the panel in sync.

---

### [L2] Snippets are stored with `mode: 0o600` which is effectively ignored on Windows NTFS

**Where:** `src/main/snippets-service.ts:145`.

**Issue:** The `mode: 0o600` argument to `writeFileSync` is honored on POSIX but largely ignored on Windows — the resulting file inherits the parent directory's ACL. On a standard Windows user profile this means user-readable, which matches intent, but the explicit mode gives a false sense of "the file is locked down to me." If userData ends up on a shared drive or a profile with non-default ACLs (rare but possible in corporate environments), snippets could be readable by other users on the box.

Snippet bodies often contain sensitive prompt phrasing (API keys, internal URLs, customer names that the user templated in). The privacy contract is "this stays on my machine." The mode-bits don't enforce that on Windows.

**Fix:** Document that mode bits are POSIX-only, or use `fs.chmod` + a Windows-ACL helper (`@xinix-technology/win-acl` or shelling to `icacls`). Most practical: just document it.

---

### [L3] `notifications-service.ts` `read()` silently falls back to DEFAULTS on JSON-parse error

**Where:** `src/main/notifications-service.ts:117-120`.

**Issue:** Unlike `snippets-service.ts:117-120` or `cloud-sync.ts:574-579`, which `throw` with a "Refusing to use" message on JSON parse failure, `notifications-service.ts` silently swallows the parse error and resets to defaults. If a user has gone to the trouble of disabling sync-error notifications and then their settings file gets corrupted, the next launch silently re-enables them with no warning. Low risk (these defaults are reasonable) but inconsistent.

**Fix:** Match the pattern from the other services — log a `console.warn` and ideally throw with a "Fix or delete to restore defaults" message.

---

### [L4] `Notification.body` can echo Octokit error strings that include API URLs and HTTP status fragments

**Where:** `src/main/cloud-sync.ts:347-356, 362-368` → `notifications-service.ts:65-71`.

**Issue:** `perFileErrors.join('; ')` is built from `${v.name}: ${err.message}` where `err.message` is whatever Octokit threw — typically `"HttpError: ... [...]/repos/owner/repo/contents/devicename/vault-X.json - 422"`. That string is fed to the OS notification body, truncated to 200 chars. On a screen-shared call or screenshot, the user's GitHub login + repo name + device name appear in the corner OS notification. The user owns this data and configured the repo themselves, so it's not a privacy breach against the user, but it can leak to whoever they're sharing screens with. Same shape as the prior Phase-6 M7 finding, just exposed via a new surface (OS notifications) that's harder to censor than an in-app banner.

**Fix:** In `notifySyncError`, normalize the message to a generic "Vault sync failed (N files). Open Sync panel for details." Leave the full message in `lastError` for in-app inspection.

---

### [L5] `snippets-service.findIndexOrNull` re-validates `typeof id !== 'string'` even though the public methods type it as `string`

**Where:** `src/main/snippets-service.ts:98-102`.

**Issue:** Defensive belt-and-braces. `update(id: string, …)` and `delete(id: string)` are typed to receive `string` (and validated in the preload bridge that types them), but `findIndexOrNull` still guards against non-string. This is fine — the renderer is the trust boundary — but it's notable that `update` calls `findIndex` (line 51) which throws "Snippet not found: ${id}" if `id` is non-string (the inner `findIndexOrNull` returns null, then `findIndex` throws). The error message embeds the user-supplied `id`, which could be a giant object stringified. Low impact.

**Fix:** Add a top-of-method `if (typeof id !== 'string') throw new Error('id must be a string')` in `update` and `delete`.

---

### [L6] `CommandPalette.onSendToTerminal` switches to Terminal panel after insert, even when the user invoked the palette from inside Terminal

**Where:** `src/renderer/components/palette/CommandPalette.tsx:92-96`.

**Issue:** Calling `onSwitchPanel('terminal')` after the insert is harmless if the user was already on Terminal (the App.tsx setter is a no-op for same value), but if a right-panel was open, it closes (via App's `showRightPanel = activePanel !== 'terminal'`). The user invoked the palette from inside, say, the Sync panel — they probably wanted to read the snippet result, not close the panel they were reading. The palette assumes "insert means you want to go look at the terminal," which is a reasonable default but not always right.

**Fix:** Don't auto-switch. The user can use the panel switch palette action if they want.

---

### [L7] Snippets list re-fetched in full every time palette opens, even if cached locally

**Where:** `src/renderer/components/palette/CommandPalette.tsx:38-44, 46-54`.

**Issue:** `refreshSnippets` runs on every `open === true` transition (and after save). With 500 snippets at 64KB each, the IPC payload can theoretically reach ~32MB. In practice users have a handful of small snippets, so this is fine — but worth noting if snippet usage grows. Also: if the user opens/closes the palette rapidly (Ctrl+Shift+P chord-spamming), each open spawns an unawaited refresh; rapid opens result in racing `setSnippets` calls. The last one wins, but ordering is not guaranteed — usually fine since the underlying data is the same.

**Fix:** Cache the snippet list at the App level (or in a context) and invalidate on mutations. v1-acceptable as-is.

---

### [L8] Palette `Enter` handler fires the active action even if `visible[activeIdx]` is undefined (after fast-typing makes the list empty)

**Where:** `src/renderer/components/palette/CommandPalette.tsx:170-176`.

**Issue:** `const a = visible[activeIdx]; if (a) { void runAction(a); }` — the `if (a)` is the right guard. But: the `activeIdx` is reset to `0` on query change (`useEffect(..., [query])`, line 154-156). This effect runs after render; so during the brief window between (a) the user typing a character that empties `visible` and (b) the effect resetting activeIdx, if the user presses Enter, `visible[0]` is undefined and the guard saves it. Fine. Just noting that there's a brief inconsistency window where `activeIdx` may point past `visible.length - 1`. Not exploitable.

**Fix:** None required.

---

## Verified-OK

These were considered and found acceptable on the as-shipped code:

- **`crypto.randomUUID()` for snippet IDs** (`snippets-service.ts:39`) — collision-free; used only as a local map key, never as a security token.
- **`crypto.randomBytes(4)` + pid tmp suffix** in both `snippets-service.ts:143` and `notifications-service.ts:136` — matches the Phase-4.5 M2 / Phase-6 M2 fix. Consistent.
- **`Notification.isSupported()` check** before `new Notification(...)` (`notifications-service.ts:86`) — correct, prevents throws on headless / OS-disabled systems.
- **`truncate` for title (80) and body (300)** — well below typical OS notification limits (Windows 10 toast: ~256 char body), prevents UI overflow.
- **Snippets are NOT included in `SyncedSettings`** (`src/shared/types.ts:237-246`) — confirmed. Theme and LMM only. A malicious sync payload cannot inject snippets.
- **React-escaped rendering everywhere in palette** — `{a.title}`, `{action.subtitle}`, `previewSnippet(body).split('\n')[0]` all flow through JSX text nodes, not `dangerouslySetInnerHTML`. Snippet bodies cannot inject DOM.
- **Notification body is rendered by the OS, not by React** — no markup/HTML injection surface.
- **Palette overlay z-index (1000) below editor modal (1100)** — stacking order correct.
- **`ipcMain.handle` for all new channels** (`SNIPPET_*`, `NOTIF_*` in `index.ts:273-289`) — request/response, no fire-and-forget for state-changing ops.
- **`getCloudSync` callback wrapped in try/catch** (`index.ts:51-57`) — notification failure cannot break sync.
- **Cloud-sync callback default `() => {}`** (`cloud-sync.ts:59`) — back-compat preserved for any test caller that omits it.
- **`NotificationsService.show()` try/catch around `new Notification(...)`** (`notifications-service.ts:90-99`) — OS notification failures don't propagate to the PTY-exit handler or to `syncNow`.
- **`fireTest()` doesn't require `enabled`** — by design (smoke test). Per [M4], worth surfacing in UX, but the design intent is sound.
- **`SnippetsService.write()` atomic-rename** — matches the pattern used by `cloud-sync.ts:writeJsonAtomic`. Crash-safe.
- **Snippet `name` trimmed before persist** (`snippets-service.ts:74`) — prevents accidental whitespace-only names.
- **Palette filtered list capped at 50 visible** (`CommandPalette.tsx:152`) — no DOM-DoS even with 500 snippets.
- **App.tsx Ctrl+Shift+P handler `useEffect(..., [])`** — registers once, cleans up on unmount. App is single-window so unmount only on shutdown. No leak.
- **`setupNotifications` / `setupSnippets` use `ipcMain.handle`** (request/response) — no naked `ipcMain.on` for state mutations that would let a single bad message do unbounded work.
