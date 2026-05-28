import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { ResourcePanel } from './components/resources/ResourcePanel';
import { CompactPanel } from './components/compact/CompactPanel';
import { CommandsPanel } from './components/commands/CommandsPanel';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { GitHubPanel } from './components/github/GitHubPanel';
import { LMMPanel } from './components/lmm/LMMPanel';
import { AuthPanel } from './components/auth/AuthPanel';
import { SyncPanel } from './components/sync/SyncPanel';
import { CostPanel } from './components/cost/CostPanel';
import { CommandPalette } from './components/palette/CommandPalette';
import { CliAuthOnboarding } from './components/auth/CliAuthOnboarding';
import { ModelsPanel } from './components/models/ModelsPanel';
import { PopoutView } from './components/models/PopoutView';
import { FileTreePanel } from './components/project/FileTreePanel';
import { ApiKeyModal } from './components/auth/ApiKeyModal';
import { TerminalTabs, type TerminalTab } from './components/terminal/TerminalTabs';
import {
  deriveCommandFamily,
  type CommandFamily,
} from './components/commands/command-families';
import { buildChordMap, chordFromEvent } from './hotkeys';
import type {
  HotkeyAction,
  HotkeyBinding,
  ModelDefinition,
  PersistedTab,
  ProviderKeyPromptEvent,
  SessionState,
} from '../shared/types';
import { applyTheme, findThemePreset, parseThemeKey, type ThemePreset } from './theme-presets';

export type SidebarPanel =
  | 'terminal'
  | 'commands'
  | 'resources'
  | 'github'
  | 'cost'
  | 'compact'
  | 'lmm'
  | 'sync'
  | 'auth'
  | 'settings'
  | 'models'   // v3.0 multi-model scaffold
  | 'files';   // 3.0.0-beta.3 file directory navigator

/** Bootstrap tab used until session-state hydrates. Mirrors the main-side
 *  defaults() in session-service.ts so the same paneId reattaches if a PTY
 *  survived a hot-reload. */
const DEFAULT_TABS: TerminalTab[] = [
  { id: 'tab_root', label: 'Claude', paneId: 'p_root', profile: 'claude', ready: true },
];

export function App() {
  // Pop-out window short-circuit. When this renderer is the child of a
  // models:popout BrowserWindow it loads with ?popout=<paneId>&label=<name>
  // — render only the terminal for that paneId, skip the full app shell.
  // Computed before any other hooks so the popout window doesn't waste
  // cycles on session/hotkey/auth wiring.
  const popoutParams = (() => {
    if (typeof window === 'undefined') return null;
    const sp = new URLSearchParams(window.location.search);
    const paneId = sp.get('popout');
    if (!paneId) return null;
    return {
      paneId,
      label: sp.get('label') ?? 'Model',
      profile: sp.get('profile') ?? undefined,
    };
  })();
  if (popoutParams) {
    return <PopoutView paneId={popoutParams.paneId} label={popoutParams.label} profile={popoutParams.profile} />;
  }

  const [hydrated, setHydrated] = useState(false);
  const [activePanel, setActivePanel] = useState<SidebarPanel>('terminal');
  const [tabs, setTabs] = useState<TerminalTab[]>(DEFAULT_TABS);
  const [activeTabId, setActiveTabId] = useState<string | null>(DEFAULT_TABS[0]?.id ?? null);
  const [catalog, setCatalog] = useState<ModelDefinition[]>([]);
  const [pidByPane, setPidByPane] = useState<Record<string, number>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bindings, setBindings] = useState<HotkeyBinding[]>([]);

  // The PTY currently driven by snippet inserts, palette text-injection, and
  // the StatusBar PID readout. Derived rather than stored: keeping it in sync
  // with the active tab is one source of truth.
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activePaneId = activeTab?.paneId ?? null;
  // Drives the Commands sidebar — `unknown` shows the generic empty-state.
  const activeCommandFamily: CommandFamily = deriveCommandFamily(
    activeTab?.profile ?? null,
    catalog
  );
  // Phase 6 — first-launch CLI onboarding. Shown when persisted
  // onboarding-complete is false AND `claude doctor` reports the CLI is
  // missing or unauthenticated. Recovers from Phase 4's NSIS bootstrap
  // soft-fail.
  const [cliOnboardingOpen, setCliOnboardingOpen] = useState(false);
  /** Map of paneId -> sendInput. Tracking *all* sender functions lets the
   *  palette / snippets always reach the *currently active* pane. */
  const sendersRef = useRef<Record<string, (data: string) => void>>({});

  // --- session load -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const restored = await window.electronAPI.session.get();
        if (cancelled) return;
        if (restored) {
          const restoredTabs: TerminalTab[] = restored.tabs.map((t: PersistedTab) => ({
            id: t.id,
            label: t.label,
            paneId: t.paneId,
            profile: t.profile,
            // Persisted tabs are Claude-only and represent already-known PTYs.
            // `terminal.spawn` is idempotent so reattach is safe; mark them
            // ready immediately so the TerminalPanel mounts and reconnects.
            ready: true,
          }));
          setTabs(restoredTabs.length > 0 ? restoredTabs : DEFAULT_TABS);
          setActivePanel(restored.activePanel as SidebarPanel);
          setActiveTabId(
            restored.activeTabId ?? restoredTabs[0]?.id ?? DEFAULT_TABS[0]?.id ?? null
          );
        }
      } catch {
        // Bad session file — already handled in main; we just fall back.
      }
      try {
        const list = await window.electronAPI.models.list();
        if (!cancelled) setCatalog(list);
      } catch {
        // Catalog IPC missing — the + picker just shows Claude.
        if (!cancelled) setCatalog([]);
      }
      // Apply persisted theme from localStorage on startup. Supports both
      // built-in presets and custom themes (loaded via themes:list IPC).
      // Without this, the app renders with default CSS until the user opens
      // Settings, which mounts SettingsPanel and applies the theme there.
      try {
        const parsed = parseThemeKey(localStorage.getItem('claude-studio-theme'));
        if (parsed) {
          if (parsed.custom) {
            const customs = await window.electronAPI.themes.list();
            const match = customs.find((t) => t.name === parsed.name);
            if (match && !cancelled) {
              const preset: ThemePreset = { ...match, custom: true };
              applyTheme(preset);
            }
          } else {
            const builtin = findThemePreset(parsed.name);
            if (builtin && !cancelled) applyTheme(builtin);
          }
        }
      } catch {
        // Themes IPC missing or store malformed — defaults are fine.
      }
      // Apply persisted accessibility prefs early so things like font
      // scale + high contrast are in place before the first paint.
      try {
        const a11y = await window.electronAPI.accessibility.get();
        if (!cancelled) {
          const { applyAccessibilityPrefs } = await import('./components/settings/accessibility-prefs');
          applyAccessibilityPrefs(a11y);
        }
      } catch {
        // Accessibility IPC missing — defaults are no-ops, fine to skip.
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- session save (debounced) ----------------------------------------------
  useEffect(() => {
    if (!hydrated) return;
    // Debounce so rapid tab open/close gestures coalesce. Main-side writes
    // are already atomic; the debounce just keeps disk traffic low.
    const handle = window.setTimeout(() => {
      // Only Claude tabs are persisted — model PTYs can't survive a restart
      // and we don't want to silently re-trigger downloads / GPU loads.
      const persistedTabs: PersistedTab[] = tabs
        .filter((t) => t.profile === 'claude' && !!t.paneId)
        .map((t) => ({
          id: t.id,
          label: t.label,
          paneId: t.paneId,
          profile: t.profile,
        }));
      const persistedActiveTabId =
        activeTabId && persistedTabs.some((t) => t.id === activeTabId)
          ? activeTabId
          : persistedTabs[0]?.id ?? null;
      const state: SessionState = {
        version: 2,
        activePanel,
        theme: null,
        // theme is applied at the renderer; we don't persist the active preset
        // name yet because applyTheme doesn't return it. Future enhancement.
        tabs: persistedTabs,
        activeTabId: persistedActiveTabId,
      };
      void window.electronAPI.session.set(state).catch(() => {
        // Persistence failure is non-fatal — user can re-arrange on next start.
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [hydrated, tabs, activeTabId, activePanel]);

  // --- CLI onboarding check (Phase 6) ----------------------------------------
  // Runs once post-hydration. If user hasn't completed onboarding AND the CLI
  // is either missing or unauthenticated, show the modal. Soft-fails silently
  // on IPC errors — we never want this to block app startup.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      try {
        const onboarding = await window.electronAPI.cli.getOnboarding();
        if (cancelled || onboarding.complete) return;
        const status = await window.electronAPI.cli.status();
        if (cancelled) return;
        if (!status.installed || !status.authenticated) {
          setCliOnboardingOpen(true);
        }
      } catch {
        // Defensive — if status/onboarding IPC fails for any reason, just
        // skip the modal. User can still use the app; the missing-CLI case
        // will manifest in the terminal panel anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  // --- pane sender management -------------------------------------------------
  const registerSender = useCallback(
    (paneId: string, send: ((data: string) => void) | null) => {
      if (send === null) {
        delete sendersRef.current[paneId];
      } else {
        sendersRef.current[paneId] = send;
      }
    },
    []
  );

  const handlePidChange = useCallback((paneId: string, pid: number) => {
    setPidByPane((prev) => ({ ...prev, [paneId]: pid }));
  }, []);

  // --- terminal helpers (used by palette + commands panel) -------------------
  const sendToActive = useCallback(
    (text: string, submit: boolean) => {
      if (!activePaneId) return;
      const sender = sendersRef.current[activePaneId];
      if (!sender) return;
      // Strip carriage returns to defuse the "snippet body with \r auto-submits"
      // footgun (Phase 7a security note). Only the explicit `submit` flag adds
      // the final \r.
      const sanitized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      sender(submit ? sanitized + '\r' : sanitized);
    },
    [activePaneId]
  );

  const handleSendCommand = useCallback(
    (command: string, submit: boolean = true) => {
      // submit=false routes the command into the pane without a CR — used
      // by per-command "starter" entries (Aider /add, Ollama /set system,
      // etc.) where the user needs to type an argument before submitting.
      sendToActive(command, submit);
      setActivePanel('terminal');
      // When the user just dropped a starter command into the pane,
      // auto-focus the active terminal so they can finish typing the
      // argument without an extra click (closes M-1 from
      // SECURITY_REVIEW_POLISH.md). Dispatched as a window event so
      // any mounted TerminalPanel / EmbeddedTerminal can opt in via
      // its `active` prop; non-active panes ignore.
      if (!submit) {
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('ccs-focus-active-terminal'));
        });
      }
    },
    [sendToActive]
  );

  const handleRestartTerminal = useCallback(() => {
    if (!activePaneId) return;
    void window.electronAPI.terminal.restart(activePaneId);
  }, [activePaneId]);

  // --- tab actions (palette + hotkeys) --------------------------------------

  const handleNewClaudeTab = useCallback(() => {
    const id = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const paneId = `p_${id.slice(4)}`;
    const next: TerminalTab = {
      id,
      label: 'Claude',
      paneId,
      profile: 'claude',
      ready: true,
    };
    setTabs((prev) => [...prev, next]);
    setActiveTabId(id);
    setActivePanel('terminal');
  }, []);

  const handleCloseActiveTab = useCallback(() => {
    if (!activeTabId) return;
    if (tabs.length <= 1) {
      // Closing the only tab is forbidden; the empty-state would surprise
      // users coming from the split-pane era. Use "Reset tabs" instead.
      return;
    }
    const closing = tabs.find((t) => t.id === activeTabId);
    if (!closing) return;
    if (closing.paneId) {
      void window.electronAPI.terminal.kill(closing.paneId).catch(() => {
        // PTY may already be dead — proceed with removal.
      });
    }
    const remaining = tabs.filter((t) => t.id !== activeTabId);
    setTabs(remaining);
    setActiveTabId(remaining[remaining.length - 1]?.id ?? null);
  }, [tabs, activeTabId]);

  const handleFocusTab = useCallback(
    (delta: 1 | -1) => {
      if (tabs.length === 0) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      const safeIdx = idx === -1 ? 0 : idx;
      const next = (safeIdx + delta + tabs.length) % tabs.length;
      setActiveTabId(tabs[next].id);
    },
    [tabs, activeTabId]
  );

  const handleResetTabs = useCallback(() => {
    void window.electronAPI.session.reset().then((s) => {
      // Kill any PTYs whose tabs are about to disappear. Defaults() collapses
      // to a single Claude tab on `p_root`, so anything not on the surviving
      // paneId list should be cleaned up.
      const survivingPanes = new Set(s.tabs.map((t: PersistedTab) => t.paneId));
      for (const t of tabs) {
        if (t.paneId && !survivingPanes.has(t.paneId)) {
          void window.electronAPI.terminal.kill(t.paneId).catch(() => {});
        }
      }
      const restored: TerminalTab[] = s.tabs.map((t: PersistedTab) => ({
        id: t.id,
        label: t.label,
        paneId: t.paneId,
        profile: t.profile,
        ready: true,
      }));
      setTabs(restored.length > 0 ? restored : DEFAULT_TABS);
      setActiveTabId(s.activeTabId ?? restored[0]?.id ?? null);
      setActivePanel(s.activePanel as SidebarPanel);
    });
  }, [tabs]);

  // Dispatch a renderer-side action by id. Used both by the local hotkey
  // listener and by tray-triggered events from the main process. Updated for
  // 7c split-panes: actions that target a single PTY use activePaneId.
  const dispatchAction = useCallback(
    (action: HotkeyAction) => {
      switch (action) {
        case 'palette.open':
          setPaletteOpen((v) => !v);
          break;
        case 'terminal.restart':
          if (activePaneId) void window.electronAPI.terminal.restart(activePaneId);
          break;
        case 'compact.toggle':
          setActivePanel('compact');
          break;
        case 'panel.lmm':
          setActivePanel('lmm');
          break;
        case 'panel.github':
          setActivePanel('github');
          break;
        case 'models.focus-search':
          // Open the Models panel (if not already) and ask it to focus
          // its search input via a custom DOM event. Decoupled from the
          // panel implementation so we don't have to lift the input ref.
          setActivePanel('models');
          // Tick after the panel renders so the input ref is mounted.
          setTimeout(() => window.dispatchEvent(new Event('models-focus-search')), 0);
          break;
        case 'terminal.new-profile':
          // Open the terminal panel and ask TerminalTabs to open its
          // profile picker via a custom DOM event.  Same decoupling
          // pattern as models.focus-search above.
          setActivePanel('terminal');
          setTimeout(() => window.dispatchEvent(new Event('terminal-open-profile-picker')), 0);
          break;
        default:
          // unknown action id — ignore
          break;
      }
    },
    [activePaneId]
  );

  // Load hotkey bindings on mount, and refresh when settings UI announces
  // a change via a window event.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await window.electronAPI.hotkeys.get();
        if (alive) setBindings(s.bindings);
      } catch {
        // Defaults will be used (empty list = no hotkeys).
      }
    };
    void load();
    const onChanged = () => void load();
    window.addEventListener('hotkeys-changed', onChanged);
    return () => {
      alive = false;
      window.removeEventListener('hotkeys-changed', onChanged);
    };
  }, []);

  // Subscribe to tray-triggered actions (main → renderer).
  useEffect(() => {
    const unsub = window.electronAPI.tray.onInvokeAction((action) => {
      dispatchAction(action as HotkeyAction);
    });
    return unsub;
  }, [dispatchAction]);

  // Global hotkey dispatcher. Runs at window level so xterm's keystrokes
  // also flow through here; we preventDefault on a match.
  //
  // Cold-start fallback (integration-review M1): until the async
  // hotkeys.get() resolves, `bindings` is `[]` and the chord map is
  // empty — meaning the palette can't be opened by keyboard during the
  // first ~50ms. We hardcode Ctrl/Cmd+Shift+P as a non-rebindable
  // fallback that's always live, so the user is never locked out of
  // the palette regardless of bindings state.
  useEffect(() => {
    const chordMap = buildChordMap(bindings);
    const handler = (e: KeyboardEvent) => {
      // Hardcoded fallback: Ctrl/Cmd+Shift+P always opens the palette.
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        e.stopPropagation();
        dispatchAction('palette.open');
        return;
      }
      if (chordMap.size === 0) return;
      const chord = chordFromEvent(e);
      if (!chord) return;
      const action = chordMap.get(chord);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      dispatchAction(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bindings, dispatchAction]);

  // PTY interceptor key-prompt subscription. When a spawned CLI prints an
  // "Enter your API key" prompt that the main-side regex map recognized,
  // we surface ApiKeyModal app-wide (it can come from any pane, not just
  // when the user is on ModelsPanel). Dismiss closes without nagging.
  const [interceptedPrompt, setInterceptedPrompt] =
    useState<ProviderKeyPromptEvent | null>(null);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    try {
      unsub = window.electronAPI.providerAuth.onKeyPrompt((evt) => {
        // Only show one modal at a time. If another prompt fires while one
        // is already open, ignore — the user can dismiss the first.
        setInterceptedPrompt((curr) => curr ?? evt);
      });
    } catch {
      // Provider-auth IPC missing — skip silently.
    }
    return () => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const onInterceptorKeySubmit = useCallback(
    async (key: string) => {
      if (!interceptedPrompt || !interceptedPrompt.paneId) return;
      await window.electronAPI.providerAuth.submitKey(
        interceptedPrompt.paneId,
        interceptedPrompt.provider,
        key
      );
      setInterceptedPrompt(null);
    },
    [interceptedPrompt]
  );

  // Status-bar PID = the active tab's PID (multi-PTY aggregation happens in
  // main / ResourceMonitor; here we just show what's relevant to the user).
  const focusedPid = activePaneId ? (pidByPane[activePaneId] ?? 0) : 0;
  const showRightPanel = activePanel !== 'terminal';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: 'var(--bg-primary)',
    }}>
      <TitleBar />

      <div style={{
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
      }}>
        <Sidebar activePanel={activePanel} onPanelChange={setActivePanel} />

        <div style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
            <TerminalTabs
              tabs={tabs}
              activeTabId={activeTabId}
              onTabsChange={setTabs}
              onActiveChange={setActiveTabId}
              onPidChange={handlePidChange}
              registerSender={registerSender}
              catalog={catalog}
            />
          </div>

          {showRightPanel && (
            // Outer wrapper animates its WIDTH (0→320) and clips; this is what
            // makes the terminal smoothly resize into the opening space. The
            // inner panel stays a fixed 320 so its content doesn't reflow while
            // the width grows — it's just revealed, then faded in.
            <div style={{
              flexShrink: 0,
              overflow: 'hidden',
              animation: 'panelEnter 320ms ease both',
            }}>
              <div style={{
                width: 320,
                height: '100%',
                boxSizing: 'border-box',
                borderLeft: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                padding: 16,
                overflowY: 'auto',
              }}>
                <RightPanel
                  panel={activePanel}
                  onSendCommand={handleSendCommand}
                  commandFamily={activeCommandFamily}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <StatusBar pid={focusedPid} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSwitchPanel={setActivePanel}
        onSendToTerminal={sendToActive}
        onRestartTerminal={handleRestartTerminal}
        onNewClaudeTab={handleNewClaudeTab}
        onCloseTab={handleCloseActiveTab}
        onFocusNextTab={() => handleFocusTab(1)}
        onFocusPrevTab={() => handleFocusTab(-1)}
        onResetTabs={handleResetTabs}
      />

      {cliOnboardingOpen && (
        <CliAuthOnboarding
          onClose={() => setCliOnboardingOpen(false)}
          sendToActivePane={(text) => {
            // "Sign in to Claude" types `/login` (Claude's in-session
            // slash command) into the active pane. PRE-TerminalTabs,
            // the active pane was always a Claude PTY; PR #27 (M-3
            // TerminalTabs fix) handles the multi-tab case explicitly:
            // if the user has switched focus to an Ollama / Aider /
            // Gemini tab, find a Claude tab first and switch to it,
            // then send. If no Claude tab exists at all, fall back to
            // sending into whatever's active — the worst case is a
            // visible error in the model tab the user can recover from.
            //
            // submit=true appends CR so Claude executes the slash command
            // immediately. Without CR the text appears typed but inert.
            const claudeTab = tabs.find((t) => t.profile === 'claude');
            if (claudeTab && claudeTab.id !== activeTabId) {
              setActiveTabId(claudeTab.id);
              setActivePanel('terminal');
              // Defer the send by one tick so the new active tab's
              // sender has time to register in App.sendersRef.
              setTimeout(() => sendToActive(text, true), 100);
            } else {
              setActivePanel('terminal');
              sendToActive(text, true);
            }
          }}
        />
      )}

      {interceptedPrompt && (
        <ApiKeyModal
          provider={interceptedPrompt.provider}
          source="pty-interceptor"
          onSubmit={onInterceptorKeySubmit}
          onDismiss={() => setInterceptedPrompt(null)}
        />
      )}
    </div>
  );
}

function RightPanel({
  panel,
  onSendCommand,
  commandFamily,
}: {
  panel: SidebarPanel;
  onSendCommand: (command: string, submit?: boolean) => void;
  commandFamily: CommandFamily;
}) {
  switch (panel) {
    case 'resources':
      return <ResourcePanel />;
    case 'compact':
      return <CompactPanel activeFamily={commandFamily} />;
    case 'cost':
      return <CostPanel />;
    case 'commands':
      return <CommandsPanel onSendCommand={onSendCommand} family={commandFamily} />;
    case 'settings':
      return <SettingsPanel />;
    case 'github':
      return <GitHubPanel />;
    case 'lmm':
      return <LMMPanel activeFamily={commandFamily} />;
    case 'auth':
      return <AuthPanel />;
    case 'sync':
      return <SyncPanel />;
    case 'models':
      return <ModelsPanel />;
    case 'files':
      return <FileTreePanel />;
    default:
      return <PlaceholderPanel panel={panel} />;
  }
}

function PlaceholderPanel({ panel }: { panel: string }) {
  const info: Record<string, { title: string; desc: string; phase: string }> = {
  };

  const p = info[panel] || { title: panel, desc: '', phase: '' };

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
        {p.title}
      </h3>

      <div style={{
        padding: '24px 16px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        textAlign: 'center',
      }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--accent-gradient-soft)',
          border: '1px solid var(--border-active)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 12px',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <div style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 8,
        }}>
          {p.desc}
        </div>
        <span style={{
          fontSize: 10,
          padding: '3px 10px',
          borderRadius: 'var(--radius-xl)',
          background: 'var(--accent-dim)',
          color: 'var(--accent-light)',
          fontWeight: 500,
        }}>
          Coming in {p.phase}
        </span>
      </div>
    </div>
  );
}
