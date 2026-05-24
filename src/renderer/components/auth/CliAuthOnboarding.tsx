import React, { useCallback, useEffect, useState } from 'react';
import type { CliStatus } from '../../../shared/types';

/**
 * First-launch CLI onboarding modal.
 *
 * Shown when the persisted onboarding-complete flag is false AND
 * `claude doctor` reports the CLI is missing or unauthenticated.
 *
 * Three possible paths based on cli.status():
 *   1. installed && authenticated → don't render (App.tsx pre-filter
 *      should have caught this; defensive close if we somehow ended up
 *      open).
 *   2. !installed → "Install Claude CLI" button (Phase 4 soft-fail
 *      recovery — re-runs the bundled npm install).
 *   3. installed && !authenticated → "Sign in to Claude" instructions
 *      pointing user to the embedded terminal to run `claude login`.
 *      We don't auto-spawn `claude login` ourselves because the OAuth
 *      flow involves a browser handoff that the user needs to drive
 *      anyway.
 *
 * Dismiss options:
 *   - "Maybe later" — closes the modal but does NOT mark onboarding
 *     complete, so it reshows next launch.
 *   - "Don't show again" — marks onboarding complete, modal will not
 *     reshow even if status changes.
 */
interface Props {
  onClose: () => void;
  /** Sends typed input to the currently active terminal pane. Used by
   *  the "Sign in" path to type `claude login` for the user. */
  sendToActivePane: (text: string) => void;
}

export function CliAuthOnboarding({ onClose, sendToActivePane }: Props) {
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [installResult, setInstallResult] = useState<{
    ok: boolean;
    error: string | null;
  } | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await window.electronAPI.cli.status();
      setStatus(next);
    } catch {
      setStatus({
        installed: false,
        authenticated: false,
        version: null,
        source: 'missing',
        lastError: 'Failed to query CLI status',
      });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Esc-to-dismiss (Phase 6 L1 — equivalent to "Maybe later", does not
  // persist the onboarding-complete flag).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleInstall = async () => {
    setBusy(true);
    setInstallResult(null);
    try {
      const result = await window.electronAPI.cli.install();
      setInstallResult({ ok: result.ok, error: result.error });
      if (result.ok) {
        // Re-poll status so the next render shows the auth step instead
        // of the install step.
        await refreshStatus();
      }
    } catch (e: unknown) {
      setInstallResult({
        ok: false,
        error: e instanceof Error ? e.message : 'Install failed',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleLoginInTerminal = () => {
    // Type `claude login` into the active pane and submit. User then
    // completes the OAuth flow in their browser. We don't dismiss the
    // modal here — the user may want to keep it open until login
    // completes, then click "Don't show again".
    sendToActivePane('claude login\r');
  };

  const handleDismiss = async (markComplete: boolean) => {
    if (markComplete) {
      try {
        await window.electronAPI.cli.markComplete();
      } catch {
        // Persistence failed; user just sees the modal again next launch.
        // That's an acceptable fallback.
      }
    }
    onClose();
  };

  // Defensive: caller shouldn't have rendered us if everything's fine,
  // but if it did, just self-close.
  if (status && status.installed && status.authenticated) {
    onClose();
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cli-onboarding-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel, #1a1a2e)',
          border: '1px solid var(--border, rgba(255,255,255,0.1))',
          borderRadius: 'var(--radius-lg, 12px)',
          padding: '32px',
          maxWidth: '520px',
          width: 'calc(100% - 48px)',
          maxHeight: 'calc(100vh - 48px)',
          overflow: 'auto',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
          color: 'var(--text-primary, #f4f4f8)',
        }}
      >
        <h2
          id="cli-onboarding-title"
          style={{
            margin: '0 0 8px',
            fontSize: '20px',
            fontWeight: 600,
          }}
        >
          Welcome to Claude Code Studio
        </h2>
        <p
          style={{
            margin: '0 0 24px',
            color: 'var(--text-secondary, #a0a0b0)',
            fontSize: '14px',
            lineHeight: 1.5,
          }}
        >
          Let's make sure the Claude Code CLI is set up so the embedded
          terminal can talk to Anthropic.
        </p>

        {status === null && (
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Checking CLI status…
          </p>
        )}

        {status && !status.installed && (
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 500 }}>
              Step 1 — Install the Claude CLI
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              We couldn't find <code>claude</code> on this machine. Studio
              can install it for you using the bundled Node runtime — no
              Node setup needed.
            </p>
            <button
              type="button"
              onClick={handleInstall}
              disabled={busy}
              style={{
                ...primaryButtonStyle,
                opacity: busy ? 0.6 : 1,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? 'Installing… (~30s)' : 'Install Claude CLI'}
            </button>
            {installResult && !installResult.ok && (
              <p
                style={{
                  marginTop: '12px',
                  padding: '8px 12px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: '#fca5a5',
                }}
              >
                {installResult.error}
                <br />
                <br />
                You can also install manually from a terminal:
                <br />
                <code style={{ fontSize: '12px' }}>
                  npm install -g @anthropic-ai/claude-code
                </code>
              </p>
            )}
            {installResult && installResult.ok && (
              <p
                style={{
                  marginTop: '12px',
                  padding: '8px 12px',
                  background: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: '#86efac',
                }}
              >
                Installed. Continue to sign-in below.
              </p>
            )}
          </div>
        )}

        {status && status.installed && !status.authenticated && (
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 500 }}>
              Step {status.installed && installResult?.ok ? '2' : '1'} — Sign in to Claude
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              Click below and Studio will type <code>claude login</code> into
              the terminal for you. The CLI will open your browser to complete
              sign-in.
            </p>
            <button
              type="button"
              onClick={handleLoginInTerminal}
              style={primaryButtonStyle}
            >
              Sign in to Claude
            </button>
            {status.version && (
              <p
                style={{
                  marginTop: '12px',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                }}
              >
                CLI version {status.version}, source: {status.source}
              </p>
            )}
          </div>
        )}

        <div
          style={{
            marginTop: '24px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border, rgba(255,255,255,0.1))',
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={() => void handleDismiss(false)}
            style={secondaryButtonStyle}
          >
            Maybe later
          </button>
          <button
            type="button"
            onClick={() => void handleDismiss(true)}
            style={secondaryButtonStyle}
          >
            Don't show again
          </button>
        </div>
      </div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--accent, #8b5cf6)',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  padding: '10px 20px',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-secondary, #a0a0b0)',
  border: '1px solid var(--border, rgba(255,255,255,0.15))',
  borderRadius: '8px',
  padding: '8px 16px',
  fontSize: '13px',
  fontWeight: 400,
  cursor: 'pointer',
};
