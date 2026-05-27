import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Persists the "have we shown the first-run model picker?" flag separately
 * from cli-onboarding so users who already completed the Claude-CLI
 * onboarding still see the model picker the first time they launch a
 * v3.0 build. Storage: <userData>/models-onboarding.json.
 *
 * Three states the UI cares about:
 *   - never shown        → show the picker
 *   - dismissed/skipped  → don't reshow, but allow reopen from the panel
 *   - completed (pulled) → don't reshow
 */

export type ModelsOnboardingOutcome = 'skipped' | 'completed';

export interface ModelsOnboardingState {
  shown: boolean;
  outcome: ModelsOnboardingOutcome | null;
  completedAt: string | null;
}

const STORE_FILE = 'models-onboarding.json';

export class FirstRunService {
  private static _instance: FirstRunService | null = null;
  static instance(): FirstRunService {
    if (!this._instance) this._instance = new FirstRunService();
    return this._instance;
  }

  private storePath: string;
  private state: ModelsOnboardingState;

  private constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.state = this.read();
  }

  get(): ModelsOnboardingState {
    return { ...this.state };
  }

  /** Mark the picker as shown so a future launch doesn't auto-open it. */
  markShown(outcome: ModelsOnboardingOutcome): ModelsOnboardingState {
    this.state = {
      shown: true,
      outcome,
      completedAt: new Date().toISOString(),
    };
    this.write();
    return this.get();
  }

  /** Reset (for testing / "reopen first-run picker" debug action). */
  reset(): ModelsOnboardingState {
    this.state = { shown: false, outcome: null, completedAt: null };
    this.write();
    return this.get();
  }

  private read(): ModelsOnboardingState {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          shown: parsed.shown === true,
          outcome:
            parsed.outcome === 'skipped' || parsed.outcome === 'completed'
              ? parsed.outcome
              : null,
          completedAt:
            typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
        };
      }
    } catch {
      // missing or malformed — fall through to defaults
    }
    return { shown: false, outcome: null, completedAt: null };
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify(this.state, null, 2));
    } catch {
      // persistence failure is non-fatal; runtime flag is correct in-memory
    }
  }
}
