import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Per-machine CLI flag persistence. Tiny standalone module (not in
 * CliService) because PtyManager needs to read it synchronously at spawn
 * time without dragging in the service singleton — PtyManager is
 * instantiated by PtyRegistry which doesn't know about CliService.
 *
 * Current flags:
 *   - dangerouslySkipPermissions: when true, every Claude PTY spawned by
 *     the embedded terminal gets `--dangerously-skip-permissions` injected
 *     as the first arg. This bypasses Claude's per-action permission
 *     prompts (file edits, command execution, etc.) — convenient for
 *     trusted projects, dangerous everywhere else. Default false.
 *     Applies ONLY to Claude PTYs; never to model PTYs spawned via
 *     MODELS_LAUNCH (those use the model's own command + args verbatim).
 */

export interface CliFlags {
  dangerouslySkipPermissions: boolean;
}

const STORE_FILE = 'cli-flags.json';

const DEFAULTS: CliFlags = {
  dangerouslySkipPermissions: false,
};

function storePath(): string {
  return path.join(app.getPath('userData'), STORE_FILE);
}

/** Sync read — safe to call from PtyManager.spawn (no async tax). */
export function readCliFlags(): CliFlags {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CliFlags>;
    return {
      dangerouslySkipPermissions: parsed.dangerouslySkipPermissions === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeCliFlags(flags: Partial<CliFlags>): CliFlags {
  const next: CliFlags = {
    ...readCliFlags(),
    ...sanitizeFlags(flags),
  };
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(next, null, 2));
  } catch {
    // Persistence failure is non-fatal — runtime state still applied for
    // the current session; just won't survive restart.
  }
  return next;
}

function sanitizeFlags(input: Partial<CliFlags>): Partial<CliFlags> {
  const out: Partial<CliFlags> = {};
  if (typeof input.dangerouslySkipPermissions === 'boolean') {
    out.dangerouslySkipPermissions = input.dangerouslySkipPermissions;
  }
  return out;
}
