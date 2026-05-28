import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LMMCycle,
  LMMCycleSummary,
  LMMPhase,
  LMMSettings,
  LMMVariant,
} from '../../../shared/types';
import type { CommandFamily } from '../commands/command-families';

const PHASE_LABEL: Record<LMMPhase, string> = {
  raw: 'RAW',
  nodes: 'NODES',
  reflect: 'REFLECT',
  synth: 'SYNTH',
};

const PHASE_HINT: Record<LMMPhase, string> = {
  raw: 'Unfiltered thoughts. 200+ words. Include uncertainties and 3+ open questions.',
  nodes: 'Extract 5–15 numbered key points / tensions / dependencies. Don’t solve yet.',
  reflect: 'One-sentence core insight. Resolve 2+ tensions. List & challenge hidden assumptions.',
  synth: 'Concrete actionable output. Someone else could execute this.',
};

const PHASE_ORDER: LMMPhase[] = ['raw', 'nodes', 'reflect', 'synth'];

interface LMMPanelProps {
  /** CommandFamily of the currently focused terminal tab.  The panel only
   *  applies to Claude tabs (LMM journaling is a Claude-conversation
   *  practice), so non-Claude families get a "switch to a Claude tab"
   *  stub instead of the editor.  Passed from App.tsx so the panel
   *  tracks tab focus changes live. */
  activeFamily?: CommandFamily;
}

const LMM_APPLICABLE_FAMILIES = new Set<CommandFamily>(['claude', 'claude-chat']);

export function LMMPanel({ activeFamily = 'claude' }: LMMPanelProps = {}) {
  const [settings, setSettings] = useState<LMMSettings | null>(null);
  const [cycles, setCycles] = useState<LMMCycleSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCycle, setActiveCycle] = useState<LMMCycle | null>(null);
  const [phase, setPhase] = useState<LMMPhase>('raw');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // In-app "+ New cycle" modal state. Replaces window.prompt() (which
  // was unreliable in Electron and looked broken to users in some
  // window-focus states).
  const [newCycleOpen, setNewCycleOpen] = useState(false);
  const [newCycleTitle, setNewCycleTitle] = useState('');
  const newCycleInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const s = await window.electronAPI.lmm.getSettings();
    setSettings(s);
    if (s.enabled) {
      const list = await window.electronAPI.lmm.listCycles();
      setCycles(list);
    } else {
      setCycles(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch whenever the active tab's CommandFamily changes. Same
  // pattern the Commands sidebar uses to stay in sync with the focused
  // tab. Cheap: just two IPC calls.
  useEffect(() => {
    void refresh();
  }, [activeFamily, refresh]);

  // Focus the title input when the new-cycle modal opens.
  useEffect(() => {
    if (newCycleOpen) {
      // Defer until after render so the ref is mounted.
      const t = setTimeout(() => newCycleInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [newCycleOpen]);

  const loadCycle = useCallback(async (id: string, targetPhase?: LMMPhase) => {
    const cycle = await window.electronAPI.lmm.getCycle(id);
    if (!cycle) {
      setErr(`Cycle "${id}" not found`);
      return;
    }
    setActiveId(id);
    setActiveCycle(cycle);
    const nextPhase = targetPhase ?? cycle.currentPhase;
    setPhase(nextPhase);
    setDraft(cycle.phases[nextPhase] ?? '');
    setDirty(false);
    setErr(null);
  }, []);

  const handleToggleEnabled = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const next = await window.electronAPI.lmm.setSettings({ enabled: !settings.enabled });
      setSettings(next);
      if (next.enabled) {
        const list = await window.electronAPI.lmm.listCycles();
        setCycles(list);
      } else {
        setActiveId(null);
        setActiveCycle(null);
        setCycles(null);
      }
    } catch (e: unknown) {
      setErr(extractError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleVariantChange = async (variant: LMMVariant) => {
    if (!settings) return;
    const next = await window.electronAPI.lmm.setSettings({ variant });
    setSettings(next);
  };

  const handlePickDir = async () => {
    const next = await window.electronAPI.lmm.pickJournalDir();
    if (next) {
      setSettings(next);
      const list = await window.electronAPI.lmm.listCycles();
      setCycles(list);
    }
  };

  const handleOpenNewCycle = () => {
    setNewCycleTitle('');
    setErr(null);
    setNewCycleOpen(true);
  };

  const handleNewCycleSubmit = async () => {
    const title = newCycleTitle.trim();
    if (!title) {
      setErr('Title cannot be empty.');
      return;
    }
    setBusy(true);
    try {
      const cycle = await window.electronAPI.lmm.createCycle(title);
      const list = await window.electronAPI.lmm.listCycles();
      setCycles(list);
      setActiveId(cycle.id);
      setActiveCycle(cycle);
      setPhase('raw');
      setDraft('');
      setDirty(false);
      setNewCycleOpen(false);
      setNewCycleTitle('');
    } catch (e: unknown) {
      setErr(extractError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (advance: boolean) => {
    if (!activeId) return;
    setBusy(true);
    setErr(null);
    try {
      const cycle = await window.electronAPI.lmm.savePhase(activeId, phase, draft);
      setActiveCycle(cycle);
      setDirty(false);
      const list = await window.electronAPI.lmm.listCycles();
      setCycles(list);
      if (advance) {
        const idx = PHASE_ORDER.indexOf(phase);
        const next = PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)];
        setPhase(next);
        setDraft(cycle.phases[next] ?? '');
      }
    } catch (e: unknown) {
      setErr(extractError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Delete cycle "${id}"? This cannot be undone.`)) return;
    await window.electronAPI.lmm.deleteCycle(id);
    if (activeId === id) {
      setActiveId(null);
      setActiveCycle(null);
    }
    const list = await window.electronAPI.lmm.listCycles();
    setCycles(list);
  };

  const switchPhase = (next: LMMPhase) => {
    if (!activeCycle) return;
    if (dirty && !window.confirm('Discard unsaved changes for this phase?')) return;
    setPhase(next);
    setDraft(activeCycle.phases[next] ?? '');
    setDirty(false);
  };

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
        Lincoln Manifold Method
      </h3>

      {/* v3.2.1 — focus-aware. LMM only applies to Claude tabs (the
          journaling discipline is about Claude conversations).  Show a
          quick hint for non-Claude active tabs so the user understands
          why the editor isn't available.  We still let them toggle
          settings (e.g. enable/disable journaling globally) — only the
          per-cycle editor + button are gated. */}
      {!LMM_APPLICABLE_FAMILIES.has(activeFamily) && (
        <div
          role="note"
          style={{
            marginBottom: 10,
            padding: '8px 10px',
            background: 'var(--bg-primary)',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}
        >
          The active tab is a <strong style={{ color: 'var(--text-secondary)' }}>{activeFamily}</strong> session — LMM journaling is designed for Claude conversations. Switch to (or open) a Claude tab to start a new cycle.
        </div>
      )}

      {settings && (
        <ToggleCard
          enabled={settings.enabled}
          onToggle={handleToggleEnabled}
          disabled={busy}
        />
      )}

      {settings?.enabled && (
        <>
          <SettingsBlock
            settings={settings}
            show={showSettings}
            onToggleShow={() => setShowSettings((v) => !v)}
            onVariantChange={handleVariantChange}
            onPickDir={handlePickDir}
          />

          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button
              onClick={handleOpenNewCycle}
              disabled={busy || !LMM_APPLICABLE_FAMILIES.has(activeFamily)}
              style={primaryBtn}
              title={!LMM_APPLICABLE_FAMILIES.has(activeFamily) ? 'Switch to a Claude tab to start a new LMM cycle' : undefined}
            >
              + New cycle
            </button>
          </div>

          {newCycleOpen && (
            <NewCycleModal
              titleRef={newCycleInputRef}
              title={newCycleTitle}
              busy={busy}
              onTitleChange={setNewCycleTitle}
              onSubmit={() => void handleNewCycleSubmit()}
              onCancel={() => {
                setNewCycleOpen(false);
                setNewCycleTitle('');
                setErr(null);
              }}
            />
          )}

          {err && <ErrorBanner>{err}</ErrorBanner>}

          {activeCycle ? (
            <CycleEditor
              cycle={activeCycle}
              phase={phase}
              draft={draft}
              dirty={dirty}
              busy={busy}
              onDraftChange={(v) => {
                setDraft(v);
                setDirty(true);
              }}
              onSave={() => void handleSave(false)}
              onSaveAdvance={() => void handleSave(true)}
              onSwitchPhase={switchPhase}
              onClose={() => {
                if (dirty && !window.confirm('Discard unsaved changes?')) return;
                setActiveId(null);
                setActiveCycle(null);
              }}
            />
          ) : (
            <CycleList
              cycles={cycles}
              onOpen={(id) => void loadCycle(id)}
              onDelete={(id) => void handleDelete(id)}
            />
          )}
        </>
      )}

      {settings && !settings.enabled && (
        <div style={{
          marginTop: 10,
          padding: '14px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.5,
        }}>
          The Lincoln Manifold Method is a four-phase exploration process for non-trivial problems:
          <strong style={{ color: 'var(--text-secondary)' }}> RAW</strong> →
          <strong style={{ color: 'var(--text-secondary)' }}> NODES</strong> →
          <strong style={{ color: 'var(--text-secondary)' }}> REFLECT</strong> →
          <strong style={{ color: 'var(--text-secondary)' }}> SYNTHESIZE</strong>.
          Enable the toggle above to start tracking cycles. Settings persist across sessions.
        </div>
      )}
    </div>
  );
}

function ToggleCard({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: enabled ? 'var(--accent-gradient-soft)' : 'var(--bg-primary)',
      borderRadius: 'var(--radius-md)',
      border: `1px solid ${enabled ? 'var(--border-active)' : 'var(--border)'}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
      transition: 'all var(--transition-base)',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {enabled ? 'Active' : 'Inactive'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          LMM journaling
        </div>
      </div>
      <button
        onClick={onToggle}
        disabled={disabled}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          border: 'none',
          padding: 2,
          cursor: disabled ? 'wait' : 'pointer',
          background: enabled ? 'var(--accent)' : 'var(--gauge-grey)',
          transition: 'background var(--transition-base)',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <div style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          transition: 'transform var(--transition-base)',
          transform: `translateX(${enabled ? 20 : 0}px)`,
          boxShadow: 'var(--shadow-sm)',
        }} />
      </button>
    </div>
  );
}

function SettingsBlock({
  settings,
  show,
  onToggleShow,
  onVariantChange,
  onPickDir,
}: {
  settings: LMMSettings;
  show: boolean;
  onToggleShow: () => void;
  onVariantChange: (v: LMMVariant) => void;
  onPickDir: () => void;
}) {
  return (
    <div style={{
      marginBottom: 10,
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <button
        onClick={onToggleShow}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>Settings</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
          style={{ transform: show ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
          <polyline points="2 4 6 8 10 4" />
        </svg>
      </button>
      {show && (
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Journal directory</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <code style={{
              flex: 1,
              padding: '5px 8px',
              fontSize: 10,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
            }}>
              {settings.journalDir}
            </code>
            <button onClick={onPickDir} style={smallBtn}>Browse</button>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Variant</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['quick', 'deep'] as LMMVariant[]).map((v) => (
              <button
                key={v}
                onClick={() => onVariantChange(v)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: settings.variant === v ? 'var(--accent-gradient)' : 'var(--bg-elevated)',
                  color: settings.variant === v ? '#fff' : 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: settings.variant === v ? 600 : 400,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {v}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
            Quick: ~30 min total. Deep: hours/days with sleep between phases.
          </div>
        </div>
      )}
    </div>
  );
}

function CycleList({
  cycles,
  onOpen,
  onDelete,
}: {
  cycles: LMMCycleSummary[] | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!cycles) return null;
  if (cycles.length === 0) {
    return (
      <div style={{
        padding: '14px',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--text-muted)',
        fontSize: 11,
        textAlign: 'center',
      }}>
        No cycles yet. Click <strong>+ New cycle</strong> above to start.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        Recent cycles
      </div>
      {cycles.map((c) => (
        <div
          key={c.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <button
            onClick={() => onOpen(c.id)}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{
              fontSize: 11,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {c.title}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 6, marginTop: 2 }}>
              <span>{c.filledPhases.length}/4 phases</span>
              <span>·</span>
              <span>{formatRelative(c.modified)}</span>
              <PhaseDots filled={c.filledPhases} />
            </div>
          </button>
          <button
            onClick={() => onDelete(c.id)}
            title="Delete"
            style={{
              padding: '4px 6px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function PhaseDots({ filled }: { filled: LMMPhase[] }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2, marginLeft: 4 }}>
      {PHASE_ORDER.map((p) => (
        <span
          key={p}
          title={PHASE_LABEL[p]}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: filled.includes(p) ? 'var(--accent)' : 'var(--border)',
          }}
        />
      ))}
    </span>
  );
}

function CycleEditor({
  cycle,
  phase,
  draft,
  dirty,
  busy,
  onDraftChange,
  onSave,
  onSaveAdvance,
  onSwitchPhase,
  onClose,
}: {
  cycle: LMMCycle;
  phase: LMMPhase;
  draft: string;
  dirty: boolean;
  busy: boolean;
  onDraftChange: (v: string) => void;
  onSave: () => void;
  onSaveAdvance: () => void;
  onSwitchPhase: (p: LMMPhase) => void;
  onClose: () => void;
}) {
  const isLast = phase === 'synth';
  return (
    <div style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-active)',
      borderRadius: 'var(--radius-md)',
      padding: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {cycle.title}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            <code style={{ fontFamily: 'monospace' }}>{cycle.id}</code>
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close"
          style={{
            padding: '3px 8px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)',
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      <div style={{
        display: 'flex',
        gap: 3,
        marginBottom: 8,
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-sm)',
        padding: 2,
      }}>
        {PHASE_ORDER.map((p) => (
          <button
            key={p}
            onClick={() => onSwitchPhase(p)}
            style={{
              flex: 1,
              padding: '5px 0',
              border: 'none',
              borderRadius: 4,
              background: phase === p ? 'var(--accent-gradient)' : 'transparent',
              color: phase === p ? '#fff' : cycle.filledPhases.includes(p) ? 'var(--accent-light)' : 'var(--text-muted)',
              fontSize: 10,
              fontWeight: phase === p ? 600 : 500,
              cursor: 'pointer',
            }}
          >
            {PHASE_LABEL[p]}
          </button>
        ))}
      </div>

      <div style={{
        fontSize: 10,
        color: 'var(--text-muted)',
        marginBottom: 6,
        lineHeight: 1.4,
      }}>
        {PHASE_HINT[phase]}
      </div>

      <textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        rows={12}
        spellCheck
        placeholder={`Write your ${PHASE_LABEL[phase]} content here…`}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          fontSize: 11,
          fontFamily: '"Cascadia Code", "Fira Code", monospace',
          lineHeight: 1.5,
          resize: 'vertical',
        }}
      />

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button
          onClick={onSave}
          disabled={busy || !dirty}
          style={{
            flex: 1,
            padding: '7px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: dirty ? 'var(--bg-elevated)' : 'transparent',
            color: dirty ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: 11,
            cursor: dirty && !busy ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        {!isLast && (
          <button
            onClick={onSaveAdvance}
            disabled={busy}
            style={{
              flex: 1,
              padding: '7px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-gradient)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Save → {PHASE_LABEL[nextPhase(phase)]}
          </button>
        )}
      </div>
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 10,
      padding: '8px 10px',
      background: 'rgba(244,63,94,0.08)',
      border: '1px solid rgba(244,63,94,0.3)',
      borderRadius: 'var(--radius-md)',
      color: '#fda4af',
      fontSize: 11,
    }}>
      {children}
    </div>
  );
}

function NewCycleModal({
  title,
  titleRef,
  busy,
  onTitleChange,
  onSubmit,
  onCancel,
}: {
  title: string;
  titleRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  onTitleChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        marginBottom: 10,
        padding: 10,
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-active)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
        New LMM cycle
      </div>
      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Cycle title (e.g. refactor-auth-flow)"
        maxLength={80}
        disabled={busy}
        style={{
          width: '100%',
          padding: '6px 8px',
          fontSize: 12,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: '5px 10px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: 11,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={busy || !title.trim()}
          style={{
            padding: '5px 10px',
            borderRadius: 4,
            border: 'none',
            background: 'var(--accent-gradient)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            cursor: busy || !title.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !title.trim() ? 0.6 : 1,
          }}
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: '7px 10px',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-gradient)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const smallBtn: React.CSSProperties = {
  padding: '5px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  fontSize: 10,
  cursor: 'pointer',
};

function nextPhase(p: LMMPhase): LMMPhase {
  const idx = PHASE_ORDER.indexOf(p);
  return PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)];
}

function extractError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Unknown error';
}

function formatRelative(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
