import React from 'react';

declare global {
  interface Window {
    electronAPI: {
      terminal: {
        onData: (cb: (data: string) => void) => void;
        onExit: (cb: (code: number) => void) => void;
        onReady: (cb: (pid: number) => void) => void;
        sendInput: (data: string) => void;
        resize: (cols: number, rows: number) => void;
        restart: () => void;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };
    };
  }
}

export function TitleBar() {
  return (
    <div style={{
      height: 36,
      backgroundColor: 'var(--bg-secondary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      // @ts-expect-error Electron-specific CSS property
      WebkitAppRegion: 'drag',
      borderBottom: '1px solid var(--border-color)',
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          color: 'var(--accent-purple-light)',
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: '0.5px',
        }}>
          Claude Code Studio
        </span>
      </div>
      <div style={{
        display: 'flex',
        gap: 0,
        // @ts-expect-error Electron-specific CSS property
        WebkitAppRegion: 'no-drag',
      }}>
        <WindowButton label="–" onClick={() => window.electronAPI.window.minimize()} />
        <WindowButton label="□" onClick={() => window.electronAPI.window.maximize()} />
        <WindowButton label="✕" onClick={() => window.electronAPI.window.close()} isClose />
      </div>
    </div>
  );
}

function WindowButton({ label, onClick, isClose }: {
  label: string;
  onClick: () => void;
  isClose?: boolean;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 46,
        height: 36,
        border: 'none',
        background: hovered ? (isClose ? '#e81123' : 'rgba(255,255,255,0.1)') : 'transparent',
        color: hovered && isClose ? '#fff' : 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );
}
