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
import {
  SplitLayout,
  splitPane,
  closePane,
  listPaneIds,
} from './components/terminal/SplitLayout';
import { buildChordMap, chordFromEvent } from './hotkeys';
import type {
  HotkeyAction,
  HotkeyBinding,
  SessionState,
  SplitNode,
} from '../shared/types';
import { THEME_PRESETS, applyTheme } from './theme-presets';

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
  | 'models';  // v3.0 multi-model scaffold

const DEFAULT_LAYOUT: SplitNode = {
  type: 'pane',
  id: 'p_root',
  cwd: null,
};

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
    return { paneId, label: sp.get('label') ?? 'Model' };
  })();
  if (popoutParams) {
    return <PopoutView paneId={popoutParams.paneId} label={popoutParams.label} />;
  }

  const [hydrated, setHydrated] = useState(false);
  const [activePanel, setActivePanel] = useState<SidebarPanel>('terminal');
  const [layout, setLayout] = useState<SplitNode>(DEFAULT_LAYOUT);
  const [activePaneId, setActivePaneId] = useState<string>('p_root');
  const [pidByPane, setPidByPane] = useState<Record<string, number>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bindings, setBindings] = useState<HotkeyBinding[]>([]);
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
          setLayout(restored.layout);
          setActivePanel(restored.activePanel as SidebarPanel);
          setActivePaneId(firstPaneId(restored.layout));
          if (restored.theme) {
            const preset = THEME_PRESETS.find((t) => t.name === restored.theme);
            if (preset) applyTheme(preset);
          }
        }
      } catch {
        // Bad session file — already handled in main; we just fall back.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- session save (debounced) ----------------------------------------------
  useEffect(() => {
    if (!hydrated) return;
    // Defer save to next animation frame so rapid drags coalesce. The main-side
    // service does atomic-tmp+rename anyway, but skipping intermediate writes
    // keeps the disk quiet during long resize gestures.
    const handle = window.setTimeout(() => {
      const state: SessionState = {
        version: 1,
        activePanel,
        theme: null,
        // theme is applied at the renderer; we don't persist the active preset
        // name yet because applyTheme doesn't return it. Future enhancement.
        layout,
      };
      void window.electronAPI.session.set(state).catch(() => {
        // Persistence failure is non-fatal — user can re-arrange on next start.
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [hydrated, layout, activePanel]);

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
    (command: string) => {
      sendToActive(command, true);
      setActivePanel('terminal');
    },
    [sendToActive]
  );

  const handleRestartTerminal = useCallback(() => {
    void window.electronAPI.terminal.restart(activePaneId);
  }, [activePaneId]);

  // --- split + close + focus actions ----------------------------------------
  /** Renderer-side mirror of PtyRegistry.MAX_PANES (16). Keep in sync. */
  const MAX_PANES_RENDERER = 16;

  const handleSplit = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      // Refuse before mutating the tree if we'd exceed the backend cap. The
      // backend would reject the spawn anyway, but failing here keeps the UI
      // and the PTY registry consistent (no dangling tree leaf with no PTY).
      if (listPaneIds(layout).length >= MAX_PANES_RENDERER) return;
      const result = splitPane(layout, activePaneId, direction);
      if (!result) return;
      setLayout(result.tree);
      setActivePaneId(result.newPaneId);
    },
    [layout, activePaneId]
  );

  const handleClosePane = useCallback(() => {
    const ids = listPaneIds(layout);
    if (ids.length <= 1) {
      // Closing the only pane is forbidden; require Reset Layout instead.
      return;
    }
    const result = closePane(layout, activePaneId);
    if (!result) return;
    // Explicitly kill the PTY for the pane we're closing — TerminalPanel
    // unmount does NOT auto-kill (so split/reparent doesn't lose state).
    void window.electronAPI.terminal.kill(activePaneId).catch(() => {});
    setLayout(result.tree);
    setActivePaneId(result.nextFocus);
  }, [layout, activePaneId]);

  const handleFocusNext = useCallback(
    (delta: 1 | -1) => {
      const ids = listPaneIds(layout);
      if (ids.length === 0) return;
      const idx = ids.indexOf(activePaneId);
      const safeIdx = idx === -1 ? 0 : idx;
      const next = (safeIdx + delta + ids.length) % ids.length;
      setActivePaneId(ids[next]);
    },
    [layout, activePaneId]
  );

  const handleResetLayout = useCallback(() => {
    void window.electronAPI.session.reset().then((s) => {
      // Kill panes that are removed by the reset (everything except the
      // surviving p_root, which the existing TerminalPanel may keep — or
      // re-mount and reattach via PtyRegistry.spawn's alive-reattach path).
      const oldIds = new Set(listPaneIds(layout));
      const newIds = new Set(listPaneIds(s.layout));
      for (const id of oldIds) {
        if (!newIds.has(id)) {
          void window.electronAPI.terminal.kill(id).catch(() => {});
        }
      }
      setLayout(s.layout);
      setActivePaneId(firstPaneId(s.layout));
      setActivePanel(s.activePanel as SidebarPanel);
    });
  }, [layout]);

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
          void window.electronAPI.terminal.restart(activePaneId);
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

  // Status-bar PID = the active pane's PID (multi-PTY aggregation happens in
  // main / ResourceMonitor; here we just show what's relevant to the user).
  const focusedPid = pidByPane[activePaneId] ?? 0;
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
            <SplitLayout
              root={layout}
              activePaneId={activePaneId}
              onLayoutChange={setLayout}
              onFocusPane={setActivePaneId}
              onPidChange={handlePidChange}
              registerSender={registerSender}
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
        onSplit={handleSplit}
        onClosePane={handleClosePane}
        onFocusNext={() => handleFocusNext(1)}
        onFocusPrev={() => handleFocusNext(-1)}
        onResetLayout={handleResetLayout}
      />

      {cliOnboardingOpen && (
        <CliAuthOnboarding
          onClose={() => setCliOnboardingOpen(false)}
          sendToActivePane={(text) => {
            // "Sign in to Claude" types `/login` (Claude's in-session
            // slash command) into the active pane. The embedded PTY
            // auto-spawns Claude, so the active pane is always a running
            // Claude session — `/login` triggers the browser OAuth flow
            // from inside that session. Typing `claude login` (the bare
            // shell command) here would be treated as chat text and
            // Claude would reply "I notice you typed claude login as a
            // message…" — exactly the bug caught in 3.0.0-beta.1.
            //
            // submit=true appends CR so Claude executes the slash command
            // immediately. Without CR the text appears typed but inert.
            setActivePanel('terminal');
            sendToActive(text, true);
          }}
        />
      )}
    </div>
  );
}

function firstPaneId(node: SplitNode): string {
  if (node.type === 'pane') return node.id;
  return firstPaneId(node.children[0]);
}

function RightPanel({
  panel,
  onSendCommand,
}: {
  panel: SidebarPanel;
  onSendCommand: (command: string) => void;
}) {
  switch (panel) {
    case 'resources':
      return <ResourcePanel />;
    case 'compact':
      return <CompactPanel />;
    case 'cost':
      return <CostPanel />;
    case 'commands':
      return <CommandsPanel onSendCommand={onSendCommand} />;
    case 'settings':
      return <SettingsPanel />;
    case 'github':
      return <GitHubPanel />;
    case 'lmm':
      return <LMMPanel />;
    case 'auth':
      return <AuthPanel />;
    case 'sync':
      return <SyncPanel />;
    case 'models':
      return <ModelsPanel />;
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
