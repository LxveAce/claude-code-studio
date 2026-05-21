import React, { useState } from 'react';
import { QuickCommands } from './QuickCommands';

interface CommandEntry {
  name: string;
  description: string;
}

const SLASH_COMMANDS: Record<string, CommandEntry[]> = {
  'Model & Effort': [
    { name: '/model [model]', description: 'Set model (opus, sonnet, haiku)' },
    { name: '/effort [level]', description: 'Set effort: low, medium, high, max' },
    { name: '/fast [on|off]', description: 'Toggle fast output mode' },
  ],
  'Session': [
    { name: '/clear', description: 'Start new conversation' },
    { name: '/resume [session]', description: 'Resume session by ID or name' },
    { name: '/compact [instructions]', description: 'Free up context' },
    { name: '/context [all]', description: 'Visualize context usage' },
    { name: '/branch [name]', description: 'Create conversation branch' },
    { name: '/rename [name]', description: 'Rename current session' },
    { name: '/export [filename]', description: 'Export conversation as text' },
    { name: '/copy [N]', description: 'Copy last N responses' },
    { name: '/rewind', description: 'Rewind to previous point' },
    { name: '/background [prompt]', description: 'Detach to background' },
  ],
  'Workflow': [
    { name: '/plan [desc]', description: 'Enter plan mode' },
    { name: '/review [PR]', description: 'Review pull request' },
    { name: '/diff', description: 'View uncommitted changes' },
    { name: '/simplify [focus]', description: 'Code quality review' },
    { name: '/batch <instr>', description: 'Parallel codebase changes' },
    { name: '/loop [interval]', description: 'Run prompt repeatedly' },
    { name: '/goal [condition]', description: 'Work until goal met' },
  ],
  'Config': [
    { name: '/init', description: 'Initialize project with CLAUDE.md' },
    { name: '/memory', description: 'Edit CLAUDE.md memory files' },
    { name: '/permissions', description: 'Manage tool permissions' },
    { name: '/config', description: 'Open settings UI' },
    { name: '/mcp', description: 'Manage MCP servers' },
    { name: '/theme', description: 'Change color theme' },
    { name: '/debug [desc]', description: 'Enable debug logging' },
    { name: '/hooks', description: 'View hook configurations' },
  ],
  'Info & Utils': [
    { name: '/help', description: 'Show help' },
    { name: '/usage', description: 'Session cost & usage' },
    { name: '/doctor', description: 'Diagnose installation' },
    { name: '/feedback', description: 'Submit feedback' },
    { name: '/btw <q>', description: 'Quick side question' },
    { name: '/recap', description: 'Session summary' },
    { name: '/tasks', description: 'List background tasks' },
  ],
};

const KEYBOARD_SHORTCUTS: CommandEntry[] = [
  { name: 'Ctrl+C', description: 'Interrupt or clear input' },
  { name: 'Escape', description: 'Stop response' },
  { name: 'Ctrl+D', description: 'Exit Claude Code' },
  { name: 'Ctrl+R', description: 'Search history' },
  { name: 'Ctrl+O', description: 'Toggle transcript' },
  { name: 'Ctrl+L', description: 'Redraw screen' },
  { name: 'Shift+Tab', description: 'Cycle permission modes' },
  { name: 'Alt+P', description: 'Switch model' },
  { name: 'Alt+T', description: 'Toggle thinking' },
  { name: 'Alt+O', description: 'Toggle fast mode' },
  { name: 'Ctrl+J', description: 'Newline in input' },
];

interface CommandsPanelProps {
  onSendCommand: (command: string) => void;
}

type TabId = 'quick' | 'all' | 'keys';

export function CommandsPanel({ onSendCommand }: CommandsPanelProps) {
  const [tab, setTab] = useState<TabId>('quick');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'quick', label: 'Quick Actions' },
    { id: 'all', label: 'All Commands' },
    { id: 'keys', label: 'Shortcuts' },
  ];

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
        Commands
      </h3>

      {/* Tab Bar */}
      <div style={{
        display: 'flex',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        padding: 3,
        marginBottom: 14,
        border: '1px solid var(--border)',
      }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: '6px 0',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: tab === t.id ? 'var(--accent-gradient)' : 'transparent',
              color: tab === t.id ? '#fff' : 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: tab === t.id ? 600 : 400,
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'quick' && <QuickCommands onSendCommand={onSendCommand} />}

      {tab === 'all' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(SLASH_COMMANDS).map(([section, commands]) => {
            const isOpen = expandedSection === section;
            return (
              <div
                key={section}
                style={{
                  background: 'var(--bg-primary)',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${isOpen ? 'var(--border-active)' : 'var(--border)'}`,
                  overflow: 'hidden',
                  transition: 'border-color var(--transition-fast)',
                }}
              >
                <button
                  onClick={() =>
                    setExpandedSection(isOpen ? null : section)
                  }
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  {section}
                  <svg
                    width="12" height="12" viewBox="0 0 12 12"
                    fill="none" stroke="currentColor" strokeWidth="1.5"
                    style={{
                      color: 'var(--text-muted)',
                      transition: 'transform var(--transition-fast)',
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
                    }}
                  >
                    <polyline points="2 4 6 8 10 4" />
                  </svg>
                </button>
                {isOpen && (
                  <div style={{ padding: '0 4px 4px' }}>
                    {commands.map((cmd) => (
                      <button
                        key={cmd.name}
                        onClick={() => onSendCommand(cmd.name.split(' ')[0])}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          width: '100%',
                          padding: '6px 8px',
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                          borderRadius: 'var(--radius-sm)',
                          transition: 'background var(--transition-fast)',
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = 'rgba(124,58,237,0.08)')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = 'transparent')
                        }
                      >
                        <span style={{
                          fontSize: 12,
                          color: 'var(--accent-light)',
                          fontFamily: 'monospace',
                        }}>
                          {cmd.name}
                        </span>
                        <span style={{
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          marginLeft: 8,
                          textAlign: 'right',
                        }}>
                          {cmd.description}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'keys' && (
        <div style={{
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}>
          {KEYBOARD_SHORTCUTS.map((shortcut, i) => (
            <div
              key={shortcut.name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                borderBottom:
                  i < KEYBOARD_SHORTCUTS.length - 1
                    ? '1px solid var(--border)'
                    : 'none',
              }}
            >
              <kbd style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                fontWeight: 500,
              }}>
                {shortcut.name}
              </kbd>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {shortcut.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
