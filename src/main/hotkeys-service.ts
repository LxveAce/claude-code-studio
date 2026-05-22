import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  HotkeyAction,
  HotkeyBinding,
  HotkeySettings,
} from '../shared/types';

const STORE_FILE = 'hotkeys.json';

// Whitelist of action ids the renderer is allowed to bind. Anything not in
// this list is silently dropped on read so a malicious settings file can't
// inject arbitrary action names that downstream code might unsafely dispatch.
const ALLOWED_ACTIONS = new Set<HotkeyAction>([
  'palette.open',
  'terminal.restart',
  'compact.toggle',
  'panel.lmm',
  'panel.github',
]);

const DEFAULT_BINDINGS: HotkeyBinding[] = [
  { action: 'palette.open', chord: 'Ctrl+Shift+P' },
  { action: 'terminal.restart', chord: 'Ctrl+T' },
  { action: 'compact.toggle', chord: 'Ctrl+Shift+M' },
  { action: 'panel.lmm', chord: 'Ctrl+Shift+L' },
  { action: 'panel.github', chord: 'Ctrl+Shift+G' },
];

const DEFAULTS: HotkeySettings = {
  bindings: DEFAULT_BINDINGS.map((b) => ({ ...b })),
};

const MAX_CHORD_LEN = 64;
// Single key segments we accept. Letters/digits handled separately.
const NAMED_KEYS = new Set([
  'Space',
  'Tab',
  'Enter',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  '`',
  '-',
  '=',
  '[',
  ']',
  '\\',
  ';',
  "'",
  ',',
  '.',
  '/',
]);
const MODIFIERS = new Set(['Ctrl', 'Cmd', 'Shift', 'Alt']);

export class HotkeysService {
  private storePath: string;
  private settings: HotkeySettings;

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.settings = this.read();
  }

  getSettings(): HotkeySettings {
    return { bindings: this.settings.bindings.map((b) => ({ ...b })) };
  }

  /** Replace a single binding by action. Returns the updated settings. */
  setBinding(action: unknown, chord: unknown): HotkeySettings {
    const a = this.requireAction(action);
    // Allow empty/null chord to mean "unbind".
    const next = this.settings.bindings.map((b) => ({ ...b }));
    const idx = next.findIndex((b) => b.action === a);
    if (chord === null || chord === '' || chord === undefined) {
      if (idx >= 0) next[idx] = { action: a, chord: null };
      else next.push({ action: a, chord: null });
    } else {
      const normalized = this.requireChord(chord);
      // Reject duplicate chords on other actions to avoid silent hijacking.
      const conflict = next.find(
        (b) => b.action !== a && b.chord && b.chord === normalized
      );
      if (conflict) {
        throw new Error(
          `Chord "${normalized}" is already bound to "${conflict.action}".`
        );
      }
      if (idx >= 0) next[idx] = { action: a, chord: normalized };
      else next.push({ action: a, chord: normalized });
    }
    this.settings = { bindings: next };
    this.write();
    return this.getSettings();
  }

  resetDefaults(): HotkeySettings {
    this.settings = { bindings: DEFAULT_BINDINGS.map((b) => ({ ...b })) };
    this.write();
    return this.getSettings();
  }

  // --- internals ---

  private requireAction(value: unknown): HotkeyAction {
    if (typeof value !== 'string') throw new Error('action must be a string');
    if (!ALLOWED_ACTIONS.has(value as HotkeyAction)) {
      throw new Error(`Unknown action: ${value}`);
    }
    return value as HotkeyAction;
  }

  /**
   * Validate and normalize a chord string. Rules:
   *  - Length-limited (defense in depth)
   *  - At least one modifier (Ctrl|Cmd|Shift|Alt) AND at least one key
   *  - Modifiers come in canonical order: Ctrl, Cmd, Alt, Shift, Key
   *  - Key part: a-z, 0-9, or named key from NAMED_KEYS
   *  - Shift alone with a printable key is NOT considered "having a modifier"
   *    (so we don't intercept things like "Shift+A" — that's just typing).
   */
  private requireChord(value: unknown): string {
    if (typeof value !== 'string') throw new Error('chord must be a string');
    if (value.length === 0 || value.length > MAX_CHORD_LEN) {
      throw new Error('chord length out of range');
    }
    const parts = value.split('+').map((p) => p.trim());
    if (parts.length < 2) {
      throw new Error('chord must include at least one modifier and a key');
    }
    const mods = new Set<string>();
    let key: string | null = null;
    for (const raw of parts) {
      if (MODIFIERS.has(raw)) {
        if (mods.has(raw)) throw new Error(`duplicate modifier: ${raw}`);
        mods.add(raw);
      } else {
        if (key !== null) {
          throw new Error('chord must have exactly one non-modifier key');
        }
        key = this.normalizeKey(raw);
      }
    }
    if (!key) throw new Error('chord is missing its key');
    // Must include Ctrl, Cmd, or Alt — Shift alone isn't enough (would
    // hijack normal typing).
    const hasRealMod =
      mods.has('Ctrl') || mods.has('Cmd') || mods.has('Alt');
    if (!hasRealMod) {
      throw new Error('chord must include Ctrl, Cmd, or Alt');
    }
    // Canonical order: Ctrl, Cmd, Alt, Shift, Key
    const ordered: string[] = [];
    for (const m of ['Ctrl', 'Cmd', 'Alt', 'Shift'] as const) {
      if (mods.has(m)) ordered.push(m);
    }
    ordered.push(key);
    return ordered.join('+');
  }

  private normalizeKey(raw: string): string {
    if (raw.length === 1) {
      // Letter -> uppercase A-Z. Digit -> as-is. Punctuation must be in
      // NAMED_KEYS.
      if (/^[a-zA-Z]$/.test(raw)) return raw.toUpperCase();
      if (/^[0-9]$/.test(raw)) return raw;
      if (NAMED_KEYS.has(raw)) return raw;
      throw new Error(`invalid key: ${raw}`);
    }
    if (NAMED_KEYS.has(raw)) return raw;
    throw new Error(`invalid key: ${raw}`);
  }

  private read(): HotkeySettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return { bindings: DEFAULTS.bindings.map((b) => ({ ...b })) };
      }
      // Unreadable file: fall back to defaults rather than crashing the app,
      // but at least leave a breadcrumb so the user can debug it.
      console.warn(
        `[hotkeys] unable to read ${this.storePath} (${(e as Error).message}); using defaults`
      );
      return { bindings: DEFAULTS.bindings.map((b) => ({ ...b })) };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.warn(
        `[hotkeys] ${this.storePath} is not valid JSON (${(e as Error).message}); using defaults`
      );
      return { bindings: DEFAULTS.bindings.map((b) => ({ ...b })) };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { bindings: DEFAULTS.bindings.map((b) => ({ ...b })) };
    }
    const arr = (parsed as { bindings?: unknown }).bindings;
    if (!Array.isArray(arr)) {
      return { bindings: DEFAULTS.bindings.map((b) => ({ ...b })) };
    }
    // Start from defaults, then overlay valid entries from disk.
    const map = new Map<HotkeyAction, string | null>();
    for (const b of DEFAULT_BINDINGS) map.set(b.action, b.chord);
    const seenChords = new Set<string>();
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const action = obj.action;
      if (typeof action !== 'string') continue;
      if (!ALLOWED_ACTIONS.has(action as HotkeyAction)) continue;
      let chord: string | null = null;
      if (obj.chord === null) {
        chord = null;
      } else if (typeof obj.chord === 'string') {
        try {
          chord = this.requireChord(obj.chord);
        } catch {
          // Invalid stored chord — drop it.
          continue;
        }
        if (seenChords.has(chord)) {
          // Conflict on disk: keep the first occurrence, drop the rest.
          continue;
        }
        seenChords.add(chord);
      } else {
        continue;
      }
      map.set(action as HotkeyAction, chord);
    }
    const bindings: HotkeyBinding[] = [];
    for (const action of ALLOWED_ACTIONS) {
      bindings.push({ action, chord: map.get(action) ?? null });
    }
    return { bindings };
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto
      .randomBytes(4)
      .toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), {
        mode: 0o600,
      });
      fs.renameSync(tmp, this.storePath);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw e;
    }
  }
}
