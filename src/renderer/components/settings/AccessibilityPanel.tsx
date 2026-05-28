import React, { useCallback, useEffect, useState } from 'react';
import type {
  AccessibilitySettings,
  ColorBlindMode,
  FontScale,
} from '../../../shared/types';
import { applyAccessibilityPrefs } from './accessibility-prefs';

/**
 * Accessibility section (Item 10 of v3.2.1 polish).  Rendered inline
 * inside SettingsPanel.  Each toggle persists via the accessibility IPC
 * and re-applies prefs to document.documentElement so the change is
 * live without reload.
 *
 * Features:
 *   1. High-contrast theme (WCAG-AAA palette override)
 *   2. Font size scale (90 / 100 / 115 / 130 %)
 *   3. Reduce motion (disables animations/transitions)
 *   4. Large focus ring (thicker, higher-contrast outlines)
 *   5. Large click targets (44 px min interactive size)
 *   6. Dyslexia-friendly font (OpenDyslexic stack with Comic Sans fallback)
 *   7. Screen-reader mode (aria-live regions + extra labels — stubbed)
 *   8. Keyboard hints overlay (visible inline list of bindings)
 *   9. Color-blind palettes (SVG color-matrix filters at root)
 *  10. Audio captions (placeholder for v4.0.0 audio models)
 *
 * Defaults: all off so existing users see no behavior change until they opt in.
 */
export function AccessibilityPanel() {
  const [prefs, setPrefs] = useState<AccessibilitySettings | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await window.electronAPI.accessibility.get();
        if (!cancelled) setPrefs(next);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    async (partial: Partial<AccessibilitySettings>) => {
      try {
        const next = await window.electronAPI.accessibility.set(partial);
        setPrefs(next);
        applyAccessibilityPrefs(next);
        setErr(null);
      } catch (e) {
        setErr((e as Error).message ?? String(e));
      }
    },
    []
  );

  if (!prefs) {
    return (
      <div style={loadingStyle}>
        {err ? <span style={{ color: '#fda4af' }}>{err}</span> : 'Loading accessibility settings…'}
      </div>
    );
  }

  return (
    <>
      {/* SVG defs for color-blind filters.  The CSS rules in
          globals.css reference these by id (#a11y-protanopia etc.). */}
      <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="a11y-protanopia">
            <feColorMatrix
              type="matrix"
              values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id="a11y-deuteranopia">
            <feColorMatrix
              type="matrix"
              values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0"
            />
          </filter>
          <filter id="a11y-tritanopia">
            <feColorMatrix
              type="matrix"
              values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>

      {err && (
        <div role="alert" style={errorStyle}>
          {err}
        </div>
      )}

      <RowToggle
        label="High contrast"
        hint="WCAG-AAA palette (pure black / white / yellow focus). Overrides the chosen theme."
        checked={prefs.highContrast}
        onChange={(v) => void update({ highContrast: v })}
      />

      <RowSelect<FontScale>
        label="Font size"
        hint="Multiplier applied to the root font-size."
        value={prefs.fontScale}
        onChange={(v) => void update({ fontScale: v })}
        options={[
          { value: '90', label: '90% (smaller)' },
          { value: '100', label: '100% (default)' },
          { value: '115', label: '115% (larger)' },
          { value: '130', label: '130% (largest)' },
        ]}
      />

      <RowToggle
        label="Reduce motion"
        hint="Disables animations and transitions everywhere. Helps users sensitive to motion."
        checked={prefs.reduceMotion}
        onChange={(v) => void update({ reduceMotion: v })}
      />

      <RowToggle
        label="Large focus ring"
        hint="3px gold outline on focused elements (vs the default 1-2px subtle ring)."
        checked={prefs.largeFocusRing}
        onChange={(v) => void update({ largeFocusRing: v })}
      />

      <RowToggle
        label="Large click targets"
        hint="Bumps buttons / inputs to 44px minimum height (WCAG-AAA touch-target spec)."
        checked={prefs.largeClickTargets}
        onChange={(v) => void update({ largeClickTargets: v })}
      />

      <RowToggle
        label="Dyslexia-friendly font"
        hint="Switches to OpenDyslexic (if installed) with Comic Sans / Verdana fallback + wider letter-spacing."
        checked={prefs.dyslexiaFont}
        onChange={(v) => void update({ dyslexiaFont: v })}
      />

      <RowToggle
        label="Screen reader mode"
        hint="Adds aria-live regions on chat output and extra aria-labels on tab focus changes."
        checked={prefs.screenReaderMode}
        onChange={(v) => void update({ screenReaderMode: v })}
      />

      <RowToggle
        label="Keyboard hints overlay"
        hint="Floats a list of active hotkeys at the bottom-right of the window."
        checked={prefs.keyboardHints}
        onChange={(v) => void update({ keyboardHints: v })}
      />

      <RowSelect<ColorBlindMode>
        label="Color-blind palette"
        hint="Applies a color-matrix SVG filter at the root so reds / greens / blues remap to distinguishable hues."
        value={prefs.colorBlindMode}
        onChange={(v) => void update({ colorBlindMode: v })}
        options={[
          { value: 'none', label: 'None' },
          { value: 'protanopia', label: 'Protanopia (red-blind)' },
          { value: 'deuteranopia', label: 'Deuteranopia (green-blind)' },
          { value: 'tritanopia', label: 'Tritanopia (blue-blind)' },
        ]}
      />

      <RowToggle
        label="Audio captions"
        hint="Placeholder — will caption HF audio model output once those land in v4.0.0."
        checked={prefs.audioCaptions}
        onChange={(v) => void update({ audioCaptions: v })}
      />

      {prefs.keyboardHints && <KeyboardHintsOverlay />}
    </>
  );
}

function RowToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1 }}>
        <div style={rowLabelStyle}>{label}</div>
        <div style={rowHintStyle}>{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          border: 'none',
          padding: 2,
          cursor: 'pointer',
          background: checked ? 'var(--accent)' : 'var(--gauge-grey)',
          transition: 'background var(--transition-base)',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            transform: checked ? 'translateX(20px)' : 'translateX(0)',
            transition: 'transform var(--transition-base)',
          }}
        />
      </button>
    </div>
  );
}

function RowSelect<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div style={rowStyle}>
      <div style={{ flex: 1 }}>
        <div style={rowLabelStyle}>{label}</div>
        <div style={rowHintStyle}>{hint}</div>
      </div>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        style={{
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          fontSize: 12,
          fontFamily: 'inherit',
          minWidth: 160,
          flexShrink: 0,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Minimal floating overlay of active hotkeys. v1: hand-rolled list;
 *  could read from `electronAPI.hotkeys.get()` in a future pass. */
function KeyboardHintsOverlay() {
  return (
    <div
      className="keyboard-hints-overlay"
      role="region"
      aria-label="Keyboard hints"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 36,
        zIndex: 90,
        padding: '8px 10px',
        background: 'rgba(15, 15, 26, 0.92)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontSize: 11,
        color: 'var(--text-secondary)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
        maxWidth: 260,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        Keyboard hints
      </div>
      <div>Ctrl+Shift+P — Command palette</div>
      <div>Ctrl+Shift+T — New tab (profile picker)</div>
      <div>Ctrl+T — Restart terminal</div>
      <div>Ctrl+F — Focus Models search</div>
      <div>Ctrl+Shift+L — Open LMM panel</div>
      <div>Ctrl+Shift+G — Open GitHub panel</div>
      <div>Ctrl+Shift+M — Toggle compact</div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  borderBottom: '1px solid var(--border)',
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-primary)',
};

const rowHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  lineHeight: 1.4,
  marginTop: 2,
};

const loadingStyle: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: 11,
  color: 'var(--text-secondary)',
};

const errorStyle: React.CSSProperties = {
  marginBottom: 10,
  padding: '8px 10px',
  background: 'rgba(244,63,94,0.08)',
  border: '1px solid rgba(244,63,94,0.3)',
  borderRadius: 'var(--radius-md)',
  color: '#fda4af',
  fontSize: 11,
};
