import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  /** Stable identifier for this pane — keys the backend PTY. */
  paneId: string;
  /** Optional cwd to launch the PTY in (only used on first spawn). */
  cwd?: string | null;
  /** True when this is the currently focused pane (multi-pane mode). */
  active?: boolean;
  onPidChange?: (paneId: string, pid: number) => void;
  /** Registers a `sendText` function so external callers (palette, snippets)
   *  can inject text into *this* pane. */
  registerSender?: (paneId: string, send: ((data: string) => void) | null) => void;
  /** Fired when the user clicks anywhere in the terminal — used by the parent
   *  layout to set focus to this pane. */
  onFocus?: (paneId: string) => void;
}

export function TerminalPanel({
  paneId,
  cwd,
  active,
  onPidChange,
  registerSender,
  onFocus,
}: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);

  // Fit the terminal to its container, but ONLY when the proposed cell grid
  // actually differs from the live one. Calling fit()+resize() unconditionally
  // is what drives the resize-loop flicker (BACKLOG #3): fit() mutates the DOM
  // (canvas/viewport sizing, scrollbar), the ResizeObserver sees that mutation
  // and fires handleResize again, which fits again… forever. Comparing the
  // *proposed* dims (what fit() WOULD do) against the current ones lets us
  // no-op once converged — which also stops the IPC echo to the backend PTY.
  const fitIfChanged = useCallback(() => {
    const fit = fitRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    let dims: ReturnType<FitAddon['proposeDimensions']>;
    try {
      dims = fit.proposeDimensions();
    } catch {
      return; // terminal not attached / disposed
    }
    if (
      !dims ||
      !Number.isFinite(dims.cols) ||
      !Number.isFinite(dims.rows) ||
      dims.cols < 1 ||
      dims.rows < 1
    ) {
      return;
    }
    // Already the right size → skip the fit() (no DOM mutation) AND the IPC
    // resize. This is the line that actually breaks the loop.
    if (dims.cols === term.cols && dims.rows === term.rows) return;
    fit.fit();
    window.electronAPI.terminal.resize(paneId, term.cols, term.rows);
  }, [paneId]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0f0f1a',
        foreground: '#ececf1',
        cursor: '#a78bfa',
        cursorAccent: '#0f0f1a',
        selectionBackground: 'rgba(124, 58, 237, 0.3)',
        selectionForeground: '#ffffff',
        black: '#0f0f1a',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#a78bfa',
        cyan: '#22d3ee',
        white: '#ececf1',
        brightBlack: '#565669',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#c4b5fd',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
      fontSize: 14,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      scrollback: 10000,
      allowTransparency: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    registerSender?.(paneId, (data: string) => {
      window.electronAPI.terminal.sendInput(paneId, data);
    });

    const onDataDispose = term.onData((data) => {
      window.electronAPI.terminal.sendInput(paneId, data);
    });

    const unsubData = window.electronAPI.terminal.onData(paneId, (data) => {
      term.write(data);
    });

    const unsubReady = window.electronAPI.terminal.onReady(paneId, (pid) => {
      onPidChange?.(paneId, pid);
      setExited(false);
    });

    const unsubExit = window.electronAPI.terminal.onExit(paneId, (code) => {
      term.writeln(`\r\n\x1b[33mClaude Code exited with code ${code}\x1b[0m`);
      term.writeln('\x1b[90mPress any key to restart…\x1b[0m');
      setExited(true);
      onPidChange?.(paneId, 0);
    });

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(fitIfChanged, 50);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);

    // One-time initial sync once the container has settled (post-spawn).
    // ALWAYS push the result to the backend PTY so it matches the xterm grid:
    // the on-open fit() above already set term.cols/rows, so the equality guard
    // in fitIfChanged() would skip this IPC and leave the PTY stuck at its
    // spawn-default size. This fires exactly once and is not part of the resize
    // feedback loop, so bypassing the guard here is safe.
    const initialFitTimer = setTimeout(() => {
      const t = termRef.current;
      const f = fitRef.current;
      if (!t || !f) return;
      try {
        f.fit();
        window.electronAPI.terminal.resize(paneId, t.cols, t.rows);
      } catch {
        // terminal may be disposed
      }
    }, 150);

    // Spawn the PTY *after* listeners are attached so we never miss the first
    // 'ready' / 'data' burst. The backend tolerates being asked to spawn a
    // paneId that's already alive (idempotent — old PTY is killed first).
    void window.electronAPI.terminal
      .spawn(paneId, cwd ?? null)
      .catch(() => {
        // Spawn errors are surfaced as no 'ready' event; user can hit Restart.
      });

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      clearTimeout(initialFitTimer);
      onDataDispose.dispose();
      unsubData();
      unsubReady();
      unsubExit();
      resizeObserver.disconnect();
      registerSender?.(paneId, null);
      term.dispose();
      // Intentionally do NOT kill the PTY here. Component unmount happens
      // both on split/reparent (we want to keep the PTY) and on close (we
      // want to kill it). The App owns the close-pane action and calls
      // `terminal.kill(paneId)` explicitly only in the close case — that
      // avoids the "split = lose PTY state" regression. If the renderer
      // window dies entirely, main's `killAll()` runs in BrowserWindow#close
      // so PTYs cannot leak across the app lifetime.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  // Auto-fit when this pane becomes the active one (split layouts may resize
  // hidden panes; xterm needs a manual fit after the size changes).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(fitIfChanged, 80);
    return () => clearTimeout(t);
  }, [active, paneId, fitIfChanged]);

  // Press-any-key restart after an exit message.
  useEffect(() => {
    if (!exited || !termRef.current) return;

    const handler = termRef.current.onData(() => {
      window.electronAPI.terminal.restart(paneId);
      setExited(false);
      termRef.current?.clear();
      handler.dispose();
    });

    return () => handler.dispose();
  }, [exited, paneId]);

  return (
    <div
      onMouseDown={() => onFocus?.(paneId)}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        // minWidth/minHeight: 0 override the flexbox default of `auto`, which
        // would otherwise size this item to its content's min-size. Without it,
        // when a 320px panel opens (or a split shrinks a pane) the parent flex
        // track resizes instantly but THIS box stays as wide as the old xterm
        // content and only catches up one column per fit() — the panel-open
        // resize-ratchet flicker. With it, the box shrinks to its allotted size
        // in the same layout pass, so xterm fits once and settles.
        minWidth: 0,
        minHeight: 0,
        outline: active ? '1px solid var(--accent)' : '1px solid transparent',
        outlineOffset: -1,
        transition: 'outline-color var(--transition-fast)',
      }}
    >
      <div
        ref={terminalRef}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          padding: '6px 2px 2px 6px',
          backgroundColor: 'var(--bg-primary)',
          overflow: 'hidden',
        }}
      />
    </div>
  );
}
