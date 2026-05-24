import { app } from 'electron';
import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

let pty: typeof import('node-pty') | null = null;
try {
  pty = require('node-pty');
} catch {
  // node-pty not available — fall back to child_process
}

export class PtyManager extends EventEmitter {
  private ptyProcess: import('node-pty').IPty | null = null;
  private childProcess: ChildProcess | null = null;
  private _pid: number = 0;
  private _usingPty: boolean = false;
  private _cwd: string = '';

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

  spawn(cwd?: string): void {
    const claudePath = this.findClaudePath();
    const workDir = cwd || os.homedir();
    this._cwd = workDir;

    if (pty) {
      this.spawnWithPty(claudePath, workDir);
    } else {
      this.spawnWithChildProcess(claudePath, workDir);
    }
  }

  private spawnWithPty(claudePath: string, cwd: string): void {
    this.ptyProcess = pty!.spawn(claudePath, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env } as Record<string, string>,
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
    });
  }

  private spawnWithChildProcess(claudePath: string, cwd: string): void {
    this.childProcess = spawn(claudePath, [], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
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
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows);
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
    // In packaged builds, the NSIS bootstrap installer (Phase 4) writes the
    // bundled Claude CLI to resources/runtime/claude.cmd alongside a private
    // Node 22 runtime. Prefer that location so users get a working terminal
    // without needing `claude` on system PATH — that "manual prereq install"
    // step was the main UX hole that v1.1 closes.
    //
    // If the bundled runtime is missing (corrupt install, bootstrap failed
    // mid-install, user manually deleted runtime/), fall through to the
    // legacy candidates rather than throwing — a degraded "use system claude"
    // experience is strictly better than a hard failure.
    //
    // Dev mode (!app.isPackaged) skips the bundled check entirely:
    // process.resourcesPath in dev points at Electron's own resources, not
    // ours, so the path would never resolve. Dev uses PATH like before.
    if (app.isPackaged) {
      const bundled = path.join(process.resourcesPath, 'runtime', 'claude.cmd');
      if (fs.existsSync(bundled)) return bundled;
      // Also try .exe in case Phase 4 produces a single-file launcher
      // (electron-builder NSIS scripts may use either; we accept both).
      const bundledExe = path.join(process.resourcesPath, 'runtime', 'claude.exe');
      if (fs.existsSync(bundledExe)) return bundledExe;
    }

    // Legacy + dev fallback.
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
