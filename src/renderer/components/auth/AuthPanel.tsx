import React, { useCallback, useEffect, useState } from 'react';
import type {
  AuthBackend,
  AuthBackendMode,
  AuthState,
} from '../../../shared/types';

type Mode = 'idle' | 'register' | 'login';

export function AuthPanel() {
  const [state, setState] = useState<AuthState | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [allowPlaintext, setAllowPlaintext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showBackend, setShowBackend] = useState(false);
  const [backendDraft, setBackendDraft] = useState<AuthBackend>({
    mode: 'local-stub',
    baseUrl: null,
  });

  const refresh = useCallback(async () => {
    const next = await window.electronAPI.auth.state();
    setState(next);
    setBackendDraft(next.backend);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'idle') return;
    if (state && !state.encryptionAvailable && !allowPlaintext) {
      setErr(
        'OS keychain is unavailable. Tick the "store token in plaintext" box to acknowledge the risk and try again.'
      );
      return;
    }
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      const creds = { email, password, allowPlaintextToken: allowPlaintext };
      const next =
        mode === 'register'
          ? await window.electronAPI.auth.register(creds)
          : await window.electronAPI.auth.login(creds);
      setState(next);
      setEmail('');
      setPassword('');
      setAllowPlaintext(false);
      setMode('idle');
      setInfo(mode === 'register' ? 'Account created and signed in.' : 'Signed in.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Authentication failed';
      // Soften the generic register collision message for the user.
      if (mode === 'register' && msg === 'Could not create account') {
        setErr('Could not create account. If you already registered, try signing in.');
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setErr(null);
    try {
      const next = await window.electronAPI.auth.logout();
      setState(next);
      setInfo('Signed out.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sign out failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePullSettings = async () => {
    setBusy(true);
    setErr(null);
    try {
      const synced = await window.electronAPI.auth.pullSettings();
      if (!synced) {
        setInfo('No settings synced for this account yet.');
        return;
      }
      if (synced.theme) {
        localStorage.setItem('claude-studio-theme', synced.theme);
      }
      setInfo(
        `Pulled settings (theme: ${synced.theme ?? 'none'}, LMM: ${
          synced.lmm ? `${synced.lmm.variant} ${synced.lmm.enabled ? 'on' : 'off'}` : 'none'
        }). Reload to fully apply.`
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Pull failed');
    } finally {
      setBusy(false);
    }
  };

  const handlePushSettings = async () => {
    setBusy(true);
    setErr(null);
    try {
      const lmm = await window.electronAPI.lmm.getSettings();
      await window.electronAPI.auth.pushSettings({
        theme: localStorage.getItem('claude-studio-theme'),
        lmm: { enabled: lmm.enabled, variant: lmm.variant },
        updatedAt: new Date().toISOString(),
      });
      setInfo('Pushed local settings to this account.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBackend = async () => {
    setBusy(true);
    setErr(null);
    try {
      const next = await window.electronAPI.auth.setBackend(backendDraft);
      setBackendDraft(next);
      await refresh();
      setInfo(`Backend set to ${next.mode}. Any existing session was cleared.`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to set backend');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3 style={headerStyle}>
        <div style={accentBar} />
        Account
      </h3>

      {state?.signedIn ? (
        <SignedInView state={state} busy={busy} onLogout={handleLogout} onPull={handlePullSettings} onPush={handlePushSettings} />
      ) : (
        <SignedOutView
          mode={mode}
          email={email}
          password={password}
          allowPlaintext={allowPlaintext}
          busy={busy}
          backend={state?.backend ?? { mode: 'local-stub', baseUrl: null }}
          encryptionAvailable={state?.encryptionAvailable ?? false}
          onModeChange={(m) => {
            setMode(m);
            setErr(null);
            setInfo(null);
          }}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onAllowPlaintextChange={setAllowPlaintext}
          onSubmit={handleSubmit}
        />
      )}

      {err && <Banner color="#fda4af" bg="rgba(244,63,94,0.08)" border="rgba(244,63,94,0.3)">{err}</Banner>}
      {info && <Banner color="#86efac" bg="rgba(16,185,129,0.08)" border="rgba(16,185,129,0.3)">{info}</Banner>}

      <BackendBlock
        show={showBackend}
        onToggleShow={() => setShowBackend((v) => !v)}
        draft={backendDraft}
        onDraftChange={setBackendDraft}
        onSave={handleSaveBackend}
        busy={busy}
        signedIn={!!state?.signedIn}
      />

      <DisclosureFooter mode={state?.backend.mode ?? 'local-stub'} />
    </div>
  );
}

function SignedInView({
  state,
  busy,
  onLogout,
  onPull,
  onPush,
}: {
  state: AuthState;
  busy: boolean;
  onLogout: () => void;
  onPull: () => void;
  onPush: () => void;
}) {
  const u = state.session!.user;
  return (
    <>
      <div style={{
        padding: '14px',
        background: 'var(--accent-gradient-soft)',
        border: '1px solid var(--border-active)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36,
            borderRadius: '50%',
            background: 'var(--accent-gradient)',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700,
            flexShrink: 0,
          }}>
            {u.email.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {u.email}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Signed in · {state.backend.mode === 'local-stub' ? 'Local only' : new URL(state.backend.baseUrl!).hostname}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button onClick={onPull} disabled={busy} style={secondaryBtn}>
          ↓ Pull settings
        </button>
        <button onClick={onPush} disabled={busy} style={secondaryBtn}>
          ↑ Push settings
        </button>
      </div>

      <button onClick={onLogout} disabled={busy} style={dangerBtn}>
        Sign out
      </button>
    </>
  );
}

function SignedOutView({
  mode,
  email,
  password,
  allowPlaintext,
  busy,
  backend,
  encryptionAvailable,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onAllowPlaintextChange,
  onSubmit,
}: {
  mode: Mode;
  email: string;
  password: string;
  allowPlaintext: boolean;
  busy: boolean;
  backend: AuthBackend;
  encryptionAvailable: boolean;
  onModeChange: (m: Mode) => void;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onAllowPlaintextChange: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <>
      <div style={{
        padding: 14,
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 10,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          Sign-in is optional.
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
          Cross-device sync of theme and LMM settings only.
          GitHub PAT stays on this device.
        </div>
        <button
          onClick={() => onModeChange('idle')}
          disabled={busy}
          style={{
            ...primaryBtn,
            width: '100%',
          }}
        >
          Continue without login
        </button>
      </div>

      <div style={{
        marginBottom: 6,
        fontSize: 10,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        textAlign: 'center',
      }}>
        — or —
      </div>

      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: 10,
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 3,
      }}>
        {(['register', 'login'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            style={{
              flex: 1,
              padding: '6px 0',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: mode === m ? 'var(--accent-gradient)' : 'transparent',
              color: mode === m ? '#fff' : 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: mode === m ? 600 : 400,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {m === 'register' ? 'Register' : 'Sign in'}
          </button>
        ))}
      </div>

      {mode !== 'idle' && (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            placeholder={mode === 'register' ? 'At least 8 characters' : 'Password'}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={busy || !email || !password}
            style={{
              ...primaryBtn,
              opacity: busy || !email || !password ? 0.5 : 1,
              cursor: busy || !email || !password ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>
      )}

      {backend.mode === 'local-stub' && (
        <div style={{
          marginTop: 8,
          padding: '6px 10px',
          fontSize: 10,
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#fcd34d',
          lineHeight: 1.4,
        }}>
          <strong>Local-stub mode:</strong> accounts and "sync" are stored in
          this app's userData on this device only. No network, no real cross-device.
          Switch backend below to point at a real server.
        </div>
      )}

      {!encryptionAvailable && (
        <>
          <div style={{
            marginTop: 8,
            padding: '6px 10px',
            fontSize: 10,
            background: 'rgba(244,63,94,0.08)',
            border: '1px solid rgba(244,63,94,0.3)',
            borderRadius: 'var(--radius-sm)',
            color: '#fda4af',
            lineHeight: 1.4,
          }}>
            OS keychain unavailable. Session tokens would be stored as
            plaintext in this app's userData. Tick the box below if you
            accept that risk.
          </div>
          <label style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            color: '#fda4af',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={allowPlaintext}
              onChange={(e) => onAllowPlaintextChange(e.target.checked)}
            />
            Store session token in plaintext (I accept the risk)
          </label>
        </>
      )}
    </>
  );
}

function BackendBlock({
  show,
  onToggleShow,
  draft,
  onDraftChange,
  onSave,
  busy,
  signedIn,
}: {
  show: boolean;
  onToggleShow: () => void;
  draft: AuthBackend;
  onDraftChange: (next: AuthBackend) => void;
  onSave: () => void;
  busy: boolean;
  signedIn: boolean;
}) {
  return (
    <div style={{
      marginTop: 12,
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <button
        onClick={onToggleShow}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        Backend
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
          style={{ transform: show ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
          <polyline points="2 4 6 8 10 4" />
        </svg>
      </button>
      {show && (
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {(['local-stub', 'http'] as AuthBackendMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onDraftChange({ ...draft, mode: m })}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: draft.mode === m ? 'var(--accent-gradient)' : 'var(--bg-elevated)',
                  color: draft.mode === m ? '#fff' : 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: draft.mode === m ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {m === 'local-stub' ? 'Local stub' : 'HTTP server'}
              </button>
            ))}
          </div>
          {draft.mode === 'http' && (
            <input
              type="url"
              placeholder="https://your-worker.workers.dev"
              value={draft.baseUrl ?? ''}
              onChange={(e) => onDraftChange({ ...draft, baseUrl: e.target.value })}
              style={{ ...inputStyle, marginBottom: 8 }}
            />
          )}
          {signedIn && (
            <div style={{
              fontSize: 10,
              color: '#fcd34d',
              marginBottom: 8,
              lineHeight: 1.4,
            }}>
              Changing backend will sign you out (tokens are backend-specific).
            </div>
          )}
          <button onClick={onSave} disabled={busy} style={{ ...secondaryBtn, width: '100%' }}>
            Save backend
          </button>
        </div>
      )}
    </div>
  );
}

function DisclosureFooter({ mode }: { mode: AuthBackendMode }) {
  return (
    <div style={{
      marginTop: 10,
      fontSize: 9,
      color: 'var(--text-muted)',
      lineHeight: 1.5,
    }}>
      {mode === 'local-stub'
        ? 'Local-stub: scrypt-hashed passwords + session tokens in userData. Suitable for prototyping only.'
        : 'HTTP: register/login/logout + GET/PUT /settings against your configured backend. Bearer-token auth.'}
    </div>
  );
}

function Banner({
  children,
  color,
  bg,
  border,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div style={{
      marginTop: 10,
      padding: '8px 10px',
      fontSize: 11,
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 'var(--radius-md)',
      color,
    }}>
      {children}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const accentBar: React.CSSProperties = {
  width: 3,
  height: 14,
  borderRadius: 2,
  background: 'var(--accent-gradient)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 11,
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 10px',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-gradient)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  flex: 1,
  padding: '7px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  fontSize: 11,
  cursor: 'pointer',
};

const dangerBtn: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid rgba(244,63,94,0.3)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: '#fda4af',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
};
