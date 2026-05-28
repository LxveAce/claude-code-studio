import React, { useEffect, useState } from 'react';

export function TitleBar() {
  // Version sourced from the main-process `app.getVersion()` via the
  // app:version IPC (added 3.0.0-beta.2). Was hardcoded "v1.0.0" through
  // v2.0; that drift is what produced the title=v1 / status=v2 / installer=v3
  // mismatch the user caught in beta.1 testing.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.app.version()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        // IPC missing (very old preload?) — leave version null so we render
        // the label without a value rather than a wrong hardcoded one.
      });
    return () => { cancelled = true; };
  }, []);
  return (
    <div style={{
      height: 40,
      background: 'var(--bg-secondary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      // @ts-expect-error Electron-specific CSS property
      WebkitAppRegion: 'drag',
      borderBottom: '1px solid var(--border)',
      userSelect: 'none',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          background: 'var(--accent-gradient)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-glow)',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </div>
        <span style={{
          color: 'var(--text-primary)',
          fontWeight: 600,
          fontSize: 13,
          letterSpacing: '0.3px',
        }}>
          Catalyst UI
        </span>
        <span
          style={{
            fontSize: 9,
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            marginLeft: -4,
          }}
          title="Formerly known as Claude Code Studio"
        >
          (fka Claude Code Studio)
        </span>
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          padding: '1px 6px',
          borderRadius: 4,
          border: '1px solid var(--border)',
          fontWeight: 500,
        }}>
          {version ? `v${version}` : ''}
        </span>
      </div>

      <div style={{
        display: 'flex',
        gap: 2,
        // @ts-expect-error Electron-specific CSS property
        WebkitAppRegion: 'no-drag',
      }}>
        <WinButton
          icon={<svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>}
          onClick={() => window.electronAPI.window.minimize()}
        />
        <WinButton
          icon={<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9"/></svg>}
          onClick={() => window.electronAPI.window.maximize()}
        />
        <WinButton
          icon={<svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>}
          onClick={() => window.electronAPI.window.close()}
          isClose
        />
      </div>
    </div>
  );
}

function WinButton({ icon, onClick, isClose }: {
  icon: React.ReactNode;
  onClick: () => void;
  isClose?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 46,
        height: 32,
        border: 'none',
        borderRadius: 0,
        background: hovered
          ? (isClose ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.06)')
          : 'transparent',
        color: hovered && isClose ? '#fff' : 'var(--text-secondary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background var(--transition-fast), color var(--transition-fast)',
      }}
    >
      {icon}
    </button>
  );
}
