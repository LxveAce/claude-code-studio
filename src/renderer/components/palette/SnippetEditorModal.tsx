import React, { useState } from 'react';
import type { Snippet } from '../../../shared/types';

interface SnippetEditorModalProps {
  initial: Snippet | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function SnippetEditorModal({ initial, onClose, onSaved }: SnippetEditorModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (initial) {
        await window.electronAPI.snippets.update(initial.id, { name, body });
      } else {
        await window.electronAPI.snippets.create({ name, body });
      }
      await onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!initial) return;
    if (!window.confirm(`Delete snippet "${initial.name}"?`)) return;
    setBusy(true);
    setErr(null);
    try {
      await window.electronAPI.snippets.delete(initial.id);
      await onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        animation: 'fadeIn 0.12s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: '90vw',
          padding: 20,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <h3 style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginTop: 0,
          marginBottom: 12,
        }}>
          {initial ? 'Edit snippet' : 'New snippet'}
        </h3>

        <label style={fieldLabel}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Review my PR"
          style={inputStyle}
          autoFocus
        />

        <label style={{ ...fieldLabel, marginTop: 10 }}>Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="The prompt text that gets inserted into the terminal…"
          rows={8}
          style={{
            ...inputStyle,
            fontFamily: '"Cascadia Code", "Fira Code", monospace',
            resize: 'vertical',
          }}
        />

        <div style={{
          marginTop: 6,
          fontSize: 10,
          color: 'var(--text-muted)',
          lineHeight: 1.4,
        }}>
          Inserted as plain text — you press Enter to submit. Max 64 KB.
        </div>

        {err && (
          <div style={{
            marginTop: 8,
            padding: '6px 10px',
            fontSize: 10,
            background: 'rgba(244,63,94,0.08)',
            border: '1px solid rgba(244,63,94,0.3)',
            borderRadius: 'var(--radius-sm)',
            color: '#fda4af',
          }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {initial && (
            <button onClick={() => void handleDelete()} disabled={busy} style={dangerBtn}>
              Delete
            </button>
          )}
          <button onClick={onClose} disabled={busy} style={ghostBtn}>Cancel</button>
          <button
            onClick={() => void handleSave()}
            disabled={busy || !name.trim() || !body.trim()}
            style={primaryBtn}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  color: 'var(--text-muted)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
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
  flex: 1,
  padding: '8px',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-gradient)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  flex: 1,
  padding: '8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 11,
  cursor: 'pointer',
};
const dangerBtn: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid rgba(244,63,94,0.3)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: '#fda4af',
  fontSize: 11,
  cursor: 'pointer',
};
