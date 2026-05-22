import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SidebarPanel } from '../../App';
import type { Snippet } from '../../../shared/types';
import { THEME_PRESETS, applyTheme } from '../../theme-presets';
import { SnippetEditorModal } from './SnippetEditorModal';

export interface PaletteAction {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSwitchPanel: (panel: SidebarPanel) => void;
  onSendToTerminal: (text: string, submit: boolean) => void;
  onRestartTerminal: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onSwitchPanel,
  onSendToTerminal,
  onRestartTerminal,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [editorOpen, setEditorOpen] = useState<{ initial: Snippet | null } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshSnippets = useCallback(async () => {
    try {
      setSnippets(await window.electronAPI.snippets.list());
    } catch {
      setSnippets([]);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      void refreshSnippets();
      // focus next tick so the modal mounts first
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, refreshSnippets]);

  const actions = useMemo<PaletteAction[]>(() => {
    const panels: { id: SidebarPanel; label: string }[] = [
      { id: 'terminal', label: 'Terminal' },
      { id: 'commands', label: 'Commands' },
      { id: 'resources', label: 'Resources' },
      { id: 'cost', label: 'Cost' },
      { id: 'compact', label: 'Compact' },
      { id: 'lmm', label: 'LMM' },
      { id: 'github', label: 'GitHub' },
      { id: 'sync', label: 'Cloud Sync' },
      { id: 'auth', label: 'Account' },
      { id: 'settings', label: 'Settings' },
    ];
    const panelActions: PaletteAction[] = panels.map((p) => ({
      id: `panel:${p.id}`,
      title: `Open: ${p.label}`,
      subtitle: 'Switch sidebar panel',
      group: 'Navigate',
      keywords: `panel sidebar ${p.id} ${p.label}`,
      run: () => onSwitchPanel(p.id),
    }));

    const themeActions: PaletteAction[] = THEME_PRESETS.map((t) => ({
      id: `theme:${t.name}`,
      title: `Theme: ${t.name}`,
      subtitle: t.accent,
      group: 'Appearance',
      keywords: `theme color accent ${t.name}`,
      run: () => applyTheme(t),
    }));

    const snippetActions: PaletteAction[] = snippets.map((s) => ({
      id: `snippet:${s.id}`,
      title: `Insert: ${s.name}`,
      subtitle: previewSnippet(s.body),
      group: 'Snippets',
      keywords: `snippet ${s.name}`,
      run: () => {
        onSendToTerminal(s.body, false);
        onSwitchPanel('terminal');
      },
    }));

    const snippetMgmt: PaletteAction[] = [
      {
        id: 'snippets:new',
        title: 'Snippet: new…',
        subtitle: 'Create a reusable prompt',
        group: 'Snippets',
        keywords: 'snippet new create add',
        run: () => setEditorOpen({ initial: null }),
      },
      ...snippets.map<PaletteAction>((s) => ({
        id: `snippet:edit:${s.id}`,
        title: `Snippet: edit "${s.name}"…`,
        subtitle: 'Rename, edit body, or delete',
        group: 'Snippets',
        keywords: `snippet edit ${s.name}`,
        run: () => setEditorOpen({ initial: s }),
      })),
    ];

    const utility: PaletteAction[] = [
      {
        id: 'terminal:restart',
        title: 'Terminal: restart',
        subtitle: 'Kill and re-spawn Claude',
        group: 'Actions',
        keywords: 'restart terminal claude reload',
        run: () => onRestartTerminal(),
      },
      {
        id: 'notif:test',
        title: 'Notifications: send test',
        subtitle: 'Verify OS notifications work',
        group: 'Actions',
        keywords: 'notification test ping',
        run: () => {
          void window.electronAPI.notifications.test();
        },
      },
      {
        id: 'cost:reset',
        title: 'Cost: reset history',
        subtitle: 'Clear stored daily totals (cannot be undone)',
        group: 'Actions',
        keywords: 'cost reset history clear tokens',
        run: () => {
          void window.electronAPI.cost.resetHistory();
        },
      },
    ];

    return [...panelActions, ...themeActions, ...snippetActions, ...snippetMgmt, ...utility];
  }, [snippets, onSwitchPanel, onSendToTerminal, onRestartTerminal]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    const tokens = q.split(/\s+/);
    return actions
      .map((a) => ({ a, score: score(a, tokens) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.a);
  }, [actions, query]);

  const visible = filtered.slice(0, 50);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const a = visible[activeIdx];
        if (a) {
          void runAction(a);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, visible, activeIdx]);

  // Scroll active item into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const runAction = useCallback(
    async (a: PaletteAction) => {
      try {
        await a.run();
      } catch {
        // swallow; surfaces from individual handlers if needed
      }
      onClose();
    },
    [onClose]
  );

  if (!open && !editorOpen) return null;

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '12vh',
            zIndex: 1000,
            animation: 'fadeIn 0.12s ease',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 560,
              maxWidth: '90vw',
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command, snippet, or theme…"
              spellCheck={false}
              autoComplete="off"
              style={{
                padding: '14px 16px',
                fontSize: 14,
                border: 'none',
                borderBottom: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
            <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
              {visible.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                  No matches.
                </div>
              ) : (
                visible.map((a, i) => (
                  <ActionRow
                    key={a.id}
                    action={a}
                    active={i === activeIdx}
                    idx={i}
                    onClick={() => void runAction(a)}
                    onHover={() => setActiveIdx(i)}
                  />
                ))
              )}
            </div>
            <div style={{
              padding: '6px 12px',
              borderTop: '1px solid var(--border)',
              fontSize: 10,
              color: 'var(--text-muted)',
              display: 'flex',
              gap: 12,
              justifyContent: 'space-between',
            }}>
              <span>↑↓ navigate · Enter select · Esc close</span>
              <span>{visible.length} of {actions.length}</span>
            </div>
          </div>
        </div>
      )}

      {editorOpen && (
        <SnippetEditorModal
          initial={editorOpen.initial}
          onClose={() => {
            setEditorOpen(null);
            // re-open the palette so the user can keep going
            if (!open) return;
          }}
          onSaved={async () => {
            setEditorOpen(null);
            await refreshSnippets();
          }}
        />
      )}
    </>
  );
}

function ActionRow({
  action,
  active,
  idx,
  onClick,
  onHover,
}: {
  action: PaletteAction;
  active: boolean;
  idx: number;
  onClick: () => void;
  onHover: () => void;
}) {
  return (
    <div
      data-idx={idx}
      onClick={onClick}
      onMouseMove={onHover}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: active ? 'var(--bg-hover)' : 'transparent',
        borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        cursor: 'pointer',
      }}
    >
      <span style={{
        fontSize: 9,
        padding: '2px 6px',
        borderRadius: 8,
        background: 'var(--bg-elevated)',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        minWidth: 60,
        textAlign: 'center',
        flexShrink: 0,
      }}>
        {action.group}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {action.title}
        </div>
        {action.subtitle && (
          <div style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 2,
          }}>
            {action.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

function previewSnippet(body: string): string {
  const first = body.split('\n')[0];
  return first.length > 80 ? first.slice(0, 79) + '…' : first;
}

function score(a: PaletteAction, tokens: string[]): number {
  const haystack = `${a.title} ${a.subtitle ?? ''} ${a.keywords ?? ''} ${a.group}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!haystack.includes(t)) return 0;
    score += a.title.toLowerCase().includes(t) ? 3 : 1;
    if (a.title.toLowerCase().startsWith(t)) score += 2;
  }
  return score;
}
