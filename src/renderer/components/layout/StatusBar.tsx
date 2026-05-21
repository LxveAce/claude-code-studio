import React from 'react';

interface StatusBarProps {
  pid: number;
}

export function StatusBar({ pid }: StatusBarProps) {
  return (
    <div style={{
      height: 28,
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      fontSize: 11,
      color: 'var(--text-muted)',
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: pid > 0 ? 'var(--success)' : 'var(--danger)',
            boxShadow: pid > 0 ? '0 0 6px rgba(34,197,94,0.4)' : '0 0 6px rgba(239,68,68,0.4)',
          }} />
          <span>{pid > 0 ? 'Connected' : 'Disconnected'}</span>
        </div>
        {pid > 0 && (
          <span style={{ color: 'var(--text-muted)' }}>
            PID {pid}
          </span>
        )}
      </div>
      <span>Claude Code Studio v1.0.0</span>
    </div>
  );
}
