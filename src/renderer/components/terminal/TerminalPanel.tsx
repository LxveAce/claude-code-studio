import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  onPidChange: (pid: number) => void;
}

export function TerminalPanel({ onPidChange }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#1a1a2e',
        foreground: '#e2e8f0',
        cursor: '#a78bfa',
        cursorAccent: '#1a1a2e',
        selectionBackground: 'rgba(124, 58, 237, 0.3)',
        black: '#1a1a2e',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a78bfa',
        cyan: '#06b6d4',
        white: '#e2e8f0',
        brightBlack: '#64748b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c4b5fd',
        brightCyan: '#22d3ee',
        brightWhite: '#f8fafc',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowTransparency: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

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

    const handleResize = () => {
      fit.fit();
      window.electronAPI.terminal.resize(term.cols, term.rows);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);

    setTimeout(() => {
      fit.fit();
      window.electronAPI.terminal.resize(term.cols, term.rows);
    }, 100);

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
        padding: 4,
        backgroundColor: 'var(--bg-primary)',
        overflow: 'hidden',
      }}
    />
  );
}
