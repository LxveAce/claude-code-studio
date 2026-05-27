import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ModelDefinition,
  ModelRegistryState,
  ModelRecommendation,
  HardwareProfile,
  ProjectFingerprint,
  HardwareTier,
  ModelRole,
} from '../shared/types';
import { MODEL_CATALOG_SEED, ROLE_TIER_DEFAULTS } from './model-catalog-seed';
import { TIER_ORDER, tierMeetsOrExceeds } from './hardware-detection';

/**
 * ModelRegistry — persistent catalog of models the user can launch.
 *
 * The seed catalog lives in model-catalog-seed.ts (33 models as of the
 * May 2026 full-scope expansion). This module owns:
 *   - persistence at <userData>/model-registry.json
 *   - CRUD for user additions/removals
 *   - the recommend() algorithm that ranks models for a given hardware
 *     tier + project fingerprint
 *
 * Privacy: the registry stores ONLY model definitions (id, command, URL).
 * It does NOT store API keys / tokens — those go in the per-provider auth
 * flow (existing GitHubService / AuthService pattern).
 *
 * Seed migration: when the seed catalog evolves between releases (new
 * models, removed ones), the seed version is bumped and the registry will
 * merge new seeded models into the existing user catalog on next launch
 * without clobbering user edits. See `mergeWithSeed()`.
 */

const REGISTRY_FILE = 'model-registry.json';
/** Bump when the seed catalog changes shape or content meaningfully. */
const SEED_VERSION = 2;

interface PersistedShape {
  models: ModelDefinition[];
  updatedAt: string;
  seedVersion?: number;
}

export class ModelRegistry {
  private static _instance: ModelRegistry | null = null;
  static instance(): ModelRegistry {
    if (!this._instance) this._instance = new ModelRegistry();
    return this._instance;
  }

  private storePath: string;
  private state: ModelRegistryState;
  private persistedSeedVersion: number;

  private constructor() {
    this.storePath = path.join(app.getPath('userData'), REGISTRY_FILE);
    const { state, seedVersion } = this.read();
    this.state = state;
    this.persistedSeedVersion = seedVersion;
    // Migrate: if the on-disk seed version is older than the bundled one,
    // merge newly-seeded models in without overwriting user customizations.
    if (this.persistedSeedVersion < SEED_VERSION) {
      this.state = this.mergeWithSeed(this.state);
      this.persistedSeedVersion = SEED_VERSION;
      this.write();
    }
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

  /** Reset to the bundled seed — useful for testing + recovery. */
  resetToSeed(): ModelRegistryState {
    this.state = {
      models: MODEL_CATALOG_SEED.map((m) => ({ ...m })),
      updatedAt: new Date().toISOString(),
    };
    this.persistedSeedVersion = SEED_VERSION;
    this.write();
    return this.snapshot();
  }

  /**
   * Rank models for a hardware tier + project fingerprint.
   *
   * Scoring (additive):
   *   +5  featured + role matches project's top role
   *   +3  any role matches project's roles
   *   +3  featured + tier matches exactly
   *   +2  tier matches exactly (without featured)
   *   +1  tier is below host tier (model fits comfortably)
   *   -3  model requires tier higher than host (won't run well)
   *   -2  license flagged (small penalty — still surfaced but not first)
   *
   * Returns top 12 with reason strings the UI can show as a "why this?"
   * tooltip on each recommendation card.
   */
  recommend(
    hardware: HardwareProfile,
    project: ProjectFingerprint | null
  ): ModelRecommendation[] {
    const scored: ModelRecommendation[] = [];
    const projectRoles = project ? mapProjectRolesToModelRoles(project.roles) : [];
    const primaryProjectRole = projectRoles[0] ?? null;

    for (const m of this.state.models) {
      if (m.category !== 'local') continue; // recommendations only for local
      let score = 0;
      const reasons: string[] = [];

      const tiers = m.hardwareTiers ?? [];
      const fitsHost = tiers.some((t) => tierMeetsOrExceeds(hardware.tier, t));
      const wantsHigherTier = tiers.length > 0 && !fitsHost;

      if (wantsHigherTier) {
        score -= 3;
        reasons.push(`Needs more than ${hardware.tier}`);
      } else if (tiers.includes(hardware.tier)) {
        score += m.featured ? 3 : 2;
        reasons.push(`Tuned for your ${hardware.tier} tier`);
      } else if (fitsHost) {
        score += 1;
        reasons.push(`Fits comfortably on your hardware`);
      }

      const roles = m.roles ?? [];
      if (primaryProjectRole && roles.includes(primaryProjectRole)) {
        score += m.featured ? 5 : 3;
        reasons.push(`Strong for ${primaryProjectRole} work`);
      } else if (projectRoles.some((r) => roles.includes(r))) {
        score += 2;
        reasons.push(`Useful for your project type`);
      }

      if (m.featured) score += 1;
      if (m.licenseFlag) {
        score -= 2;
        reasons.push(`License has commercial-use restrictions`);
      }

      // Defaults table: if this is the curated default for the role+tier
      // combo, give a strong push so it ends up #1.
      if (primaryProjectRole) {
        const defaultId = ROLE_TIER_DEFAULTS[`${primaryProjectRole}:${hardware.tier}`];
        if (defaultId === m.id) {
          score += 4;
          reasons.unshift(`Default pick for ${primaryProjectRole} + ${hardware.tier}`);
        }
      }
      // Even with no project signal, surface the general-chat default first.
      const chatDefault = ROLE_TIER_DEFAULTS[`general-chat:${hardware.tier}`];
      if (chatDefault === m.id && !primaryProjectRole) {
        score += 4;
        reasons.unshift(`Default chat for your ${hardware.tier} tier`);
      }

      // Normalize to 0..1 — max plausible additive score is ~16.
      const normalized = Math.max(0, Math.min(1, score / 16));
      if (score > 0) {
        scored.push({
          modelId: m.id,
          score: normalized,
          reason: reasons.slice(0, 2).join(' · '),
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 12);
  }

  snapshot(): ModelRegistryState {
    return {
      models: this.state.models.map((m) => ({ ...m })),
      updatedAt: this.state.updatedAt,
    };
  }

  // --- internals ---

  private read(): { state: ModelRegistryState; seedVersion: number } {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedShape;
      if (parsed && Array.isArray(parsed.models)) {
        return {
          state: {
            models: parsed.models.filter(isValidDefinition),
            updatedAt:
              typeof parsed.updatedAt === 'string'
                ? parsed.updatedAt
                : new Date().toISOString(),
          },
          seedVersion: typeof parsed.seedVersion === 'number' ? parsed.seedVersion : 0,
        };
      }
    } catch {
      // missing file or parse error — fall through to seed
    }
    const seeded: ModelRegistryState = {
      models: MODEL_CATALOG_SEED.map((m) => ({ ...m })),
      updatedAt: new Date().toISOString(),
    };
    try {
      this.writeRaw({ ...seeded, seedVersion: SEED_VERSION });
    } catch {
      // first-run write failure is non-fatal; runtime state is correct
    }
    return { state: seeded, seedVersion: SEED_VERSION };
  }

  /**
   * Merge bundled seed updates into an existing user catalog. Only adds
   * models the user doesn't already have (matched by id). Never overwrites
   * an existing entry, so user edits to seeded models survive upgrades.
   */
  private mergeWithSeed(state: ModelRegistryState): ModelRegistryState {
    const haveIds = new Set(state.models.map((m) => m.id));
    const additions = MODEL_CATALOG_SEED.filter((m) => !haveIds.has(m.id));
    if (additions.length === 0) return state;
    return {
      models: [...state.models, ...additions.map((m) => ({ ...m }))],
      updatedAt: new Date().toISOString(),
    };
  }

  private touch(): void {
    this.state.updatedAt = new Date().toISOString();
    this.write();
  }

  private write(): void {
    this.writeRaw({ ...this.state, seedVersion: this.persistedSeedVersion });
  }

  private writeRaw(state: PersistedShape): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify(state, null, 2));
    } catch {
      // persistence failure is non-fatal; UI state still updated
    }
  }
}

/**
 * Map project-side roles (frontend/backend/devops/etc.) to catalog-side
 * model roles. They overlap but aren't identical — projects don't have
 * "reasoning" or "vision" as roles; models don't have "devops" as a role.
 *
 * Returns the model roles ranked by the project's role ordering, so the
 * first model role is the project's primary intent.
 */
function mapProjectRolesToModelRoles(projectRoles: ProjectFingerprint['roles']): ModelRole[] {
  const map: Record<string, ModelRole[]> = {
    frontend: ['frontend', 'polyglot-code'],
    backend: ['backend', 'polyglot-code'],
    systems: ['polyglot-code', 'backend'],
    data: ['data', 'reasoning'],
    mobile: ['frontend', 'polyglot-code'],
    devops: ['backend', 'agentic'],
    general: ['general-chat', 'polyglot-code'],
  };
  const out: ModelRole[] = [];
  for (const pr of projectRoles) {
    const mapped = map[pr] ?? ['general-chat'];
    for (const mr of mapped) {
      if (!out.includes(mr)) out.push(mr);
    }
  }
  return out;
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

/** Re-export for callers — keep so the public surface doesn't depend on internal layout. */
export { TIER_ORDER };
