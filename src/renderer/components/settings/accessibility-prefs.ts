import type { AccessibilitySettings, FontScale } from '../../../shared/types';

/**
 * Apply user accessibility prefs to document.documentElement.  Called
 * from App.tsx on hydration and from AccessibilityPanel on every change.
 *
 * Style hooks (all owned by index.css):
 *   - `--app-font-size` : root font-size multiplier (90 / 100 / 115 / 130 %)
 *   - `[data-high-contrast="true"]` : WCAG-AAA palette override
 *   - `[data-reduce-motion="true"]` : disables animations / transitions
 *   - `[data-large-focus-ring="true"]` : thicker focus outlines
 *   - `[data-large-click-targets="true"]` : 44 px min interactive size
 *   - `[data-dyslexia-font="true"]` : dyslexia-friendly font stack
 *   - `[data-screen-reader-mode="true"]` : aria-live region enabled
 *   - `[data-keyboard-hints="true"]` : keyboard-hints overlay visible
 *   - `[data-color-blind="<mode>"]` : color matrix SVG filter on root
 *
 * Idempotent — calling repeatedly produces the same DOM.
 */

const FONT_SCALE_PX: Record<FontScale, string> = {
  '90': '0.9',
  '100': '1',
  '115': '1.15',
  '130': '1.3',
};

export function applyAccessibilityPrefs(prefs: AccessibilitySettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.style.setProperty('--app-font-scale', FONT_SCALE_PX[prefs.fontScale] ?? '1');

  // Toggle data attributes the CSS keys off — these stay even when
  // `false` so cleanup doesn't leave a stale `true` attribute behind.
  root.setAttribute('data-high-contrast', String(prefs.highContrast));
  root.setAttribute('data-reduce-motion', String(prefs.reduceMotion));
  root.setAttribute('data-large-focus-ring', String(prefs.largeFocusRing));
  root.setAttribute('data-large-click-targets', String(prefs.largeClickTargets));
  root.setAttribute('data-dyslexia-font', String(prefs.dyslexiaFont));
  root.setAttribute('data-screen-reader-mode', String(prefs.screenReaderMode));
  root.setAttribute('data-keyboard-hints', String(prefs.keyboardHints));
  root.setAttribute('data-color-blind', prefs.colorBlindMode);
  // audioCaptions: placeholder for v4.0.0; the toggle persists, no DOM effect yet.
  root.setAttribute('data-audio-captions', String(prefs.audioCaptions));
}
