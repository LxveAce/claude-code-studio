import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ModelDefinition, ModelRegistryState } from '../shared/types';

/**
 * ModelRegistry — persistent catalog of models the user can launch.
 *
 * v3.0 multi-model scaffold (see BACKLOG.md ★ section). At this stage
 * the registry only stores definitions; actual pane launch + local-
 * model download flows are separate follow-ups. Other services will
 * eventually consume:
 *   - PaneSpawner: looks up command + args by model id
 *   - LocalModelDownloader: handles the download URL + SHA verify
 *   - Auth service: stores per-provider credentials
 *
 * Storage: <userData>/model-registry.json. Seeded with one known model
 * on first run (Anthropic Claude — what the app already supports).
 *
 * Privacy: the registry stores ONLY model definitions (id, command,
 * URL). It does NOT store API keys / tokens — those go in the per-
 * provider auth flow (existing GitHubService / AuthService pattern).
 */

const REGISTRY_FILE = 'model-registry.json';

const DEFAULT_SEED: ModelDefinition[] = [
  {
    id: 'anthropic.claude',
    name: 'Claude (Anthropic)',
    description:
      'Anthropic\'s Claude Code CLI. The default model the app shipped with.',
    category: 'api',
    provider: 'Anthropic',
    command: 'claude',
  },
  // Stub entries that demonstrate the local-model shape. They are NOT
  // downloadable yet — the download/launch flows haven't been built.
  // Listed so the catalog UI shows a "Local Models" tab with content
  // and so the registry schema gets exercised in the wild.
  {
    id: 'local.ollama-llama-3.1-8b',
    name: 'Llama 3.1 8B (via Ollama)',
    description:
      'Meta\'s Llama 3.1 8B instruct model, run locally through Ollama. ' +
      'Requires Ollama already installed on PATH; future versions will ' +
      'install it for you (~5 GB).',
    category: 'local',
    provider: 'Ollama',
    command: 'ollama',
    args: ['run', 'llama3.1:8b'],
    download: {
      // Ollama handles its own model storage; this URL points at the
      // model manifest documentation for now. Real download wiring is
      // a v3.0 follow-up.
      url: 'https://ollama.com/library/llama3.1',
      sha256: 'pending-real-flow',
      archiveType: 'raw',
      sizeBytes: 4_700_000_000,
    },
  },
];

export class ModelRegistry {
  private static _instance: ModelRegistry | null = null;
  static instance(): ModelRegistry {
    if (!this._instance) this._instance = new ModelRegistry();
    return this._instance;
  }

  private storePath: string;
  private state: ModelRegistryState;

  private constructor() {
    this.storePath = path.join(app.getPath('userData'), REGISTRY_FILE);
    this.state = this.read();
  }

  list(): ModelDefinition[] {
    return [...this.state.models];
  }

  listByCategory(category: ModelDefinition['category']): ModelDefinition[] {
    return this.state.models.filter((m) => m.category === category);
  }

  get(id: string): ModelDefinition | null {
    return this.state.models.find((m) => m.id === id) ?? null;
  }

  add(model: ModelDefinition): ModelRegistryState {
    if (this.get(model.id)) {
      throw new Error(`Model id already registered: ${model.id}`);
    }
    this.state.models.push(model);
    this.touch();
    return this.snapshot();
  }

  update(id: string, patch: Partial<ModelDefinition>): ModelRegistryState {
    const idx = this.state.models.findIndex((m) => m.id === id);
    if (idx < 0) throw new Error(`Model not found: ${id}`);
    // id + category are immutable post-registration — patching them
    // would break references from open panes / auth records.
    const { id: _id, category: _cat, ...allowed } = patch;
    void _id; void _cat;
    this.state.models[idx] = { ...this.state.models[idx], ...allowed };
    this.touch();
    return this.snapshot();
  }

  remove(id: string): ModelRegistryState {
    this.state.models = this.state.models.filter((m) => m.id !== id);
    this.touch();
    return this.snapshot();
  }

  /** Reset to the default seed — useful for testing + recovery. */
  resetToSeed(): ModelRegistryState {
    this.state = {
      models: DEFAULT_SEED.map((m) => ({ ...m })),
      updatedAt: new Date().toISOString(),
    };
    this.write();
    return this.snapshot();
  }

  snapshot(): ModelRegistryState {
    return {
      models: this.state.models.map((m) => ({ ...m })),
      updatedAt: this.state.updatedAt,
    };
  }

  // --- internals ---

  private read(): ModelRegistryState {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.models)) {
        return {
          models: parsed.models.filter(isValidDefinition),
          updatedAt:
            typeof parsed.updatedAt === 'string'
              ? parsed.updatedAt
              : new Date().toISOString(),
        };
      }
    } catch {
      // missing file or parse error — fall through to seed
    }
    const seeded: ModelRegistryState = {
      models: DEFAULT_SEED.map((m) => ({ ...m })),
      updatedAt: new Date().toISOString(),
    };
    try {
      this.writeRaw(seeded);
    } catch {
      // first-run write failure is non-fatal; runtime state is correct
    }
    return seeded;
  }

  private touch(): void {
    this.state.updatedAt = new Date().toISOString();
    this.write();
  }

  private write(): void {
    this.writeRaw(this.state);
  }

  private writeRaw(state: ModelRegistryState): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify(state, null, 2));
    } catch {
      // persistence failure is non-fatal; UI state still updated
    }
  }
}

function isValidDefinition(m: unknown): m is ModelDefinition {
  if (!m || typeof m !== 'object') return false;
  const obj = m as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    (obj.category === 'api' || obj.category === 'local') &&
    typeof obj.provider === 'string' &&
    typeof obj.command === 'string'
  );
}
