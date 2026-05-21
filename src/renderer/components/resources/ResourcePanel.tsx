import React, { useEffect, useState } from 'react';
import { GaugeBar } from './GaugeBar';
import type { ResourceSnapshot } from '../../../shared/types';

export function ResourcePanel() {
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null);

  useEffect(() => {
    window.electronAPI.resources.onUpdate((data) => {
      setSnapshot(data as ResourceSnapshot);
    });
  }, []);

  if (!snapshot) {
    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        <SectionHeader title="Resource Monitor" />
        <div style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 12,
        }}>
          <div style={{
            width: 32, height: 32,
            borderRadius: '50%',
            border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)',
            animation: 'pulse 1.5s ease infinite',
            margin: '0 auto 12px',
          }} />
          Collecting system data...
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <SectionHeader title="Resource Monitor" />

      <GaugeBar
        label="CPU"
        systemPercent={snapshot.system.cpuPercent}
        claudePercent={snapshot.claude.cpuPercent}
      />
      <GaugeBar
        label="Memory"
        systemPercent={snapshot.system.ramPercent}
        claudePercent={snapshot.claude.ramPercent}
        detail={`${snapshot.system.ramUsedGB.toFixed(1)} / ${snapshot.system.ramTotalGB.toFixed(1)} GB`}
      />
      <GaugeBar
        label="GPU"
        systemPercent={snapshot.system.gpuPercent ?? 0}
        claudePercent={0}
        unavailable={snapshot.system.gpuPercent === null}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
        marginTop: 8,
      }}>
        <MiniStat
          label="Claude Processes"
          value={String(snapshot.claude.pidCount)}
        />
        <MiniStat
          label="Claude Memory"
          value={`${snapshot.claude.ramMB} MB`}
        />
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 style={{
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--text-primary)',
      marginBottom: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <div style={{
        width: 3,
        height: 14,
        borderRadius: 2,
        background: 'var(--accent-gradient)',
      }} />
      {title}
    </h3>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--bg-primary)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)',
    }}>
      <div style={{
        fontSize: 16,
        fontWeight: 700,
        color: 'var(--accent-light)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 10,
        color: 'var(--text-muted)',
        marginTop: 2,
      }}>
        {label}
      </div>
    </div>
  );
}
