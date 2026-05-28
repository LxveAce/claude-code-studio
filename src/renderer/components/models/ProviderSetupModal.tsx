import React from 'react';
import type { ProviderCliDetectResult } from '../../../shared/types';

interface Props {
  /** Display name of the model the user tried to launch. */
  modelName: string;
  /** Detection result showing what's missing + how to install. */
  detect: ProviderCliDetectResult;
  /** Re-run the probe (after the user installs the CLI). */
  onRetry: () => void | Promise<void>;
  onDismiss: () => void;
}

export function ProviderSetupModal({ modelName, detect, onRetry, onDismiss }: Props) {
  const openInstallPage = () => {
    if (!detect.installUrl) return;
    void window.electronAPI.models.openExternal(detect.installUrl).catch(() => undefined);
  };

  const copyHint = () => {
    void navigator.clipboard.writeText(detect.installHint).catch(() => undefined);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 540,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 6,
          }}
        >
          Provider not installed
        </div>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>
          Install <code style={{ fontFamily: 'monospace' }}>{detect.cli}</code> to launch {modelName}
        </h3>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            margin: '0 0 12px',
          }}
        >
          Catalyst UI doesn't bundle <code style={{ fontFamily: 'monospace' }}>{detect.cli}</code>.
          Install it from your terminal, then click "I installed it — retry" below.
        </p>

        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
            margin: '0 0 12px',
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ whiteSpace: 'pre', overflowX: 'auto', flex: 1 }}>
            $ {detect.installHint}
          </span>
          <button
            onClick={copyHint}
            title="Copy install command"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-md)',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            Copy
          </button>
        </div>

        {detect.installUrl && (
          <p
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              margin: '0 0 12px',
            }}
          >
            <a
              href={detect.installUrl}
              onClick={(e) => {
                e.preventDefault();
                openInstallPage();
              }}
              style={{ color: 'var(--accent-light)' }}
            >
              Open install instructions →
            </a>
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={onDismiss}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Dismiss
          </button>
          <button
            onClick={() => void onRetry()}
            style={{
              flex: 2,
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: 'white',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            I installed it — retry
          </button>
        </div>
      </div>
    </div>
  );
}
