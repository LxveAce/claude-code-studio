import type { HotkeyAction, HotkeyBinding } from '../shared/types';

/**
 * Build the canonical chord string for a KeyboardEvent, matching the format
 * the main-process HotkeysService validates against.
 *
 * Canonical order: Ctrl, Cmd, Alt, Shift, Key.
 *
 * Returns null if the event is not a usable "chord" (no real modifier, or
 * the user just pressed a modifier alone).
 */
export function chordFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  // Treat metaKey as "Cmd" on macOS and "Ctrl"-equivalent elsewhere — but
  // we keep them as distinct names so cross-platform configs round-trip
  // cleanly. The renderer hot-path matches against the platform's actual
  // event flags, so a binding stored as "Ctrl+Shift+P" matches on Windows
  // (e.ctrlKey) and a binding stored as "Cmd+Shift+P" matches on macOS
  // (e.metaKey).
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.metaKey) mods.push('Cmd');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  const hasRealMod = e.ctrlKey || e.metaKey || e.altKey;
  if (!hasRealMod) return null;

  const key = normalizeKey(e.key, e.code);
  if (!key) return null;
  // Don't match a chord that's *just* a modifier (e.g. user pressed Ctrl).
  if (MODIFIER_KEYS.has(key)) return null;
  return [...mods, key].join('+');
}

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'OS',
  'Hyper',
  'Super',
]);

function normalizeKey(key: string, code: string): string | null {
  if (!key) return null;
  // Letters: normalize to upper-case A-Z. Use code as a fallback so that
  // Shift+P on a keyboard layout that emits some other character still
  // resolves to "P".
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  // KeyA..KeyZ from code
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^[0-9]$/.test(key)) return key;
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (key.startsWith('Arrow')) return key; // ArrowUp etc.
  if (key.startsWith('F') && /^F([1-9]|1[0-2])$/.test(key)) return key;
  switch (key) {
    case ' ':
      return 'Space';
    case 'Tab':
    case 'Enter':
    case 'Escape':
    case 'Backspace':
    case 'Delete':
    case 'Insert':
    case 'Home':
    case 'End':
    case 'PageUp':
    case 'PageDown':
      return key;
    case '`':
    case '-':
    case '=':
    case '[':
    case ']':
    case '\\':
    case ';':
    case "'":
    case ',':
    case '.':
    case '/':
      return key;
    default:
      return null;
  }
}

/** Build a lookup map from chord → action from a HotkeyBinding list. */
export function buildChordMap(
  bindings: HotkeyBinding[]
): Map<string, HotkeyAction> {
  const m = new Map<string, HotkeyAction>();
  for (const b of bindings) {
    if (b.chord) m.set(b.chord, b.action);
  }
  return m;
}

/** Human-readable label for an action. */
export const ACTION_LABELS: Record<HotkeyAction, string> = {
  'palette.open': 'Open command palette',
  'terminal.restart': 'Restart terminal',
  'compact.toggle': 'Toggle compact controller',
  'panel.lmm': 'Open LMM panel',
  'panel.github': 'Open GitHub panel',
  'models.focus-search': 'Focus Models search',
  'terminal.new-profile': 'New terminal tab (pick profile)',
};
