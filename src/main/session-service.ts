import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SessionState, SplitNode } from '../shared/types';

const STORE_FILE = 'session.json';
const STORE_VERSION = 1;
/**
 * Hard caps to keep the layout tree from growing into a denial-of-service
 * (huge JSON written to disk, huge tree rendered, etc.). Trees that exceed
 * any cap are treated as malformed and replaced with the default layout.
 */
const MAX_TREE_DEPTH = 6;
const MAX_TREE_NODES = 32;
const MAX_PANE_ID_LEN = 64;
const MAX_CWD_LEN = 4096;
const VALID_PANEL_IDS = new Set([
  'terminal',
  'commands',
  'resources',
  'github',
  'cost',
  'compact',
  'lmm',
  'sync',
  'auth',
  'settings',
  'models',
  'files',
]);

interface PersistedSession {
  version: number;
  state: SessionState;
}

export class SessionService {
  private storePath: string;
  private state: SessionState;

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.state = this.read();
  }

  get(): SessionState {
    // Defensive copy so callers can't mutate the in-memory state by reference.
    return JSON.parse(JSON.stringify(this.state)) as SessionState;
  }

  /**
   * Replace the full session state. Caller (the renderer) is responsible for
   * computing the merged state from current UI; we validate and persist.
   */
  set(next: SessionState): SessionState {
    const sanitized = this.sanitize(next);
    this.state = sanitized;
    this.write();
    return this.get();
  }

  /** Reset to factory defaults; used by the palette "Reset layout" action. */
  reset(): SessionState {
    this.state = this.defaults();
    this.write();
    return this.get();
  }

  // --- internals ---

  private defaults(): SessionState {
    return {
      version: STORE_VERSION,
      activePanel: 'terminal',
      theme: null,
      layout: {
        type: 'pane',
        id: 'p_root',
        cwd: null,
      },
    };
  }

  private sanitize(input: unknown): SessionState {
    if (!input || typeof input !== 'object') return this.defaults();
    const obj = input as Record<string, unknown>;
    const activePanel =
      typeof obj.activePanel === 'string' && VALID_PANEL_IDS.has(obj.activePanel)
        ? (obj.activePanel as SessionState['activePanel'])
        : 'terminal';
    const theme = typeof obj.theme === 'string' && obj.theme.length <= 64
      ? obj.theme
      : null;

    let layout: SplitNode;
    let counter = { n: 0 };
    try {
      layout = this.sanitizeNode(obj.layout, 0, counter, new Set());
    } catch {
      layout = this.defaults().layout;
    }
    return {
      version: STORE_VERSION,
      activePanel,
      theme,
      layout,
    };
  }

  private sanitizeNode(
    raw: unknown,
    depth: number,
    counter: { n: number },
    seenIds: Set<string>
  ): SplitNode {
    if (depth > MAX_TREE_DEPTH) throw new Error('layout too deep');
    if (++counter.n > MAX_TREE_NODES) throw new Error('layout too large');
    if (!raw || typeof raw !== 'object') throw new Error('node not object');
    const node = raw as Record<string, unknown>;

    if (node.type === 'pane') {
      const id = typeof node.id === 'string' ? node.id : null;
      if (!id || id.length === 0 || id.length > MAX_PANE_ID_LEN) {
        throw new Error('bad pane id');
      }
      if (!/^[A-Za-z0-9_\-:]+$/.test(id)) throw new Error('bad pane id chars');
      if (seenIds.has(id)) throw new Error('duplicate pane id');
      seenIds.add(id);
      const cwd =
        typeof node.cwd === 'string' &&
        node.cwd.length > 0 &&
        node.cwd.length <= MAX_CWD_LEN
          ? node.cwd
          : null;
      return { type: 'pane', id, cwd };
    }

    if (node.type === 'split') {
      const direction = node.direction === 'vertical' ? 'vertical' : 'horizontal';
      const children = Array.isArray(node.children) ? node.children : null;
      if (!children || children.length !== 2) throw new Error('split needs 2 children');
      const sizes = Array.isArray(node.sizes) ? node.sizes : null;
      const safeSizes =
        sizes && sizes.length === 2 && sizes.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0 && s < 100)
          ? [sizes[0] as number, sizes[1] as number]
          : [50, 50];
      const sum = safeSizes[0] + safeSizes[1];
      const normalized: [number, number] = sum > 0
        ? [(safeSizes[0] / sum) * 100, (safeSizes[1] / sum) * 100]
        : [50, 50];
      const childA = this.sanitizeNode(children[0], depth + 1, counter, seenIds);
      const childB = this.sanitizeNode(children[1], depth + 1, counter, seenIds);
      return {
        type: 'split',
        direction,
        sizes: normalized,
        children: [childA, childB],
      };
    }

    throw new Error('unknown node type');
  }

  private read(): SessionState {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return this.defaults();
      // Don't blow up startup; degrade to defaults but leave the bad file on disk
      // (it will be overwritten on the next successful save).
      return this.defaults();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.defaults();
    }
    if (!parsed || typeof parsed !== 'object') return this.defaults();
    const p = parsed as Partial<PersistedSession> & { version?: unknown };
    const rawVersion = typeof p.version === 'number' && Number.isInteger(p.version)
      ? p.version
      : null;
    if (rawVersion === null) return this.defaults();
    if (rawVersion > STORE_VERSION) {
      // From-the-future file: a newer build wrote it. We don't know the shape,
      // so don't try — just start fresh rather than mis-sanitize.
      return this.defaults();
    }
    if (rawVersion < STORE_VERSION) {
      // Migrate forward step-by-step. Each migrator reads the prior-version
      // shape and returns the next-version shape. Today there's only v1, so
      // the migration table is empty; the structure is here so future schema
      // bumps don't have to re-architect this method.
      const migrated = this.migrate(p, rawVersion);
      if (!migrated) return this.defaults();
      return this.sanitize(migrated.state);
    }
    return this.sanitize(p.state);
  }

  /**
   * Step-by-step forward migration from `from` to STORE_VERSION.
   * Add a case for each version bump. Return null to refuse the migration
   * (caller falls back to defaults).
   *
   * Example skeleton for the next bump:
   *   if (from === 1) {
   *     // shape from v1 → v2 (e.g. add a `palette` field)
   *     current = { ...current, state: { ...current.state, palette: {...} } };
   *     from = 2;
   *   }
   */
  private migrate(p: Partial<PersistedSession>, from: number): PersistedSession | null {
    let current: Partial<PersistedSession> = p;
    let v = from;
    // No bumps shipped yet — v1 is the only version.
    if (v !== STORE_VERSION) return null;
    return {
      version: STORE_VERSION,
      state: (current.state ?? this.defaults()) as SessionState,
    };
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const payload: PersistedSession = {
      version: STORE_VERSION,
      state: this.state,
    };
    const tmp = `${this.storePath}.${process.pid}.${crypto
      .randomBytes(4)
      .toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.storePath);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw e;
    }
  }
}
