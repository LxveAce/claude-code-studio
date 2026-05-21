import React, { useState } from 'react';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { TerminalPanel } from './components/terminal/TerminalPanel';

export type SidebarPanel = 'terminal' | 'resources' | 'github' | 'compact' | 'sync' | 'auth' | 'settings';

export function App() {
  const [activePanel, setActivePanel] = useState<SidebarPanel>('terminal');
  const [claudePid, setClaudePid] = useState<number>(0);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
    }}>
      <TitleBar />
      <div style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
      }}>
        <Sidebar activePanel={activePanel} onPanelChange={setActivePanel} />
        <div style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
        }}>
          <TerminalPanel onPidChange={setClaudePid} />
          {activePanel !== 'terminal' && (
            <div style={{
              width: 320,
              borderLeft: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-secondary)',
              padding: 16,
              overflowY: 'auto',
            }}>
              <RightPanel panel={activePanel} />
            </div>
          )}
        </div>
      </div>
      <StatusBar pid={claudePid} />
    </div>
  );
}

function RightPanel({ panel }: { panel: SidebarPanel }) {
  const placeholders: Record<string, string> = {
    resources: 'Resource Monitor — Coming in Phase 2',
    github: 'GitHub Integration — Coming in Phase 4',
    compact: 'Compact Optimization — Coming in Phase 3',
    sync: 'Cloud Sync — Coming in Phase 6',
    auth: 'Authentication — Coming in Phase 5',
    settings: 'Settings — Coming in Phase 7',
  };

  return (
    <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
      <h3 style={{ marginBottom: 8, color: 'var(--text-primary)' }}>
        {panel.charAt(0).toUpperCase() + panel.slice(1)}
      </h3>
      <p>{placeholders[panel] || ''}</p>
    </div>
  );
}
