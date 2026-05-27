import React, { useEffect } from 'react';
import { EmbeddedTerminal } from './EmbeddedTerminal';

/**
 * Pop-out window view — minimal layout that just hosts the EmbeddedTerminal
 * for one paneId, full-window. Triggered by URL params:
 *   ?popout=<paneId>&label=<modelName>
 *
 * The pop-out BrowserWindow is created in main (setupPopout) and inherits
 * the same preload, so electronAPI is available exactly as in the main
 * window. The terminal subscribes to the existing paneId — the PTY itself
 * was already spawned in main; this is purely a view.
 */

interface Props {
  paneId: string;
  label: string;
}

export function PopoutView({ paneId, label }: Props) {
  useEffect(() => {
    document.title = `${label} — Claude Code Studio`;
  }, [label]);

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #ececf1)' }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted, #8b8b9e)', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
          paneId: {paneId}
        </span>
      </div>
      <div style={{ flex: 1, padding: 8, minHeight: 0 }}>
        <EmbeddedTerminal paneId={paneId} compact={false} />
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  background: '#0a0a14',
  color: '#ececf1',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  background: '#0f0f1a',
};
