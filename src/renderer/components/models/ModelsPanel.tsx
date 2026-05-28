import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  HardwareProfile,
  HardwareTier,
  ModelCategory,
  ModelDefinition,
  ModelRecommendation,
  ModelRole,
  OllamaInstalledModel,
  OllamaPullProgressEvent,
  OllamaVersionInfo,
  ProviderId,
} from '../../../shared/types';
import { EmbeddedTerminal } from './EmbeddedTerminal';
import { AddModelModal } from './AddModelModal';
import { FirstRunPicker } from './FirstRunPicker';
import { ProviderSetupModal } from './ProviderSetupModal';
import { ApiKeyModal } from '../auth/ApiKeyModal';
import type { ProviderCliDetectResult } from '../../../shared/types';

/** Map a ModelDefinition.provider display name → canonical ProviderId (or
 *  null for providers that don't need an API key). Mirrors the main-process
 *  `normalizeProvider` in provider-auth-service.ts. */
function rendererNormalizeProvider(displayName: string): ProviderId | null {
  const n = displayName.toLowerCase().trim();
  if (n === 'anthropic') return 'anthropic';
  if (n === 'openai') return 'openai';
  if (n === 'google' || n === 'gemini') return 'gemini';
  if (n === 'openrouter') return 'openrouter';
  return null;
}

/**
 * v3.0 multi-model catalog panel — full-scope build (May 2026).
 *
 * Features wired here:
 *   - Hardware-tier auto-detect badge (top header)
 *   - Ollama detection: shows "installed", "not installed", "daemon down" states
 *   - Recommendations: top picks for current hardware + cwd project type
 *   - Filters: category (API/Local), role (frontend/backend/reasoning/…),
 *     tier (toaster…workstation), free-text search
 *   - Per-model card: badge, description, strengths/weaknesses,
 *     VRAM/RAM/context, license (with flag warning), pull/delete/launch
 *   - Pull progress: subscribes to OLLAMA_PULL_PROGRESS, shows live bar
 *   - Launch flow: spawns PTY via MODELS_LAUNCH, lists running models with
 *     Kill button, surfaces "Copy command" as a clipboard fallback
 *
 * Deferred (tracked in MULTI_MODEL.md):
 *   - In-panel xterm output viewer for launched models
 *   - Pop-out windows per launched model
 *   - Per-provider API key entry UI
 *   - "Add custom model" form
 */

type Tab = ModelCategory;
type TierFilter = HardwareTier | 'all';
type RoleFilter = ModelRole | 'all';

interface PullState {
  percent: number | null;
  status: string;
  bytesCompleted: number | null;
  bytesTotal: number | null;
  done?: boolean;
  error?: string | null;
}

interface RunningModel {
  paneId: string;
  modelId: string;
  modelName: string;
  commandLine: string;
  startedAt: number;
}

export function ModelsPanel() {
  const [tab, setTab] = useState<Tab>('local');
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [ollama, setOllama] = useState<OllamaVersionInfo | null>(null);
  const [recs, setRecs] = useState<ModelRecommendation[]>([]);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [pulls, setPulls] = useState<Record<string, PullState>>({});
  const [running, setRunning] = useState<RunningModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [showRecommended, setShowRecommended] = useState(true);
  const [selectedRunningPaneId, setSelectedRunningPaneId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFirstRun, setShowFirstRun] = useState(false);
  /** When the user clicks the "+" tab, open a small picker anchored to
   *  the strip. Picker shows the catalog as a searchable list; choosing
   *  an entry runs the same `handleLaunch` flow that the catalog cards
   *  use. Lives outside the running-strip's conditional render because
   *  the user can open it even with zero current tabs. */
  const [showTabPicker, setShowTabPicker] = useState(false);
  const [tabPickerQuery, setTabPickerQuery] = useState('');
  const detectedAtRef = useRef<string | null>(null);

  // First-run picker — check persisted onboarding flag once on mount. If
  // the user hasn't been shown the picker yet, open it now. They can also
  // re-open it from the panel footer ("Show first-run picker again").
  useEffect(() => {
    let alive = true;
    void window.electronAPI.models.onboardingGet().then((state) => {
      if (!alive) return;
      if (!state.shown) setShowFirstRun(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 3.0.0-beta.3: rebuild the Running list from main on panel mount.
  // Pre-beta.3 the list lived in component state only — switching to
  // another sidebar tab and back wiped it (PTYs survived but the panel
  // forgot about them). Now we query PtyRegistry.listModelPanes() and
  // rehydrate, including each model's display name from the catalog.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [livePanes, allModels] = await Promise.all([
          window.electronAPI.models.listRunning(),
          window.electronAPI.models.list(),
        ]);
        if (!alive) return;
        const modelById = new Map(allModels.map((m) => [m.id, m] as const));
        const rebuilt: RunningModel[] = livePanes.map((p) => {
          // paneId format from MODELS_LAUNCH: "model:<safeIdPart>-<base36ts>".
          // Extract the model id (best-effort) so we can label nicely.
          const match = p.paneId.match(/^model:([^-]+(?:-[^-]+)*)-([0-9a-z]+)$/);
          const idPart = match ? match[1] : '';
          // The safeIdPart replaced any chars not in [A-Za-z0-9_\-:] with _.
          // Match against catalog by reversing the substitution loosely.
          let model = modelById.get(idPart);
          if (!model) {
            // Fallback: scan for any model whose id matches after underscore-norm
            for (const m of allModels) {
              if (m.id.replace(/[^A-Za-z0-9_\-:]/g, '_').slice(0, 40) === idPart) {
                model = m;
                break;
              }
            }
          }
          return {
            paneId: p.paneId,
            modelId: model?.id ?? idPart,
            modelName: model?.name ?? p.commandLine.split(/\s+/)[0] ?? 'Model',
            commandLine: p.commandLine,
            startedAt: Date.now(), // best-effort; real start time isn't tracked
          };
        });
        setRunning(rebuilt);
      } catch {
        // listRunning IPC may not exist in older preload — non-fatal
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Auto-select the most recently launched model so the embedded terminal
  // has something to show by default. Also clears the selection when its
  // PTY exits and is pruned from `running`.
  useEffect(() => {
    if (running.length === 0) {
      setSelectedRunningPaneId(null);
      return;
    }
    setSelectedRunningPaneId((prev) => {
      if (prev && running.some((r) => r.paneId === prev)) return prev;
      return running[running.length - 1].paneId;
    });
  }, [running]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, hw, ov] = await Promise.all([
        window.electronAPI.models.list(),
        window.electronAPI.hardware.detect(),
        window.electronAPI.ollama.version(),
      ]);
      setModels(list);
      setHardware(hw);
      detectedAtRef.current = hw.detectedAt;
      setOllama(ov);

      if (ov.installed && ov.daemonReachable) {
        try {
          const inst = await window.electronAPI.ollama.list();
          setInstalled(new Set(inst.map((m: OllamaInstalledModel) => m.name)));
        } catch {
          setInstalled(new Set());
        }
      } else {
        setInstalled(new Set());
      }

      try {
        const cwd = await window.electronAPI.git.getCwd();
        const r = await window.electronAPI.models.recommend(cwd ?? undefined);
        setRecs(r);
      } catch {
        setRecs([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Pull progress subscription — one global listener, dispatches into
  // per-model state keyed by modelName.
  useEffect(() => {
    const unsub = window.electronAPI.ollama.onPullProgress((raw: unknown) => {
      const evt = raw as OllamaPullProgressEvent;
      setPulls((prev) => ({
        ...prev,
        [evt.modelName]: {
          percent: evt.percent,
          status: evt.status,
          bytesCompleted: evt.bytesCompleted,
          bytesTotal: evt.bytesTotal,
          done: evt.status === 'done',
          error: evt.status.startsWith('error:') ? evt.status : null,
        },
      }));
      // When a pull finishes, re-run the installed list so the UI swaps
      // from "Pull" to "Installed".
      if (evt.status === 'done') {
        setTimeout(() => {
          void window.electronAPI.ollama.list().then((inst) => {
            setInstalled(new Set(inst.map((m) => m.name)));
          });
        }, 800);
      }
    });
    return unsub;
  }, []);

  // Subscribe to terminal exits so we can auto-prune dead launches from
  // the Running list. PaneId is the first arg of TERMINAL_EXIT.
  useEffect(() => {
    const handlers: Array<() => void> = [];
    for (const r of running) {
      const off = window.electronAPI.terminal.onExit(r.paneId, () => {
        setRunning((prev) => prev.filter((x) => x.paneId !== r.paneId));
      });
      handlers.push(off);
    }
    return () => {
      for (const h of handlers) h();
    };
  }, [running]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (m.category !== tab) return false;
      if (tierFilter !== 'all' && !(m.hardwareTiers ?? []).includes(tierFilter)) return false;
      if (roleFilter !== 'all' && !(m.roles ?? []).includes(roleFilter)) return false;
      if (q) {
        const haystack = [
          m.name,
          m.description ?? '',
          m.provider,
          ...(m.roles ?? []),
          m.recommendedFor ?? '',
          ...(m.strengths ?? []),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [models, tab, tierFilter, roleFilter, search]);

  const counts = useMemo(
    () => ({
      api: models.filter((m) => m.category === 'api').length,
      local: models.filter((m) => m.category === 'local').length,
    }),
    [models]
  );

  const recommendedModels = useMemo(() => {
    const map = new Map(models.map((m) => [m.id, m] as const));
    return recs
      .map((r) => ({ rec: r, model: map.get(r.modelId) }))
      .filter((x): x is { rec: ModelRecommendation; model: ModelDefinition } => !!x.model)
      .slice(0, 6);
  }, [recs, models]);

  const handlePull = async (m: ModelDefinition) => {
    if (!m.ollamaName) return;
    // Disk quota check — warn (don't block) if the user is close to
    // running out. Ollama's pull will fail with a less friendly error.
    // We use 1.5x model size as the warn threshold to leave headroom for
    // the manifest + temp files.
    if (m.vramGB || m.download?.sizeBytes) {
      const needBytes = (m.download?.sizeBytes ?? (m.vramGB ?? 0) * 1e9) * 1.5;
      try {
        const disk = await window.electronAPI.disk.info();
        if (disk.ok && disk.freeBytes != null && disk.freeBytes < needBytes) {
          const freeGB = (disk.freeBytes / 1e9).toFixed(1);
          const needGB = (needBytes / 1e9).toFixed(1);
          if (!confirm(`Low disk space warning.\n\nYou have ~${freeGB} GB free at ${disk.path}, but this pull needs ~${needGB} GB (1.5× the model size, to allow for manifest + temp files).\n\nContinue anyway?`)) {
            return;
          }
        }
      } catch {
        // disk probe failed — just proceed; ollama will error if truly out of space
      }
    }
    setBusy((p) => ({ ...p, [m.id]: true }));
    try {
      await window.electronAPI.ollama.pullStart(m.ollamaName);
    } finally {
      setBusy((p) => ({ ...p, [m.id]: false }));
    }
  };

  const handleCancelPull = async (m: ModelDefinition) => {
    if (!m.ollamaName) return;
    await window.electronAPI.ollama.pullCancel(m.ollamaName);
  };

  const handleDelete = async (m: ModelDefinition) => {
    if (!m.ollamaName) return;
    if (!confirm(`Delete ${m.name} from Ollama? You'll need to re-pull (~${m.vramGB ?? '?'} GB) to use it again.`)) {
      return;
    }
    setBusy((p) => ({ ...p, [m.id]: true }));
    try {
      const r = await window.electronAPI.ollama.delete(m.ollamaName);
      if (r.ok) {
        const inst = await window.electronAPI.ollama.list();
        setInstalled(new Set(inst.map((x) => x.name)));
      } else {
        alert(`Delete failed: ${r.error}`);
      }
    } finally {
      setBusy((p) => ({ ...p, [m.id]: false }));
    }
  };

  /** Pre-launch state: when an API model needs a key and we don't have one,
   *  we stash the pending model + provider here and show ApiKeyModal. On
   *  successful key save we fall through to `performLaunch`. */
  const [pendingLaunch, setPendingLaunch] = useState<{
    model: ModelDefinition;
    provider: ProviderId;
  } | null>(null);

  /** Setup-instructions state: when the model's CLI isn't on PATH, we
   *  pause the launch and show ProviderSetupModal. Retry re-probes and
   *  proceeds if the user installed in the meantime. */
  const [pendingSetup, setPendingSetup] = useState<{
    model: ModelDefinition;
    detect: ProviderCliDetectResult;
  } | null>(null);

  /** Returns the detection result for a model's command if we know how to
   *  detect it; null otherwise. Detected CLIs are limited to providers we
   *  don't bundle (gemini, aider). Claude is handled separately, Ollama
   *  has its own panel-level surfacing. */
  const detectModelCli = useCallback(
    async (m: ModelDefinition): Promise<ProviderCliDetectResult | null> => {
      const cmd = m.command;
      // We only know how to probe these.
      if (cmd !== 'gemini' && cmd !== 'aider') return null;
      try {
        return await window.electronAPI.providerAuth.detectGet(cmd);
      } catch {
        return null;
      }
    },
    []
  );

  const performLaunch = useCallback(async (m: ModelDefinition) => {
    setBusy((p) => ({ ...p, [m.id]: true }));
    try {
      const cwd = await window.electronAPI.git.getCwd().catch(() => undefined);
      const r = await window.electronAPI.models.launch(m.id, cwd ?? undefined);
      if (!r.ok || !r.paneId) {
        alert(`Launch failed: ${r.error ?? 'unknown error'}`);
        return;
      }
      setRunning((prev) => [
        ...prev,
        {
          paneId: r.paneId!,
          modelId: m.id,
          modelName: m.name,
          commandLine: r.commandLine ?? '',
          startedAt: Date.now(),
        },
      ]);
    } finally {
      setBusy((p) => ({ ...p, [m.id]: false }));
    }
  }, []);

  const handleLaunch = async (m: ModelDefinition) => {
    // Launch-gate ordering (post-Cat 6 audit fix):
    //   1) CLI detect → cheapest gate; if the binary isn't there, NOTHING
    //      else matters yet. Was after license-flag pre-audit; users
    //      shouldn't have to confirm a license for a tool they don't have.
    //   2) Per-provider API key → still cheap, no user friction if cached.
    //   3) License-flag confirm → ask LAST so the user has already shown
    //      intent to launch (everything else is sorted).
    //   4) Spawn.
    const detect = await detectModelCli(m);
    if (detect && !detect.installed) {
      setPendingSetup({ model: m, detect });
      return;
    }
    // Pre-launch key check for API providers. We only prompt for known
    // providers that need a key (anthropic / openai / gemini / openrouter);
    // local providers (Ollama) skip this entirely. If a key is on file we
    // launch directly; if not, the modal opens and the user can dismiss
    // without launching ("don't be overbearing").
    const provider = rendererNormalizeProvider(m.provider);
    if (provider) {
      try {
        const has = await window.electronAPI.providerAuth.hasKey(provider);
        if (!has) {
          setPendingLaunch({ model: m, provider });
          return;
        }
      } catch {
        // Provider-auth IPC missing — fall through to direct launch.
      }
    }
    if (m.licenseFlag && !confirm(`${m.name} is governed by "${m.license}". This license has commercial-use restrictions worth reviewing before regular use. Continue launch?`)) {
      return;
    }
    await performLaunch(m);
  };

  const onSetupRetry = useCallback(async () => {
    if (!pendingSetup) return;
    const { model } = pendingSetup;
    let next: ProviderCliDetectResult | null = null;
    try {
      next = await window.electronAPI.providerAuth.detectGet(model.command, true);
    } catch {
      // Probe error — keep modal open so user can retry again.
      return;
    }
    if (next?.installed) {
      setPendingSetup(null);
      await handleLaunch(model);
    } else {
      // Still not installed — update the modal's detect snapshot.
      setPendingSetup({ model, detect: next });
    }
  }, [pendingSetup]);

  const onPendingKeySubmit = async (key: string) => {
    if (!pendingLaunch) return;
    const { model, provider } = pendingLaunch;
    await window.electronAPI.providerAuth.setKey(provider, key);
    setPendingLaunch(null);
    await performLaunch(model);
  };

  const handleKill = async (paneId: string) => {
    await window.electronAPI.terminal.kill(paneId);
    setRunning((prev) => prev.filter((r) => r.paneId !== paneId));
  };

  // Per-model "Copied!" toast state. We keep the id of the most-recently
  // copied model + a timestamp; the card renders "Copied!" while the id
  // matches and the timer hasn't elapsed.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
  }, []);

  // Ref to the catalog search input. App.tsx dispatches a
  // 'models-focus-search' window event when the user hits the
  // models.focus-search hotkey (default Ctrl+F) so we can focus +
  // select without lifting the input ref through the panel tree.
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onFocusReq = () => {
      const el = searchInputRef.current;
      if (!el) return;
      el.focus();
      try {
        el.select();
      } catch {
        // some input types don't support select; the focus is enough
      }
    };
    window.addEventListener('models-focus-search', onFocusReq);
    return () => window.removeEventListener('models-focus-search', onFocusReq);
  }, []);

  const handleCopyCommand = async (m: ModelDefinition) => {
    const cmdLine = [m.command, ...(m.args ?? [])].join(' ');
    // Prefer Electron's clipboard via IPC — reliable regardless of focus
    // state. Fall back to navigator.clipboard for dev-mode where the
    // bridge may not be wired.
    let ok = false;
    try {
      ok = await window.electronAPI.app.clipboardWrite(cmdLine);
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        await navigator.clipboard.writeText(cmdLine);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopiedId(m.id);
      if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
      copyToastTimer.current = setTimeout(() => setCopiedId(null), 2000);
    } else {
      alert(`Could not copy to clipboard. Command:\n\n${cmdLine}`);
    }
  };

  const handleOpenLicense = (m: ModelDefinition) => {
    if (m.licenseUrl) void window.electronAPI.models.openExternal(m.licenseUrl).catch(() => undefined);
  };

  const handleResetSeed = async () => {
    if (!confirm('Reset the model catalog to the bundled defaults? Custom additions will be removed.')) return;
    try {
      const next = await window.electronAPI.models.resetSeed();
      setModels(next.models);
    } catch {
      /* ignore */
    }
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <h3 style={titleStyle}>
        <div style={accentBarStyle} />
        Models
      </h3>

      <HardwareBanner hardware={hardware} ollama={ollama} />

      {recommendedModels.length > 0 && tab === 'local' && (
        <div style={recommendedSectionStyle}>
          <div style={recommendedHeaderStyle}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
              Recommended for you
            </span>
            <button
              type="button"
              onClick={() => setShowRecommended((v) => !v)}
              style={collapseBtnStyle}
            >
              {showRecommended ? 'Hide' : 'Show'}
            </button>
          </div>
          {showRecommended && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6, marginTop: 6 }}>
              {recommendedModels.map(({ rec, model }) => (
                <div
                  key={model.id}
                  style={recommendedCardStyle}
                  title={rec.reason}
                  onClick={() => {
                    setRoleFilter('all');
                    setTierFilter('all');
                    setSearch(model.name);
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{model.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                    {rec.reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
        <TabButton label={`Local Models (${counts.local})`} active={tab === 'local'} onClick={() => setTab('local')} />
        <TabButton label={`API Models (${counts.api})`} active={tab === 'api'} onClick={() => setTab('api')} />
      </div>

      {/* Search bar — visible on BOTH tabs so users can filter API
          entries too. Tier/role selects only matter for the local
          catalog, so they remain gated to the local tab. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          ref={searchInputRef}
          type="search"
          placeholder={tab === 'local' ? 'Search 30+ local models… (Ctrl+F)' : 'Search API providers… (Ctrl+F)'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchInputStyle}
          aria-label="Search models"
        />
        {tab === 'local' && (
          <>
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as TierFilter)} style={selectStyle}>
              <option value="all">All tiers</option>
              <option value="toaster">Toaster (≤8 GB)</option>
              <option value="low">Low (8-16 GB)</option>
              <option value="mid">Mid (16-32 GB)</option>
              <option value="high">High (24 GB VRAM)</option>
              <option value="workstation">Workstation (48+ GB)</option>
            </select>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)} style={selectStyle}>
              <option value="all">All roles</option>
              <option value="general-chat">General chat</option>
              <option value="frontend">Frontend</option>
              <option value="backend">Backend</option>
              <option value="polyglot-code">Polyglot code</option>
              <option value="reasoning">Reasoning</option>
              <option value="vision">Vision</option>
              <option value="long-context">Long context</option>
              <option value="edge">Edge / tiny</option>
              <option value="embedding">Embedding</option>
              <option value="agentic">Agentic</option>
              <option value="data">Data</option>
            </select>
          </>
        )}
      </div>

      <div style={runningSectionStyle}>
        {/* Tab strip — terminal-app style. Each running model is a tab;
            "+" at the end opens a model picker. Click tab to focus its
            embedded terminal below. ↗ pops out as its own window
            (preserves the chat-skin toggle). × kills.
            Always rendered so the "+" is reachable even with zero tabs. */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            alignItems: 'stretch',
            borderBottom: '1px solid var(--border)',
            marginBottom: 8,
            overflowX: 'auto',
            paddingBottom: 0,
            position: 'relative',
          }}
        >
          {running.map((r) => {
            const isSel = r.paneId === selectedRunningPaneId;
            return (
              <div
                key={r.paneId}
                onClick={() => setSelectedRunningPaneId(r.paneId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px 8px',
                  cursor: 'pointer',
                  borderRadius: '6px 6px 0 0',
                  background: isSel ? 'var(--bg-primary)' : 'transparent',
                  borderTop: isSel ? '1px solid var(--border)' : '1px solid transparent',
                  borderLeft: isSel ? '1px solid var(--border)' : '1px solid transparent',
                  borderRight: isSel ? '1px solid var(--border)' : '1px solid transparent',
                  borderBottom: isSel ? '1px solid var(--bg-primary)' : 'none',
                  marginBottom: -1,
                  position: 'relative',
                  top: isSel ? 1 : 0,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: isSel ? 'var(--accent)' : 'rgba(134,239,172,0.7)',
                    boxShadow: isSel ? 'var(--shadow-glow)' : 'none',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: isSel ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: isSel ? 600 : 400,
                    maxWidth: 140,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.modelName}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void window.electronAPI.models
                      .popout(r.paneId, r.modelName, r.modelId)
                      .catch(() => undefined);
                  }}
                  title="Pop out into its own window"
                  aria-label={`Pop out ${r.modelName}`}
                  style={tabIconBtnStyle}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="7" y1="17" x2="17" y2="7" />
                    <polyline points="7 7 17 7 17 17" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleKill(r.paneId);
                  }}
                  title="Kill this model"
                  aria-label={`Close ${r.modelName}`}
                  style={tabIconBtnStyle}
                >
                  ×
                </button>
              </div>
            );
          })}

          {/* "+" tab — opens the model picker dropdown. */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => {
                setShowTabPicker((v) => !v);
                setTabPickerQuery('');
              }}
              title="Open a new model in a new tab"
              aria-label="New model tab"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 10px 8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontSize: 13,
                lineHeight: 1,
                flexShrink: 0,
                borderRadius: '6px 6px 0 0',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1 }}>+</span>
              <span style={{ fontSize: 11 }}>New</span>
            </button>
            {showTabPicker && (
              <TabModelPicker
                models={models}
                query={tabPickerQuery}
                setQuery={setTabPickerQuery}
                onPick={(m) => {
                  setShowTabPicker(false);
                  void handleLaunch(m);
                }}
                onClose={() => setShowTabPicker(false)}
              />
            )}
          </div>

          {/* Spacer so "no tabs yet" hint sits to the right of "+". */}
          {running.length === 0 && (
            <div
              style={{
                padding: '8px 10px',
                fontSize: 10,
                color: 'var(--text-secondary)',
                alignSelf: 'center',
              }}
            >
              No active models. Click "+ New" to launch one, or use a catalog card below.
            </div>
          )}
        </div>

        {selectedRunningPaneId && (
          <div
            style={{
              height: 360,
              border: '1px solid var(--border)',
              borderRadius: '0 6px 6px 6px',
              overflow: 'hidden',
              background: 'var(--bg-primary)',
            }}
          >
            <EmbeddedTerminal
              paneId={selectedRunningPaneId}
              compact
              profile={
                running.find((r) => r.paneId === selectedRunningPaneId)?.modelId
              }
            />
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={mutedStyle}>Loading catalog…</div>}
        {!loading && filtered.length === 0 && (
          <div style={mutedStyle}>
            No {tab === 'api' ? 'API' : 'local'} models match the current filters.
            Clear filters, or click "Reset to defaults" if the catalog seems empty.
          </div>
        )}
        {filtered.map((m) => (
          <ModelCard
            key={m.id}
            model={m}
            installed={m.ollamaName ? installed.has(m.ollamaName) : false}
            pull={m.ollamaName ? pulls[m.ollamaName] : undefined}
            busy={!!busy[m.id]}
            ollamaReady={!!ollama?.installed && !!ollama?.daemonReachable}
            onPull={() => handlePull(m)}
            onCancelPull={() => handleCancelPull(m)}
            onDelete={() => handleDelete(m)}
            onLaunch={() => handleLaunch(m)}
            onCopy={() => handleCopyCommand(m)}
            recentlyCopied={copiedId === m.id}
            onOpenLicense={() => handleOpenLicense(m)}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setShowAddModal(true)} style={btnStyle}>
          + Add custom model
        </button>
        <button type="button" onClick={handleResetSeed} style={btnStyle}>
          Reset catalog to defaults
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          style={btnStyle}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setShowFirstRun(true)}
          style={btnStyle}
          title="Re-open the welcome picker"
        >
          First-run picker
        </button>
      </div>

      {showAddModal && (
        <AddModelModal
          onCancel={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            void refresh();
          }}
        />
      )}
      {showFirstRun && (
        <FirstRunPicker
          onClose={(outcome) => {
            setShowFirstRun(false);
            void window.electronAPI.models.onboardingMarkShown(outcome).catch(() => undefined);
            if (outcome === 'completed') void refresh();
          }}
        />
      )}

      {pendingLaunch && (
        <ApiKeyModal
          provider={pendingLaunch.provider}
          source="pre-launch"
          onSubmit={onPendingKeySubmit}
          onDismiss={() => setPendingLaunch(null)}
        />
      )}

      {pendingSetup && (
        <ProviderSetupModal
          modelName={pendingSetup.model.name}
          detect={pendingSetup.detect}
          onRetry={onSetupRetry}
          onDismiss={() => setPendingSetup(null)}
        />
      )}
    </div>
  );
}

function HardwareBanner({ hardware, ollama }: { hardware: HardwareProfile | null; ollama: OllamaVersionInfo | null }) {
  if (!hardware) {
    return <div style={mutedStyle}>Detecting hardware…</div>;
  }
  const tierLabel = hardware.tier.charAt(0).toUpperCase() + hardware.tier.slice(1);
  const ollamaLabel =
    ollama?.installed && ollama.daemonReachable
      ? `Ollama ${ollama.version ?? 'ready'}`
      : ollama?.installed
        ? `Ollama installed — daemon down`
        : `Ollama not installed`;
  const ollamaColor =
    ollama?.installed && ollama.daemonReachable
      ? '#86efac'
      : ollama?.installed
        ? '#fbbf24'
        : '#fca5a5';
  return (
    <div style={hardwareBannerStyle}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...tierBadgeStyle, background: tierColor(hardware.tier) }}>
          {tierLabel} tier
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
          {hardware.summary}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <span style={{ ...statusDotStyle, background: ollamaColor }} />
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{ollamaLabel}</span>
        {ollama && !ollama.installed && (
          <a
            href="https://ollama.com/download"
            onClick={(e) => {
              e.preventDefault();
              void window.electronAPI.models.openExternal('https://ollama.com/download').catch(() => undefined);
            }}
            style={{ fontSize: 10, color: 'var(--accent-light, var(--text-primary))', textDecoration: 'underline' }}
          >
            Install Ollama
          </a>
        )}
      </div>
      <GpuRoutingRow hardware={hardware} ollamaReachable={Boolean(ollama?.installed && ollama.daemonReachable)} />
    </div>
  );
}

/**
 * GPU routing controls — let the user override Ollama's auto-detect when
 * it's getting their dedicated GPU wrong. Renders inside HardwareBanner.
 *
 * Behavior: dropdown selects mode (Auto / GPU / CPU). On GPU mode with
 * multiple dedicated GPUs, a second dropdown picks which one. "Apply"
 * persists the prefs + restarts the daemon (vars only take effect on
 * fresh `ollama serve`).
 */
function GpuRoutingRow({
  hardware,
  ollamaReachable,
}: {
  hardware: HardwareProfile;
  ollamaReachable: boolean;
}) {
  const [prefs, setPrefs] = useState<import('../../../shared/types').GpuPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.gpuPrefs
      .get()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!prefs) return null;
  const dedicatedGpus = hardware.gpus.filter((g) => g.isDedicated);

  const onModeChange = (mode: 'auto' | 'gpu' | 'cpu') => {
    setPrefs({ ...prefs, mode });
    setDirty(true);
    setStatus(null);
  };
  const onGpuChange = (idxStr: string) => {
    const idx = idxStr === '' ? null : Number(idxStr);
    setPrefs({ ...prefs, targetGpuIndex: idx });
    setDirty(true);
    setStatus(null);
  };
  const onApply = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const saved = await window.electronAPI.gpuPrefs.set(prefs);
      setPrefs(saved);
      if (ollamaReachable) {
        const r = await window.electronAPI.ollama.daemonRestart();
        if (!r.ok) {
          setStatus(`Daemon restart failed: ${r.error ?? 'unknown'}`);
        } else {
          setStatus('Applied. Daemon restarted with new GPU routing.');
        }
      } else {
        setStatus('Saved. Will apply on next daemon start.');
      }
      setDirty(false);
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 6,
        flexWrap: 'wrap',
        fontSize: 10,
        color: 'var(--text-secondary)',
      }}
    >
      <span>GPU routing:</span>
      <select
        value={prefs.mode}
        onChange={(e) => onModeChange(e.target.value as 'auto' | 'gpu' | 'cpu')}
        disabled={busy}
        style={gpuSelectStyle}
      >
        <option value="auto">Auto-detect</option>
        <option value="gpu" disabled={dedicatedGpus.length === 0}>
          Force GPU {dedicatedGpus.length === 0 ? '(none detected)' : ''}
        </option>
        <option value="cpu">Force CPU</option>
      </select>
      {prefs.mode === 'gpu' && dedicatedGpus.length > 1 && (
        <select
          value={String(prefs.targetGpuIndex ?? '')}
          onChange={(e) => onGpuChange(e.target.value)}
          disabled={busy}
          style={gpuSelectStyle}
        >
          <option value="">Largest VRAM (auto)</option>
          {dedicatedGpus.map((g) => (
            <option key={g.index} value={g.index}>
              {g.name} ({g.vramGB ?? '?'} GB)
            </option>
          ))}
        </select>
      )}
      {dirty && (
        <button
          onClick={() => void onApply()}
          disabled={busy}
          style={{
            padding: '3px 10px',
            borderRadius: 6,
            border: '1px solid var(--accent)',
            background: 'var(--accent)',
            color: 'white',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          {busy ? 'Applying…' : 'Apply + restart daemon'}
        </button>
      )}
      {status && <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{status}</span>}
    </div>
  );
}

const gpuSelectStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '2px 6px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
};

function ModelCard({
  model,
  installed,
  pull,
  busy,
  ollamaReady,
  onPull,
  onCancelPull,
  onDelete,
  onLaunch,
  onCopy,
  recentlyCopied,
  onOpenLicense,
}: {
  model: ModelDefinition;
  installed: boolean;
  pull: PullState | undefined;
  busy: boolean;
  ollamaReady: boolean;
  onPull: () => void;
  onCancelPull: () => void;
  onDelete: () => void;
  onLaunch: () => void;
  onCopy: () => void;
  recentlyCopied?: boolean;
  onOpenLicense: () => void;
}) {
  const pulling = !!pull && !pull.done && !pull.error;
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {model.name}
          {model.featured && (
            <span style={featuredChipStyle} title={model.badge ?? 'Featured pick'}>
              ★ {model.badge ?? 'Featured'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {installed && <span style={installedChipStyle}>Installed</span>}
          <span style={chipStyle(model.category)}>{model.category === 'api' ? 'API' : 'Local'}</span>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
        {model.provider}
        {model.paramsB && ` · ${model.paramsB}B`}
        {model.activeParamsB && ` (${model.activeParamsB}B active)`}
        {model.architecture && ` · ${model.architecture}`}
        {model.releaseDate && ` · ${model.releaseDate}`}
      </div>

      {model.description && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.45 }}>
          {model.description}
        </div>
      )}

      {(model.roles?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
          {model.roles?.map((r) => (
            <span key={r} style={roleChipStyle}>{r}</span>
          ))}
        </div>
      )}

      {(model.vramGB || model.contextTokens || model.recommendedQuant) && (
        <div style={specGridStyle}>
          {model.vramGB && <Spec label="VRAM" value={`~${model.vramGB} GB`} />}
          {model.ramGB && <Spec label="RAM" value={`~${model.ramGB} GB`} />}
          {model.contextTokens && <Spec label="Context" value={fmtContext(model.contextTokens)} />}
          {model.recommendedQuant && <Spec label="Quant" value={model.recommendedQuant} />}
          {model.license && <Spec label="License" value={model.license} flagged={!!model.licenseFlag} />}
        </div>
      )}

      {model.recommendedFor && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
          {model.recommendedFor}
        </div>
      )}

      {(model.strengths?.length || model.weaknesses?.length) && (
        <details style={{ marginTop: 6, fontSize: 10 }}>
          <summary style={{ color: 'var(--text-muted)', cursor: 'pointer' }}>Strengths / weaknesses</summary>
          <div style={{ marginTop: 4, paddingLeft: 8 }}>
            {model.strengths?.map((s) => (
              <div key={s} style={{ color: 'var(--text-secondary)' }}>+ {s}</div>
            ))}
            {model.weaknesses?.map((w) => (
              <div key={w} style={{ color: 'var(--text-muted)' }}>− {w}</div>
            ))}
          </div>
        </details>
      )}

      {pull && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>
            {pull.error ? pull.error : pull.done ? 'Pull complete' : pull.status}
            {pull.bytesCompleted != null && pull.bytesTotal != null && !pull.done && (
              <> · {fmtBytes(pull.bytesCompleted)} / {fmtBytes(pull.bytesTotal)}</>
            )}
          </div>
          <div style={progressBarStyle}>
            <div
              style={{
                ...progressFillStyle,
                width: pull.done ? '100%' : `${pull.percent ?? 0}%`,
                background: pull.error ? '#ef4444' : pull.done ? '#22c55e' : 'var(--accent-gradient, #8b5cf6)',
              }}
            />
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {model.category === 'local' && model.ollamaName && !installed && !pulling && (
          <button
            type="button"
            onClick={onPull}
            disabled={busy || !ollamaReady}
            style={primaryBtnStyle(!ollamaReady ? 'Install Ollama first' : undefined)}
            title={!ollamaReady ? 'Install Ollama first' : `Download this model with Ollama. Streams progress below; size: ${model.vramGB ?? '?'} GB approximate.`}
          >
            Pull
          </button>
        )}
        {pulling && (
          <button
            type="button"
            onClick={onCancelPull}
            style={btnStyle}
            title="Cancel the in-flight Ollama pull."
          >Cancel pull</button>
        )}
        {model.category === 'local' && installed && (
          <>
            <button
              type="button"
              onClick={onLaunch}
              disabled={busy}
              style={primaryBtnStyle()}
              title="Spawn this model in a new terminal tab and route input/output through the chat skin."
            >
              Launch in app
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              style={btnStyle}
              title="Remove this model from Ollama (frees disk). Re-pull to use it again."
            >
              Delete
            </button>
          </>
        )}
        {model.category === 'api' && (
          <button
            type="button"
            onClick={onLaunch}
            style={primaryBtnStyle()}
            title="Launch this API model. Prompts for an API key if you don't have one saved."
          >
            Launch in app
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          style={recentlyCopied ? { ...btnStyle, color: '#22c55e', borderColor: '#22c55e' } : btnStyle}
          aria-live="polite"
          title="Copy the equivalent CLI command to your clipboard so you can run it in a regular shell."
        >
          {recentlyCopied ? '✓ Copied!' : 'Copy command'}
        </button>
        {model.licenseFlag && model.licenseUrl && (
          <button type="button" onClick={onOpenLicense} style={{ ...btnStyle, color: '#fbbf24' }}>
            Read license
          </button>
        )}
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

function Spec({ label, value, flagged }: { label: string; value: string; flagged?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 10, color: flagged ? '#fbbf24' : 'var(--text-primary)' }}>
        {flagged && '⚠ '}{value}
      </span>
    </div>
  );
}

function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

function tierColor(t: HardwareTier): string {
  switch (t) {
    case 'workstation': return 'linear-gradient(135deg, #8b5cf6, #ec4899)';
    // NVIDIA-green for Jetson Thor — visually distinct from generic
    // workstation while keeping the same "top tier" weight.
    case 'jetson-thor': return 'linear-gradient(135deg, #22c55e, #76b900)';
    case 'high': return 'linear-gradient(135deg, #3b82f6, #8b5cf6)';
    case 'mid': return 'linear-gradient(135deg, #22c55e, #3b82f6)';
    case 'low': return 'linear-gradient(135deg, #facc15, #22c55e)';
    case 'toaster': return 'linear-gradient(135deg, #f97316, #facc15)';
  }
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

function primaryBtnStyle(disabledReason?: string): React.CSSProperties {
  return {
    background: disabledReason ? 'transparent' : 'var(--accent-gradient, #8b5cf6)',
    border: '1px solid var(--border)',
    color: disabledReason ? 'var(--text-muted)' : '#fff',
    padding: '6px 12px',
    fontSize: 11,
    borderRadius: 6,
    cursor: disabledReason ? 'not-allowed' : 'pointer',
    fontWeight: 500,
    opacity: disabledReason ? 0.5 : 1,
  };
}

const mutedStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  padding: 12,
  textAlign: 'center',
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

const featuredChipStyle: React.CSSProperties = {
  fontSize: 9,
  marginLeft: 6,
  padding: '1px 6px',
  borderRadius: 999,
  background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
  color: '#0f172a',
  fontWeight: 600,
};

const installedChipStyle: React.CSSProperties = {
  fontSize: 9,
  padding: '1px 6px',
  borderRadius: 999,
  background: '#22c55e',
  color: '#0f172a',
  fontWeight: 600,
};

const roleChipStyle: React.CSSProperties = {
  fontSize: 8,
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(139, 92, 246, 0.15)',
  color: 'var(--text-secondary)',
  border: '1px solid rgba(139, 92, 246, 0.3)',
};

const specGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))',
  gap: 4,
  marginTop: 6,
  padding: '6px 8px',
  background: 'rgba(0,0,0,0.15)',
  borderRadius: 4,
};

const searchInputStyle: React.CSSProperties = {
  // v3.2.1 — bumped from 140/font 11/padding 4x8 because the old
  // search bar was hard to see and use (Item 4 in
  // docs/PLAN_2026-05-28_10-items.md).  Larger target, larger
  // font, sits visually as a first-class element next to the tabs.
  flex: 1,
  minWidth: 280,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  fontSize: 13,
  padding: '8px 12px',
  borderRadius: 6,
};

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  fontSize: 11,
  padding: '4px 6px',
  borderRadius: 4,
};

const hardwareBannerStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(139, 92, 246, 0.08)',
  border: '1px solid rgba(139, 92, 246, 0.2)',
  borderRadius: 6,
};

const tierBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  padding: '2px 8px',
  borderRadius: 999,
  color: '#0f172a',
  fontWeight: 600,
};

const statusDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  display: 'inline-block',
};

const recommendedSectionStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(34, 197, 94, 0.06)',
  border: '1px solid rgba(34, 197, 94, 0.15)',
  borderRadius: 6,
};

const recommendedHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const recommendedCardStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: 'var(--bg-primary)',
  borderRadius: 4,
  cursor: 'pointer',
  border: '1px solid var(--border)',
};

const collapseBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-muted)',
  fontSize: 10,
  cursor: 'pointer',
  textDecoration: 'underline',
};

const runningSectionStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: 'rgba(59, 130, 246, 0.06)',
  border: '1px solid rgba(59, 130, 246, 0.2)',
  borderRadius: 6,
};

const runningRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  padding: '4px 0',
};

const killBtnStyle: React.CSSProperties = {
  background: 'rgba(239, 68, 68, 0.2)',
  border: '1px solid rgba(239, 68, 68, 0.4)',
  color: '#fca5a5',
  padding: '2px 8px',
  fontSize: 10,
  borderRadius: 4,
  cursor: 'pointer',
};

const popoutBtnStyle: React.CSSProperties = {
  background: 'rgba(59, 130, 246, 0.15)',
  border: '1px solid rgba(59, 130, 246, 0.4)',
  color: '#93c5fd',
  padding: '2px 8px',
  fontSize: 10,
  borderRadius: 4,
  cursor: 'pointer',
  marginRight: 4,
};

/** Tab-strip icon button (popout / close). Quiet by default, brightens on
 *  hover. Inline-only — used in the running-models tab strip. */
const tabIconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  padding: '2px 5px',
  fontSize: 11,
  lineHeight: 1,
  borderRadius: 4,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * Anchored picker shown when the user clicks "+" on the tab strip.
 * Renders the catalog as a searchable list with grouping by category
 * (API / Local). Picking an entry runs the same `handleLaunch` flow
 * the catalog cards use (which honors license-flag + CLI-detect +
 * API-key gates).
 *
 * UX is intentionally similar to the terminal-app profile dropdown
 * (Windows Terminal, iTerm): hit "+", pick a profile, get a new tab.
 */
function TabModelPicker({
  models,
  query,
  setQuery,
  onPick,
  onClose,
}: {
  models: ModelDefinition[];
  query: string;
  setQuery: (q: string) => void;
  onPick: (m: ModelDefinition) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Dismiss on Escape OR click outside the popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest('[data-tab-picker]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Bind after a tick so the "+" click that opened us doesn't immediately close.
    const t = setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = models.filter((m) => {
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q)
      );
    });
    // Group by category for clearer scanability.
    const api = all.filter((m) => m.category === 'api');
    const local = all.filter((m) => m.category === 'local');
    return { api, local };
  }, [models, query]);

  return (
    <div
      data-tab-picker
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 2,
        width: 340,
        maxHeight: 420,
        zIndex: 50,
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 12,
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.api.length === 0 && filtered.local.length === 0 && (
          <div
            style={{
              padding: 16,
              fontSize: 11,
              color: 'var(--text-secondary)',
              textAlign: 'center',
            }}
          >
            No models match "{query}".
          </div>
        )}
        {filtered.api.length > 0 && (
          <PickerGroup label="API" models={filtered.api} onPick={onPick} />
        )}
        {filtered.local.length > 0 && (
          <PickerGroup label="Local" models={filtered.local} onPick={onPick} />
        )}
      </div>
    </div>
  );
}

function PickerGroup({
  label,
  models,
  onPick,
}: {
  label: string;
  models: ModelDefinition[];
  onPick: (m: ModelDefinition) => void;
}) {
  return (
    <div>
      <div
        style={{
          padding: '6px 12px 4px',
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          background: 'var(--bg-secondary)',
        }}
      >
        {label} · {models.length}
      </div>
      {models.map((m) => (
        <button
          key={m.id}
          onClick={() => onPick(m)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 12px',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {m.name}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-secondary)',
                marginTop: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {m.provider}
              {m.description ? ` · ${m.description}` : ''}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

const progressBarStyle: React.CSSProperties = {
  width: '100%',
  height: 4,
  background: 'rgba(0,0,0,0.3)',
  borderRadius: 2,
  overflow: 'hidden',
};

const progressFillStyle: React.CSSProperties = {
  height: '100%',
  transition: 'width 0.2s ease',
};
