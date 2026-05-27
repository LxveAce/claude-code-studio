import React, { useEffect, useState } from 'react';

interface StatusBarProps {
  pid: number;
}

export function StatusBar({ pid }: StatusBarProps) {
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  // Phase 7 M4 — surface download-progress while electron-updater is pulling
  // bits. Cleared back to null on update-downloaded (the ready badge takes
  // over) or if the updater silently aborts.
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  // Current installed version — single source of truth via app:version IPC
  // (added 3.0.0-beta.2). Replaces the hardcoded "v2.0.0" baked into the
  // bottom-right label, which never tracked package.json bumps.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  // 3.0.0-beta.3 — surface current git branch + dirty state so the status
  // bar tells the user which branch their cwd is on (was previously
  // only visible by clicking into the GitHub panel). Polled lazily —
  // refresh every 30s OR on focus, whichever is sooner.
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitDirty, setGitDirty] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.app.version()
      .then((v) => { if (!cancelled) setAppVersion(v); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const state = await window.electronAPI.git.detect();
        if (cancelled) return;
        setGitBranch(state.found ? state.branch : null);
        setGitDirty(state.found ? state.dirty : false);
      } catch {
        // git not on PATH / cwd not a repo — leave fields null
      }
    };
    void refresh();
    const t = setInterval(refresh, 30_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Poll once at mount for already-pending updates (e.g. user re-opens
    // Settings/StatusBar after the update fired earlier this session).
    void (async () => {
      try {
        const state = await window.electronAPI.updater.getState();
        if (!cancelled) setPendingVersion(state.pendingVersion);
      } catch {
        // updater may not be ready yet — ignore
      }
    })();
    const unsubAvail = window.electronAPI.updater.onAvailable((version) => {
      if (!cancelled) {
        setPendingVersion(version || 'new');
        // Download finished, clear the progress badge.
        setDownloadPercent(null);
      }
    });
    const unsubProgress = window.electronAPI.updater.onDownloadProgress((p) => {
      if (!cancelled) setDownloadPercent(p);
    });
    return () => {
      cancelled = true;
      try { unsubAvail(); } catch { /* ignore */ }
      try { unsubProgress(); } catch { /* ignore */ }
    };
  }, []);

  return (
    <div style={{
      height: 28,
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      fontSize: 11,
      color: 'var(--text-muted)',
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: pid > 0 ? 'var(--success)' : 'var(--danger)',
            boxShadow: pid > 0 ? '0 0 6px rgba(34,197,94,0.4)' : '0 0 6px rgba(239,68,68,0.4)',
          }} />
          <span>{pid > 0 ? 'Connected' : 'Disconnected'}</span>
        </div>
        {pid > 0 && (
          <span style={{ color: 'var(--text-muted)' }}>
            PID {pid}
          </span>
        )}
        {gitBranch && (
          <span
            title={gitDirty ? 'Working tree has uncommitted changes' : 'Working tree clean'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              padding: '2px 7px',
              borderRadius: 10,
              background: 'rgba(139, 92, 246, 0.12)',
              border: '1px solid rgba(139, 92, 246, 0.25)',
              color: 'var(--text-secondary)',
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            }}
          >
            <span style={{ fontSize: 8, opacity: 0.7 }}></span>
            {gitBranch}
            {gitDirty && <span style={{ color: '#fbbf24' }}>●</span>}
          </span>
        )}
        {pendingVersion && (
          <span
            title={`Version ${pendingVersion} will install on next launch`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 8px',
              borderRadius: 10,
              background: 'var(--accent-dim)',
              color: 'var(--accent-light)',
              fontWeight: 500,
              fontSize: 10,
            }}
          >
            <span style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--accent-light)',
            }} />
            Update v{pendingVersion} ready
          </span>
        )}
        {!pendingVersion && downloadPercent !== null && (
          <span
            title="Downloading update in the background"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 8px',
              borderRadius: 10,
              background: 'var(--accent-dim)',
              color: 'var(--accent-light)',
              fontWeight: 500,
              fontSize: 10,
            }}
          >
            <span style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--accent-light)',
              animation: 'pulse 1.6s ease-in-out infinite',
            }} />
            Downloading update… {downloadPercent}%
          </span>
        )}
      </div>
      <span>Claude Code Studio{appVersion ? ` v${appVersion}` : ''}</span>
    </div>
  );
}
