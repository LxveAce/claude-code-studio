import React, { useState, useRef, useCallback } from 'react';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { ResourcePanel } from './components/resources/ResourcePanel';
import { CompactPanel } from './components/compact/CompactPanel';
import { CommandsPanel } from './components/commands/CommandsPanel';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { GitHubPanel } from './components/github/GitHubPanel';
import { LMMPanel } from './components/lmm/LMMPanel';

export type SidebarPanel =
  | 'terminal'
  | 'commands'
  | 'resources'
  | 'github'
  | 'compact'
  | 'lmm'
  | 'sync'
  | 'auth'
  | 'settings';

export function App() {
  const [activePanel, setActivePanel] = useState<SidebarPanel>('terminal');
  const [claudePid, setClaudePid] = useState<number>(0);
  const terminalSendRef = useRef<((data: string) => void) | null>(null);

  const handleSendCommand = useCallback((command: string) => {
    if (terminalSendRef.current) {
      terminalSendRef.current(command + '\r');
    }
    setActivePanel('terminal');
  }, []);

  const showRightPanel = activePanel !== 'terminal';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: 'var(--bg-primary)',
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
          position: 'relative',
        }}>
          {/* Terminal always fills available space */}
          <TerminalPanel
            onPidChange={setClaudePid}
            sendRef={terminalSendRef}
          />

          {/* Right Panel - slides in from right */}
          {showRightPanel && (
            <div style={{
              width: 320,
              minWidth: 320,
              borderLeft: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              padding: 16,
              overflowY: 'auto',
              animation: 'slideIn 0.2s ease',
            }}>
              <RightPanel
                panel={activePanel}
                onSendCommand={handleSendCommand}
              />
            </div>
          )}
        </div>
      </div>

      <StatusBar pid={claudePid} />
    </div>
  );
}

function RightPanel({
  panel,
  onSendCommand,
}: {
  panel: SidebarPanel;
  onSendCommand: (command: string) => void;
}) {
  switch (panel) {
    case 'resources':
      return <ResourcePanel />;
    case 'compact':
      return <CompactPanel />;
    case 'commands':
      return <CommandsPanel onSendCommand={onSendCommand} />;
    case 'settings':
      return <SettingsPanel />;
    case 'github':
      return <GitHubPanel />;
    case 'lmm':
      return <LMMPanel />;
    default:
      return <PlaceholderPanel panel={panel} />;
  }
}

function PlaceholderPanel({ panel }: { panel: string }) {
  const info: Record<string, { title: string; desc: string; phase: string }> = {
    sync: {
      title: 'Cloud Sync',
      desc: 'Sync conversation vaults across devices via your GitHub repo.',
      phase: 'Phase 6',
    },
    auth: {
      title: 'Account',
      desc: 'Optional login for cross-device settings sync.',
      phase: 'Phase 5',
    },
  };

  const p = info[panel] || { title: panel, desc: '', phase: '' };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3 style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 3, height: 14, borderRadius: 2,
          background: 'var(--accent-gradient)',
        }} />
        {p.title}
      </h3>

      <div style={{
        padding: '24px 16px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        textAlign: 'center',
      }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--accent-gradient-soft)',
          border: '1px solid var(--border-active)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 12px',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <div style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 8,
        }}>
          {p.desc}
        </div>
        <span style={{
          fontSize: 10,
          padding: '3px 10px',
          borderRadius: 'var(--radius-xl)',
          background: 'var(--accent-dim)',
          color: 'var(--accent-light)',
          fontWeight: 500,
        }}>
          Coming in {p.phase}
        </span>
      </div>
    </div>
  );
}
