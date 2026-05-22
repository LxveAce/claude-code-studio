import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CostDayTotal,
  CostModel,
  CostRateTable,
  CostStatus,
  SessionTotal,
} from '../../../shared/types';

const REFRESH_INTERVAL_MS = 5_000; // panel refresh (cheap IPC call)

export function CostPanel() {
  const [status, setStatus] = useState<CostStatus | null>(null);
  const [sessions, setSessions] = useState<SessionTotal[] | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>('');
  const [savingBudget, setSavingBudget] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, sess] = await Promise.all([
        window.electronAPI.cost.status(),
        window.electronAPI.cost.listSessions(),
      ]);
      setStatus(s);
      setSessions(sess);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to load cost status');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Sync the local input from server-state whenever the panel reloads.
  useEffect(() => {
    if (status && !savingBudget) {
      setBudgetInput(String(status.settings.dailyBudgetUSD || ''));
    }
  }, [status, savingBudget]);

  const handleSaveBudget = useCallback(async () => {
    if (!status) return;
    const trimmed = budgetInput.trim();
    const value = trimmed === '' ? 0 : Number(trimmed);
    if (!Number.isFinite(value) || value < 0 || value > 10_000) {
      setErrMsg('Budget must be a number between 0 and 10000.');
      return;
    }
    setSavingBudget(true);
    setErrMsg(null);
    try {
      await window.electronAPI.cost.setSettings({ dailyBudgetUSD: value });
      await refresh();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to save budget');
    } finally {
      setSavingBudget(false);
    }
  }, [budgetInput, refresh, status]);

  const handleModelChange = useCallback(
    async (model: CostModel) => {
      try {
        await window.electronAPI.cost.setSettings({ model });
        await refresh();
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : 'Failed to change model');
      }
    },
    [refresh]
  );

  const handleReset = useCallback(async () => {
    setResetting(true);
    setErrMsg(null);
    try {
      await window.electronAPI.cost.resetHistory();
      await refresh();
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Failed to reset history');
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  }, [refresh]);

  if (!status) {
    return (
      <div style={{ animation: 'fadeIn 0.3s ease', color: 'var(--text-muted)', fontSize: 11 }}>
        Loading cost data…
      </div>
    );
  }

  const { today, last30Days, rates, settings, budgetExceeded } = status;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 3,
            height: 14,
            borderRadius: 2,
            background: 'var(--accent-gradient)',
          }}
        />
        Token Cost (estimate)
      </h3>

      {/* Today summary card */}
      <div
        style={{
          padding: '12px 14px',
          background: budgetExceeded ? 'rgba(225, 60, 60, 0.10)' : 'var(--accent-gradient-soft)',
          borderRadius: 'var(--radius-md)',
          border: `1px solid ${budgetExceeded ? 'rgba(225, 60, 60, 0.45)' : 'var(--border-active)'}`,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Today (est.)</div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: budgetExceeded ? '#ff6b6b' : 'var(--accent-light)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatUSD(today.estCostUSD)}
          </div>
        </div>
        {settings.dailyBudgetUSD > 0 && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
            Budget: {formatUSD(settings.dailyBudgetUSD)}{' '}
            {budgetExceeded ? ' — exceeded' : ` (${formatPercent(today.estCostUSD, settings.dailyBudgetUSD)})`}
          </div>
        )}
      </div>

      {/* Token stats grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <StatCard label="Input Tokens" value={formatTokens(today.inputTokens)} />
        <StatCard label="Output Tokens" value={formatTokens(today.outputTokens)} />
        <StatCard label="Sessions" value={String(today.sessionCount)} />
        <StatCard label="Model" value={settings.model.toUpperCase()} />
      </div>

      {/* Sparkline */}
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: 6,
          }}
        >
          Last 30 days
        </div>
        <Sparkline days={last30Days} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            {last30Days[0]?.date ?? ''}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            30-day total: {formatUSD(last30Days.reduce((a, d) => a + d.estCostUSD, 0))}
          </span>
        </div>
      </div>

      {/* Conversations (Phase 7f) */}
      <ConversationsSection
        sessions={sessions}
        showAll={showAllSessions}
        onToggleShowAll={() => setShowAllSessions((v) => !v)}
      />

      {/* Budget input */}
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Daily budget (USD)
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="number"
            min={0}
            max={10000}
            step="0.5"
            inputMode="decimal"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            placeholder="0 = off"
            style={{
              flex: 1,
              padding: '6px 8px',
              fontSize: 12,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              outline: 'none',
              fontVariantNumeric: 'tabular-nums',
            }}
          />
          <button
            onClick={() => void handleSaveBudget()}
            disabled={savingBudget}
            style={{
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 600,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: savingBudget ? 'wait' : 'pointer',
            }}
          >
            {savingBudget ? '…' : 'Save'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
          Fires a desktop notification once per day when crossed.
        </div>
      </div>

      {/* Model selector */}
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Estimation model
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['opus', 'sonnet', 'haiku'] as CostModel[]).map((m) => (
            <button
              key={m}
              onClick={() => void handleModelChange(m)}
              style={{
                flex: 1,
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 600,
                background: m === settings.model ? 'var(--accent)' : 'var(--bg-secondary)',
                color: m === settings.model ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${m === settings.model ? 'var(--border-active)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {m}
            </button>
          ))}
        </div>
        <RateTable rates={rates} active={settings.model} />
      </div>

      {/* Reset history */}
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          marginBottom: 12,
        }}
      >
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: 11,
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Reset history…
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => void handleReset()}
              disabled={resetting}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: 'rgba(225, 60, 60, 0.15)',
                color: '#ff8585',
                border: '1px solid rgba(225, 60, 60, 0.45)',
                borderRadius: 'var(--radius-sm)',
                cursor: resetting ? 'wait' : 'pointer',
              }}
            >
              {resetting ? 'Resetting…' : 'Confirm reset'}
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              disabled={resetting}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: resetting ? 'wait' : 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--border)',
          fontSize: 10,
          color: 'var(--text-muted)',
          lineHeight: 1.4,
        }}
      >
        {status.disclaimer}
        {status.lastSampledAt && (
          <div style={{ marginTop: 4 }}>
            Last sampled: {new Date(status.lastSampledAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      {errMsg && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            background: 'rgba(225, 60, 60, 0.10)',
            border: '1px solid rgba(225, 60, 60, 0.45)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 11,
            color: '#ff8585',
          }}
        >
          {errMsg}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline: inline SVG, 30 daily totals → 30 points, normalized to panel y.
// ---------------------------------------------------------------------------
function Sparkline({ days }: { days: CostDayTotal[] }) {
  const points = useMemo(() => buildSparkPoints(days), [days]);
  const width = 280;
  const height = 48;
  if (points.length === 0) return <div style={{ height, fontSize: 10, color: 'var(--text-muted)' }}>no data</div>;
  const max = Math.max(...points, 0);
  const path = points
    .map((v, i) => {
      const x = (i / Math.max(1, points.length - 1)) * width;
      const y = max === 0 ? height - 1 : height - 1 - (v / max) * (height - 2);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  // Area-fill path (closes back to baseline)
  const fillPath = `${path} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={fillPath} fill="var(--accent-dim)" opacity="0.4" />
      <path d={path} fill="none" stroke="var(--accent-light)" strokeWidth="1.5" />
    </svg>
  );
}

function buildSparkPoints(days: CostDayTotal[]): number[] {
  if (!Array.isArray(days)) return [];
  return days.map((d) => (Number.isFinite(d.estCostUSD) && d.estCostUSD > 0 ? d.estCostUSD : 0));
}

function RateTable({ rates, active }: { rates: CostRateTable; active: CostModel }) {
  return (
    <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
      {(['opus', 'sonnet', 'haiku'] as CostModel[]).map((m) => (
        <div
          key={m}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '2px 0',
            color: m === active ? 'var(--text-secondary)' : undefined,
          }}
        >
          <span style={{ textTransform: 'uppercase', fontWeight: m === active ? 600 : 400 }}>{m}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            ${rates[m].inputPerMillion.toFixed(2)} / ${rates[m].outputPerMillion.toFixed(2)} per 1M
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--accent-light)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatUSD(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '$0.00';
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function formatPercent(value: number, budget: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(budget) || budget <= 0) return '';
  return `${Math.round((value / budget) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Conversations section (Phase 7f): per-session token + cost breakdown.
// Renders nothing if there's no history yet (first-launch / post-reset).
// ---------------------------------------------------------------------------
function ConversationsSection({
  sessions,
  showAll,
  onToggleShowAll,
}: {
  sessions: SessionTotal[] | null;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  if (!sessions) return null;
  const COLLAPSED_COUNT = 5;
  const visible = showAll ? sessions : sessions.slice(0, COLLAPSED_COUNT);
  const totalCost = sessions.reduce((a, s) => a + s.estCostUSD, 0);

  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Conversations ({sessions.length})
        </div>
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          total est. {formatUSD(totalCost)}
        </div>
      </div>

      {sessions.length === 0 ? (
        <div
          style={{
            padding: '12px 0',
            fontSize: 11,
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          No conversation history yet. Sessions appear here once
          compact-controller writes vault snapshots.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {visible.map((s) => (
              <ConversationRow key={s.sessionId} session={s} />
            ))}
          </div>
          {sessions.length > COLLAPSED_COUNT && (
            <button
              onClick={onToggleShowAll}
              style={{
                marginTop: 8,
                width: '100%',
                padding: '5px 10px',
                fontSize: 10,
                background: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              {showAll
                ? `Show top ${COLLAPSED_COUNT}`
                : `Show all ${sessions.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ConversationRow({ session }: { session: SessionTotal }) {
  // session_id is a UUID-shaped string; show the first 8 chars + ellipsis
  // for the row, with the full id available on hover (title attr).
  const shortId =
    session.sessionId.length > 12
      ? session.sessionId.slice(0, 8) + '…'
      : session.sessionId;
  return (
    <div
      title={session.sessionId}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: 8,
        alignItems: 'center',
        padding: '5px 8px',
        background: session.isCurrent
          ? 'var(--accent-gradient-soft)'
          : 'var(--bg-secondary)',
        border: `1px solid ${session.isCurrent ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <div
        style={{
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {session.isCurrent && (
          <span
            title="Active conversation (live in state.json)"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--accent)',
              flexShrink: 0,
            }}
          />
        )}
        <code
          style={{
            fontSize: 10,
            color: session.isCurrent ? 'var(--accent-light)' : 'var(--text-secondary)',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {shortId}
        </code>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {session.lastActivityDate}
        </span>
      </div>
      <div
        title={`in ${session.inputTokens.toLocaleString()} · out ${session.outputTokens.toLocaleString()}`}
        style={{ fontSize: 10, color: 'var(--text-muted)' }}
      >
        {formatTokens(session.inputTokens + session.outputTokens)} tok
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: session.isCurrent ? 'var(--accent-light)' : 'var(--text-primary)',
        }}
      >
        {formatUSD(session.estCostUSD)}
      </div>
    </div>
  );
}
