import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  LMMCycle,
  LMMCycleSummary,
  LMMPhase,
  LMMSettings,
  LMMVariant,
} from '../shared/types';

const SETTINGS_FILE = 'lmm-settings.json';
const DEFAULT_DIR_NAME = 'lmm-journal';
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_PHASE_BYTES = 256 * 1024;
const MAX_CYCLE_BYTES = 1024 * 1024;
const MAX_CYCLE_FILE_BYTES = 1024 * 1024;
const MAX_CYCLES_SCANNED = 500;
const PHASE_ORDER: LMMPhase[] = ['raw', 'nodes', 'reflect', 'synth'];
const PHASE_LABEL: Record<LMMPhase, string> = {
  raw: 'Phase 1: RAW',
  nodes: 'Phase 2: NODES',
  reflect: 'Phase 3: REFLECT',
  synth: 'Phase 4: SYNTHESIZE',
};

export class LMMService {
  private settingsPath: string;
  private settings: LMMSettings;

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
    this.settings = this.readSettings();
    this.ensureDir(this.settings.journalDir);
  }

  getSettings(): LMMSettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<LMMSettings>): LMMSettings {
    // journalDir is intentionally NOT mutable here — it can only be changed
    // through pickJournalDir, which requires a user gesture via the OS dialog.
    if (partial.enabled !== undefined && typeof partial.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    if (
      partial.variant !== undefined &&
      partial.variant !== 'quick' &&
      partial.variant !== 'deep'
    ) {
      throw new Error(`Invalid variant: ${String(partial.variant)}`);
    }
    const next: LMMSettings = {
      enabled: partial.enabled ?? this.settings.enabled,
      journalDir: this.settings.journalDir,
      variant: (partial.variant as LMMVariant | undefined) ?? this.settings.variant,
    };
    this.ensureDir(next.journalDir);
    this.writeSettings(next);
    this.settings = next;
    return { ...this.settings };
  }

  listCycles(): LMMCycleSummary[] {
    this.ensureDir(this.settings.journalDir);
    let entries: string[];
    try {
      entries = fs.readdirSync(this.settings.journalDir);
    } catch {
      return [];
    }
    const cycles: LMMCycleSummary[] = [];
    let scanned = 0;
    for (const name of entries) {
      if (!name.endsWith('.lmm.md')) continue;
      const id = name.slice(0, -'.lmm.md'.length);
      if (!ID_PATTERN.test(id)) continue;
      if (++scanned > MAX_CYCLES_SCANNED) break;
      const cycle = this.readCycle(id);
      if (cycle) cycles.push(summary(cycle));
    }
    return cycles.sort((a, b) => b.modified.localeCompare(a.modified));
  }

  getCycle(id: string): LMMCycle | null {
    if (!this.isValidId(id)) return null;
    return this.readCycle(id);
  }

  createCycle(title: string): LMMCycle {
    const trimmed = typeof title === 'string' ? title.trim() : '';
    if (!trimmed) throw new Error('Title cannot be empty');
    const slug = makeSlug(trimmed);
    const filePath = this.cyclePath(slug);
    if (fs.existsSync(filePath)) {
      throw new Error(`A cycle with id "${slug}" already exists`);
    }
    const now = new Date().toISOString();
    const cycle: LMMCycle = {
      id: slug,
      title: trimmed,
      created: now,
      modified: now,
      currentPhase: 'raw',
      filledPhases: [],
      phases: { raw: '', nodes: '', reflect: '', synth: '' },
    };
    this.writeCycle(cycle);
    return cycle;
  }

  savePhase(id: string, phase: LMMPhase, content: string): LMMCycle {
    if (!this.isValidId(id)) throw new Error(`Invalid cycle id: ${id}`);
    if (!PHASE_ORDER.includes(phase)) throw new Error(`Invalid phase: ${phase}`);
    if (typeof content !== 'string') throw new Error('content must be a string');
    const phaseBytes = Buffer.byteLength(content, 'utf8');
    if (phaseBytes > MAX_PHASE_BYTES) {
      throw new Error(
        `Phase content is ${phaseBytes} bytes; max is ${MAX_PHASE_BYTES} bytes (256 KB).`
      );
    }
    const cycle = this.readCycle(id);
    if (!cycle) throw new Error(`Cycle not found: ${id}`);
    cycle.phases[phase] = content;
    const totalBytes = PHASE_ORDER.reduce(
      (sum, p) => sum + Buffer.byteLength(cycle.phases[p], 'utf8'),
      0
    );
    if (totalBytes > MAX_CYCLE_BYTES) {
      throw new Error(
        `Cycle total content is ${totalBytes} bytes; max is ${MAX_CYCLE_BYTES} bytes (1 MB).`
      );
    }
    cycle.modified = new Date().toISOString();
    cycle.filledPhases = PHASE_ORDER.filter((p) => cycle.phases[p].trim().length > 0);
    const lastFilled = cycle.filledPhases[cycle.filledPhases.length - 1];
    if (lastFilled) {
      const nextIdx = Math.min(PHASE_ORDER.indexOf(lastFilled) + 1, PHASE_ORDER.length - 1);
      cycle.currentPhase = PHASE_ORDER[nextIdx];
    }
    this.writeCycle(cycle);
    return cycle;
  }

  deleteCycle(id: string): boolean {
    if (!this.isValidId(id)) return false;
    const filePath = this.cyclePath(id);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  pickJournalDir(picked: string): LMMSettings {
    const sanitized = this.sanitizeDir(picked);
    if (!sanitized) throw new Error(`Invalid directory: ${picked}`);
    const next: LMMSettings = { ...this.settings, journalDir: sanitized };
    this.ensureDir(next.journalDir);
    this.writeSettings(next);
    this.settings = next;
    return { ...this.settings };
  }

  private isValidId(id: unknown): id is string {
    return typeof id === 'string' && ID_PATTERN.test(id);
  }

  // --- internals ---

  private cyclePath(id: string): string {
    if (!this.isValidId(id)) throw new Error(`Invalid cycle id: ${id}`);
    const dir = path.resolve(this.settings.journalDir);
    const target = path.resolve(dir, `${id}.lmm.md`);
    if (path.dirname(target) !== dir) {
      throw new Error(`Cycle id escapes journal directory: ${id}`);
    }
    return target;
  }

  private readSettings(): LMMSettings {
    const defaults: LMMSettings = {
      enabled: false,
      journalDir: path.join(app.getPath('userData'), DEFAULT_DIR_NAME),
      variant: 'quick',
    };
    let raw: string;
    try {
      raw = fs.readFileSync(this.settingsPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
      throw e;
    }
    let parsed: Partial<LMMSettings>;
    try {
      parsed = JSON.parse(raw) as Partial<LMMSettings>;
    } catch (e) {
      throw new Error(
        `Refusing to use ${this.settingsPath}: not valid JSON (${(e as Error).message}). ` +
          `Fix the file or delete it to restore defaults.`
      );
    }
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
      journalDir:
        typeof parsed.journalDir === 'string' && parsed.journalDir.length > 0
          ? parsed.journalDir
          : defaults.journalDir,
      variant: parsed.variant === 'deep' ? 'deep' : 'quick',
    };
  }

  private writeSettings(next: LMMSettings): void {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    const tmp = this.settingsPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, this.settingsPath);
  }

  private readCycle(id: string): LMMCycle | null {
    if (!this.isValidId(id)) return null;
    let target: string;
    try {
      target = this.cyclePath(id);
    } catch {
      return null;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    if (stat.size > MAX_CYCLE_FILE_BYTES) return null;
    let raw: string;
    try {
      raw = fs.readFileSync(target, 'utf8');
    } catch {
      return null;
    }
    try {
      return parseCycle(id, raw);
    } catch {
      return null;
    }
  }

  private writeCycle(cycle: LMMCycle): void {
    this.ensureDir(this.settings.journalDir);
    const content = serializeCycle(cycle);
    const target = this.cyclePath(cycle.id);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
  }

  private ensureDir(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore — operations will fail visibly if dir is unwritable
    }
  }

  private sanitizeDir(input: string): string | null {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (process.platform === 'win32' && /^[\\/][\\/]/.test(trimmed)) return null;
    try {
      const resolved = path.resolve(trimmed);
      fs.mkdirSync(resolved, { recursive: true });
      return resolved;
    } catch {
      return null;
    }
  }
}

function summary(cycle: LMMCycle): LMMCycleSummary {
  return {
    id: cycle.id,
    title: cycle.title,
    created: cycle.created,
    modified: cycle.modified,
    currentPhase: cycle.currentPhase,
    filledPhases: cycle.filledPhases,
  };
}

function makeSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || `cycle-${Date.now()}`;
}

function serializeCycle(cycle: LMMCycle): string {
  const fm = [
    '---',
    `id: ${cycle.id}`,
    `title: ${JSON.stringify(cycle.title)}`,
    `created: ${cycle.created}`,
    `modified: ${cycle.modified}`,
    `currentPhase: ${cycle.currentPhase}`,
    `filledPhases: [${cycle.filledPhases.join(', ')}]`,
    '---',
    '',
    `# ${cycle.title}`,
    '',
  ].join('\n');

  const body = PHASE_ORDER.map((p) => {
    const content = cycle.phases[p].trim();
    return `## ${PHASE_LABEL[p]}\n\n${content || '_(empty)_'}\n`;
  }).join('\n');

  return fm + body + '\n';
}

function parseCycle(id: string, raw: string): LMMCycle {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  let title = id;
  let created = new Date(0).toISOString();
  let modified = created;
  let currentPhase: LMMPhase = 'raw';
  let body = raw;

  if (fmMatch) {
    body = fmMatch[2];
    for (const line of fmMatch[1].split('\n')) {
      const [k, ...rest] = line.split(':');
      if (!k) continue;
      const v = rest.join(':').trim();
      if (k.trim() === 'title') {
        try {
          title = JSON.parse(v);
        } catch {
          title = v;
        }
      } else if (k.trim() === 'created') {
        created = v;
      } else if (k.trim() === 'modified') {
        modified = v;
      } else if (k.trim() === 'currentPhase' && isPhase(v)) {
        currentPhase = v;
      }
    }
  }

  const phases = { raw: '', nodes: '', reflect: '', synth: '' };
  for (const phase of PHASE_ORDER) {
    const heading = PHASE_LABEL[phase];
    const re = new RegExp(
      `## ${escapeRegex(heading)}\\n\\n([\\s\\S]*?)(?=\\n## Phase \\d:|$)`
    );
    const m = body.match(re);
    if (m) {
      const content = m[1].replace(/\n+$/, '');
      phases[phase] = content === '_(empty)_' ? '' : content;
    }
  }

  const filledPhases = PHASE_ORDER.filter((p) => phases[p].trim().length > 0);

  return {
    id,
    title,
    created,
    modified,
    currentPhase,
    filledPhases,
    phases,
  };
}

function isPhase(v: string): v is LMMPhase {
  return v === 'raw' || v === 'nodes' || v === 'reflect' || v === 'synth';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const LMM_PHASE_ORDER = PHASE_ORDER;
export const LMM_PHASE_LABEL = PHASE_LABEL;
export type { LMMVariant };
