import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';

/**
 * ProjectExplorer — bounded, lazy directory listing for the FileTreePanel.
 *
 * Constraints (intentional):
 *   - LIST one directory level at a time. No recursive scans, ever.
 *     The renderer drives expansion: it asks for one path, gets entries,
 *     then asks for child paths as the user expands them.
 *   - Cap at MAX_ENTRIES per call so an `ls` of a huge dir (node_modules
 *     with 50k entries) doesn't OOM the renderer or block the main loop.
 *   - Reject absolute paths that escape the configured root (path-
 *     traversal guard). Caller passes the "root" — the explorer enforces
 *     that the resolved target is path.startsWith(root).
 *   - Hidden entries (dotfiles) are returned but flagged so the UI can
 *     gray them out or hide them by user preference.
 *
 * Recent-projects list piggybacks on this service so the panel has one
 * IPC namespace. Stored at <userData>/recent-projects.json.
 */

const MAX_ENTRIES = 2000;
const MAX_PATH_LENGTH = 4096;
const RECENT_FILE = 'recent-projects.json';
const MAX_RECENT = 12;

export interface DirEntry {
  name: string;
  /** Absolute path on disk. */
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  /** Size in bytes (files only; -1 for non-files). */
  size: number;
  /** ISO timestamp of last modification. */
  modified: string;
  /** True for `.`-prefixed names — UI can filter. */
  hidden: boolean;
}

export interface DirListing {
  root: string;
  path: string;
  /** True when the listing was capped at MAX_ENTRIES (more present on disk). */
  truncated: boolean;
  totalEntries: number;
  entries: DirEntry[];
  /** Stable, UI-friendly error reason when entries is empty. */
  error: 'not-found' | 'not-a-directory' | 'access-denied' | 'outside-root' | null;
}

export interface RecentProject {
  path: string;
  addedAt: string;
  /** User-overridable label; defaults to basename(path). */
  label: string;
}

/**
 * List one directory.
 *
 * @param root  Absolute path the listing is anchored under. Any `target`
 *              that isn't a subpath of `root` is rejected. Pass the
 *              user's current cwd here; the explorer never lets the UI
 *              read /etc/passwd by accident.
 * @param target Absolute path of the directory to list. Must be `root`
 *               or a descendant.
 */
export async function listDir(root: string, target: string): Promise<DirListing> {
  if (typeof root !== 'string' || typeof target !== 'string') {
    return emptyListing(root, target, 'not-found');
  }
  if (root.length === 0 || root.length > MAX_PATH_LENGTH) {
    return emptyListing(root, target, 'not-found');
  }
  if (target.length === 0 || target.length > MAX_PATH_LENGTH) {
    return emptyListing(root, target, 'not-found');
  }

  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  // Path-traversal guard. The +path.sep prevents `/foo/bar` from being
  // accepted when root is `/foo/ba` (prefix-match without separator).
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + path.sep)
  ) {
    return emptyListing(resolvedRoot, resolvedTarget, 'outside-root');
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(resolvedTarget);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return emptyListing(resolvedRoot, resolvedTarget, 'not-found');
    if (code === 'EACCES' || code === 'EPERM') {
      return emptyListing(resolvedRoot, resolvedTarget, 'access-denied');
    }
    return emptyListing(resolvedRoot, resolvedTarget, 'not-found');
  }
  if (!stat.isDirectory()) {
    return emptyListing(resolvedRoot, resolvedTarget, 'not-a-directory');
  }

  let names: string[];
  try {
    names = await fsp.readdir(resolvedTarget);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      return emptyListing(resolvedRoot, resolvedTarget, 'access-denied');
    }
    return emptyListing(resolvedRoot, resolvedTarget, 'not-found');
  }

  const totalEntries = names.length;
  const truncated = totalEntries > MAX_ENTRIES;
  const work = truncated ? names.slice(0, MAX_ENTRIES) : names;
  const entries: DirEntry[] = [];
  for (const name of work) {
    const full = path.join(resolvedTarget, name);
    let s: fs.Stats;
    try {
      s = await fsp.lstat(full);
    } catch {
      // Permission/race — skip the row rather than failing the whole listing.
      continue;
    }
    let type: DirEntry['type'];
    if (s.isSymbolicLink()) type = 'symlink';
    else if (s.isDirectory()) type = 'dir';
    else if (s.isFile()) type = 'file';
    else type = 'other';
    entries.push({
      name,
      path: full,
      type,
      size: type === 'file' ? s.size : -1,
      modified: s.mtime.toISOString(),
      hidden: name.startsWith('.'),
    });
  }
  // Stable order: dirs first, then files, each alphabetical case-insensitive.
  entries.sort((a, b) => {
    const aDir = a.type === 'dir' ? 0 : 1;
    const bDir = b.type === 'dir' ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return {
    root: resolvedRoot,
    path: resolvedTarget,
    truncated,
    totalEntries,
    entries,
    error: null,
  };
}

function emptyListing(root: string, target: string, error: NonNullable<DirListing['error']>): DirListing {
  return {
    root,
    path: target,
    truncated: false,
    totalEntries: 0,
    entries: [],
    error,
  };
}

// --- recent-projects persistence ----------------------------------------

function recentStorePath(): string {
  return path.join(app.getPath('userData'), RECENT_FILE);
}

export function readRecentProjects(): RecentProject[] {
  try {
    const raw = fs.readFileSync(recentStorePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r): RecentProject | null => {
        if (!r || typeof r !== 'object') return null;
        const p = typeof r.path === 'string' ? r.path : null;
        const a = typeof r.addedAt === 'string' ? r.addedAt : null;
        const l = typeof r.label === 'string' ? r.label : null;
        if (!p || p.length === 0 || p.length > MAX_PATH_LENGTH) return null;
        if (!a) return null;
        return {
          path: p,
          addedAt: a,
          label: l || path.basename(p) || p,
        };
      })
      .filter((x): x is RecentProject => x !== null)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function addRecentProject(targetPath: string): RecentProject[] {
  if (typeof targetPath !== 'string') return readRecentProjects();
  if (targetPath.length === 0 || targetPath.length > MAX_PATH_LENGTH) {
    return readRecentProjects();
  }
  const resolved = path.resolve(targetPath);
  const existing = readRecentProjects().filter((r) => r.path !== resolved);
  const next: RecentProject[] = [
    {
      path: resolved,
      addedAt: new Date().toISOString(),
      label: path.basename(resolved) || resolved,
    },
    ...existing,
  ].slice(0, MAX_RECENT);
  try {
    fs.mkdirSync(path.dirname(recentStorePath()), { recursive: true });
    fs.writeFileSync(recentStorePath(), JSON.stringify(next, null, 2));
  } catch {
    // Persistence failure is non-fatal — UI sees the in-memory result for
    // this session and we retry on next add.
  }
  return next;
}

export function removeRecentProject(targetPath: string): RecentProject[] {
  if (typeof targetPath !== 'string') return readRecentProjects();
  const resolved = path.resolve(targetPath);
  const next = readRecentProjects().filter((r) => r.path !== resolved);
  try {
    fs.writeFileSync(recentStorePath(), JSON.stringify(next, null, 2));
  } catch {
    // ignore
  }
  return next;
}
