import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Snippet } from '../shared/types';

const STORE_FILE = 'snippets.json';
const MAX_SNIPPETS = 500;
const MAX_NAME_LEN = 120;
const MAX_BODY_BYTES = 64 * 1024; // 64 KB per snippet

interface SnippetStore {
  snippets: Snippet[];
}

export class SnippetsService {
  private storePath: string;
  private store: SnippetStore;

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.store = this.read();
  }

  list(): Snippet[] {
    return this.store.snippets
      .slice()
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  create(input: { name: string; body: string }): Snippet {
    const name = this.requireName(input.name);
    const body = this.requireBody(input.body);
    if (this.store.snippets.length >= MAX_SNIPPETS) {
      throw new Error(`Snippet limit reached (${MAX_SNIPPETS})`);
    }
    const now = new Date().toISOString();
    const snippet: Snippet = {
      id: crypto.randomUUID(),
      name,
      body,
      createdAt: now,
      modifiedAt: now,
    };
    this.store.snippets.push(snippet);
    this.write();
    return snippet;
  }

  update(id: string, patch: { name?: string; body?: string }): Snippet {
    const idx = this.findIndex(id);
    const current = this.store.snippets[idx];
    const next: Snippet = { ...current };
    if (patch.name !== undefined) next.name = this.requireName(patch.name);
    if (patch.body !== undefined) next.body = this.requireBody(patch.body);
    next.modifiedAt = new Date().toISOString();
    this.store.snippets[idx] = next;
    this.write();
    return next;
  }

  delete(id: string): boolean {
    const idx = this.findIndexOrNull(id);
    if (idx === null) return false;
    this.store.snippets.splice(idx, 1);
    this.write();
    return true;
  }

  // --- internals ---

  private requireName(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Snippet name must be a string');
    const trimmed = value.trim();
    if (!trimmed) throw new Error('Snippet name cannot be empty');
    if (trimmed.length > MAX_NAME_LEN) {
      throw new Error(`Snippet name must be ${MAX_NAME_LEN} characters or fewer`);
    }
    return trimmed;
  }

  private requireBody(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Snippet body must be a string');
    if (!value) throw new Error('Snippet body cannot be empty');
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_BODY_BYTES) {
      throw new Error(`Snippet body is ${bytes} bytes; max is ${MAX_BODY_BYTES} bytes (64 KB)`);
    }
    return value;
  }

  private findIndex(id: string): number {
    const idx = this.findIndexOrNull(id);
    if (idx === null) throw new Error(`Snippet not found: ${id}`);
    return idx;
  }

  private findIndexOrNull(id: string): number | null {
    if (typeof id !== 'string') return null;
    const i = this.store.snippets.findIndex((s) => s.id === id);
    return i === -1 ? null : i;
  }

  private read(): SnippetStore {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { snippets: [] };
      throw new Error(
        `Refusing to use ${this.storePath}: ${(e as Error).message}. Fix or delete the file.`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `Refusing to use ${this.storePath}: not valid JSON (${(e as Error).message}).`
      );
    }
    if (!parsed || typeof parsed !== 'object') return { snippets: [] };
    const arr = (parsed as { snippets?: unknown }).snippets;
    if (!Array.isArray(arr)) return { snippets: [] };
    const valid: Snippet[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const s = item as Record<string, unknown>;
      if (typeof s.id !== 'string' || s.id.length === 0) continue;
      if (typeof s.name !== 'string') continue;
      if (typeof s.body !== 'string') continue;
      const createdAt = typeof s.createdAt === 'string' ? s.createdAt : new Date(0).toISOString();
      const modifiedAt = typeof s.modifiedAt === 'string' ? s.modifiedAt : createdAt;
      if (Buffer.byteLength(s.body, 'utf8') > MAX_BODY_BYTES) continue;
      if (s.name.length > MAX_NAME_LEN) continue;
      valid.push({ id: s.id, name: s.name, body: s.body, createdAt, modifiedAt });
    }
    return { snippets: valid.slice(0, MAX_SNIPPETS) };
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2), { mode: 0o600 });
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
