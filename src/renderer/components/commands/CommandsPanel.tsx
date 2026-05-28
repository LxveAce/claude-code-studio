import React, { useEffect, useState } from 'react';
import { QuickCommands } from './QuickCommands';
import { COMMAND_FAMILIES, type CommandFamily } from './command-families';

interface CommandsPanelProps {
  /** Optional `submit` arg lets per-command settings opt out of the
   *  default auto-submit-on-click behavior; CommandDef.submit === false
   *  routes the command into the composer without an Enter at the end. */
  onSendCommand: (command: string, submit?: boolean) => void;
  /** Family of the currently active terminal tab. Drives which command
   *  list, quick actions, and shortcuts to surface. Defaults to 'claude'
   *  if not provided so the panel renders sensibly in isolation. */
  family?: CommandFamily;
  /** v4.0.3: Claude (Chat) empty-state CTA — spawn a plain Claude tab so
   *  the user can use slash commands. Wired by App.tsx to its existing
   *  handleNewClaudeTab. Optional so the panel still renders in isolation. */
  onSpawnPlainClaudeTab?: () => void;
}

type TabId = 'quick' | 'all' | 'keys';

export function CommandsPanel({
  onSendCommand,
  family = 'claude',
  onSpawnPlainClaudeTab,
}: CommandsPanelProps) {
  const config = COMMAND_FAMILIES[family] ?? COMMAND_FAMILIES.unknown;
  const [tab, setTab] = useState<TabId>('quick');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Collapse the open section whenever the family changes — the previous
  // section name almost certainly doesn't exist in the new family.
  useEffect(() => {
    setExpandedSection(null);
  }, [family]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'quick', label: 'Quick Actions' },
    { id: 'all', label: 'All Commands' },
    { id: 'keys', label: 'Shortcuts' },
  ];

  const slashSections = Object.entries(config.slashCommands);
  const hasSlash = slashSections.length > 0;

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
        <span
          data-family-chip={family}
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 500,
            padding: '2px 8px',
            borderRadius: 'var(--radius-xl)',
            background: 'var(--accent-dim)',
            color: 'var(--accent-light)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
          title={`Mirroring the active tab's profile: ${config.label}`}
        >
          {config.label}
        </span>
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

      {/* v4.0.3: Claude (Chat) doesn't accept slash commands — surface
       *  a direct way out to a plain Claude tab.  Sits above QuickCommands
       *  so it's the first thing visible alongside the empty-state copy. */}
      {family === 'claude-chat' && onSpawnPlainClaudeTab && (
        <button
          onClick={onSpawnPlainClaudeTab}
          data-cta="spawn-plain-claude"
          title="Open a new Claude tab that supports slash commands and Quick Actions."
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '10px 12px',
            marginBottom: 10,
            borderRadius: 'var(--radius-md)',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: 'var(--accent-dim, rgba(167,139,250,0.35))',
            background: 'var(--accent-gradient-soft, rgba(167,139,250,0.08))',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
            transition: 'all var(--transition-fast)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateX(2px)';
            e.currentTarget.style.borderColor = 'var(--border-active, rgba(167,139,250,0.55))';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'none';
            e.currentTarget.style.borderColor = 'var(--accent-dim, rgba(167,139,250,0.35))';
          }}
        >
          <span>+ Switch to a plain Claude tab</span>
          <span style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            fontWeight: 400,
          }}>
            slash commands & quick actions
          </span>
        </button>
      )}

      {tab === 'quick' && (
        <QuickCommands
          onSendCommand={onSendCommand}
          commands={config.quickCommands}
          categories={config.quickCategories}
          emptyMessage={config.emptyMessage}
        />
      )}

      {tab === 'all' && (
        !hasSlash ? (
          <div style={emptyBlockStyle}>
            {config.emptyMessage ?? 'No slash commands documented for this profile.'}
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {slashSections.map(([section, commands]) => {
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
        )
      )}

      {tab === 'keys' && (
        config.shortcuts.length === 0 ? (
          <div style={emptyBlockStyle}>
            No shortcuts documented for this profile.
          </div>
        ) : (
        <div style={{
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}>
          {config.shortcuts.map((shortcut, i) => (
            <div
              key={shortcut.name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                borderBottom:
                  i < config.shortcuts.length - 1
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
        )
      )}
    </div>
  );
}

const emptyBlockStyle: React.CSSProperties = {
  padding: '20px 12px',
  background: 'var(--bg-primary)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  fontSize: 12,
  color: 'var(--text-muted)',
  textAlign: 'center',
};
