import { EventEmitter } from 'events';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * OllamaService — thin wrapper around the local `ollama` CLI.
 *
 * Owns:
 *   - probing whether Ollama is installed (CLI on PATH or in well-known dirs)
 *   - listing installed models (`ollama list --json` when supported, falls
 *     back to parsing the text table for older builds)
 *   - pulling a model with streaming progress (parsed line-by-line)
 *   - deleting an installed model
 *
 * Does NOT own:
 *   - launching a model — that's the PtyRegistry / spawnArgs flow
 *   - the daemon lifecycle — Ollama's installer registers the service itself
 *
 * Why CLI not HTTP API: simpler, no port juggling, survives daemon restarts,
 * and the CLI's progress output is already line-buffered which makes streaming
 * trivial. The 11434 HTTP API is fine but adds a moving part we don't need.
 *
 * All inputs that flow into `ollama <subcommand> <name>` are validated against
 * a strict regex (lowercase alnum + `:_./-`) — Ollama's own naming rules are
 * narrower than that so this is a conservative defense.
 */

export interface OllamaInstalledModel {
  name: string;
  /** Hash or digest from Ollama's manifest store. May be short or long form. */
  id: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface OllamaVersionInfo {
  installed: boolean;
  cliPath: string | null;
  version: string | null;
  /** True if `ollama list` succeeded — implies daemon is reachable. */
  daemonReachable: boolean;
  /** Stable, UI-friendly reason when installed=false. */
  reason: 'not-found' | 'daemon-unreachable' | 'ok' | 'unknown-error';
  lastError: string | null;
}

export interface OllamaPullProgressEvent {
  modelName: string;
  /** 0-100 when measurable, null when Ollama is still resolving manifest. */
  percent: number | null;
  /** e.g. "pulling manifest", "pulling sha256:...", "verifying digest". */
  status: string;
  /** Bytes-downloaded if reported in this line. */
  bytesCompleted: number | null;
  bytesTotal: number | null;
}

const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._:/\-]{0,127}$/i;

function assertValidModelName(name: string): void {
  if (typeof name !== 'string' || !MODEL_NAME_RE.test(name)) {
    throw new Error(`Invalid Ollama model name: ${String(name)}`);
  }
}

function locateOllamaCli(): string | null {
  // Honor explicit override first — useful for tests / non-standard installs.
  const envOverride = process.env.CCS_OLLAMA_PATH;
  if (envOverride && fs.existsSync(envOverride)) return envOverride;

  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const lad = process.env.LOCALAPPDATA;
    if (lad) candidates.push(path.join(lad, 'Programs', 'Ollama', 'ollama.exe'));
    const pf = process.env['ProgramFiles'];
    if (pf) candidates.push(path.join(pf, 'Ollama', 'ollama.exe'));
    candidates.push('ollama.exe');
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Ollama.app/Contents/Resources/ollama');
    candidates.push('/usr/local/bin/ollama');
    candidates.push('/opt/homebrew/bin/ollama');
    candidates.push(path.join(os.homedir(), '.ollama', 'bin', 'ollama'));
    candidates.push('ollama');
  } else {
    candidates.push('/usr/local/bin/ollama');
    candidates.push('/usr/bin/ollama');
    candidates.push(path.join(os.homedir(), '.local', 'bin', 'ollama'));
    candidates.push('ollama');
  }

  for (const c of candidates) {
    if (c === 'ollama' || c === 'ollama.exe') {
      // Defer to PATH lookup — try a no-op exec; if it works we treat the
      // bare name as the resolved path.
      const probe = spawnSync(c, ['--version'], { timeout: 3000 });
      if (probe.status === 0) return c;
      continue;
    }
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // permission errors etc. — keep scanning
    }
  }
  return null;
}

export class OllamaService extends EventEmitter {
  private static _instance: OllamaService | null = null;
  static instance(): OllamaService {
    if (!this._instance) this._instance = new OllamaService();
    return this._instance;
  }

  /** Cached version probe; first call populates, callers can force-refresh. */
  private cachedVersion: OllamaVersionInfo | null = null;
  /** Active pulls keyed by model name — used so callers can cancel. */
  private activePulls = new Map<string, ChildProcess>();

  async getVersion(force = false): Promise<OllamaVersionInfo> {
    if (!force && this.cachedVersion) return this.cachedVersion;

    const cliPath = locateOllamaCli();
    if (!cliPath) {
      const info: OllamaVersionInfo = {
        installed: false,
        cliPath: null,
        version: null,
        daemonReachable: false,
        reason: 'not-found',
        lastError: null,
      };
      this.cachedVersion = info;
      return info;
    }

    let version: string | null = null;
    let lastError: string | null = null;
    try {
      const probe = spawnSync(cliPath, ['--version'], { timeout: 5000 });
      const out = String(probe.stdout || '') + String(probe.stderr || '');
      const m = out.match(/(\d+\.\d+\.\d+)/);
      if (m) version = m[1];
      if (probe.status !== 0 && !version) {
        lastError = out.trim() || `exit ${probe.status}`;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }

    let daemonReachable = false;
    try {
      const list = spawnSync(cliPath, ['list'], { timeout: 8000 });
      daemonReachable = list.status === 0;
      if (!daemonReachable && !lastError) {
        lastError = String(list.stderr || '').trim();
      }
    } catch (e) {
      lastError = lastError ?? (e instanceof Error ? e.message : String(e));
    }

    const info: OllamaVersionInfo = {
      installed: true,
      cliPath,
      version,
      daemonReachable,
      reason: daemonReachable ? 'ok' : 'daemon-unreachable',
      lastError,
    };
    this.cachedVersion = info;
    return info;
  }

  async listInstalled(): Promise<OllamaInstalledModel[]> {
    const v = await this.getVersion();
    if (!v.installed || !v.cliPath) return [];

    // `ollama list` text format:
    //   NAME              ID            SIZE    MODIFIED
    //   llama3.1:8b       42b1c...      4.7 GB  2 days ago
    // Newer builds support `ollama list --format=json` but we can't rely on
    // that. Parse the text — first column is name, last 2 cols are size + age.
    const r = spawnSync(v.cliPath, ['list'], { timeout: 10000, encoding: 'utf8' });
    if (r.status !== 0) return [];
    const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return [];
    // Skip header
    const dataLines = lines[0].toLowerCase().includes('name') ? lines.slice(1) : lines;
    const out: OllamaInstalledModel[] = [];
    for (const line of dataLines) {
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length < 4) continue;
      const [name, id, sizeStr, modifiedAt] = parts;
      out.push({
        name,
        id,
        sizeBytes: parseHumanSize(sizeStr),
        modifiedAt,
      });
    }
    return out;
  }

  isPulling(name: string): boolean {
    return this.activePulls.has(name);
  }

  /**
   * Start an `ollama pull <name>`. Returns an EventEmitter that emits:
   *   - 'progress' (OllamaPullProgressEvent)
   *   - 'done' ()
   *   - 'error' (Error)
   *
   * Caller is responsible for adding listeners synchronously after this call.
   * Use cancelPull(name) to stop in flight.
   */
  startPull(name: string): EventEmitter {
    assertValidModelName(name);
    const v = this.cachedVersion;
    if (!v?.installed || !v.cliPath) {
      throw new Error('Ollama is not installed.');
    }
    if (this.activePulls.has(name)) {
      throw new Error(`Pull already in progress: ${name}`);
    }

    const ee = new EventEmitter();
    const child = spawn(v.cliPath, ['pull', name], {
      // Inherit env so the daemon's settings (OLLAMA_MODELS etc.) work.
      env: process.env,
      // Don't use a shell — args are validated; shell would just add risk.
      shell: false,
    });
    this.activePulls.set(name, child);

    const handleLine = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      // Sample lines:
      //   pulling manifest
      //   pulling 42b1c...   23% ▕████░░░░░░░░░░░░▏ 1.1 GB/4.7 GB
      //   verifying sha256 digest
      //   writing manifest
      //   success
      const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
      const bytesMatch = line.match(/([\d.]+\s*[KMGT]?B)\s*\/\s*([\d.]+\s*[KMGT]?B)/i);
      const status = line.split(/\s{2,}|\t/)[0] || line;
      const ev: OllamaPullProgressEvent = {
        modelName: name,
        percent: percentMatch ? Math.max(0, Math.min(100, parseFloat(percentMatch[1]))) : null,
        status,
        bytesCompleted: bytesMatch ? parseHumanSize(bytesMatch[1]) : null,
        bytesTotal: bytesMatch ? parseHumanSize(bytesMatch[2]) : null,
      };
      ee.emit('progress', ev);
    };

    let stdoutBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        handleLine(stdoutBuf.slice(0, nl));
        stdoutBuf = stdoutBuf.slice(nl + 1);
      }
    });
    let stderrBuf = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      // Ollama prints progress to stderr in some versions — treat both.
      stderrBuf += chunk.toString('utf8');
      let nl: number;
      while ((nl = stderrBuf.indexOf('\n')) >= 0) {
        handleLine(stderrBuf.slice(0, nl));
        stderrBuf = stderrBuf.slice(nl + 1);
      }
    });

    child.on('error', (err) => {
      this.activePulls.delete(name);
      ee.emit('error', err);
    });
    child.on('exit', (code) => {
      this.activePulls.delete(name);
      if (code === 0) ee.emit('done');
      else ee.emit('error', new Error(`ollama pull exited with code ${code}`));
    });

    return ee;
  }

  cancelPull(name: string): boolean {
    const child = this.activePulls.get(name);
    if (!child) return false;
    try {
      child.kill();
    } catch {
      // best-effort
    }
    return true;
  }

  async delete(name: string): Promise<{ ok: boolean; error: string | null }> {
    assertValidModelName(name);
    const v = await this.getVersion();
    if (!v.installed || !v.cliPath) {
      return { ok: false, error: 'Ollama is not installed.' };
    }
    const r = spawnSync(v.cliPath, ['rm', name], { timeout: 15000, encoding: 'utf8' });
    if (r.status === 0) return { ok: true, error: null };
    const err = String(r.stderr || r.stdout || '').trim() || `exit ${r.status}`;
    return { ok: false, error: err };
  }
}

/** Parse "1.1 GB", "470 MB", "4096" → bytes. Returns 0 on parse failure. */
function parseHumanSize(s: string): number {
  const m = String(s).trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
  if (!m) {
    const direct = parseInt(s, 10);
    return Number.isFinite(direct) ? direct : 0;
  }
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'B').toUpperCase();
  const mul: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  return Math.round(n * (mul[unit] ?? 1));
}
