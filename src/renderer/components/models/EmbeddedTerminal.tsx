import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ChatSkinOverlay } from '../chat-skin/ChatSkinOverlay';
import { isSkinEnabled, setSkinEnabled } from '../chat-skin/skin-prefs';

/**
 * Inline xterm.js viewer for a model PTY launched from the Models panel.
 *
 * Unlike TerminalPanel, this one:
 *   - Does NOT spawn the PTY — it just attaches to an existing paneId
 *     created by MODELS_LAUNCH (which already called PtyRegistry.spawn
 *     with the model's command).
 *   - Disposes the xterm on unmount but does NOT kill the PTY. Kill is
 *     a separate explicit action in the Running list.
 *   - Subscribes to TERMINAL_DATA/EXIT for the given paneId, forwards
 *     input to TERMINAL_INPUT, and reports resizes via TERMINAL_RESIZE.
 *
 * Sized to fit its container; ResizeObserver triggers fit() when the
 * Models panel re-flows.
 */

interface Props {
  paneId: string;
  /** Compact mode reduces font size + padding (default true for in-panel). */
  compact?: boolean;
  /** When provided, the embed registers a `sendInput`-backed sender under
   *  the given paneId so the palette / snippets / Commands tab can route
   *  text into this model's PTY just like they do for Claude tabs. */
  registerSender?: (
    paneId: string,
    send: ((data: string) => void) | null
  ) => void;
  /** Fired once the embed confirms the PTY is alive (via models:list-running).
   *  Same signature as TerminalPanel's onPidChange so the StatusBar PID
   *  footer works for model tabs the same way it does for Claude tabs. */
  onPidChange?: (paneId: string, pid: number) => void;
  /** True when this is the currently-visible tab. Used to scope the
   *  focus-active-terminal window event (PR #27 M-1 polish fix) so
   *  only the visible pane claims focus when a starter command fires. */
  active?: boolean;
  /** Catalog profile id of the tab. Threaded through to ChatSkinOverlay
   *  so it can pick the JSON-stream renderer for chat-mode profiles. */
  profile?: string;
}

export function EmbeddedTerminal({
  paneId,
  compact = true,
  registerSender,
  onPidChange,
  active,
  profile,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Per-pane chat-skin toggle, persisted via skin-prefs (localStorage).
  // Synced with TerminalPanel so the SAME paneId surfaces the SAME skin
  // state whether viewed via TerminalPanel, EmbeddedTerminal, or PopoutView.
  const [skinOn, setSkinOn] = useState<boolean>(() => isSkinEnabled(paneId));
  const toggleSkin = useCallback(() => {
    setSkinOn((prev) => {
      const next = !prev;
      setSkinEnabled(paneId, next);
      return next;
    });
  }, [paneId]);
  const fitRef = useRef<FitAddon | null>(null);

  const fitIfChanged = useCallback(() => {
    const fit = fitRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    let dims: ReturnType<FitAddon['proposeDimensions']>;
    try {
      dims = fit.proposeDimensions();
    } catch {
      return;
    }
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
    if (dims.cols < 1 || dims.rows < 1) return;
    if (dims.cols === term.cols && dims.rows === term.rows) return;
    fit.fit();
    window.electronAPI.terminal.resize(paneId, term.cols, term.rows);
  }, [paneId]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;

    const term = new Terminal({
      theme: {
        background: '#0a0a14',
        foreground: '#ececf1',
        cursor: '#a78bfa',
        cursorAccent: '#0a0a14',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
      fontSize: compact ? 12 : 14,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // Initial fit + write banner so the embed isn't blank if the PTY is
    // slow to produce output.
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* host not measured yet — first resize observer fires shortly */
      }
    });

    const offData = window.electronAPI.terminal.onData(paneId, (data: string) => {
      term.write(data);
    });
    const offExit = window.electronAPI.terminal.onExit(paneId, (code: number) => {
      term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`);
    });

    // Probe whether the PTY actually exists, with a soft retry before
    // we declare it dead.  Item 7 of docs/PLAN_2026-05-28_10-items.md:
    // the previous 1.5s probe would print a scary "paneId not found"
    // message in a popout that just hadn't received its first
    // listRunning() reply yet.  Now: probe at 1.5s, retry at 4s if the
    // first probe came back empty, only print the cold message after
    // the second negative probe.
    const probeAttempt = async (): Promise<{ alive: boolean; pid: number }> => {
      try {
        const live = await window.electronAPI.models.listRunning();
        const myPane = live.find((p) => p.paneId === paneId);
        return { alive: !!myPane, pid: myPane?.pid ?? 0 };
      } catch {
        // listRunning unavailable — treat as inconclusive (alive=false)
        // and let the retry decide; if the IPC stays broken, the cold
        // message still prints at the end.
        return { alive: false, pid: 0 };
      }
    };
    const probeTimers: ReturnType<typeof setTimeout>[] = [];
    let cancelledProbe = false;
    probeTimers.push(setTimeout(() => {
      void (async () => {
        if (cancelledProbe) return;
        const first = await probeAttempt();
        if (cancelledProbe) return;
        if (first.alive) {
          if (first.pid > 0) onPidChange?.(paneId, first.pid);
          return;
        }
        // First probe came back empty — could be transient (popout
        // mounted before main settled, listRunning lagged, etc.).
        term.write(`\x1b[2m[re-attaching to ${paneId}…]\x1b[0m\r\n`);
        probeTimers.push(setTimeout(() => {
          void (async () => {
            if (cancelledProbe) return;
            const second = await probeAttempt();
            if (cancelledProbe) return;
            if (second.alive) {
              term.write(`\x1b[2m[ok, attached]\x1b[0m\r\n`);
              if (second.pid > 0) onPidChange?.(paneId, second.pid);
              return;
            }
            term.write(`\x1b[33m[paneId ${paneId} not found — the model may have exited.]\x1b[0m\r\n`);
            term.write(`\x1b[2mClose this view and Launch again from the Models panel.\x1b[0m\r\n`);
          })();
        }, 2500));
      })();
    }, 1500));

    const offUserInput = term.onData((data) => {
      window.electronAPI.terminal.sendInput(paneId, data);
    });

    // Register a sender so external callers (palette, snippets, the
    // Commands sidebar) can write to this model's PTY just like Claude
    // tabs. Without this, sendToActive in App.tsx silently no-ops when a
    // model tab is focused — fixes H-1 from the TerminalTabs red-team.
    registerSender?.(paneId, (data: string) => {
      window.electronAPI.terminal.sendInput(paneId, data);
    });

    const ro = new ResizeObserver(() => fitIfChanged());
    ro.observe(host);

    return () => {
      cancelledProbe = true;
      for (const t of probeTimers) clearTimeout(t);
      ro.disconnect();
      offData();
      offExit();
      offUserInput.dispose();
      registerSender?.(paneId, null);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [paneId, compact, fitIfChanged, registerSender, onPidChange]);

  // Sync chat-skin toggle across windows for the same paneId.  Main and
  // popout both keep their own React state; when one toggles, the other
  // sees the localStorage 'storage' event and updates.  Fires only on
  // OTHER windows than the writer (browser semantics), so the local
  // toggleSkin keeps its existing optimistic state update.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== `chat-skin:${paneId}`) return;
      const next = e.newValue === '1';
      setSkinOn(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [paneId]);

  // Mirror TerminalPanel's auto-focus-on-starter-command behavior so
  // model tabs (Ollama's `/set system `, etc.) get keyboard focus
  // when the user clicks a Quick Action with submit:false. Only the
  // active tab claims focus. PR #27, M-1 polish fix.
  useEffect(() => {
    if (!active) return;
    const onFocusReq = () => {
      try {
        termRef.current?.focus();
      } catch {
        // term may not be mounted yet — first frame is the worst case.
      }
    };
    window.addEventListener('ccs-focus-active-terminal', onFocusReq);
    return () => window.removeEventListener('ccs-focus-active-terminal', onFocusReq);
  }, [active]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 180,
      }}
    >
      <div
        ref={hostRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0a14',
          borderRadius: 6,
          padding: 6,
          boxSizing: 'border-box',
          overflow: 'hidden',
          visibility: skinOn ? 'hidden' : 'visible',
        }}
      />

      {!skinOn && (
        <button
          onClick={toggleSkin}
          title="Switch to chat skin"
          aria-label="Switch to chat skin"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 4,
            padding: '4px 10px',
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px solid var(--border, rgba(255,255,255,0.1))',
            background: 'rgba(15,15,26,0.7)',
            color: 'var(--text-secondary, #8b8b9e)',
            backdropFilter: 'blur(4px)',
            cursor: 'pointer',
            fontSize: 11,
            opacity: 0.6,
            transition: 'opacity 120ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
        >
          ✦ Chat
        </button>
      )}

      <ChatSkinOverlay
        paneId={paneId}
        visible={skinOn}
        onToggleOff={toggleSkin}
        profile={profile}
      />
    </div>
  );
}
