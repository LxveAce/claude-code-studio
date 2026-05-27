import React, { useEffect, useMemo, useState } from 'react';
import type {
  HardwareProfile,
  ModelDefinition,
  ModelRecommendation,
  OllamaVersionInfo,
} from '../../../shared/types';

/**
 * First-run model picker — shown automatically after install when the
 * persisted models-onboarding flag is still false. Lets the user select
 * one or more recommended models to pre-pull, or skip entirely.
 *
 * Auto-pull means starting `ollama pull` for each selected model. We
 * don't wait for completion — the modal closes and progress shows up in
 * the regular Models panel pull progress bars.
 */

interface Props {
  onClose: (outcome: 'skipped' | 'completed') => void;
}

export function FirstRunPicker({ onClose }: Props) {
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [ollama, setOllama] = useState<OllamaVersionInfo | null>(null);
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [recs, setRecs] = useState<ModelRecommendation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [hw, ov, list, cwd] = await Promise.all([
          window.electronAPI.hardware.detect(),
          window.electronAPI.ollama.version(),
          window.electronAPI.models.list(),
          window.electronAPI.git.getCwd().catch(() => undefined),
        ]);
        if (!alive) return;
        setHardware(hw);
        setOllama(ov);
        setModels(list);
        const r = await window.electronAPI.models.recommend(cwd ?? undefined);
        if (!alive) return;
        setRecs(r);
        // Preselect the top recommendation so the friendly path is
        // "click Pull" rather than "select then pull".
        if (r.length > 0) setSelected(new Set([r[0].modelId]));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const top = useMemo(() => {
    const map = new Map(models.map((m) => [m.id, m] as const));
    return recs
      .map((r) => ({ rec: r, model: map.get(r.modelId) }))
      .filter((x): x is { rec: ModelRecommendation; model: ModelDefinition } => !!x.model)
      .slice(0, 5);
  }, [recs, models]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSkip = () => onClose('skipped');

  const handlePull = async () => {
    if (selected.size === 0) {
      onClose('completed');
      return;
    }
    if (!ollama?.installed || !ollama.daemonReachable) {
      setError('Ollama is not installed or its daemon is not reachable. Install Ollama first.');
      return;
    }
    setSubmitting(true);
    try {
      const ids = [...selected];
      const startResults = await Promise.allSettled(
        ids
          .map((id) => models.find((m) => m.id === id))
          .filter((m): m is ModelDefinition => !!m && !!m.ollamaName)
          .map((m) => window.electronAPI.ollama.pullStart(m.ollamaName!))
      );
      const failures = startResults
        .map((r, i) => ({ r, name: ids[i] }))
        .filter(({ r }) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok));
      if (failures.length > 0) {
        setError(`${failures.length} pull(s) didn't start. Check the Models panel.`);
      }
      onClose('completed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={backdropStyle}>
        <div style={modalStyle}>
          <div style={{ padding: 20, color: 'var(--text-secondary)' }}>Detecting hardware…</div>
        </div>
      </div>
    );
  }

  const ollamaReady = ollama?.installed && ollama.daemonReachable;
  const tierLabel = hardware ? hardware.tier.charAt(0).toUpperCase() + hardware.tier.slice(1) : '?';

  return (
    <div style={backdropStyle}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Welcome — pick your first models</span>
          <button type="button" onClick={handleSkip} style={closeBtnStyle}>×</button>
        </div>

        {hardware && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Detected: <strong>{tierLabel} tier</strong> — {hardware.summary}
          </div>
        )}

        {!ollamaReady && (
          <div style={warnStyle}>
            <strong>Ollama isn't installed yet.</strong> The catalog will work, but you can't
            pull local models until Ollama is on your machine.{' '}
            <a
              href="https://ollama.com/download"
              onClick={(e) => {
                e.preventDefault();
                void window.electronAPI.models.openExternal('https://ollama.com/download').catch(() => undefined);
              }}
              style={{ color: 'var(--accent-light, var(--text-primary))', textDecoration: 'underline' }}
            >
              Install Ollama
            </a>
            , then click "Skip for now" — the Models panel will detect it once it's running.
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-secondary)' }}>
          Recommended for your hardware:
        </div>

        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {top.map(({ rec, model }) => {
            const isSel = selected.has(model.id);
            const sizeNote = model.vramGB ? `~${model.vramGB} GB` : 'size unknown';
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => toggle(model.id)}
                style={{
                  ...cardStyle,
                  borderColor: isSel ? 'var(--accent, #8b5cf6)' : 'var(--border)',
                  background: isSel ? 'rgba(139, 92, 246, 0.12)' : 'var(--bg-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid var(--accent, #8b5cf6)', background: isSel ? 'var(--accent, #8b5cf6)' : 'transparent', flexShrink: 0 }} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{model.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {sizeNote}</div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, marginLeft: 22 }}>
                  {rec.reason}
                </div>
              </button>
            );
          })}
          {top.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              No recommendations available. You can still browse the catalog from the Models sidebar.
            </div>
          )}
        </div>

        {error && (
          <div style={errorStyle}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={handleSkip} style={btnStyle}>Skip for now</button>
          <button
            type="button"
            onClick={handlePull}
            disabled={submitting || !ollamaReady || selected.size === 0}
            style={{
              ...primaryBtnStyle,
              opacity: !ollamaReady || selected.size === 0 ? 0.5 : 1,
              cursor: submitting || !ollamaReady || selected.size === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Starting pulls…' : `Pull ${selected.size} model${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.7)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 18,
  maxWidth: 540,
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottom: '1px solid var(--border)',
  paddingBottom: 10,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 20,
  lineHeight: 1,
  padding: '0 6px',
};

const cardStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  width: '100%',
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '6px 14px',
  fontSize: 11,
  borderRadius: 6,
  cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--accent-gradient, #8b5cf6)',
  color: '#fff',
  border: 'none',
  fontWeight: 500,
};

const warnStyle: React.CSSProperties = {
  marginTop: 10,
  padding: '8px 12px',
  fontSize: 11,
  color: 'var(--text-secondary)',
  background: 'rgba(251, 191, 36, 0.1)',
  border: '1px solid rgba(251, 191, 36, 0.3)',
  borderRadius: 4,
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#fca5a5',
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  padding: '6px 10px',
  borderRadius: 4,
  marginTop: 10,
};
