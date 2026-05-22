# Security & Correctness Review — Phase 4.5 (LMM Panel)

> Reviewed: 2026-05-21 · Branch: phase-4.5-lmm-panel · Reviewer: red-team agent

## Summary

Phase 4.5 is well-scoped (no Claude hooks, pure UI + a self-contained settings/markdown store) and inherits the hardening done after the Phase 4 review — sandbox, CSP-via-headers, navigation lockdown, allowlisted `openExternal`. The new attack surface is the eight `LMM_*` IPC handlers wired in `src/main/index.ts:196-224`. One real path-traversal sink exists (renderer-supplied cycle `id` flows directly into `path.join` in `cyclePath` for delete/save/get — `createCycle`'s `makeSlug` does NOT protect the other three paths), plus a couple of mediums around DoS on `listCycles`, no content-length cap, fixed `.tmp` filename, and a `setSettings` path that will happily point the journal at `C:\Windows`. No remote code execution paths.

## Critical (fix before merge)

### [C1] Renderer-supplied `id` is not sanitized in `getCycle`/`savePhase`/`deleteCycle` → arbitrary `*.lmm.md` read/write/delete anywhere on disk

**Where:** `src/main/lmm-service.ts:67-69` (`getCycle`), `:93-106` (`savePhase`), `:108-113` (`deleteCycle`), `:123-125` (`cyclePath`); IPC entries `src/main/index.ts:202`, `:206-210`, `:211-213`.

**Issue:** Only `createCycle` runs `makeSlug` (`lmm-service.ts:74`). The other three handlers pass the renderer's `id` string straight into `cyclePath(id)` which does `path.join(this.settings.journalDir, ${id}.lmm.md)`. `path.join` resolves `..` segments, so `id = "..\\..\\..\\..\\Users\\extra\\AppData\\Roaming\\Claude\\settings"` produces a target outside `journalDir`. Concretely:

- `deleteCycle("../../../../some/path/to/file")` → `fs.unlinkSync` on `<journalDir>/../../../../some/path/to/file.lmm.md`. Any `.lmm.md` file the user owns can be deleted. The 40-cycle Phase-4 journal at `./journal/*.lmm.md` is a juicy target — wipe the team's design history in one IPC call.
- `getCycle("../../../some/other/note")` → leaks the contents of any `.lmm.md` file in the filesystem back to the renderer (and through it to whatever DOM/network the renderer can reach).
- `savePhase("../../path/to/victim", "raw", attackerContent)` → if the victim file exists, `readCycle` succeeds, then `writeCycle` does `fs.writeFileSync(target + ".tmp", attackerContent)` then `fs.renameSync(tmp, target)` — **silently overwrites a file outside `journalDir` with attacker-controlled markdown.** The file must already exist and end in `.lmm.md`, but `createCycle` itself can create the precondition: an attacker who controls the renderer (e.g., a future XSS via a markdown component, or a malicious browser-side dep) calls `createCycle("seed")` to learn a slug, then uses that to bootstrap arbitrary writes elsewhere only if they can stage the target — so the practical impact is dominated by the read and delete paths.

**Exploit/scenario:** This is the same shape as C3 from the prior review's threat model — renderer XSS becomes filesystem mutation. The Phase-4 mitigations (CSP, sandbox, navigation lockdown) reduce the *likelihood* of renderer compromise but do not remove the *primitive*. A defense-in-depth IPC validator costs five lines and removes the primitive entirely.

**Fix:** Add a single guard in `cyclePath` (or a separate `resolveCycleId(id): string | null` used by all three handlers):

```ts
private cyclePath(id: string): string {
  if (typeof id !== 'string') throw new Error('id must be a string');
  // ids are slugs from makeSlug — strict allowlist
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) {
    throw new Error(`Invalid cycle id: ${id}`);
  }
  const target = path.resolve(this.settings.journalDir, `${id}.lmm.md`);
  const dir = path.resolve(this.settings.journalDir);
  // belt-and-suspenders: ensure target is a direct child of dir
  if (path.dirname(target) !== dir) {
    throw new Error(`id escapes journal directory: ${id}`);
  }
  return target;
}
```

Also tighten `makeSlug` to refuse the `cycle-${Date.now()}` fallback if the timestamp could collide with that allowlist (it always will — `cycle-1716285600000` matches — so the existing fallback is fine, but rename to `cycle-<ts>` to make the invariant readable).

## High (fix soon)

### [H1] `setSettings({ journalDir })` will happily point the store at `C:\Windows\System32` (or any system dir the user can `mkdir` inside)

**Where:** `src/main/lmm-service.ts:36-52` (`setSettings`), `:182-194` (`sanitizeDir`), IPC at `src/main/index.ts:198-200`.

**Issue:** `sanitizeDir` checks three things: non-empty string, not a Windows UNC path (`^[\\/][\\/]`), and `fs.mkdirSync(resolved, { recursive: true })` succeeds. There is no check that the directory is empty, that it is not a known system path, that it is inside `app.getPath('home')` / `userData`, or that the user actually intended this. The handler `LMM_SET_SETTINGS` is `ipcMain.handle(...)` — accepting any string from the renderer without a directory-picker user gesture. So:

1. A renderer call `lmm.setSettings({ journalDir: 'C:\\Windows\\Temp\\lmm' })` succeeds (any user can mkdir under `C:\Windows\Temp`).
2. Worse: `lmm.setSettings({ journalDir: 'C:\\ProgramData\\some-shared-dir' })` — same.
3. `lmm.setSettings({ journalDir: 'D:\\' })` succeeds if D:\ is writable; then `createCycle` writes a `.lmm.md` at the drive root and `listCycles` does `readdirSync('D:\\')` — see H2 for the blocking-IO consequence.
4. Worse still: a privileged user (admin Electron) gets unrestricted write into protected dirs.

The directory-picker path (`LMM_PICK_JOURNAL_DIR`, `src/main/index.ts:214-223`) does require a user gesture, but `LMM_SET_SETTINGS` provides a parallel ungated path that bypasses it.

**Exploit/scenario:** Defense-in-depth violation: the user thinks "I'm choosing a folder," but a future renderer bug can move the journal silently. Combined with C1's arbitrary-id writes, the attacker can re-aim both the directory AND the id offsets.

**Fix:**
1. In `setSettings`, refuse `journalDir` updates that didn't come from the picker. Either drop `journalDir` from `setSettings`'s accepted keys entirely (force callers through `LMM_PICK_JOURNAL_DIR`), or thread a `fromPicker: boolean` sentinel through the picker handler.
2. In `sanitizeDir`, reject paths inside `process.env.SystemRoot` (`C:\Windows`), `process.env.ProgramFiles*`, `process.env.ProgramData`, and the drive root (`/^[A-Za-z]:[\\/]?$/`). Optionally require the resolved path to be under `app.getPath('home')`.
3. Also reject paths matching `^[\\/]$` on POSIX (root).

### [H2] `listCycles` reads + parses every `.lmm.md` synchronously on the main process

**Where:** `src/main/lmm-service.ts:54-65`.

**Issue:** `readdirSync` + per-file `readFileSync` + per-file `parseCycle` (which runs a regex over the full file body four times). On the journalDir == the project's existing `journal/` (~40 files, each a few KB) this is fine. But:

- A user repointing `journalDir` at a documents folder full of unrelated `.lmm.md` files (or a malicious file dropped by another process) will block the main thread per IPC call.
- Combined with H1, an attacker who can call `setSettings` can aim the directory at a folder with thousands of `.md` entries (none match `.lmm.md`, but `readdirSync` still has to enumerate them all).
- Each call to `listCycles` from the renderer (it's called on every save in `LMMPanel.tsx:132-133` and every toggle) re-scans the whole directory.
- There's no cap on per-file size — `readFileSync` of an attacker-planted 500 MB `.lmm.md` will OOM the main process.

**Exploit/scenario:** Low likelihood, real impact: the panel becomes a DoS amplifier. The user toggling "Active" or saving a phase freezes the whole app for seconds, and on an OOM the whole Electron process dies (taking the PTY child with it — losing Claude session state).

**Fix:**
1. Cap per-file read at e.g. 1 MB: `fs.openSync` + `fs.readSync` of `Math.min(stat.size, 1_048_576)`. Skip files larger than the cap with a one-line warning to the renderer.
2. Cap total number of entries scanned (e.g., 500). If exceeded, return the first 500 sorted by mtime and a truncation flag.
3. In-memory cache `listCycles` keyed on `(journalDir, dirMtime)` so repeated renderer calls don't re-scan unchanged dirs.
4. Move to `fs.promises.*` + `Promise.all` so the event loop isn't fully blocked.

### [H3] No content-length cap on `savePhase`

**Where:** `src/main/lmm-service.ts:93-106` (`savePhase`), IPC at `src/main/index.ts:206-210`, textarea source at `src/renderer/components/lmm/LMMPanel.tsx:623-642`.

**Issue:** `content: string` from the renderer is written to disk unchecked. A renderer (or a clipboard paste of a huge file) can submit a 100 MB string, which gets `JSON.stringify`-serialized across the IPC bridge, copied into a `string` in main, then `writeFileSync`'d. Each save round-trips the entire payload twice. There's no upper bound.

**Exploit/scenario:** Accidental: user pastes a large log into the RAW textarea, hits save, app hangs for several seconds per save. Adversarial: renderer XSS calls `savePhase(victimId, 'raw', '\0'.repeat(1e8))` in a loop to fill the user's disk or trigger OOM.

**Fix:** Enforce a max-size per phase in `savePhase` (e.g., 256 KB — generous for human writing, ~3.5x the longest entry in the existing `journal/`). Throw with a structured message the renderer can surface. Also enforce a sum-of-phases cap so an attacker can't bypass by spreading across 4 phases.

## Medium (track as tech debt)

### [M1] `parseCycle` `JSON.parse(v)` on the title field will throw on a control character — but the surrounding try/catch only catches *that*, not the rest of frontmatter parsing

**Where:** `src/main/lmm-service.ts:240-294`, particularly `:254-259`.

**Issue:** The try/catch only wraps `JSON.parse(v)` for the title. Everything else (`created = v`, `modified = v`, `currentPhase = v if isPhase`) silently accepts whatever string appears after `key:`. A file with `created: not-a-date` produces `Date('not-a-date') → Invalid Date`, then `formatRelative` (`LMMPanel.tsx:734-748`) produces `NaN ago`. Not exploitable, but a malformed file on disk silently corrupts the listing UI without a "could not parse" surface. Also: `parseCycle` itself can throw if `body.match(re)` returns `null` and downstream code assumes otherwise — currently it's defensive, but the wrapping `readCycle` swallows ALL errors and returns `null`, so a single malformed file silently disappears from `listCycles`.

**Fix:** In `readCycle`, distinguish ENOENT from parse failure (mirror the C1-prior pattern). In `parseCycle`, validate `created`/`modified` as ISO strings (`Number.isFinite(new Date(v).getTime())`) and fall back to file mtime via `fs.statSync` if missing.

### [M2] Fixed `.tmp` filename in `writeCycle` — concurrent `savePhase` calls for the same id can clobber each other

**Where:** `src/main/lmm-service.ts:165-172`.

**Issue:** `const tmp = target + '.tmp'`. If the user spams "Save → NODES" and "Save" buttons (or a renderer effect re-renders and re-fires save), two `writeCycle` calls race: both `writeFileSync(tmp, ...)` with different contents, the second-writer's content "wins" but the order is non-deterministic, and a crash between `writeFileSync` and `renameSync` leaves a stale `.tmp` next to the real file forever. `listCycles` ignores it (filter is `.lmm.md`), so the user sees no symptom — disk clutter only.

**Exploit/scenario:** Benign in normal single-user flow but the existing `LMMPanel.tsx:124-145` calls `setBusy(true)` to gate the UI — so the practical race is small. The leak-stale-tmp on crash is real.

**Fix:** Either include a random suffix (`target + '.' + crypto.randomBytes(6).toString('hex') + '.tmp'`) and `unlink` on error, or use `fs.openSync` with `O_EXCL` for the tmp. On startup, sweep the journalDir for orphan `*.lmm.md.tmp` files.

### [M3] `setSettings` does no shape-validation on `partial.variant`

**Where:** `src/main/lmm-service.ts:36-52`.

**Issue:** Spreads `partial` into `next` without validating that `partial.variant` is `'quick' | 'deep'`. A renderer call `setSettings({ variant: 'banana' as any })` round-trips and is then persisted to disk. Next-read normalization at `:142` (`parsed.variant === 'deep' ? 'deep' : 'quick'`) recovers — but the on-disk file briefly holds invalid data, and the in-memory `this.settings` returned to the renderer mid-call is wrong.

**Fix:** Validate variant explicitly in `setSettings`:
```ts
if (partial.variant !== undefined && partial.variant !== 'quick' && partial.variant !== 'deep') {
  throw new Error(`Invalid variant: ${partial.variant}`);
}
if (partial.enabled !== undefined && typeof partial.enabled !== 'boolean') {
  throw new Error('enabled must be boolean');
}
```

### [M4] `readSettings` swallows all errors → distinguish ENOENT from parse failure (same anti-pattern as C1 in prior review)

**Where:** `src/main/lmm-service.ts:127-147`.

**Issue:** Per the prior review's C1: a corrupted or hand-edited settings file (JSONC comments, trailing commas, UTF-8 BOM) is silently replaced by defaults on the next `writeSettings` call. For LMM the blast radius is small — user loses three preferences and the journalDir pointer — but they may also lose the only pointer to a journalDir that was outside the default, and then on next launch the default dir is "empty" and they think their cycles vanished.

**Fix:** Mirror the prior-review fix: distinguish ENOENT (return defaults — safe to write) from parse failure (log + refuse to write until the user resolves). Optional: write `.bak` before each rename.

### [M5] `cycle.id` shown in the editor header is rendered as `<code>{cycle.id}</code>` — and IDs that round-trip from `parseCycle` come from the filename, not from any in-file `id:` frontmatter

**Where:** `src/renderer/components/lmm/LMMPanel.tsx:564-566`, `src/main/lmm-service.ts:60` (`id` derived from `name.slice(...)`).

**Issue:** Not a direct XSS — React escapes — but the file-name-derived id can contain any character `readdirSync` returns. On Windows that's restricted by NTFS, but a journalDir on a network mount or WSL-bridged path could surface ids like `<script>...</script>.lmm.md` (slug from `makeSlug` can never produce this, but a hand-placed file can). React will render the literal text safely. The risk is purely aesthetic — listing UI shows a weird id — but `formatRelative` and `localeCompare` don't validate either, so a malicious file with `modified: 9999-99-99T99:99:99` sorts to the top of `listCycles` and pins itself as the most-recent entry, "hiding" the user's real recent work below.

**Fix:** In `listCycles`, validate the filename slug matches `^[a-z0-9][a-z0-9-]{0,79}$` (same rule as C1's allowlist) before including. In `parseCycle`, validate `modified` is a real ISO date; fall back to `fs.statSync(path).mtimeMs.toISOString()` if not.

### [M6] `window.prompt` / `window.confirm` are synchronous blocking dialogs in Electron — they block the renderer process, can't be styled, and on some Electron builds can be disabled

**Where:** `src/renderer/components/lmm/LMMPanel.tsx:105` (`prompt`), `:148` (`confirm`), `:160` (`confirm`), `:225` (`confirm`).

**Issue:** Electron supports these but they look out of place against the rest of the styled UI, they block the React event loop (no spinner, no escape), and Chromium has been progressively restricting them — they may be disabled by future Electron defaults. For C3-related defense-in-depth (the prior review), an XSS that bypasses confirmation is trivial because `confirm` always returns true under puppeteer/automated control.

**Fix:** Replace with the project's own modal/toast component (the rest of the app uses styled in-page UI). Bonus: for `deleteCycle`, gate the IPC handler on a per-session "delete enabled" capability that only the directory picker (a user gesture) can flip — so a renderer-side XSS that bypasses the React confirm dialog still can't reach the IPC. (Mitigates the loop-wipe scenario from C3.)

### [M7] Sidebar slice split places `lmm` and `github` in the "primary" group together — verify intent

**Where:** `src/renderer/components/layout/Sidebar.tsx:115-125`, panel order at `:9-100`.

**Observation:** `panels[0..5] = [terminal, commands, resources, compact, lmm, github]`. `panels[6..] = [sync, auth, settings]`. The split previously was `slice(0,5)/slice(5)`, which put `[terminal, commands, resources, compact, github]` primary and `[sync, auth, settings]` secondary. Inserting `lmm` at index 4 and bumping the split to 6 keeps GitHub in primary and lifts LMM into primary — visually correct. **Not a bug**, listed here only because it was an item to verify in the brief.

## Low / nits

- `lmm-service.ts:74` — `makeSlug(trimmed)` truncates at 60 chars. Two titles "AAAA…A" with the same 60-char prefix collide, and the second `createCycle` throws "already exists." Surfacing this as an error is correct, but the UX message at `LMMPanel.tsx:104-122` will dump the raw thrown message to the error banner. Consider a friendlier hint.
- `lmm-service.ts:225` — `filledPhases: [${cycle.filledPhases.join(', ')}]` is written but never read back by `parseCycle`. Either parse it or drop it to avoid drift between frontmatter and body.
- `lmm-service.ts:208-215` — `makeSlug` lowercases and collapses non-alphanumeric. On case-insensitive filesystems (Windows, default macOS) "My Title" → `my-title` matches existing `my-title.lmm.md`, so `fs.existsSync(filePath)` correctly rejects the duplicate. On Linux it does too because the slug already lowercased. No issue, but the case-insensitive collision check is implicit — comment it.
- `lmm-service.ts:298` — `isPhase(v)` is fine. `parseCycle` `currentPhase` falls back to `'raw'` if unparseable, which is sensible.
- `lmm-service.ts:174-180` — `ensureDir` swallows mkdir errors. If journalDir is on a read-only volume, the user gets no signal until `writeCycle` fails. Log to stderr at least.
- `index.ts:196-224` — `setupLMM` returns IPCs that all instantiate `getLMM()` lazily on first call. On a slow first call (e.g., huge directory), the handler blocks. Pre-warm in `app.whenReady`.
- `preload.ts:74-84` — `lmm.setSettings(partial: unknown)` types the input as `unknown` — good. The `.d.ts` (`declarations.d.ts:110-112`) narrows to `Partial<LMMSettings>`. Mismatch is fine because preload uses `unknown` defensively.
- `LMMPanel.tsx:677` — button label `Save → ${PHASE_LABEL[nextPhase(phase)]}`. When `phase === 'synth'` the button isn't rendered (gated by `!isLast`), so `nextPhase('synth')` returning `'synth'` is harmless. Confirmed.
- `LMMPanel.tsx:38-47` — `refresh()` is called once on mount only. If another window or shell write modifies the journalDir, the panel won't notice. Acceptable v1 — note that "in another window" doesn't exist yet (single-window app).
- `types.ts:148-150` — comment now correctly says the full ElectronAPI shape lives in `declarations.d.ts`. Good — addresses the prior review's M8.

## Verified-OK (explicitly checked, no issue)

- **`makeSlug` path traversal**: titles like `"../../etc/passwd"` or `"..\\..\\Windows\\evil"` are reduced to slugs (`etc-passwd`, `windows-evil`) — the regex `/[^a-z0-9]+/g` strips slashes, dots, backslashes, and the leading-dash strip then removes any leading separator. `createCycle` is safe. (The unsafe paths are `getCycle`/`savePhase`/`deleteCycle` — see C1.)
- **Markdown frontmatter rendering**: React text interpolation (`{cycle.title}`, `{cycle.id}`, `{c.title}`) escapes by default. No `dangerouslySetInnerHTML` anywhere in `LMMPanel.tsx`. No `react-markdown` or similar. The title from `parseCycle` can be any string, but the renderer treats it as text.
- **Settings file location**: `app.getPath('userData')` is per-user, NTFS-ACL'd to the user. `lmm-settings.json` is safely scoped.
- **IPC channel naming**: all new channels (`lmm:get-settings` … `lmm:pick-journal-dir`) are under the `lmm:` namespace and use `ipcMain.handle` (request/response) not `ipcMain.on` — correct pattern for renderer-initiated reads.
- **No `shell.openExternal` for journal paths**: the panel renders the journalDir as `<code>` text only; there's no "Reveal in Finder" button that could pivot to `shell.showItemInFolder` with a renderer-controlled path. Future addition should reuse the GitHub `openExternal` allowlist pattern.
- **No `eval` / no `Function()` / no dynamic `import`**: `parseCycle` uses regex + `JSON.parse` only. The `JSON.parse(v)` for title returns a string, never executes code.
- **No new network surface**: the LMM panel makes zero `fetch` / `XHR` / `ipcRenderer` calls outside the eight `lmm.*` methods. No GitHub roundtrip, no telemetry.
- **No new dependencies**: `lmm-service.ts` imports only `electron`, `node:fs`, `node:path`, and the shared types — no new npm packages, no new transitive supply-chain surface.
- **`subscribe` preload helper is unused for LMM**: the panel uses `invoke`-only IPC (request/response), not pub/sub — so H4 from the prior review (listener leaks) doesn't apply here.
- **Sandbox + CSP inherited**: per `src/main/index.ts:44-50` `sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true` — already remediated by Phase 4 follow-up.
- **`pickJournalDir` requires a user gesture**: `dialog.showOpenDialog` is the only path that produces a renderer-trusted directory. The companion `setSettings({ journalDir })` is the bypass — see H1.
- **`deleteCycle` returns boolean, not the deleted content** — no inadvertent data exfiltration through the delete acknowledgement.
- **`cycles.sort((a,b) => b.modified.localeCompare(a.modified))`** is string-comparison on ISO timestamps which sorts correctly because ISO-8601 is lexicographically ordered. (Bogus modified strings can pin to top — see M5.)
