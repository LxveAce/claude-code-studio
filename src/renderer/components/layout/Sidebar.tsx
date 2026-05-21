import React from 'react';
import type { SidebarPanel } from '../../App';

interface SidebarProps {
  activePanel: SidebarPanel;
  onPanelChange: (panel: SidebarPanel) => void;
}

const panels: { id: SidebarPanel; label: string; icon: string }[] = [
  { id: 'terminal', label: 'Terminal', icon: '>' },
  { id: 'resources', label: 'Resources', icon: '#' },
  { id: 'github', label: 'GitHub', icon: 'G' },
  { id: 'compact', label: 'Compact', icon: 'C' },
  { id: 'sync', label: 'Sync', icon: 'S' },
  { id: 'auth', label: 'Account', icon: 'A' },
  { id: 'settings', label: 'Settings', icon: '*' },
];

export function Sidebar({ activePanel, onPanelChange }: SidebarProps) {
  return (
    <div style={{
      width: 48,
      backgroundColor: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 8,
      gap: 4,
    }}>
      {panels.map((panel) => (
        <SidebarButton
          key={panel.id}
          icon={panel.icon}
          label={panel.label}
          active={activePanel === panel.id}
          onClick={() => onPanelChange(panel.id)}
        />
      ))}
    </div>
  );
}

function SidebarButton({ icon, label, active, onClick }: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={label}
      style={{
        width: 36,
        height: 36,
        border: 'none',
        borderRadius: 6,
        background: active
          ? 'var(--accent-purple)'
          : hovered
            ? 'rgba(255,255,255,0.08)'
            : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 16,
        fontWeight: active ? 700 : 400,
        fontFamily: 'monospace',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s',
      }}
    >
      {icon}
    </button>
  );
}
