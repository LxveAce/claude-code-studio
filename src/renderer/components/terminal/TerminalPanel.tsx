import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  onPidChange: (pid: number) => void;
  sendRef?: React.MutableRefObject<((data: string) => void) | null>;
}

export function TerminalPanel({ onPidChange, sendRef }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);

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

    if (sendRef) {
      sendRef.current = (data: string) => {
        window.electronAPI.terminal.sendInput(data);
      };
    }

    term.onData((data) => {
      window.electronAPI.terminal.sendInput(data);
    });

    window.electronAPI.terminal.onData((data) => {
      term.write(data);
    });

    window.electronAPI.terminal.onReady((pid) => {
      onPidChange(pid);
      setExited(false);
    });

    window.electronAPI.terminal.onExit((code) => {
      term.writeln(`\r\n\x1b[33mClaude Code exited with code ${code}\x1b[0m`);
      term.writeln('\x1b[90mPress any key to restart...\x1b[0m');
      setExited(true);
      onPidChange(0);
    });

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        try {
          fit.fit();
          window.electronAPI.terminal.resize(term.cols, term.rows);
        } catch {
          // terminal may be disposed
        }
      }, 50);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);

    setTimeout(() => {
      fit.fit();
      window.electronAPI.terminal.resize(term.cols, term.rows);
    }, 150);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!exited || !termRef.current) return;

    const handler = termRef.current.onData(() => {
      window.electronAPI.terminal.restart();
      setExited(false);
      termRef.current?.clear();
      handler.dispose();
    });

    return () => handler.dispose();
  }, [exited]);

  return (
    <div
      ref={terminalRef}
      style={{
        flex: 1,
        padding: '6px 2px 2px 6px',
        backgroundColor: 'var(--bg-primary)',
        overflow: 'hidden',
      }}
    />
  );
}
