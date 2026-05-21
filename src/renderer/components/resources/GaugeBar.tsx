import React from 'react';

interface GaugeBarProps {
  label: string;
  systemPercent: number;
  claudePercent: number;
  detail?: string;
  unavailable?: boolean;
}

export function GaugeBar({
  label,
  systemPercent,
  claudePercent,
  detail,
  unavailable,
}: GaugeBarProps) {
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--bg-primary)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)',
      marginBottom: 8,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 8,
      }}>
        <span style={{
          color: 'var(--text-primary)',
          fontWeight: 600,
          fontSize: 12,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 18,
          fontWeight: 700,
          color: unavailable ? 'var(--text-muted)' : 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {unavailable ? 'N/A' : `${Math.round(systemPercent)}%`}
        </span>
      </div>

      <div style={{
        height: 6,
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 3,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {!unavailable && (
          <>
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${Math.min(systemPercent, 100)}%`,
              background: 'var(--gauge-grey)',
              borderRadius: 3,
              transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            }} />
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${Math.min(claudePercent, 100)}%`,
              background: 'var(--accent-gradient)',
              borderRadius: 3,
              transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: claudePercent > 0 ? '0 0 8px rgba(124,58,237,0.3)' : 'none',
            }} />
          </>
        )}
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 6,
        fontSize: 10,
        color: 'var(--text-muted)',
      }}>
        {!unavailable ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 6, height: 6, borderRadius: 2,
                background: 'var(--accent)',
              }} />
              Claude {Math.round(claudePercent)}%
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 6, height: 6, borderRadius: 2,
                background: 'var(--gauge-grey)',
              }} />
              System {Math.round(systemPercent)}%
            </div>
          </>
        ) : (
          <span>GPU monitoring unavailable</span>
        )}
      </div>

      {detail && (
        <div style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          marginTop: 4,
        }}>
          {detail}
        </div>
      )}
    </div>
  );
}
