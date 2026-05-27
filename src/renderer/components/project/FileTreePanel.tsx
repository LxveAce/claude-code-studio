import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DirEntry,
  DirListing,
  RecentProject,
} from '../../../shared/types';

/**
 * FileTreePanel — sidebar panel that shows the active cwd as a lazy-loaded
 * tree. Each folder loads its children only when expanded so opening a
 * project with `node_modules` doesn't stall the renderer.
 *
 * Click semantics:
 *   - Folder row: toggle expansion (load children if first time).
 *   - File row: select + show actions inline (Copy path, Open externally).
 *   - "Set as cwd" link in the header: change app-wide cwd to this folder.
 *
 * Path-traversal protection lives in the main-process ProjectExplorer —
 * the renderer just trusts the backend's `entries[].path` to be valid.
 */

interface ExpandedListings {
  [absPath: string]: DirListing;
}

export function FileTreePanel() {
  const [cwd, setCwd] = useState<string>('');
  const [root, setRoot] = useState<string>(''); // anchored root for traversal safety
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [listings, setListings] = useState<ExpandedListings>({});
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const reloadCwd = useCallback(async () => {
    try {
      const next = await window.electronAPI.git.getCwd();
      setCwd(next);
      setRoot(next);
    } catch {
      // git service unavailable — leave fields empty
    }
  }, []);

  const reloadRecent = useCallback(async () => {
    try {
      const list = await window.electronAPI.projectExplorer.recentList();
      setRecent(list);
    } catch {
      setRecent([]);
    }
  }, []);

  const loadDir = useCallback(
    async (target: string, anchorRoot: string): Promise<DirListing | null> => {
      setLoading(true);
      setErr(null);
      try {
        const listing = await window.electronAPI.projectExplorer.listDir(anchorRoot, target);
        if (listing.error) {
          setErr(`${target}: ${listing.error}`);
        }
        setListings((prev) => ({ ...prev, [target]: listing }));
        return listing;
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void reloadCwd();
    void reloadRecent();
  }, [reloadCwd, reloadRecent]);

  // When cwd changes, reset tree state + load top-level.
  useEffect(() => {
    if (!cwd) return;
    setExpanded(new Set([cwd]));
    setListings({});
    setSelectedPath(null);
    void (async () => {
      await loadDir(cwd, cwd);
      try {
        const list = await window.electronAPI.projectExplorer.recentAdd(cwd);
        setRecent(list);
      } catch {
        // recent-add failure is non-fatal
      }
    })();
  }, [cwd, loadDir]);

  const handleToggle = useCallback(
    async (entry: DirEntry) => {
      if (entry.type !== 'dir') {
        setSelectedPath(entry.path);
        return;
      }
      const next = new Set(expanded);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
        if (!listings[entry.path]) {
          await loadDir(entry.path, root);
        }
      }
      setExpanded(next);
    },
    [expanded, listings, root, loadDir]
  );

  const handlePickDir = async () => {
    try {
      const next = await window.electronAPI.git.pickDir();
      if (next) {
        setCwd(next);
      }
    } catch {
      // dialog dismissed or failed — ignore
    }
  };

  const handleSwitchRecent = async (target: string) => {
    try {
      await window.electronAPI.git.setCwd(target);
      setCwd(target);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleForgetRecent = async (target: string) => {
    try {
      const list = await window.electronAPI.projectExplorer.recentRemove(target);
      setRecent(list);
    } catch {
      // ignore
    }
  };

  const handleCopyPath = async (p: string) => {
    try {
      await navigator.clipboard.writeText(p);
    } catch {
      // ignore
    }
  };

  const handleOpenExternally = async (p: string) => {
    // shell.openPath via the github IPC's openExternal won't accept file://
    // URLs (host allowlist). Use a fresh IPC? For now: copy + tell user.
    // The main process's shell.openExternal would work but we don't expose
    // a generic open-path. Document in BACKLOG for beta.4 — for now, copy.
    await handleCopyPath(p);
    alert(`Path copied to clipboard:\n${p}\n\n(External-open from the file tree is queued for beta.4 — paste into Explorer / your editor for now.)`);
  };

  const visibleListing = listings[root];

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      <h3 style={titleStyle}>
        <div style={accentBarStyle} />
        Files
      </h3>

      <div style={cwdBoxStyle}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Current project</div>
        <div style={{ fontSize: 11, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
          {cwd || '(none)'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={handlePickDir} style={btnStyle}>Pick folder…</button>
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            style={btnStyle}
          >
            {showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
          </button>
          <button
            type="button"
            onClick={() => cwd && void loadDir(cwd, cwd)}
            style={btnStyle}
          >
            Refresh
          </button>
        </div>
      </div>

      {recent.length > 0 && (
        <details style={recentBlockStyle}>
          <summary style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Recent ({recent.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {recent.map((r) => (
              <div key={r.path} style={recentRowStyle}>
                <button
                  type="button"
                  onClick={() => void handleSwitchRecent(r.path)}
                  style={{ ...recentLinkStyle, flex: 1 }}
                  title={r.path}
                >
                  {r.label}
                </button>
                <button
                  type="button"
                  onClick={() => void handleForgetRecent(r.path)}
                  style={{ ...btnStyle, fontSize: 9, padding: '2px 6px' }}
                  title="Forget this entry"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {err && (
        <div style={errStyle}>{err}</div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', fontSize: 11, fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
        {loading && !visibleListing && (
          <div style={{ color: 'var(--text-muted)', padding: 8 }}>Loading…</div>
        )}
        {visibleListing && (
          <Tree
            listing={visibleListing}
            depth={0}
            expanded={expanded}
            listings={listings}
            showHidden={showHidden}
            selectedPath={selectedPath}
            onToggle={handleToggle}
            onSelect={(p) => setSelectedPath(p)}
          />
        )}
      </div>

      {selectedPath && (
        <div style={selectedBoxStyle}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Selected</div>
          <div style={{ fontSize: 10, color: 'var(--text-primary)', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', wordBreak: 'break-all', marginBottom: 6 }}>
            {selectedPath}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => void handleCopyPath(selectedPath)} style={btnStyle}>Copy path</button>
            <button type="button" onClick={() => void handleOpenExternally(selectedPath)} style={btnStyle}>Open externally</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface TreeProps {
  listing: DirListing;
  depth: number;
  expanded: Set<string>;
  listings: ExpandedListings;
  showHidden: boolean;
  selectedPath: string | null;
  onToggle: (entry: DirEntry) => void;
  onSelect: (p: string) => void;
}

function Tree({
  listing,
  depth,
  expanded,
  listings,
  showHidden,
  selectedPath,
  onToggle,
  onSelect,
}: TreeProps) {
  const entries = useMemo(
    () => listing.entries.filter((e) => showHidden || !e.hidden),
    [listing.entries, showHidden]
  );
  return (
    <div>
      {listing.truncated && (
        <div style={{ color: '#fbbf24', padding: '2px 8px', fontSize: 10 }}>
          ⚠ {listing.totalEntries} entries (capped at {listing.entries.length})
        </div>
      )}
      {entries.length === 0 && (
        <div style={{ color: 'var(--text-muted)', padding: '2px 8px', fontSize: 10, marginLeft: depth * 14 }}>
          (empty)
        </div>
      )}
      {entries.map((entry) => {
        const isExpanded = entry.type === 'dir' && expanded.has(entry.path);
        const isSelected = selectedPath === entry.path;
        const childListing = isExpanded ? listings[entry.path] : null;
        return (
          <div key={entry.path}>
            <div
              style={{
                ...rowStyle,
                paddingLeft: 4 + depth * 14,
                background: isSelected ? 'rgba(139, 92, 246, 0.18)' : 'transparent',
                color: entry.hidden ? 'var(--text-muted)' : 'var(--text-primary)',
                cursor: 'pointer',
              }}
              onClick={() => {
                onSelect(entry.path);
                void onToggle(entry);
              }}
              title={entry.path}
            >
              <span style={{ width: 12, textAlign: 'center', color: 'var(--text-muted)' }}>
                {entry.type === 'dir' ? (isExpanded ? '▾' : '▸') : ' '}
              </span>
              <span style={{ width: 14 }}>{entry.type === 'dir' ? '📁' : entry.type === 'symlink' ? '🔗' : '📄'}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.name}
              </span>
              {entry.type === 'file' && entry.size >= 0 && (
                <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>
                  {humanSize(entry.size)}
                </span>
              )}
            </div>
            {isExpanded && childListing && (
              <Tree
                listing={childListing}
                depth={depth + 1}
                expanded={expanded}
                listings={listings}
                showHidden={showHidden}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const accentBarStyle: React.CSSProperties = {
  width: 3,
  height: 14,
  borderRadius: 2,
  background: 'var(--accent-gradient)',
};
const cwdBoxStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
};
const recentBlockStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: 'rgba(34, 197, 94, 0.05)',
  border: '1px solid rgba(34, 197, 94, 0.12)',
  borderRadius: 6,
};
const recentRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  alignItems: 'center',
};
const recentLinkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-primary)',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left',
  padding: '2px 4px',
};
const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '4px 10px',
  fontSize: 10,
  borderRadius: 4,
  cursor: 'pointer',
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 4px',
  borderRadius: 3,
};
const selectedBoxStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(139, 92, 246, 0.08)',
  border: '1px solid rgba(139, 92, 246, 0.2)',
  borderRadius: 6,
};
const errStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#fca5a5',
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  padding: '6px 10px',
  borderRadius: 4,
};
