import React, { useState, useEffect, useCallback } from 'react';
import { THEME_PRESETS, applyTheme, findThemePreset, type ThemePreset } from '../../theme-presets';
import type {
  HotkeyAction,
  HotkeyBinding,
  HotkeySettings,
  NotificationSettings,
  TraySettings,
  UpdaterSettings,
  UpdaterState,
} from '../../../shared/types';
import { ACTION_LABELS, chordFromEvent } from '../../hotkeys';

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export function SettingsPanel() {
  const [activeTheme, setActiveTheme] = useState('Purple');
  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);
  const [notif, setNotif] = useState<NotificationSettings | null>(null);
  const [notifSupported, setNotifSupported] = useState(true);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [updaterState, setUpdaterState] = useState<UpdaterState | null>(null);
  const [updaterSettings, setUpdaterSettings] = useState<UpdaterSettings | null>(null);
  const [updaterError, setUpdaterError] = useState<string | null>(null);
  const [updaterChecking, setUpdaterChecking] = useState(false);
  const [tray, setTray] = useState<TraySettings | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeySettings | null>(null);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [recordingAction, setRecordingAction] = useState<HotkeyAction | null>(
    null
  );

  useEffect(() => {
    const saved = localStorage.getItem('claude-studio-theme');
    const preset = findThemePreset(saved);
    if (preset) {
      setActiveTheme(preset.name);
      applyTheme(preset);
    }
    let cancelled = false;
    void (async () => {
      try {
        const [supported, n, us, ust] = await Promise.all([
          window.electronAPI.notifications.supported(),
          window.electronAPI.notifications.getSettings(),
          window.electronAPI.updater.getSettings(),
          window.electronAPI.updater.getState(),
        ]);
        if (cancelled) return;
        setNotifSupported(supported);
        setNotif(n);
        setUpdaterSettings(us);
        setUpdaterState(ust);
      } catch (e) {
        if (!cancelled) {
          setUpdaterError((e as Error).message ?? String(e));
        }
      }
      try {
        setTray(await window.electronAPI.tray.getSettings());
      } catch {
        // tray API missing — show nothing for the tray section
      }
      try {
        setHotkeys(await window.electronAPI.hotkeys.get());
      } catch {
        // hotkeys API missing — show nothing for the hotkeys section
      }
    })();
    // Live-update when main fires update-available.
    const unsub = window.electronAPI.updater.onAvailable(() => {
      void (async () => {
        try {
          const next = await window.electronAPI.updater.getState();
          if (!cancelled) setUpdaterState(next);
        } catch {
          // ignore
        }
      })();
    });
    return () => {
      cancelled = true;
      try {
        unsub();
      } catch {
        // ignore
      }
    };
  }, []);

  const handleThemeChange = (preset: ThemePreset) => {
    setActiveTheme(preset.name);
    applyTheme(preset);
  };

  const updateNotif = async (patch: Partial<NotificationSettings>) => {
    try {
      const next = await window.electronAPI.notifications.setSettings(patch);
      setNotif(next);
      setNotifError(null);
    } catch (e) {
      setNotifError((e as Error).message ?? String(e));
    }
  };

  const updateUpdater = async (patch: Partial<UpdaterSettings>) => {
    try {
      const next = await window.electronAPI.updater.setSettings(patch);
      setUpdaterSettings(next);
      setUpdaterError(null);
    } catch (e) {
      setUpdaterError((e as Error).message ?? String(e));
    }
  };

  const checkForUpdatesNow = async () => {
    setUpdaterChecking(true);
    setUpdaterError(null);
    try {
      const next = await window.electronAPI.updater.checkNow();
      setUpdaterState(next);
    } catch (e) {
      setUpdaterError((e as Error).message ?? String(e));
    } finally {
      setUpdaterChecking(false);
    }
  };

  const updateTray = async (patch: Partial<TraySettings>) => {
    try {
      const next = await window.electronAPI.tray.setSettings(patch);
      setTray(next);
    } catch {
      // ignore
    }
  };

  const handleBind = useCallback(
    async (action: HotkeyAction, chord: string | null) => {
      setHotkeyError(null);
      try {
        const next = await window.electronAPI.hotkeys.setBinding(action, chord);
        setHotkeys(next);
        window.dispatchEvent(new Event('hotkeys-changed'));
      } catch (e) {
        setHotkeyError((e as Error).message ?? 'Failed to set binding.');
      }
    },
    []
  );

  const handleResetHotkeys = useCallback(async () => {
    setHotkeyError(null);
    try {
      const next = await window.electronAPI.hotkeys.reset();
      setHotkeys(next);
      window.dispatchEvent(new Event('hotkeys-changed'));
    } catch (e) {
      setHotkeyError((e as Error).message ?? 'Failed to reset bindings.');
    }
  }, []);

  // While recording, capture the next valid chord and save it.
  useEffect(() => {
    if (!recordingAction) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setRecordingAction(null);
        return;
      }
      // Ignore lone modifier keypresses; wait for a non-modifier.
      if (
        e.key === 'Control' ||
        e.key === 'Shift' ||
        e.key === 'Alt' ||
        e.key === 'Meta'
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const chord = chordFromEvent(e);
      if (!chord) {
        setHotkeyError(
          'Chord must include Ctrl, Cmd, or Alt plus a key. Try again.'
        );
        return;
      }
      const action = recordingAction;
      setRecordingAction(null);
      void handleBind(action, chord);
    };
    // Capture so we win against any panel-level listener.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingAction, handleBind]);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3 style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 3, height: 14, borderRadius: 2,
          background: 'var(--accent-gradient)',
        }} />
        Settings
      </h3>

      {/* Accent Color */}
      <div style={{
        marginBottom: 20,
      }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}>
          Accent Color
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}>
          {THEME_PRESETS.map((preset) => {
            const isActive = activeTheme === preset.name;
            const isHovered = hoveredTheme === preset.name;
            return (
              <button
                key={preset.name}
                onClick={() => handleThemeChange(preset)}
                onMouseEnter={() => setHoveredTheme(preset.name)}
                onMouseLeave={() => setHoveredTheme(null)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: `1.5px solid ${isActive ? preset.accent : isHovered ? 'rgba(255,255,255,0.1)' : 'var(--border)'}`,
                  background: isActive
                    ? `linear-gradient(135deg, rgba(${hexToRgb(preset.accent)},0.15) 0%, rgba(${hexToRgb(preset.accent)},0.05) 100%)`
                    : 'var(--bg-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  transition: 'all var(--transition-fast)',
                  transform: isHovered ? 'scale(1.02)' : 'none',
                }}
              >
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  background: preset.gradient,
                  boxShadow: isActive ? `0 0 12px rgba(${hexToRgb(preset.accent)},0.4)` : 'none',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {isActive && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span style={{
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}>
                  {preset.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Terminal Settings */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}>
          Terminal
        </div>
        <SettingRow label="Font Size" value="14px" />
        <SettingRow label="Scrollback" value="10,000 lines" />
        <SettingRow label="Cursor Style" value="Bar" />
        <SettingRow label="Cursor Blink" value="On" />
      </div>

      {/* Notifications */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}>
          Notifications
        </div>
        {!notifSupported ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Desktop notifications are not supported on this OS.
          </div>
        ) : notif ? (
          <>
            <ToggleRow
              label="Enabled"
              value={notif.enabled}
              onChange={(v) => void updateNotif({ enabled: v })}
            />
            <ToggleRow
              label="On Claude exit"
              value={notif.notifyOnPtyExit}
              disabled={!notif.enabled}
              onChange={(v) => void updateNotif({ notifyOnPtyExit: v })}
            />
            <ToggleRow
              label="On vault sync error"
              value={notif.notifyOnSyncError}
              disabled={!notif.enabled}
              onChange={(v) => void updateNotif({ notifyOnSyncError: v })}
            />
            <ToggleRow
              label="On update available"
              value={notif.notifyOnUpdateAvailable}
              disabled={!notif.enabled}
              onChange={(v) => void updateNotif({ notifyOnUpdateAvailable: v })}
            />
            <ToggleRow
              label="On daily cost budget hit"
              value={notif.notifyOnCostBudget}
              disabled={!notif.enabled}
              onChange={(v) => void updateNotif({ notifyOnCostBudget: v })}
            />
            <button
              onClick={() => void window.electronAPI.notifications.test()}
              style={{
                marginTop: 6,
                padding: '5px 10px',
                fontSize: 11,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Send test notification
            </button>
            {notifError && (
              <div style={{
                marginTop: 6,
                padding: '6px 8px',
                fontSize: 11,
                color: 'var(--danger, #ef4444)',
                background: 'rgba(239,68,68,0.08)',
                borderRadius: 'var(--radius-sm)',
              }}>
                {notifError}
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Updates */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}>
          Updates
        </div>
        {updaterState ? (
          <>
            <SettingRow
              label="Current version"
              value={`v${updaterState.currentVersion}`}
            />
            <SettingRow
              label="Status"
              value={updaterStatusLabel(updaterState)}
            />
            <SettingRow
              label="Last checked"
              value={formatTimestamp(updaterState.lastCheckedAt)}
            />
            {updaterState.pendingVersion && (
              <SettingRow
                label="Pending install"
                value={`v${updaterState.pendingVersion} (on next launch)`}
              />
            )}
            {updaterSettings && (
              <SettingRow
                label="Channel"
                value="stable"
              />
            )}
            {updaterSettings && (
              <ToggleRow
                label="Auto-update enabled"
                value={updaterSettings.enabled}
                onChange={(v) => void updateUpdater({ enabled: v })}
              />
            )}
            <button
              onClick={() => void checkForUpdatesNow()}
              disabled={updaterChecking || !updaterState.active}
              style={{
                marginTop: 6,
                padding: '5px 10px',
                fontSize: 11,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                cursor: (updaterChecking || !updaterState.active) ? 'not-allowed' : 'pointer',
                opacity: (updaterChecking || !updaterState.active) ? 0.5 : 1,
              }}
            >
              {updaterChecking ? 'Checking…' : 'Check for updates now'}
            </button>
            {!updaterState.active && updaterState.inactiveReason && (
              <div style={{
                marginTop: 6,
                fontSize: 11,
                color: 'var(--text-muted)',
                lineHeight: 1.4,
              }}>
                {inactiveReasonCopy(updaterState.inactiveReason)}
              </div>
            )}
            {(updaterError || updaterState.lastError) && (
              <div style={{
                marginTop: 6,
                padding: '6px 8px',
                fontSize: 11,
                color: 'var(--danger, #ef4444)',
                background: 'rgba(239,68,68,0.08)',
                borderRadius: 'var(--radius-sm)',
                lineHeight: 1.4,
                wordBreak: 'break-word',
              }}>
                {updaterError || updaterState.lastError}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Loading updater status…
          </div>
        )}
      </div>

      {/* System Tray */}
      {tray && (
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 10,
          }}>
            System tray
          </div>
          <ToggleRow
            label="Minimize to tray on close"
            value={tray.minimizeToTrayOnClose}
            onChange={(v) => void updateTray({ minimizeToTrayOnClose: v })}
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
            When enabled, closing the window hides it to the system tray
            instead of quitting. Right-click the tray icon for options.
            Background services (cost sampler, vault sync, auto-updater)
            keep running while hidden — notifications will accumulate until
            you bring the window back, or until you sign out / disable them.
          </div>
        </div>
      )}

      {/* Hotkeys */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>Hotkeys</span>
          {hotkeys && (
            <button
              onClick={() => void handleResetHotkeys()}
              style={{
                padding: '3px 8px',
                fontSize: 10,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Reset defaults
            </button>
          )}
        </div>
        {hotkeys ? (
          <>
            {hotkeys.bindings.map((b) => (
              <HotkeyRow
                key={b.action}
                binding={b}
                recording={recordingAction === b.action}
                onStartRecording={() => {
                  setHotkeyError(null);
                  setRecordingAction(b.action);
                }}
                onClear={() => void handleBind(b.action, null)}
              />
            ))}
            {recordingAction && (
              <div style={{ fontSize: 10, color: 'var(--accent-light)', marginTop: 6, lineHeight: 1.4 }}>
                Press a key combination. Esc to cancel.
              </div>
            )}
            {hotkeyError && (
              <div
                role="alert"
                style={{ fontSize: 10, color: '#ff8888', marginTop: 6, lineHeight: 1.4 }}
              >
                {hotkeyError}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</div>
        )}
      </div>

      {/* Claude CLI */}
      <div style={{
        padding: '14px 16px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Claude CLI
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
          The first-launch onboarding helps install or sign in to the Claude
          Code CLI. If you dismissed it, you can re-show it here.
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await window.electronAPI.cli.resetOnboarding();
              alert('Re-shown on next restart. Close and reopen Claude Code Studio.');
            } catch {
              alert('Could not reset onboarding state.');
            }
          }}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            padding: '6px 12px',
            fontSize: 11,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Re-show CLI onboarding
        </button>
      </div>

      {/* About */}
      <div style={{
        padding: '14px 16px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          About
        </div>
        <SettingRow label="App Version" value="1.1.0-dev" />
        <SettingRow label="Electron" value="42.2.0" />
        <SettingRow label="React" value="19.x" />
        <SettingRow label="Author" value="LxveAce" />
      </div>
    </div>
  );
}

function updaterStatusLabel(s: UpdaterState): string {
  if (s.pendingVersion) return `Update v${s.pendingVersion} ready`;
  if (s.active) return 'Active — checking automatically';
  switch (s.inactiveReason) {
    case 'dev-mode': return 'Inactive (dev mode)';
    case 'unsupported-platform': return 'Inactive (platform not supported)';
    case 'disabled': return 'Disabled in settings';
    case 'unsigned': return 'Inactive (unsigned build)';
    case 'init-error': return 'Inactive (init error)';
    default: return 'Inactive';
  }
}

function inactiveReasonCopy(reason: NonNullable<UpdaterState['inactiveReason']>): string {
  switch (reason) {
    case 'dev-mode':
      return 'Auto-update is skipped when running from "npm start". Build a packaged installer to test the full flow.';
    case 'unsupported-platform':
      return 'Auto-update via Squirrel is only supported on Windows and macOS.';
    case 'disabled':
      return 'Auto-update is disabled. Toggle "Auto-update enabled" above and restart the app to re-enable.';
    case 'unsigned':
      return 'Auto-update requires a signed build on this platform.';
    case 'init-error':
      return 'The updater failed to initialize. See last error above.';
  }
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unknown';
    // Render local date+time in a compact form.
    const date = d.toLocaleDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  } catch {
    return 'Unknown';
  }
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '5px 0',
      fontSize: 12,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function HotkeyRow({
  binding,
  recording,
  onStartRecording,
  onClear,
}: {
  binding: HotkeyBinding;
  recording: boolean;
  onStartRecording: () => void;
  onClear: () => void;
}) {
  const label = ACTION_LABELS[binding.action];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 0',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>
        {label}
      </span>
      <button
        onClick={onStartRecording}
        style={{
          minWidth: 110,
          padding: '4px 8px',
          fontSize: 11,
          border: `1px solid ${recording ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)',
          background: recording ? 'var(--accent-dim)' : 'var(--bg-elevated)',
          color: recording ? 'var(--accent-light)' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontFamily: 'monospace',
        }}
      >
        {recording ? 'Press keys…' : binding.chord ?? '(unbound)'}
      </button>
      {binding.chord && !recording && (
        <button
          onClick={onClear}
          title="Clear binding"
          style={{
            padding: '4px 6px',
            fontSize: 11,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '5px 0',
      fontSize: 12,
      opacity: disabled ? 0.5 : 1,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        style={{
          width: 32,
          height: 18,
          borderRadius: 9,
          border: 'none',
          padding: 1.5,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: value ? 'var(--accent)' : 'var(--gauge-grey)',
          transition: 'background var(--transition-base)',
          flexShrink: 0,
        }}
      >
        <div style={{
          width: 15,
          height: 15,
          borderRadius: '50%',
          background: '#fff',
          transition: 'transform var(--transition-base)',
          transform: `translateX(${value ? 14 : 0}px)`,
        }} />
      </button>
    </div>
  );
}
