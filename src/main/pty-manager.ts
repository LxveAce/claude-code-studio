import { app } from 'electron';
import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { findBundledRuntime } from './runtime-paths';
import { readCliFlags } from './cli-flags';
import { resolveCommandPath, explainResolution } from './cli-resolver';

let pty: typeof import('node-pty') | null = null;
try {
  pty = require('node-pty');
} catch {
  // node-pty not available — fall back to child_process
}

/**
 * Optional spawn overrides used by the multi-model launch flow.
 * When omitted, PtyManager spawns the bundled `claude` CLI as before —
 * existing terminal-pane flows are unchanged.
 */
export interface PtySpawnOpts {
  /** argv[0]. Defaults to the bundled/resolved `claude` binary. */
  command?: string;
  /** argv[1..]. Defaults to []. */
  args?: string[];
  /** Extra env to merge on top of process.env. */
  env?: Record<string, string>;
  /** Human-readable label for logs (e.g. "Qwen2.5 Coder 7B"). */
  label?: string;
}

export class PtyManager extends EventEmitter {
  private ptyProcess: import('node-pty').IPty | null = null;
  private childProcess: ChildProcess | null = null;
  private _pid: number = 0;
  private _usingPty: boolean = false;
  private _cwd: string = '';
  private _commandLine: string = '';

  get pid(): number {
    return this._pid;
  }

  get usingPty(): boolean {
    return this._usingPty;
  }

  /** Best-effort cwd we launched with — empty until `spawn()` succeeds. */
  get cwd(): string {
    return this._cwd;
  }

  /** Resolved command-line, e.g. "ollama run qwen2.5-coder:7b". */
  get commandLine(): string {
    return this._commandLine;
  }

  spawn(cwd?: string, opts?: PtySpawnOpts): void {
    const rawCommand = opts?.command ?? this.findClaudePath();
    let args = opts?.args ?? [];
    // Claude-only auto-flags. When opts.command is unset (the default
    // terminal flow that spawns the bundled claude CLI), respect the
    // user-toggled flags from cli-flags.json. Model PTYs (opts.command
    // explicitly set) are never modified — those use the model's verbatim
    // command + args from ModelDefinition.
    if (!opts?.command) {
      const flags = readCliFlags();
      if (flags.dangerouslySkipPermissions) {
        args = ['--dangerously-skip-permissions', ...args];
      }
    }
    // Resolve the command to an absolute path when possible. Critical on
    // Windows: node-pty's spawn does CreateProcess directly (no shell),
    // so a bare 'ollama' fails to find ollama.exe. cli-resolver checks
    // well-known install dirs + where.exe before falling back to the
    // bare name. Claude paths returned by findClaudePath are already
    // absolute when bundled-runtime is found; for the 'claude' fallback,
    // this resolver helps if the user has a system claude install.
    const command = resolveCommandPath(rawCommand);
    if (command !== rawCommand) {
      // Print to stderr so --enable-logging captures the resolution trace.
      // Non-fatal — successful resolution.
      try {
        process.stderr.write(`[pty-manager] ${explainResolution(rawCommand)}\n`);
      } catch {
        // ignore
      }
    } else if (process.platform === 'win32' && !command.includes('.') && command !== 'claude') {
      // Bare command name on Windows that didn't resolve — likely to fail.
      // Surface a diagnostic before spawn so the user (or log) can see why.
      try {
        process.stderr.write(`[pty-manager] WARNING: ${explainResolution(rawCommand)}\n`);
      } catch {
        // ignore
      }
    }
    const workDir = cwd || os.homedir();
    this._cwd = workDir;
    this._commandLine = [command, ...args].join(' ');
    const env = { ...process.env, ...(opts?.env ?? {}) } as Record<string, string>;

    if (pty) {
      this.spawnWithPty(command, args, workDir, env);
    } else {
      this.spawnWithChildProcess(command, args, workDir, env);
    }
  }

  private spawnWithPty(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>
  ): void {
    this.ptyProcess = pty!.spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env,
    });

    this._pid = this.ptyProcess.pid;
    this._usingPty = true;
    this.emit('ready', this._pid);

    this.ptyProcess.onData((data) => {
      this.emit('data', data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', exitCode);
      this._pid = 0;
      // Clear the handle so subsequent write/resize calls (which can be
      // triggered by lagging ResizeObserver / panel re-flow events from the
      // renderer) short-circuit instead of calling into node-pty and
      // throwing "Cannot resize a pty that has already exited", which
      // surfaces as a JavaScript-error modal in the main process.
      this.ptyProcess = null;
    });
  }

  private spawnWithChildProcess(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>
  ): void {
    this.childProcess = spawn(command, args, {
      cwd,
      env: { ...env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._pid = this.childProcess.pid || 0;
    this._usingPty = false;
    this.emit('ready', this._pid);

    this.childProcess.stdout?.on('data', (data: Buffer) => {
      this.emit('data', data.toString());
    });

    this.childProcess.stderr?.on('data', (data: Buffer) => {
      this.emit('data', data.toString());
    });

    this.childProcess.on('exit', (code) => {
      this.emit('exit', code ?? 1);
      this._pid = 0;
      // Symmetric to spawnWithPty: drop the handle so post-exit writes/
      // resizes short-circuit.
      this.childProcess = null;
    });
  }

  write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    } else if (this.childProcess?.stdin) {
      this.childProcess.stdin.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    // Defensive try/catch: even with the ptyProcess=null clear on exit,
    // node-pty can still throw inside resize() if the underlying conpty
    // handle was torn down between the null-check and the call (rare,
    // but observed during fast Claude (Chat) exits — see v4.0.3 fix).
    if (this.ptyProcess) {
      try {
        this.ptyProcess.resize(cols, rows);
      } catch {
        // PTY exited concurrent with this resize — drop the handle and
        // move on.  The user already sees the exit message; a modal
        // error dialog here would just be noise.
        this.ptyProcess = null;
      }
    }
  }

  kill(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
    } else if (this.childProcess) {
      this.childProcess.kill();
    }
    this._pid = 0;
  }

  private findClaudePath(): string {
    // In packaged builds, prefer the bundled runtime installed by either:
    //   - Phase 4 NSIS bootstrap (Windows, at resources/runtime/), or
    //   - First-launch in-app bootstrap (macOS/Linux, at <userData>/runtime/),
    //     also used as Windows soft-fail recovery.
    // runtime-paths.ts handles per-platform path resolution.
    if (app.isPackaged) {
      const bundled = findBundledRuntime();
      if (bundled) return bundled.claudeBin;
      // Bundled is missing (corrupt install, bootstrap failed mid-install,
      // user manually deleted runtime/) — fall through to system PATH so
      // a user with their own claude install still gets a working terminal.
    }

    // Legacy + dev fallback. ~/.local/bin is a common per-user install
    // location across platforms; bare `claude` resolves via PATH.
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      'claude',
    ];

    for (const candidate of candidates) {
      if (candidate === 'claude') return candidate;
      if (fs.existsSync(candidate)) return candidate;
    }

    return 'claude';
  }
}
