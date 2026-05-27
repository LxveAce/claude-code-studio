import React, { useCallback, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

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
}

export function EmbeddedTerminal({ paneId, compact = true }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
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

    // 3.0.0-beta.3: probe whether the PTY actually exists. If the user
    // clicks Pop-out on a stale running-list entry (e.g. after panel
    // re-mount with a launched PTY that died while away), the embed will
    // be silent forever — write a placeholder so they know what happened.
    setTimeout(() => {
      void (async () => {
        try {
          const live = await window.electronAPI.models.listRunning();
          if (!live.some((p) => p.paneId === paneId)) {
            term.write(`\x1b[33m[paneId ${paneId} not found — the model may have exited.]\x1b[0m\r\n`);
            term.write(`\x1b[2mClose this view and Launch again from the Models panel.\x1b[0m\r\n`);
          }
        } catch {
          // listRunning unavailable — skip the warning; the PTY may still be live
        }
      })();
    }, 1500);

    const offUserInput = term.onData((data) => {
      window.electronAPI.terminal.sendInput(paneId, data);
    });

    const ro = new ResizeObserver(() => fitIfChanged());
    ro.observe(host);

    return () => {
      ro.disconnect();
      offData();
      offExit();
      offUserInput.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [paneId, compact, fitIfChanged]);

  return (
    <div
      ref={hostRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 180,
        background: '#0a0a14',
        borderRadius: 6,
        padding: 6,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    />
  );
}
