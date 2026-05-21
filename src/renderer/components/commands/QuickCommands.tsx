import React, { useState } from 'react';

interface CommandDef {
  label: string;
  command: string;
  description: string;
  category: string;
}

const QUICK_COMMANDS: CommandDef[] = [
  { label: 'Opus', command: '/model opus', description: 'Most capable model', category: 'Model' },
  { label: 'Sonnet', command: '/model sonnet', description: 'Fast & capable', category: 'Model' },
  { label: 'Haiku', command: '/model haiku', description: 'Fastest model', category: 'Model' },
  { label: 'Fast Mode', command: '/fast', description: 'Toggle fast output', category: 'Model' },
  { label: 'Max', command: '/effort max', description: 'Maximum reasoning', category: 'Effort' },
  { label: 'High', command: '/effort high', description: 'High reasoning', category: 'Effort' },
  { label: 'Medium', command: '/effort medium', description: 'Balanced', category: 'Effort' },
  { label: 'Low', command: '/effort low', description: 'Quick responses', category: 'Effort' },
  { label: 'Compact', command: '/compact', description: 'Summarize & free context', category: 'Session' },
  { label: 'Clear', command: '/clear', description: 'New conversation', category: 'Session' },
  { label: 'Resume', command: '/resume', description: 'Resume previous', category: 'Session' },
  { label: 'Context', command: '/context', description: 'View usage grid', category: 'Session' },
  { label: 'Plan', command: '/plan', description: 'Enter plan mode', category: 'Workflow' },
  { label: 'Review', command: '/review', description: 'Review PR', category: 'Workflow' },
  { label: 'Diff', command: '/diff', description: 'View changes', category: 'Workflow' },
  { label: 'Simplify', command: '/simplify', description: 'Code quality check', category: 'Workflow' },
  { label: 'Usage', command: '/usage', description: 'Session cost & stats', category: 'Info' },
  { label: 'Help', command: '/help', description: 'Show help', category: 'Info' },
  { label: 'Doctor', command: '/doctor', description: 'Diagnose install', category: 'Info' },
  { label: 'Permissions', command: '/permissions', description: 'Manage tools', category: 'Config' },
  { label: 'Memory', command: '/memory', description: 'Edit memory files', category: 'Config' },
  { label: 'Init', command: '/init', description: 'Initialize project', category: 'Config' },
];

const CATEGORIES = ['Model', 'Effort', 'Session', 'Workflow', 'Info', 'Config'];

interface QuickCommandsProps {
  onSendCommand: (command: string) => void;
}

export function QuickCommands({ onSendCommand }: QuickCommandsProps) {
  const [activeCategory, setActiveCategory] = useState('Model');
  const [hoveredCmd, setHoveredCmd] = useState<string | null>(null);

  const filtered = QUICK_COMMANDS.filter((c) => c.category === activeCategory);

  return (
    <div>
      {/* Category Pills */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        marginBottom: 12,
      }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '5px 12px',
              borderRadius: 'var(--radius-xl)',
              border: activeCategory === cat ? 'none' : '1px solid var(--border)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              background: activeCategory === cat ? 'var(--accent-gradient)' : 'transparent',
              color: activeCategory === cat ? '#fff' : 'var(--text-secondary)',
              transition: 'all var(--transition-fast)',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Commands List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map((cmd) => {
          const isHovered = hoveredCmd === cmd.command;
          return (
            <button
              key={cmd.command}
              onClick={() => onSendCommand(cmd.command)}
              onMouseEnter={() => setHoveredCmd(cmd.command)}
              onMouseLeave={() => setHoveredCmd(null)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${isHovered ? 'var(--border-active)' : 'var(--border)'}`,
                cursor: 'pointer',
                background: isHovered ? 'var(--accent-gradient-soft)' : 'var(--bg-primary)',
                textAlign: 'left',
                transition: 'all var(--transition-fast)',
                transform: isHovered ? 'translateX(2px)' : 'none',
              }}
            >
              <div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}>
                  {cmd.label}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 1,
                }}>
                  {cmd.description}
                </div>
              </div>
              <span style={{
                fontSize: 11,
                color: 'var(--accent-light)',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                opacity: isHovered ? 1 : 0.6,
                transition: 'opacity var(--transition-fast)',
              }}>
                {cmd.command}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
