import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AccessibilitySettings,
  ColorBlindMode,
  FontScale,
} from '../shared/types';

/**
 * AccessibilityService — persisted user-controlled accessibility prefs.
 *
 * Storage: <userData>/accessibility.json via the atomic tmp+rename
 * pattern from cli-flags.ts.  Defaults turn every accommodation off
 * so existing users see no behavior change until they opt in.
 *
 * Validation is strict — anything off-spec falls back to the default so
 * a hand-edited file can't make the renderer apply something weird.
 */

const STORE_FILE = 'accessibility.json';

const DEFAULTS: AccessibilitySettings = {
  highContrast: false,
  fontScale: '100',
  reduceMotion: false,
  largeFocusRing: false,
  largeClickTargets: false,
  dyslexiaFont: false,
  screenReaderMode: false,
  keyboardHints: false,
  colorBlindMode: 'none',
  audioCaptions: false,
};

const FONT_SCALES: ReadonlySet<FontScale> = new Set(['90', '100', '115', '130']);
const COLOR_BLIND_MODES: ReadonlySet<ColorBlindMode> = new Set([
  'none',
  'protanopia',
  'deuteranopia',
  'tritanopia',
]);

export class AccessibilityService {
  private storePath: string;
  private settings: AccessibilitySettings;

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.settings = this.read();
  }

  get(): AccessibilitySettings {
    return { ...this.settings };
  }

  set(partial: Partial<AccessibilitySettings>): AccessibilitySettings {
    const next: AccessibilitySettings = { ...this.settings };
    if (partial.highContrast !== undefined) {
      next.highContrast = !!partial.highContrast;
    }
    if (partial.fontScale !== undefined) {
      if (typeof partial.fontScale !== 'string' || !FONT_SCALES.has(partial.fontScale as FontScale)) {
        throw new Error(`Invalid fontScale: ${String(partial.fontScale)}`);
      }
      next.fontScale = partial.fontScale as FontScale;
    }
    if (partial.reduceMotion !== undefined) {
      next.reduceMotion = !!partial.reduceMotion;
    }
    if (partial.largeFocusRing !== undefined) {
      next.largeFocusRing = !!partial.largeFocusRing;
    }
    if (partial.largeClickTargets !== undefined) {
      next.largeClickTargets = !!partial.largeClickTargets;
    }
    if (partial.dyslexiaFont !== undefined) {
      next.dyslexiaFont = !!partial.dyslexiaFont;
    }
    if (partial.screenReaderMode !== undefined) {
      next.screenReaderMode = !!partial.screenReaderMode;
    }
    if (partial.keyboardHints !== undefined) {
      next.keyboardHints = !!partial.keyboardHints;
    }
    if (partial.colorBlindMode !== undefined) {
      if (typeof partial.colorBlindMode !== 'string' || !COLOR_BLIND_MODES.has(partial.colorBlindMode as ColorBlindMode)) {
        throw new Error(`Invalid colorBlindMode: ${String(partial.colorBlindMode)}`);
      }
      next.colorBlindMode = partial.colorBlindMode as ColorBlindMode;
    }
    if (partial.audioCaptions !== undefined) {
      next.audioCaptions = !!partial.audioCaptions;
    }
    this.settings = next;
    this.write();
    return { ...this.settings };
  }

  // --- internals ---

  private read(): AccessibilitySettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULTS };
      return { ...DEFAULTS };
    }
    let parsed: Partial<AccessibilitySettings>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULTS };
    }
    // Validate each field independently; anything missing or wrong
    // falls back to the default.
    return {
      highContrast: typeof parsed.highContrast === 'boolean' ? parsed.highContrast : DEFAULTS.highContrast,
      fontScale:
        typeof parsed.fontScale === 'string' && FONT_SCALES.has(parsed.fontScale as FontScale)
          ? (parsed.fontScale as FontScale)
          : DEFAULTS.fontScale,
      reduceMotion: typeof parsed.reduceMotion === 'boolean' ? parsed.reduceMotion : DEFAULTS.reduceMotion,
      largeFocusRing: typeof parsed.largeFocusRing === 'boolean' ? parsed.largeFocusRing : DEFAULTS.largeFocusRing,
      largeClickTargets:
        typeof parsed.largeClickTargets === 'boolean' ? parsed.largeClickTargets : DEFAULTS.largeClickTargets,
      dyslexiaFont: typeof parsed.dyslexiaFont === 'boolean' ? parsed.dyslexiaFont : DEFAULTS.dyslexiaFont,
      screenReaderMode:
        typeof parsed.screenReaderMode === 'boolean' ? parsed.screenReaderMode : DEFAULTS.screenReaderMode,
      keyboardHints: typeof parsed.keyboardHints === 'boolean' ? parsed.keyboardHints : DEFAULTS.keyboardHints,
      colorBlindMode:
        typeof parsed.colorBlindMode === 'string' && COLOR_BLIND_MODES.has(parsed.colorBlindMode as ColorBlindMode)
          ? (parsed.colorBlindMode as ColorBlindMode)
          : DEFAULTS.colorBlindMode,
      audioCaptions: typeof parsed.audioCaptions === 'boolean' ? parsed.audioCaptions : DEFAULTS.audioCaptions,
    };
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
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
