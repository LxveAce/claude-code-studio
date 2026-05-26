import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModelCategory, ModelDefinition } from '../../../shared/types';

/**
 * v3.0 multi-model scaffold — catalog browser with two top-level
 * tabs (API Models / Local Models). Reads from ModelRegistry via
 * the new `models` IPC namespace.
 *
 * What this panel DOES right now:
 *   - Lists registered models split by category
 *   - Shows per-model name + description + provider + launch
 *     command (read-only)
 *   - "Reset to defaults" button (calls models.resetSeed)
 *
 * What it does NOT do yet (separate v3.0 follow-ups):
 *   - Launching a model in a new pane (needs PtyRegistry generalization
 *     to accept arbitrary command/args)
 *   - Adding / editing models from the UI (just stub buttons for now)
 *   - Downloading local-model binaries
 *   - Pop-out windows per model
 *   - Auth setup per provider (API key entry UI)
 */

type Tab = ModelCategory;

export function ModelsPanel() {
  const [tab, setTab] = useState<Tab>('api');
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.electronAPI.models.list();
      setModels(list);
    } catch {
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => models.filter((m) => m.category === tab), [models, tab]);
  const counts = useMemo(
    () => ({
      api: models.filter((m) => m.category === 'api').length,
      local: models.filter((m) => m.category === 'local').length,
    }),
    [models]
  );

  const handleResetSeed = async () => {
    if (!confirm('Reset the model catalog to defaults? Custom entries will be removed.')) return;
    try {
      const next = await window.electronAPI.models.resetSeed();
      setModels(next.models);
    } catch { /* ignore */ }
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <h3 style={titleStyle}>
        <div style={accentBarStyle} />
        Models
      </h3>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        v3.0 scaffold — catalog only. Launch + per-pane wiring + local-
        model download are tracked in BACKLOG.md ★ multi-model section.
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
        <TabButton
          label={`API Models (${counts.api})`}
          active={tab === 'api'}
          onClick={() => setTab('api')}
        />
        <TabButton
          label={`Local Models (${counts.local})`}
          active={tab === 'local'}
          onClick={() => setTab('local')}
        />
      </div>

      {/* Model list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={mutedStyle}>Loading catalog…</div>}
        {!loading && filtered.length === 0 && (
          <div style={mutedStyle}>
            No {tab === 'api' ? 'API' : 'local'} models registered. Click
            "Reset to defaults" to restore the seed list, or use "Add model"
            (coming soon).
          </div>
        )}
        {filtered.map((m) => (
          <ModelCard key={m.id} model={m} />
        ))}
      </div>

      {/* Footer actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" disabled style={{ ...btnStyle, opacity: 0.5, cursor: 'not-allowed' }}>
          + Add model (soon)
        </button>
        <button type="button" onClick={handleResetSeed} style={btnStyle}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        color: active ? 'var(--accent-light, var(--text-primary))' : 'var(--text-secondary)',
        fontSize: 12,
        padding: '8px 12px',
        cursor: 'pointer',
        borderBottom: active ? '2px solid var(--accent, #8b5cf6)' : '2px solid transparent',
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}

function ModelCard({ model }: { model: ModelDefinition }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{model.name}</div>
        <span style={chipStyle(model.category)}>{model.category === 'api' ? 'API' : 'Local'}</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
        {model.provider} · id: <code style={codeStyle}>{model.id}</code>
      </div>
      {model.description && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.45 }}>
          {model.description}
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>Command:</span>{' '}
        <code style={codeStyle}>{[model.command, ...(model.args ?? [])].join(' ')}</code>
      </div>
      {model.download && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Download:</span>{' '}
          {(model.download.sizeBytes / 1e9).toFixed(2)} GB · <code style={codeStyle}>{model.download.archiveType}</code>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button type="button" disabled style={{ ...btnStyle, opacity: 0.5, cursor: 'not-allowed', fontSize: 11 }}>
          Launch in new pane (soon)
        </button>
      </div>
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const accentBarStyle: React.CSSProperties = {
  width: 3,
  height: 14,
  borderRadius: 2,
  background: 'var(--accent-gradient)',
};

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: 'var(--bg-primary)',
  borderRadius: 'var(--radius-md, 8px)',
  border: '1px solid var(--border, rgba(255,255,255,0.08))',
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '6px 12px',
  fontSize: 11,
  borderRadius: 6,
  cursor: 'pointer',
};

const mutedStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  padding: 12,
  textAlign: 'center',
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 10,
  color: 'var(--text-primary)',
  background: 'rgba(0,0,0,0.2)',
  padding: '1px 4px',
  borderRadius: 3,
};

function chipStyle(cat: ModelCategory): React.CSSProperties {
  return {
    fontSize: 9,
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    padding: '1px 6px',
    borderRadius: 999,
    background: cat === 'api' ? '#7dd3fc' : '#86efac',
    color: '#0f172a',
  };
}
