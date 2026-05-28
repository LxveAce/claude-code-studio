import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalPanel } from './TerminalPanel';
import { EmbeddedTerminal } from '../models/EmbeddedTerminal';
import type { CliCapabilities, ModelDefinition } from '../../../shared/types';

/** Catalog ids that require CliCapabilities.streamJson. The picker
 *  warns the user before launching one of these on a CLI that doesn't
 *  support the necessary flags. Keep in sync with model-catalog-seed. */
const STREAM_JSON_REQUIRED_PROFILES = new Set<string>([
  'api.anthropic.claude-chat',
]);

/**
 * TerminalTabs — Windows-Terminal-style tab bar for the main terminal area.
 *
 * Each tab is one CLI session with its own PTY:
 *   - `profile: 'claude'`: TerminalPanel auto-spawns the bundled Claude
 *     CLI; paneId is `p_<uuid>`.
 *   - `profile: <model.id>`: we call `models.launch(modelId)` to spawn a
 *     non-Claude CLI / Ollama model PTY; paneId is `model:<id>-<ts>` (set
 *     by main). The tab content uses EmbeddedTerminal which attaches.
 *
 * UI affordances modeled on Windows Terminal:
 *   - One tab per session, with label + close (×) + popout (↗) buttons.
 *   - `+` button on the right of the strip = new Claude tab (default).
 *   - `v` chevron beside `+` opens a profile dropdown listing every
 *     model in the catalog grouped by API / Local.
 *   - Click a tab to switch its terminal into view.
 *
 * State is owned by App.tsx and passed in — App owns session persistence
 * and the activePaneId concept used elsewhere (palette, snippets, etc.).
 */

export interface TerminalTab {
  /** Stable tab identifier (renderer-only). */
  id: string;
  /** Display name shown in the tab. */
  label: string;
  /** PTY paneId. For Claude: `p_<uuid>`. For models: `model:<id>-<ts>`
   *  (assigned by main when MODELS_LAUNCH spawns the PTY). */
  paneId: string;
  /** `'claude'` or a catalog `ModelDefinition.id`. */
  profile: string;
  /** True once the underlying PTY has been launched. False during the
   *  brief window between tab-add and models.launch resolving. */
  ready: boolean;
}

export interface TerminalTabsProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  /** Accepts both `next: TerminalTab[]` and an updater function. The
   *  updater form is required by the internal add/replace/close paths
   *  so concurrent gestures (e.g., user clicks `+` while a model PTY
   *  is still launching) don't drop or duplicate tabs by reading a
   *  stale closure. App.tsx passes `setTabs` directly. */
  onTabsChange: React.Dispatch<React.SetStateAction<TerminalTab[]>>;
  onActiveChange: (id: string | null) => void;
  onPidChange: (paneId: string, pid: number) => void;
  registerSender: (paneId: string, send: ((data: string) => void) | null) => void;
  /** Catalog from ModelRegistry, used by the profile dropdown. */
  catalog: ModelDefinition[];
  /** Optional cwd for new Claude PTYs (model PTYs use the git cwd via main). */
  cwd?: string | null;
}

/** Hard cap matching SessionService's MAX_TABS (32). The backend
 *  rejects spawns past PtyRegistry.MAX_PANES (16 for Claude tabs) and
 *  the persistence sanitizer trims tabs beyond 32, but failing here
 *  with a clear notice beats a silent half-broken tab in the strip. */
const MAX_TABS_RENDERER = 32;

export function TerminalTabs({
  tabs,
  activeTabId,
  onTabsChange,
  onActiveChange,
  onPidChange,
  registerSender,
  catalog,
  cwd,
}: TerminalTabsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [capNotice, setCapNotice] = useState<string | null>(null);

  // Open the profile picker in response to a hotkey-driven custom event
  // fired by App.tsx (default chord Ctrl+Shift+T -> 'terminal.new-profile').
  // Same decoupling pattern as the Models search hotkey.
  useEffect(() => {
    const onOpenPicker = () => {
      setPickerQuery('');
      setPickerOpen(true);
    };
    window.addEventListener('terminal-open-profile-picker', onOpenPicker);
    return () => window.removeEventListener('terminal-open-profile-picker', onOpenPicker);
  }, []);
  /** `claude --help` capability flags. null = not yet fetched (treated
   *  as "no warning" until we know — false positives on a slow probe
   *  would be more annoying than a missing badge for a few hundred ms). */
  const [cliCaps, setCliCaps] = useState<CliCapabilities | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  // Fetch CLI capabilities once on mount. Cached main-side, so the
  // second call is free. Used by ProfilePicker to badge entries that
  // need flag support the local Claude binary may not have.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const caps = await window.electronAPI.cli.capabilities();
        if (!cancelled) setCliCaps(caps);
      } catch {
        // IPC missing (dev build) — leave null; picker shows no warnings.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Drop the "you hit the cap" toast after 10s. The longer window helps
  // when the user is mid-context-switch (PR #21's M-2 was that a 4s
  // dismiss could fire while the user was on a sidebar panel and miss
  // the banner). User can also click-to-dismiss for instant clearing.
  useEffect(() => {
    if (!capNotice) return;
    const t = setTimeout(() => setCapNotice(null), 10000);
    return () => clearTimeout(t);
  }, [capNotice]);

  const addClaudeTab = useCallback(() => {
    if (tabs.length >= MAX_TABS_RENDERER) {
      setCapNotice(`Tab limit reached (${MAX_TABS_RENDERER}). Close a tab first.`);
      return;
    }
    const id = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const paneId = `p_${id.slice(4)}`;
    const next: TerminalTab = {
      id,
      label: 'Claude',
      paneId,
      profile: 'claude',
      ready: true,
    };
    // Updater form: rapid `+` clicks must not drop tabs added between renders.
    onTabsChange((prev) => [...prev, next]);
    onActiveChange(id);
  }, [tabs.length, onTabsChange, onActiveChange]);

  const addModelTab = useCallback(
    async (m: ModelDefinition) => {
      if (tabs.length >= MAX_TABS_RENDERER) {
        setCapNotice(`Tab limit reached (${MAX_TABS_RENDERER}). Close a tab first.`);
        return;
      }
      const id = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      // Insert a placeholder tab immediately so the UI doesn't feel laggy.
      const placeholder: TerminalTab = {
        id,
        label: m.name,
        paneId: '',
        profile: m.id,
        ready: false,
      };
      onTabsChange((prev) => [...prev, placeholder]);
      onActiveChange(id);

      let r: { ok: boolean; paneId: string | null; error: string | null };
      try {
        r = await window.electronAPI.models.launch(m.id, cwd ?? undefined);
      } catch (e) {
        r = { ok: false, paneId: null, error: (e as Error).message ?? String(e) };
      }
      if (!r.ok || !r.paneId) {
        alert(`Couldn't launch ${m.name}: ${r.error ?? 'unknown error'}`);
        // Remove only the failing placeholder; tabs the user opened in parallel
        // during the async window stay alive.
        onTabsChange((prev) => prev.filter((t) => t.id !== id));
        return;
      }
      const confirmedPaneId = r.paneId;
      // Replace the placeholder in-place so tabs added in parallel during the
      // launch survive — the previous implementation overwrote the whole list
      // with a stale closure of `tabs`, silently dropping any concurrent
      // additions.
      onTabsChange((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, paneId: confirmedPaneId, ready: true } : t
        )
      );
    },
    [onTabsChange, onActiveChange, cwd]
  );

  const closeTab = useCallback(
    async (id: string) => {
      // Capture the tab before any state mutation — we need its paneId to kill
      // the PTY even if `tabs` changes during the await.
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      setClosingId(id);
      if (tab.paneId) {
        try {
          await window.electronAPI.terminal.kill(tab.paneId);
        } catch {
          // PTY may already be dead — proceed with removal.
        }
      }
      onTabsChange((prev) => prev.filter((t) => t.id !== id));
      if (activeTabId === id) {
        // Compute fallback focus from the post-close `tabs` snapshot we just
        // observed. If a tab was added concurrently in the await window, it
        // will still be in the list after our filter and become the natural
        // last-tab fallback in App.tsx's session save path.
        const remaining = tabs.filter((t) => t.id !== id);
        onActiveChange(remaining[remaining.length - 1]?.id ?? null);
      }
      setClosingId(null);
    },
    [tabs, activeTabId, onTabsChange, onActiveChange]
  );

  const popoutTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab || !tab.paneId) return;
      // The popout window IS the same paneId — closing the popout doesn't
      // kill the PTY, and the tab stays in the main window. Removing it
      // from the tab strip would orphan the PTY; we keep it instead so the
      // user can close the popout and still get back to the session.
      void window.electronAPI.models
        .popout(tab.paneId, tab.label, tab.profile)
        .catch(() => undefined);
    },
    [tabs]
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 0,
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          paddingLeft: 6,
          minHeight: 32,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 2,
            overflowX: 'auto',
            flex: 1,
            minWidth: 0,
          }}
        >
          {tabs.map((t) => (
            <Tab
              key={t.id}
              tab={t}
              active={t.id === activeTabId}
              busy={closingId === t.id}
              onSelect={() => onActiveChange(t.id)}
              onClose={() => void closeTab(t.id)}
              onPopout={() => popoutTab(t.id)}
            />
          ))}
        </div>
        <NewTabButtons
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          pickerQuery={pickerQuery}
          setPickerQuery={setPickerQuery}
          catalog={catalog}
          cliCaps={cliCaps}
          onAddClaude={addClaudeTab}
          onAddModel={(m) => { setPickerOpen(false); void addModelTab(m); }}
        />
      </div>

      {capNotice && (
        <div
          role="status"
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: '#fcd34d',
            background: 'rgba(251,191,36,0.08)',
            borderBottom: '1px solid rgba(251,191,36,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ flex: 1 }}>{capNotice}</span>
          <button
            onClick={() => setCapNotice(null)}
            aria-label="Dismiss"
            title="Dismiss"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fcd34d',
              cursor: 'pointer',
              padding: '0 4px',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {tabs.length === 0 && (
          <div style={emptyStateStyle}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
              No active sessions.
            </div>
            <button
              onClick={addClaudeTab}
              style={primaryButtonStyle}
            >
              Open a Claude tab
            </button>
          </div>
        )}
        {tabs.map((t) => {
          const isActive = t.id === activeTabId;
          // Keep all tabs mounted (display:none for inactive) so PTY
          // history isn't lost on tab switch. Cheap because xterm doesn't
          // re-render when not visible.
          return (
            <div
              key={t.id}
              style={{
                position: 'absolute',
                inset: 0,
                display: isActive ? 'flex' : 'none',
              }}
            >
              {!t.ready ? (
                <div style={emptyStateStyle}>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    Launching {t.label}…
                  </div>
                </div>
              ) : t.profile === 'claude' ? (
                <TerminalPanel
                  paneId={t.paneId}
                  cwd={cwd}
                  active={isActive}
                  onPidChange={onPidChange}
                  registerSender={registerSender}
                  onFocus={() => onActiveChange(t.id)}
                />
              ) : (
                <EmbeddedTerminal
                  paneId={t.paneId}
                  compact={false}
                  registerSender={registerSender}
                  onPidChange={onPidChange}
                  active={isActive}
                  profile={t.profile}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----- Tab -----

function Tab({
  tab,
  active,
  busy,
  onSelect,
  onClose,
  onPopout,
}: {
  tab: TerminalTab;
  active: boolean;
  busy: boolean;
  onSelect: () => void;
  onClose: () => void;
  onPopout: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      title={tab.label}
      data-terminal-tab={tab.id}
      data-tab-profile={tab.profile}
      data-tab-active={active ? 'true' : 'false'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px 8px 12px',
        cursor: 'pointer',
        borderRadius: '6px 6px 0 0',
        background: active ? 'var(--bg-primary)' : 'transparent',
        borderTop: active ? '1px solid var(--border)' : '1px solid transparent',
        borderLeft: active ? '1px solid var(--border)' : '1px solid transparent',
        borderRight: active ? '1px solid var(--border)' : '1px solid transparent',
        borderBottom: active ? '1px solid var(--bg-primary)' : 'none',
        marginBottom: -1,
        position: 'relative',
        top: active ? 1 : 0,
        minWidth: 110,
        maxWidth: 200,
        flexShrink: 0,
        opacity: busy ? 0.5 : 1,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: tab.ready
            ? active
              ? 'var(--accent)'
              : 'rgba(134,239,172,0.6)'
            : 'rgba(251,191,36,0.7)',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          fontSize: 12,
          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: active ? 600 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {tab.label}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPopout();
        }}
        title={`Pop out ${tab.label} as its own window`}
        aria-label={`Pop out ${tab.label}`}
        style={iconBtn}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="7" y1="17" x2="17" y2="7" />
          <polyline points="7 7 17 7 17 17" />
        </svg>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title={`Close ${tab.label}`}
        aria-label={`Close ${tab.label}`}
        style={iconBtn}
      >
        ×
      </button>
    </div>
  );
}

// ----- "+" and "v" buttons + profile picker -----

function NewTabButtons({
  pickerOpen,
  setPickerOpen,
  pickerQuery,
  setPickerQuery,
  catalog,
  cliCaps,
  onAddClaude,
  onAddModel,
}: {
  pickerOpen: boolean;
  setPickerOpen: (v: boolean) => void;
  pickerQuery: string;
  setPickerQuery: (q: string) => void;
  catalog: ModelDefinition[];
  cliCaps: CliCapabilities | null;
  onAddClaude: () => void;
  onAddModel: (m: ModelDefinition) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', position: 'relative' }}>
      <button
        type="button"
        onClick={() => {
          setPickerOpen(!pickerOpen);
          setPickerQuery('');
        }}
        title="New tab… (Ctrl+Shift+T) — pick Claude or another profile"
        aria-label="New tab"
        style={{
          ...iconBtn,
          width: 28,
          height: 24,
          fontSize: 16,
          fontWeight: 400,
          color: 'var(--text-secondary)',
        }}
      >
        +
      </button>
      <button
        type="button"
        onClick={() => {
          setPickerOpen(!pickerOpen);
          setPickerQuery('');
        }}
        title="Pick a profile to open"
        aria-label="Pick a profile"
        style={{
          ...iconBtn,
          width: 18,
          height: 24,
          color: 'var(--text-secondary)',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {pickerOpen && (
        <ProfilePicker
          query={pickerQuery}
          setQuery={setPickerQuery}
          catalog={catalog}
          cliCaps={cliCaps}
          onPickClaude={() => { setPickerOpen(false); onAddClaude(); }}
          onPickModel={onAddModel}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function ProfilePicker({
  query,
  setQuery,
  catalog,
  cliCaps,
  onPickClaude,
  onPickModel,
  onClose,
}: {
  query: string;
  setQuery: (q: string) => void;
  catalog: ModelDefinition[];
  cliCaps: CliCapabilities | null;
  onPickClaude: () => void;
  onPickModel: (m: ModelDefinition) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest('[data-profile-picker]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Exclude the Anthropic catalog entry — Claude is shown as the
    // "Default" pinned item at the top so it always wins for + clicks.
    const visible = catalog.filter(
      (m) => m.id !== 'api.anthropic.claude' &&
        (!q ||
          m.name.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q) ||
          (m.description ?? '').toLowerCase().includes(q))
    );
    return {
      api: visible.filter((m) => m.category === 'api'),
      local: visible.filter((m) => m.category === 'local'),
    };
  }, [catalog, query]);

  return (
    <div
      data-profile-picker
      style={{
        position: 'absolute',
        top: 28,
        right: 4,
        width: 360,
        maxHeight: 460,
        zIndex: 100,
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'inherit',
      }}
    >
      <button
        type="button"
        onClick={onPickClaude}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'var(--bg-secondary)',
          border: 'none',
          borderBottom: '1px solid var(--border)',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-secondary)';
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Claude</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Bundled default · Anthropic
          </div>
        </div>
        <span style={pickerHotkey}>+ click</span>
      </button>

      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter on empty query: confirm the default Claude entry,
            // matching the visual "Claude (default)" pinned card above.
            // Lets the Ctrl+Shift+T hotkey flow into Enter for the
            // single-keystroke "new Claude tab" path.
            if (e.key === 'Enter' && !query.trim()) {
              e.preventDefault();
              onPickClaude();
            }
          }}
          placeholder="Search profiles… (Enter to pick Claude)"
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
            No profiles match "{query}".
          </div>
        )}
        {filtered.api.length > 0 && (
          <PickerGroup label="API" models={filtered.api} cliCaps={cliCaps} onPick={onPickModel} />
        )}
        {filtered.local.length > 0 && (
          <PickerGroup label="Local" models={filtered.local} cliCaps={cliCaps} onPick={onPickModel} />
        )}
      </div>
    </div>
  );
}

function PickerGroup({
  label,
  models,
  cliCaps,
  onPick,
}: {
  label: string;
  models: ModelDefinition[];
  cliCaps: CliCapabilities | null;
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
      {models.map((m) => {
        // Badge entries that need stream-json when the local Claude
        // binary doesn't appear to support it. Only flag when we've
        // successfully probed (cliCaps.probed); a probe failure is a
        // separate problem the user will see in the chat-skin bubble
        // anyway.
        const needsStreamJson = STREAM_JSON_REQUIRED_PROFILES.has(m.id);
        const incompatible =
          needsStreamJson &&
          !!cliCaps &&
          cliCaps.probed &&
          !cliCaps.streamJson;
        return (
          <button
            key={m.id}
            onClick={() => onPick(m)}
            title={
              incompatible
                ? `Your Claude CLI (${cliCaps?.version ?? 'unknown version'}) may not support --output-format=stream-json. Launching may error out; you can still try.`
                : undefined
            }
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.name}
                </span>
                {incompatible && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: 'rgba(251,191,36,0.18)',
                      color: '#fcd34d',
                      border: '1px solid rgba(251,191,36,0.35)',
                      flexShrink: 0,
                    }}
                  >
                    CLI flags?
                  </span>
                )}
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
        );
      })}
    </div>
  );
}

// ----- Shared styles -----

const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  padding: '4px 6px',
  fontSize: 12,
  lineHeight: 1,
  borderRadius: 4,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};

const emptyStateStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--bg-primary)',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const pickerHotkey: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-secondary)',
  padding: '2px 6px',
  background: 'rgba(255,255,255,0.06)',
  borderRadius: 4,
};
