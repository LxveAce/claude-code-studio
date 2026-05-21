import React, { useEffect, useState, useCallback } from 'react';
import type { CompactStatus, CompactConfig } from '../../../shared/types';

export function CompactPanel() {
  const [status, setStatus] = useState<CompactStatus | null>(null);
  const [config, setConfig] = useState<CompactConfig | null>(null);
  const [toggling, setToggling] = useState(false);

  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([
      window.electronAPI.compact.getStatus(),
      window.electronAPI.compact.getConfig(),
    ]);
    setStatus(s);
    setConfig(c);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleToggle = async () => {
    if (!status) return;
    setToggling(true);
    if (status.enabled) {
      await window.electronAPI.compact.uninstall();
    } else {
      await window.electronAPI.compact.install();
    }
    await refresh();
    setToggling(false);
  };

  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3 style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 3, height: 14, borderRadius: 2,
          background: 'var(--accent-gradient)',
        }} />
        Compact Optimization
      </h3>

      {/* Toggle Card */}
      <div style={{
        padding: '14px 16px',
        background: status?.enabled
          ? 'var(--accent-gradient-soft)'
          : 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${status?.enabled ? 'var(--border-active)' : 'var(--border)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        transition: 'all var(--transition-base)',
      }}>
        <div>
          <div style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            {status?.enabled ? 'Active' : 'Inactive'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Auto-compact hooks
          </div>
        </div>
        <ToggleSwitch
          enabled={status?.enabled ?? false}
          onChange={handleToggle}
          disabled={toggling}
        />
      </div>

      {/* Stats Grid */}
      {status && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 12,
        }}>
          <StatCard label="Input Tokens" value={formatTokens(status.inputTokens)} />
          <StatCard label="Output Tokens" value={formatTokens(status.outputTokens)} />
          <StatCard label="Turns" value={String(status.turnCount)} />
          <StatCard label="Vaults Saved" value={String(status.vaultCount)} />
        </div>
      )}

      {/* Session Info */}
      {status?.sessionId && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
            Session ID
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}>
            {status.sessionId}
          </div>
        </div>
      )}

      {/* Config */}
      {config && (
        <div style={{
          padding: '12px 14px',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
        }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Configuration
          </div>
          <ConfigRow label="Max Vaults" value={String(config.vault_max_entries)} />
          <ConfigRow
            label="Transcript Tail"
            value={`${(config.vault_transcript_tail_bytes / 1024).toFixed(0)} KB`}
          />
          <ConfigRow label="Logging" value={config.log_enabled ? 'Enabled' : 'Disabled'} />
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        padding: 2,
        cursor: disabled ? 'wait' : 'pointer',
        background: enabled ? 'var(--accent)' : 'var(--gauge-grey)',
        transition: 'background var(--transition-base)',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: '#fff',
        transition: 'transform var(--transition-base)',
        transform: `translateX(${enabled ? 20 : 0}px)`,
        boxShadow: 'var(--shadow-sm)',
      }} />
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--bg-primary)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 20,
        fontWeight: 700,
        color: 'var(--accent-light)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.2,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 10,
        color: 'var(--text-muted)',
        marginTop: 4,
      }}>
        {label}
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '4px 0',
      fontSize: 12,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
