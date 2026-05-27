import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Cross-platform disk-space probe used by the Models panel to gate "Pull"
 * actions when the user is dangerously close to running out of disk.
 *
 * Uses Node 19+'s `fs.statfs` which works on Windows, macOS, and Linux.
 * Falls back to returning unknown rather than throwing — the UI can still
 * proceed with the pull, the user just doesn't get the early warning.
 */

export interface DiskInfo {
  /** Path the probe was performed on (resolved). */
  path: string;
  freeBytes: number | null;
  totalBytes: number | null;
  /** True if the probe succeeded; false if we returned null fields. */
  ok: boolean;
  error: string | null;
}

/** Where Ollama stores model blobs by default, per its install conventions. */
export function defaultOllamaModelsDir(): string {
  const override = process.env.OLLAMA_MODELS;
  if (override) return override;
  // Windows: %USERPROFILE%\.ollama\models
  // macOS / Linux: ~/.ollama/models
  return path.join(os.homedir(), '.ollama', 'models');
}

export async function probeDisk(target?: string): Promise<DiskInfo> {
  const targetPath = target ?? defaultOllamaModelsDir();
  // statfs needs an existing path. If the Ollama models dir doesn't exist
  // yet (Ollama not installed, or hasn't been run), walk up until we hit
  // one that does — that disk is the relevant one.
  let probe = targetPath;
  while (probe && probe !== path.dirname(probe)) {
    try {
      await fsp.access(probe, fs.constants.F_OK);
      break;
    } catch {
      probe = path.dirname(probe);
    }
  }
  try {
    const stat = await fsp.statfs(probe);
    // statfs returns block-counts; multiply by bsize for bytes. bavail is
    // user-available (excludes root-reserved blocks) — what we actually care
    // about for pull-fit checking.
    const blockSize = (stat as unknown as { bsize: number }).bsize;
    const free = stat.bavail * blockSize;
    const total = stat.blocks * blockSize;
    return {
      path: targetPath,
      freeBytes: free,
      totalBytes: total,
      ok: true,
      error: null,
    };
  } catch (e) {
    return {
      path: targetPath,
      freeBytes: null,
      totalBytes: null,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
