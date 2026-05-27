import React, { useState } from 'react';
import type { ModelCategory, ModelDefinition } from '../../../shared/types';

/**
 * Modal form for adding a custom model to the registry. Validates the id
 * against the same regex the registry uses internally so the add succeeds
 * the first time instead of bouncing on a backend reject.
 *
 * Reachable from the Models panel "+ Add custom model" button.
 */

const ID_RE = /^[a-z0-9][a-z0-9._:/\-]{0,127}$/i;

interface Props {
  onCancel: () => void;
  onSaved: () => void;
}

export function AddModelModal({ onCancel, onSaved }: Props) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ModelCategory>('local');
  const [provider, setProvider] = useState('Ollama');
  const [command, setCommand] = useState('ollama');
  const [argsText, setArgsText] = useState('run my-model:tag');
  const [ollamaName, setOllamaName] = useState('my-model:tag');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!ID_RE.test(id)) {
      return 'ID must be lowercase alphanumeric with . _ : / - separators.';
    }
    if (!name.trim()) return 'Name is required.';
    if (!command.trim()) return 'Command is required.';
    if (!provider.trim()) return 'Provider is required.';
    return null;
  };

  const handleSave = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const argList = argsText
        .split('\n')
        .flatMap((line) => line.split(/\s+/))
        .filter(Boolean);
      const model: ModelDefinition = {
        id: id.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        provider: provider.trim(),
        command: command.trim(),
        args: argList,
        ollamaName: category === 'local' && ollamaName.trim() ? ollamaName.trim() : undefined,
      };
      await window.electronAPI.models.add(model);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={backdropStyle} onClick={onCancel}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Add custom model</span>
          <button type="button" onClick={onCancel} style={closeBtnStyle}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <Field label="ID" hint="lowercase, dot/colon/slash/hyphen separators" value={id} onChange={setId} placeholder="ollama.my-custom-model" />
          <Field label="Name" value={name} onChange={setName} placeholder="My Custom Model" />
          <Field label="Description" value={description} onChange={setDescription} placeholder="What is this model for?" />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Label>Category</Label>
              <select value={category} onChange={(e) => setCategory(e.target.value as ModelCategory)} style={inputStyle}>
                <option value="local">Local (PTY-spawned)</option>
                <option value="api">API (remote provider CLI)</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Provider" value={provider} onChange={setProvider} placeholder="Ollama / OpenAI / Anthropic / …" />
            </div>
          </div>
          <Field label="Command" hint="argv[0] — the binary to spawn" value={command} onChange={setCommand} placeholder="ollama" />
          <div>
            <Label>Args (one per line, or space-separated)</Label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={3}
              style={{ ...inputStyle, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', resize: 'vertical' }}
              placeholder="run my-model:tag"
            />
          </div>
          {category === 'local' && (
            <Field
              label="Ollama tag (optional)"
              hint="If set, enables Pull / Delete actions for this model"
              value={ollamaName}
              onChange={setOllamaName}
              placeholder="my-model:tag"
            />
          )}

          {error && (
            <div style={errorStyle}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" onClick={handleSave} disabled={submitting} style={primaryBtnStyle}>
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onCancel} style={btnStyle}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, value, onChange, placeholder }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label>{label}{hint && <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontWeight: 400 }}>· {hint}</span>}</Label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2, fontWeight: 600 }}>{children}</div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 16,
  maxWidth: 480,
  width: '100%',
  maxHeight: '85vh',
  overflowY: 'auto',
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottom: '1px solid var(--border)',
  paddingBottom: 8,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 20,
  lineHeight: 1,
  padding: '0 6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '5px 8px',
  fontSize: 11,
  borderRadius: 4,
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '6px 14px',
  fontSize: 11,
  borderRadius: 6,
  cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--accent-gradient, #8b5cf6)',
  color: '#fff',
  border: 'none',
  fontWeight: 500,
};

const errorStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#fca5a5',
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  padding: '6px 10px',
  borderRadius: 4,
};
