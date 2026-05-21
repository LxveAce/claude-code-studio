import React from 'react';

interface StatusBarProps {
  pid: number;
}

export function StatusBar({ pid }: StatusBarProps) {
  return (
    <div style={{
      height: 24,
      backgroundColor: 'var(--accent-purple)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      fontSize: 12,
      color: '#fff',
      gap: 16,
    }}>
      <span>{pid > 0 ? `Claude PID: ${pid}` : 'Claude: starting...'}</span>
      <span style={{ opacity: 0.7 }}>|</span>
      <span>Claude Code Studio v1.0.0</span>
    </div>
  );
}
