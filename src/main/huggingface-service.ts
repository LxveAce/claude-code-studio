import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  HFAuditEntry,
  HFGgufVariant,
  HFModelCard,
  HFSearchHit,
  HFSearchOptions,
  HFSettings,
  HFCachedEntry,
} from '../shared/types';

const SETTINGS_FILE = 'huggingface-settings.json';
const CACHE_DIR_NAME = 'hf-cache';
const AUDIT_LOG_FILE = 'huggingface-research-audit.jsonl';
const MAX_AUDIT_ENTRIES = 1000;

const DEFAULT_SETTINGS: HFSettings = {
  researchModeEnabled: false,
  researchModeAcknowledgedAt: null,
  cachePath: null,
};

const MAX_RESULTS = 50;
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * HuggingFaceService — main-process facade over @huggingface/hub.
 *
 * Provides search / model card / GGUF discovery / Ollama-bridge import /
 * local cache management.  The renderer talks to this strictly via IPC;
 * raw API tokens (none, for now) never cross the boundary.
 *
 * Caching strategy:
 *   - We default to <userData>/hf-cache to keep ownership inside the app
 *     directory (auto-cleaned by `Reset User Data`).
 *   - If the user has an existing `~/.cache/huggingface` populated, we
 *     prefer it so a fresh install reuses their existing downloads.
 *   - The first explicit setSettings({cachePath}) overrides both.
 *
 * Research mode (uncensored / experimental catalogs):
 *   - Disabled by default.  Settings -> Advanced -> "Enable Research
 *     Catalogs" toggle with explicit disclaimer in the renderer.
 *   - When enabled, the renderer exposes a Research sub-tab that lists
 *     curated HF Collections.  Per-model Ollama imports for research
 *     content run under an isolated OLLAMA_MODELS env override
 *     (sandbox path) and append a line to the audit log on every run.
 *   - Acknowledgement timestamp persists so the disclaimer doesn't
 *     re-prompt on every launch once accepted.
 */
export class HuggingFaceService {
  private settingsPath: string;
  private settings: HFSettings;
  private hfModule: typeof import('@huggingface/hub') | null = null;
  private hfModuleError: string | null = null;

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
    this.settings = this.readSettings();
    this.ensureCacheDir();
  }

  // ---- settings ----

  getSettings(): HFSettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<HFSettings>): HFSettings {
    const next: HFSettings = { ...this.settings };
    if (partial.researchModeEnabled !== undefined) {
      if (typeof partial.researchModeEnabled !== 'boolean') {
        throw new Error('researchModeEnabled must be a boolean');
      }
      next.researchModeEnabled = partial.researchModeEnabled;
      // Stamp acknowledgement the first time the user flips it on.
      if (partial.researchModeEnabled && !this.settings.researchModeAcknowledgedAt) {
        next.researchModeAcknowledgedAt = new Date().toISOString();
      }
    }
    if (partial.cachePath !== undefined) {
      if (partial.cachePath !== null) {
        if (typeof partial.cachePath !== 'string') {
          throw new Error('cachePath must be a string or null');
        }
        if (!path.isAbsolute(partial.cachePath)) {
          throw new Error('cachePath must be an absolute path');
        }
        if (partial.cachePath.length > 4096) {
          throw new Error('cachePath is too long');
        }
      }
      next.cachePath = partial.cachePath;
    }
    this.settings = next;
    this.writeSettings(next);
    this.ensureCacheDir();
    return { ...this.settings };
  }

  // ---- public surface ----

  /** List models matching the query.  Falls back to a reasonable
   *  default-sorted list if no query is provided. */
  async search(opts: HFSearchOptions): Promise<HFSearchHit[]> {
    const mod = await this.loadHubModule();
    const search = String(opts.query ?? '').slice(0, 256);
    const limit = clampInt(opts.limit ?? 30, 1, MAX_RESULTS);
    const task =
      typeof opts.task === 'string' && opts.task.length > 0 && opts.task.length <= 64
        ? opts.task
        : undefined;
    const library =
      typeof opts.library === 'string' && opts.library.length > 0 && opts.library.length <= 64
        ? opts.library
        : undefined;
    const ggufOnly = !!opts.ggufOnly;

    const results: HFSearchHit[] = [];
    let scanned = 0;
    const maxScan = ggufOnly ? Math.max(limit * 4, 80) : limit;
    // Concatenate optional task / library into the search string —
    // listModels' shape across @huggingface/hub versions is more lenient
    // about extra search keywords than per-axis filters, so this gives
    // us deterministic behavior on minor SDK bumps.
    const searchParts: string[] = [];
    if (search) searchParts.push(search);
    if (task) searchParts.push(task);
    if (library) searchParts.push(library);
    const searchString = searchParts.join(' ') || undefined;
    try {
      // @huggingface/hub's listModels takes `search` as a structured
      // object ({ query, task, owner, tags, ... }).  We pass query
      // (free-form text) and let the SDK forward it to the API.
      for await (const raw of mod.listModels({
        search: searchString ? { query: searchString } : undefined,
        limit: maxScan,
        // additionalFields pulls in `tags`, `pipeline_tag`, etc.
        // which aren't on the strict ModelEntry but ARE in the API
        // response.  Cast lets us read them downstream.
        additionalFields: ['tags', 'pipeline_tag'],
      } as Parameters<typeof mod.listModels>[0])) {
        const model = raw as ModelEntryLoose;
        scanned++;
        const tags: string[] = Array.isArray(model.tags)
          ? model.tags.filter((t): t is string => typeof t === 'string')
          : [];
        if (ggufOnly) {
          const hasGguf = tags.some((t) => t.toLowerCase().includes('gguf'));
          if (!hasGguf) continue;
        }
        results.push({
          id: String(model.name ?? ''),
          author: String(model.name ?? '').split('/')[0] ?? '',
          downloads: typeof model.downloads === 'number' ? model.downloads : 0,
          likes: typeof model.likes === 'number' ? model.likes : 0,
          tags: tags.slice(0, 20),
          pipelineTag: typeof model.pipeline_tag === 'string' ? model.pipeline_tag : null,
          gated: !!model.gated,
          updatedAt:
            model.updatedAt instanceof Date
              ? model.updatedAt.toISOString()
              : typeof model.updatedAt === 'string'
                ? model.updatedAt
                : null,
        });
        if (results.length >= limit) break;
        if (scanned >= maxScan) break;
      }
    } catch (e) {
      throw new Error(`HF search failed: ${(e as Error).message ?? String(e)}`);
    }
    return results;
  }

  /** Full card for a single repo.  Includes GGUF variants if any. */
  async modelInfo(repoId: string): Promise<HFModelCard> {
    if (!isRepoId(repoId)) throw new Error('invalid repoId');
    const mod = await this.loadHubModule();
    try {
      const infoRaw = await mod.modelInfo({
        name: repoId,
        additionalFields: ['tags', 'pipeline_tag', 'license', 'description'],
      } as Parameters<typeof mod.modelInfo>[0]);
      const info = infoRaw as ModelInfoLoose;
      const files: { path: string; size: number | null }[] = [];
      try {
        for await (const f of mod.listFiles({ repo: { type: 'model', name: repoId } })) {
          if (typeof f.path !== 'string') continue;
          files.push({
            path: f.path,
            size: typeof f.size === 'number' ? f.size : null,
          });
          if (files.length >= 200) break;
        }
      } catch {
        // listFiles may fail on gated models w/o a token; fall through
        // with whatever metadata modelInfo returned.
      }
      const ggufFiles = files.filter((f) => /\.gguf$/i.test(f.path));
      const gguf: HFGgufVariant[] = ggufFiles.map((f) => {
        const quant = extractQuantTag(f.path);
        return {
          fileName: f.path,
          quant,
          sizeBytes: f.size ?? null,
        };
      });
      return {
        id: repoId,
        description: typeof info.description === 'string' ? info.description : null,
        downloads: typeof info.downloads === 'number' ? info.downloads : 0,
        likes: typeof info.likes === 'number' ? info.likes : 0,
        tags: Array.isArray(info.tags)
          ? info.tags.filter((t): t is string => typeof t === 'string').slice(0, 60)
          : [],
        pipelineTag: typeof info.pipeline_tag === 'string' ? info.pipeline_tag : null,
        license: typeof info.license === 'string' ? info.license : null,
        gated: !!info.gated,
        files,
        gguf,
        updatedAt:
          info.updatedAt instanceof Date
            ? info.updatedAt.toISOString()
            : typeof info.updatedAt === 'string'
              ? info.updatedAt
              : null,
      };
    } catch (e) {
      throw new Error(`HF modelInfo failed: ${(e as Error).message ?? String(e)}`);
    }
  }

  /** Resolved cache directory.  Pure read — no side effects. */
  getCachePath(): string {
    if (this.settings.cachePath) return this.settings.cachePath;
    const homeCache = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
    try {
      if (fs.existsSync(homeCache) && fs.statSync(homeCache).isDirectory()) return homeCache;
    } catch {
      // ignore — fall through to userData
    }
    return path.join(app.getPath('userData'), CACHE_DIR_NAME);
  }

  /** Walk the cache directory and report top-level entries (repo dirs) +
   *  their on-disk size.  Bounded scan; large caches are summarised. */
  listCached(): HFCachedEntry[] {
    const root = this.getCachePath();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: HFCachedEntry[] = [];
    let scanned = 0;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      // Hub layout: `models--<org>--<name>` per repo.
      const id = decodeCacheDir(e.name);
      if (!id) continue;
      const full = path.join(root, e.name);
      const size = directorySizeSafe(full);
      out.push({ id, dirName: e.name, sizeBytes: size });
      scanned++;
      if (scanned > 500) break;
    }
    return out;
  }

  /** Delete a cached repo by id.  Returns whether the directory was found. */
  removeCached(repoId: string): boolean {
    if (!isRepoId(repoId)) throw new Error('invalid repoId');
    const root = this.getCachePath();
    const dirName = `models--${repoId.replace('/', '--')}`;
    const target = path.join(root, dirName);
    // Path-traversal guard: target MUST resolve inside root.
    const targetReal = path.resolve(target);
    const rootReal = path.resolve(root);
    if (!targetReal.startsWith(rootReal + path.sep) && targetReal !== rootReal) {
      throw new Error('cache target escapes the cache root');
    }
    try {
      const st = fs.statSync(target);
      if (!st.isDirectory()) return false;
    } catch {
      return false;
    }
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  }

  // ---- research audit log ----

  /** Append a Research-catalog launch event to the JSONL audit log.
   *  Bounded to MAX_AUDIT_ENTRIES — older entries truncate FIFO. */
  appendAuditEntry(entry: HFAuditEntry): void {
    const auditPath = this.getAuditLogPath();
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    try {
      fs.appendFileSync(auditPath, line, { mode: 0o600 });
    } catch {
      // ignore — best-effort logging
      return;
    }
    // Cap the file by trimming oldest entries when it grows large.
    // Cheap heuristic: only check size occasionally (every 50 appends
    // would be ideal; we approximate by checking when the file is
    // larger than ~MAX_AUDIT_ENTRIES * 200 bytes per line).
    try {
      const stat = fs.statSync(auditPath);
      if (stat.size > MAX_AUDIT_ENTRIES * 256) {
        const all = this.readAuditLog();
        const trimmed = all.slice(-MAX_AUDIT_ENTRIES);
        const next = trimmed.map((e) => JSON.stringify(e)).join('\n') + '\n';
        const tmp = `${auditPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tmp, next, { mode: 0o600 });
        fs.renameSync(tmp, auditPath);
      }
    } catch {
      // ignore — trimming is opportunistic
    }
  }

  readAuditLog(): HFAuditEntry[] {
    const auditPath = this.getAuditLogPath();
    let raw: string;
    try {
      raw = fs.readFileSync(auditPath, 'utf8');
    } catch {
      return [];
    }
    const out: HFAuditEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Partial<HFAuditEntry>;
        if (typeof parsed.ts !== 'string') continue;
        if (typeof parsed.repoId !== 'string') continue;
        out.push({
          ts: parsed.ts,
          repoId: parsed.repoId,
          quant: typeof parsed.quant === 'string' ? parsed.quant : null,
          note: typeof parsed.note === 'string' ? parsed.note : undefined,
        });
      } catch {
        // skip malformed line
      }
    }
    return out;
  }

  clearAuditLog(): void {
    const auditPath = this.getAuditLogPath();
    try {
      fs.unlinkSync(auditPath);
    } catch {
      // already absent
    }
  }

  private getAuditLogPath(): string {
    return path.join(app.getPath('userData'), AUDIT_LOG_FILE);
  }

  // ---- internals ----

  /** Lazy-load the SDK so the rest of the app doesn't pay the parse cost
   *  unless the user actually opens the HF panel. */
  private async loadHubModule(): Promise<typeof import('@huggingface/hub')> {
    if (this.hfModule) return this.hfModule;
    if (this.hfModuleError) throw new Error(this.hfModuleError);
    try {
      // Dynamic import keeps electron-builder from trying to bundle it
      // into the main entry — it lives in node_modules and is required
      // lazily on first HF call.
      this.hfModule = await import('@huggingface/hub');
      return this.hfModule;
    } catch (e) {
      this.hfModuleError = `@huggingface/hub failed to load: ${(e as Error).message ?? String(e)}`;
      throw new Error(this.hfModuleError);
    }
  }

  private ensureCacheDir(): void {
    const dir = this.getCachePath();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Ignore — first call to a method that touches the dir will surface.
    }
  }

  private readSettings(): HFSettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.settingsPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS };
    }
    let parsed: Partial<HFSettings>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      researchModeEnabled:
        typeof parsed.researchModeEnabled === 'boolean'
          ? parsed.researchModeEnabled
          : DEFAULT_SETTINGS.researchModeEnabled,
      researchModeAcknowledgedAt:
        typeof parsed.researchModeAcknowledgedAt === 'string'
          ? parsed.researchModeAcknowledgedAt
          : DEFAULT_SETTINGS.researchModeAcknowledgedAt,
      cachePath:
        typeof parsed.cachePath === 'string' && parsed.cachePath.length > 0
          ? parsed.cachePath
          : DEFAULT_SETTINGS.cachePath,
    };
  }

  private writeSettings(next: HFSettings): void {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    const tmp = `${this.settingsPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.settingsPath);
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

// ---- helpers ----

/**
 * Looser shape of a `ModelEntry` from @huggingface/hub.  The SDK's
 * strict type elides `tags`, `pipeline_tag`, etc. because they're only
 * present when `additionalFields` is requested.  We always request them
 * so the cast is safe — but TypeScript needs the wider type to read.
 */
interface ModelEntryLoose {
  name?: string;
  downloads?: number;
  likes?: number;
  gated?: boolean;
  tags?: unknown[];
  pipeline_tag?: string;
  updatedAt?: Date | string;
}

interface ModelInfoLoose extends ModelEntryLoose {
  description?: string;
  license?: string;
}


function isRepoId(s: unknown): s is string {
  // <org-or-user>/<name>; both sides allow letters, digits, '_', '-', '.'.
  return typeof s === 'string' && /^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+$/.test(s) && s.length <= 256;
}

function clampInt(n: unknown, lo: number, hi: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : lo;
  return Math.max(lo, Math.min(hi, x));
}

function extractQuantTag(fileName: string): string | null {
  // Common GGUF quant tags: Q2_K, Q3_K_S, Q4_0, Q4_K_M, Q5_0, Q5_K_M,
  // Q6_K, Q8_0, F16, BF16, F32, IQ3_XS, IQ4_NL, etc.
  const m = fileName.match(/\.((?:Q\d_K_[A-Z]+|Q\d_\d|IQ\d_[A-Z]+|F16|BF16|F32))\.gguf$/i);
  return m ? m[1].toUpperCase() : null;
}

function decodeCacheDir(dirName: string): string | null {
  // Hub layout: 'models--<org>--<name>'
  if (!dirName.startsWith('models--')) return null;
  const stripped = dirName.slice('models--'.length);
  // First '--' separates org from name; later '--' can appear in the
  // repo name itself in the cache layout (Hub uses '--' as a safe
  // separator for filesystem-incompatible characters), so split on
  // the first occurrence only.
  const idx = stripped.indexOf('--');
  if (idx <= 0) return null;
  const org = stripped.slice(0, idx);
  const name = stripped.slice(idx + 2);
  if (!org || !name) return null;
  return `${org}/${name}`;
}

function directorySizeSafe(root: string): number {
  let total = 0;
  let scanned = 0;
  const stack: string[] = [root];
  while (stack.length > 0 && scanned < 5000) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      scanned++;
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          // ignore unreadable files
        }
      }
    }
  }
  return total;
}
