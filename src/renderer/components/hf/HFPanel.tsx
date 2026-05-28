import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HFAuditEntry,
  HFCachedEntry,
  HFGgufVariant,
  HFModelCard,
  HFSearchHit,
  HFSettings,
} from '../../../shared/types';

type SubTab = 'browse' | 'cached' | 'research';

const ROLE_FILTERS = [
  { value: '', label: 'Any task' },
  { value: 'text-generation', label: 'Text generation' },
  { value: 'text-classification', label: 'Text classification' },
  { value: 'question-answering', label: 'Question answering' },
  { value: 'summarization', label: 'Summarization' },
  { value: 'translation', label: 'Translation' },
  { value: 'feature-extraction', label: 'Embeddings' },
  { value: 'image-classification', label: 'Image classification' },
  { value: 'automatic-speech-recognition', label: 'Speech to text' },
] as const;

/**
 * HFPanel — Hugging Face Hub browser.
 *
 * Three sub-tabs:
 *   Browse   — live search HF Hub, view model cards, "Import to Ollama"
 *              for GGUF models.
 *   Cached   — local cache directory listing, per-repo size + remove.
 *   Research — uncensored / experimental community catalogs, gated
 *              behind opt-in flag with disclaimer.  Lands in a follow-up PR.
 *
 * Backend lives in main-process HuggingFaceService; renderer talks
 * exclusively through electronAPI.hf.*.
 */
export function HFPanel() {
  const [tab, setTab] = useState<SubTab>('browse');
  const [settings, setSettings] = useState<HFSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await window.electronAPI.hf.getSettings();
        if (!cancelled) setSettings(next);
      } catch (e) {
        if (!cancelled) setErr(formatError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <h3 style={titleStyle}>
        <div style={accentBarStyle} />
        Hugging Face
      </h3>

      {err && (
        <div role="alert" style={errBannerStyle}>{err}</div>
      )}

      <div style={tabStripStyle}>
        <TabButton label="Browse" active={tab === 'browse'} onClick={() => setTab('browse')} />
        <TabButton label="Cached" active={tab === 'cached'} onClick={() => setTab('cached')} />
        <TabButton
          label="Research"
          active={tab === 'research'}
          onClick={() => setTab('research')}
          dimmed={!(settings?.researchModeEnabled)}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'browse' && <BrowseTab onErr={setErr} />}
        {tab === 'cached' && <CachedTab onErr={setErr} />}
        {tab === 'research' && <ResearchTab settings={settings} onSettings={setSettings} />}
      </div>
    </div>
  );
}

// =====================================================================
// Browse
// =====================================================================

function BrowseTab({ onErr }: { onErr: (msg: string | null) => void }) {
  const [query, setQuery] = useState('');
  const [task, setTask] = useState<string>('');
  const [ggufOnly, setGgufOnly] = useState(true);
  const [results, setResults] = useState<HFSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const inFlight = useRef<number>(0);

  const runSearch = useCallback(async () => {
    onErr(null);
    setBusy(true);
    const myReq = ++inFlight.current;
    try {
      const hits = await window.electronAPI.hf.search({
        query: query.trim() || undefined,
        task: task || undefined,
        ggufOnly,
        limit: 30,
      });
      if (myReq !== inFlight.current) return; // a newer search superseded us
      setResults(hits);
    } catch (e) {
      onErr(formatError(e));
    } finally {
      if (myReq === inFlight.current) setBusy(false);
    }
  }, [query, task, ggufOnly, onErr]);

  // Auto-run once on mount with the GGUF-only default to give the user
  // something useful immediately instead of an empty page.
  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <input
          type="search"
          placeholder="Search 1M+ models… (e.g. 'llama 3 8b instruct')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch();
          }}
          style={searchInputStyle}
          aria-label="Search Hugging Face models"
        />
        <select
          value={task}
          onChange={(e) => setTask(e.target.value)}
          style={selectStyle}
        >
          {ROLE_FILTERS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <label style={chkStyle}>
          <input
            type="checkbox"
            checked={ggufOnly}
            onChange={(e) => setGgufOnly(e.target.checked)}
          />
          <span>GGUF only</span>
        </label>
        <button onClick={() => void runSearch()} disabled={busy} style={primaryBtnStyle}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>

      {results.length === 0 && !busy && (
        <div style={emptyStyle}>
          No matches.  Loosen the filter or try a different query.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map((hit) => (
          <ResultCard
            key={hit.id}
            hit={hit}
            expanded={openCardId === hit.id}
            onToggleExpand={() => setOpenCardId((cur) => (cur === hit.id ? null : hit.id))}
            onErr={onErr}
          />
        ))}
      </div>
    </>
  );
}

function ResultCard({
  hit,
  expanded,
  onToggleExpand,
  onErr,
  researchMode,
}: {
  hit: HFSearchHit;
  expanded: boolean;
  onToggleExpand: () => void;
  onErr: (msg: string | null) => void;
  researchMode?: boolean;
}) {
  const [card, setCard] = useState<HFModelCard | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!expanded || card) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        const c = await window.electronAPI.hf.modelInfo(hit.id);
        if (!cancelled) setCard(c);
      } catch (e) {
        if (!cancelled) onErr(formatError(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, card, hit.id, onErr]);

  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={cardTitleStyle}>
            <a
              href={`https://huggingface.co/${hit.id}`}
              onClick={(e) => {
                e.preventDefault();
                void window.electronAPI.models.openExternal(`https://huggingface.co/${hit.id}`).catch(() => undefined);
              }}
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              {hit.id}
            </a>
            {hit.gated && <span style={badgeWarnStyle}>gated</span>}
          </div>
          <div style={cardMetaStyle}>
            {hit.pipelineTag && <span>{hit.pipelineTag}</span>}
            <span>↓ {formatCount(hit.downloads)}</span>
            <span>♥ {formatCount(hit.likes)}</span>
            {hit.updatedAt && <span>{shortDate(hit.updatedAt)}</span>}
          </div>
          {hit.tags.length > 0 && (
            <div style={tagRowStyle}>
              {hit.tags.slice(0, 6).map((t) => (
                <span key={t} style={tagChipStyle}>{t}</span>
              ))}
            </div>
          )}
        </div>
        <button onClick={onToggleExpand} style={btnStyle}>
          {expanded ? 'Hide details' : 'Details'}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {busy && <div style={subtleStyle}>Loading model card…</div>}
          {card && (
            <>
              {card.description && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
                  {card.description.slice(0, 400)}{card.description.length > 400 ? '…' : ''}
                </div>
              )}
              {card.license && (
                <div style={subtleStyle}>License: <strong style={{ color: 'var(--text-secondary)' }}>{card.license}</strong></div>
              )}
              <GgufVariantList
                repoId={card.id}
                variants={card.gguf}
                onErr={onErr}
                researchMode={researchMode}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GgufVariantList({
  repoId,
  variants,
  onErr,
  researchMode,
}: {
  repoId: string;
  variants: HFGgufVariant[];
  onErr: (msg: string | null) => void;
  researchMode?: boolean;
}) {
  // Per-variant launch state.  `null` means idle; "launching" while
  // the IPC is in flight; "launched" for 4s after success so the
  // user sees confirmation.
  const [launchState, setLaunchState] = useState<Record<string, 'launching' | 'launched' | null>>({});
  const launchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => () => {
    for (const t of Object.values(launchTimers.current)) clearTimeout(t);
  }, []);

  if (variants.length === 0) {
    return <div style={subtleStyle}>No GGUF files in this repo.</div>;
  }

  const handleCopy = (quant: string | null) => {
    const cmd = `ollama run hf.co/${repoId}${quant ? `:${quant}` : ''}`;
    void window.electronAPI.app.clipboardWrite(cmd).then((ok) => {
      if (!ok) onErr(`Could not copy command. It was: ${cmd}`);
    });
  };

  const handleImport = async (quant: string | null) => {
    const key = quant ?? '__default__';
    setLaunchState((s) => ({ ...s, [key]: 'launching' }));
    try {
      const cwd = await window.electronAPI.git.getCwd().catch(() => undefined);
      const r = await window.electronAPI.hf.importAndLaunch(
        repoId,
        quant,
        cwd ?? undefined,
        !!researchMode
      );
      if (!r.ok) {
        onErr(`Import failed: ${r.error ?? 'unknown error'}`);
        setLaunchState((s) => ({ ...s, [key]: null }));
        return;
      }
      setLaunchState((s) => ({ ...s, [key]: 'launched' }));
      if (launchTimers.current[key]) clearTimeout(launchTimers.current[key]);
      launchTimers.current[key] = setTimeout(() => {
        setLaunchState((s) => ({ ...s, [key]: null }));
      }, 4000);
    } catch (e) {
      onErr(formatError(e));
      setLaunchState((s) => ({ ...s, [key]: null }));
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
        GGUF variants ({variants.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {variants.slice(0, 12).map((v) => {
          const key = v.quant ?? '__default__';
          const state = launchState[key];
          return (
            <div
              key={v.fileName}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              <span style={{ flex: 1, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                {v.fileName}
              </span>
              {v.quant && <span style={tagChipStyle}>{v.quant}</span>}
              {v.sizeBytes !== null && (
                <span style={subtleStyle}>{fmtBytes(v.sizeBytes)}</span>
              )}
              <button
                onClick={() => void handleImport(v.quant)}
                disabled={state === 'launching'}
                style={state === 'launched' ? { ...smallBtnStyle, color: '#22c55e', borderColor: '#22c55e' } : smallBtnStyle}
                title="Adds this variant to the Models catalog and starts it via Ollama"
              >
                {state === 'launching' ? 'Launching…' : state === 'launched' ? '✓ Launched' : 'Import to Ollama'}
              </button>
              <button
                onClick={() => handleCopy(v.quant)}
                style={smallBtnStyle}
                title="Copy the ollama run command to clipboard"
              >
                Copy cmd
              </button>
            </div>
          );
        })}
      </div>
      {Object.values(launchState).some((s) => s === 'launched') && (
        <div style={{ ...subtleStyle, marginTop: 6, color: 'var(--accent-light)' }}>
          Launched — switch to the Models panel to view the running tab.
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Cached
// =====================================================================

function CachedTab({ onErr }: { onErr: (msg: string | null) => void }) {
  const [entries, setEntries] = useState<HFCachedEntry[] | null>(null);
  const [cachePath, setCachePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [list, p] = await Promise.all([
        window.electronAPI.hf.listCached(),
        window.electronAPI.hf.getCachePath(),
      ]);
      setEntries(list);
      setCachePath(p);
    } catch (e) {
      onErr(formatError(e));
    } finally {
      setBusy(false);
    }
  }, [onErr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (id: string) => {
    if (!confirm(`Delete cached files for ${id}?  Re-download to use again.`)) return;
    try {
      await window.electronAPI.hf.removeCached(id);
      await refresh();
    } catch (e) {
      onErr(formatError(e));
    }
  };

  if (entries === null) {
    return <div style={subtleStyle}>{busy ? 'Loading cache…' : 'No data yet.'}</div>;
  }
  return (
    <>
      <div style={subtleStyle}>
        Cache location: <code style={{ color: 'var(--text-secondary)' }}>{cachePath ?? '?'}</code>
      </div>
      <div style={{ marginTop: 8 }}>
        <button onClick={() => void refresh()} disabled={busy} style={btnStyle}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {entries.length === 0 ? (
        <div style={{ ...emptyStyle, marginTop: 10 }}>
          No models cached yet.  Downloads will appear here once you import one to Ollama.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {entries.map((e) => (
            <div key={e.id} style={cachedRowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{e.id}</div>
                <div style={subtleStyle}>{fmtBytes(e.sizeBytes)}</div>
              </div>
              <button onClick={() => void remove(e.id)} style={btnStyle}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// =====================================================================
// Research (placeholder — fully wired in PR #57)
// =====================================================================

function ResearchTab({
  settings,
  onSettings,
}: {
  settings: HFSettings | null;
  onSettings: (s: HFSettings) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const enabled = !!settings?.researchModeEnabled;
  const enable = async () => {
    setErr(null);
    try {
      const next = await window.electronAPI.hf.setSettings({ researchModeEnabled: true });
      onSettings(next);
    } catch (e) {
      setErr(formatError(e));
    }
  };
  const disable = async () => {
    setErr(null);
    try {
      const next = await window.electronAPI.hf.setSettings({ researchModeEnabled: false });
      onSettings(next);
    } catch (e) {
      setErr(formatError(e));
    }
  };
  if (!enabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={disclaimerStyle}>
          <strong style={{ color: 'var(--text-primary)' }}>Research catalogs are disabled.</strong>
          <p style={{ marginTop: 6 }}>
            These surface community-curated lists of models — including uncensored / experimental
            checkpoints — that may generate harmful content.  Models in this section are not
            reviewed by Hugging Face or by this app.  Use only in sandboxed environments.  You
            assume all responsibility for use.
          </p>
        </div>
        <button onClick={() => void enable()} style={primaryBtnStyle}>
          I understand — enable Research catalogs
        </button>
        {err && <div role="alert" style={errBannerStyle}>{err}</div>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={researchActiveBannerStyle} role="note">
        <div>
          <strong style={{ color: '#fbbf24' }}>Research mode is active.</strong>
          <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>
            Imports get a "Research" badge in Models and every launch is logged below.
          </span>
        </div>
        <button onClick={() => void disable()} style={btnStyle}>
          Disable
        </button>
      </div>
      {err && <div role="alert" style={errBannerStyle}>{err}</div>}
      <ResearchBrowse onErr={setErr} />
      <ResearchAuditLog onErr={setErr} />
    </div>
  );
}

function ResearchBrowse({ onErr }: { onErr: (msg: string | null) => void }) {
  // Same surface as BrowseTab but seeded with a research-leaning query
  // ("uncensored" + "abliterated") and the import button calls
  // hf.importAndLaunch with research:true.
  const [query, setQuery] = useState('uncensored');
  const [results, setResults] = useState<HFSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const inFlight = useRef<number>(0);

  const runSearch = useCallback(async () => {
    onErr(null);
    setBusy(true);
    const myReq = ++inFlight.current;
    try {
      const hits = await window.electronAPI.hf.search({
        query: query.trim() || 'uncensored',
        ggufOnly: true,
        limit: 30,
      });
      if (myReq !== inFlight.current) return;
      setResults(hits);
    } catch (e) {
      onErr(formatError(e));
    } finally {
      if (myReq === inFlight.current) setBusy(false);
    }
  }, [query, onErr]);

  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          type="search"
          placeholder="Try 'uncensored', 'abliterated', 'dolphin', 'wizard-vicuna-uncensored'…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch();
          }}
          style={searchInputStyle}
          aria-label="Search Research catalog"
        />
        <button onClick={() => void runSearch()} disabled={busy} style={primaryBtnStyle}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>

      {results.length === 0 && !busy && (
        <div style={emptyStyle}>
          No matches.  Try a different keyword like "abliterated" or a specific repo name.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map((hit) => (
          <ResultCard
            key={hit.id}
            hit={hit}
            expanded={openCardId === hit.id}
            onToggleExpand={() => setOpenCardId((cur) => (cur === hit.id ? null : hit.id))}
            onErr={onErr}
            researchMode
          />
        ))}
      </div>
    </>
  );
}

function ResearchAuditLog({ onErr }: { onErr: (msg: string | null) => void }) {
  const [entries, setEntries] = useState<HFAuditEntry[] | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const log = await window.electronAPI.hf.getResearchLog();
      setEntries(log);
    } catch (e) {
      onErr(formatError(e));
    }
  }, [onErr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = async () => {
    if (!confirm('Clear the research audit log?  This cannot be undone.')) return;
    try {
      await window.electronAPI.hf.clearResearchLog();
      await refresh();
    } catch (e) {
      onErr(formatError(e));
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setCollapsed((v) => !v)} style={{ ...btnStyle, padding: '4px 6px' }}>
          {collapsed ? '▶' : '▼'}
        </button>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
          Research audit log
        </span>
        <span style={subtleStyle}>{entries?.length ?? 0} entries</span>
        {entries && entries.length > 0 && (
          <button onClick={() => void clear()} style={btnStyle}>
            Clear
          </button>
        )}
      </div>
      {!collapsed && (
        <div style={{ marginTop: 8 }}>
          {!entries || entries.length === 0 ? (
            <div style={subtleStyle}>No research launches recorded yet.</div>
          ) : (
            <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace' }}>
              {entries
                .slice()
                .reverse()
                .map((e, i) => (
                  <div key={`${e.ts}-${i}`} style={{ padding: '3px 0', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{e.ts.slice(0, 19).replace('T', ' ')}</span>
                    {' '}
                    {e.repoId}
                    {e.quant && <span style={{ color: 'var(--accent-light)' }}> :{e.quant}</span>}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Subcomponents + styles
// =====================================================================

function TabButton({
  label,
  active,
  onClick,
  dimmed,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dimmed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        color: active ? 'var(--accent-light, var(--text-primary))' : dimmed ? 'var(--text-muted)' : 'var(--text-secondary)',
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

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Unknown error';
}

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
};

const accentBarStyle: React.CSSProperties = {
  width: 3,
  height: 14,
  borderRadius: 2,
  background: 'var(--accent-gradient, #8b5cf6)',
};

const tabStripStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid var(--border)',
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 260,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  fontSize: 12,
  padding: '8px 12px',
  borderRadius: 6,
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  fontSize: 12,
  padding: '6px 8px',
  borderRadius: 4,
};

const chkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: 'var(--text-secondary)',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent-gradient, #8b5cf6)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 11,
  cursor: 'pointer',
};

const smallBtnStyle: React.CSSProperties = {
  ...btnStyle,
  padding: '3px 6px',
  fontSize: 10,
};

const cardStyle: React.CSSProperties = {
  padding: 10,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-primary)',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const cardMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  display: 'flex',
  gap: 8,
  marginTop: 2,
  flexWrap: 'wrap',
};

const tagRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 4,
};

const tagChipStyle: React.CSSProperties = {
  fontSize: 9,
  padding: '2px 6px',
  borderRadius: 999,
  background: 'rgba(139, 92, 246, 0.08)',
  color: 'var(--accent-light, #a78bfa)',
};

const badgeWarnStyle: React.CSSProperties = {
  fontSize: 9,
  padding: '1px 5px',
  borderRadius: 4,
  background: 'rgba(234, 179, 8, 0.15)',
  color: '#fbbf24',
  border: '1px solid rgba(234, 179, 8, 0.3)',
};

const cachedRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
};

const emptyStyle: React.CSSProperties = {
  padding: '14px',
  background: 'var(--bg-primary)',
  border: '1px dashed var(--border)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--text-muted)',
  textAlign: 'center',
};

const errBannerStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(244,63,94,0.08)',
  border: '1px solid rgba(244,63,94,0.3)',
  borderRadius: 6,
  color: '#fda4af',
  fontSize: 11,
};

const subtleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  lineHeight: 1.5,
};

const disclaimerStyle: React.CSSProperties = {
  padding: '12px',
  background: 'rgba(234, 179, 8, 0.06)',
  border: '1px solid rgba(234, 179, 8, 0.3)',
  borderRadius: 6,
  color: 'var(--text-secondary)',
  fontSize: 11,
  lineHeight: 1.5,
};

const researchActiveBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  background: 'rgba(234, 179, 8, 0.06)',
  border: '1px solid rgba(234, 179, 8, 0.4)',
  borderRadius: 6,
  fontSize: 11,
  lineHeight: 1.5,
};
