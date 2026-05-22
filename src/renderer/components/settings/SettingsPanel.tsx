import React, { useState, useEffect } from 'react';
import { THEME_PRESETS, applyTheme, findThemePreset, type ThemePreset } from '../../theme-presets';
import type { NotificationSettings } from '../../../shared/types';

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

  useEffect(() => {
    const saved = localStorage.getItem('claude-studio-theme');
    const preset = findThemePreset(saved);
    if (preset) {
      setActiveTheme(preset.name);
      applyTheme(preset);
    }
    void (async () => {
      setNotifSupported(await window.electronAPI.notifications.supported());
      setNotif(await window.electronAPI.notifications.getSettings());
    })();
  }, []);

  const handleThemeChange = (preset: ThemePreset) => {
    setActiveTheme(preset.name);
    applyTheme(preset);
  };

  const updateNotif = async (patch: Partial<NotificationSettings>) => {
    const next = await window.electronAPI.notifications.setSettings(patch);
    setNotif(next);
  };

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
          </>
        ) : null}
      </div>

      {/* Shortcuts */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}>
          Shortcuts
        </div>
        <SettingRow label="Command palette" value="Ctrl+Shift+P" />
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
        <SettingRow label="App Version" value="1.0.0" />
        <SettingRow label="Electron" value="42.2.0" />
        <SettingRow label="React" value="19.x" />
        <SettingRow label="Author" value="LxveAce" />
      </div>
    </div>
  );
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
