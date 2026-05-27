import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { CliStatus, CliOnboardingState } from '../shared/types';
import { findBundledRuntime, targetRuntimePaths, targetRuntimeRoot } from './runtime-paths';

const execFileAsync = promisify(execFile);

/**
 * Caller-supplied progress sink. CliService streams npm install output
 * line-by-line via this callback so the renderer can show real-time
 * install progress in the onboarding modal.
 */
export type CliInstallProgressSink = (line: string) => void;

const ONBOARDING_FILE = 'cli-onboarding.json';
const ONBOARDING_DEFAULT: CliOnboardingState = {
  complete: false,
  completedAt: null,
};

/** Hard timeout for `claude doctor`. Doctor is normally <2 s; longer means
 * something is wedged. */
const DOCTOR_TIMEOUT_MS = 10000;

/** Hard timeout for the npm install fallback. CLI is ~30 MB; on a slow
 * connection this can legitimately take a couple minutes. */
const NPM_INSTALL_TIMEOUT_MS = 300000;

/** Hard timeout for the Node download + extract. ~30 MB on macOS/Linux. */
const NODE_BOOTSTRAP_TIMEOUT_MS = 300000;

/**
 * Node 22.22.3 per-platform tarball metadata for the in-app first-launch
 * bootstrap (macOS + Linux only — Windows handles this in the NSIS
 * installer at install-time).
 *
 * SHA256s captured 2026-05-24 from
 * https://nodejs.org/dist/v22.22.3/SHASUMS256.txt — re-verify on each
 * Node version bump.
 */
const NODE_VERSION = '22.22.3';
const NODE_DIST_BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;

interface NodeDownload {
  filename: string;
  url: string;
  sha256: string;
  /** Extract command: 'tar-gz', 'tar-xz', or 'zip'. */
  archiveType: 'tar-gz' | 'tar-xz' | 'zip';
  /** Directory inside the archive (gets flattened into runtime/). */
  innerDirName: string;
}

function nodeDownloadFor(platform: NodeJS.Platform, arch: string): NodeDownload | null {
  if (platform === 'darwin' && arch === 'x64') {
    return {
      filename: `node-v${NODE_VERSION}-darwin-x64.tar.gz`,
      url: `${NODE_DIST_BASE}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
      sha256: '45830ba752fa0d892c6dcd640946669801293cac820a33591ded40ac075198ec',
      archiveType: 'tar-gz',
      innerDirName: `node-v${NODE_VERSION}-darwin-x64`,
    };
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      filename: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
      url: `${NODE_DIST_BASE}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
      sha256: '0da7ff74ef8611328c8212f17943368713a2ad953fb7d89a8c8a0eae87c23207',
      archiveType: 'tar-gz',
      innerDirName: `node-v${NODE_VERSION}-darwin-arm64`,
    };
  }
  if (platform === 'linux' && arch === 'x64') {
    return {
      filename: `node-v${NODE_VERSION}-linux-x64.tar.xz`,
      url: `${NODE_DIST_BASE}/node-v${NODE_VERSION}-linux-x64.tar.xz`,
      sha256: '2e5d13569282d016861fae7c8f935e741693c269101a5bebcf761a5376d1f99f',
      archiveType: 'tar-xz',
      innerDirName: `node-v${NODE_VERSION}-linux-x64`,
    };
  }
  // Windows handled by NSIS, not here. Unsupported arches return null.
  return null;
}

/**
 * Surfaces information about the Claude Code CLI on this machine and
 * provides one-click recovery for the Phase 4 soft-fail path (NSIS
 * bootstrap's npm install failed → user has Studio but no CLI).
 *
 * Source-of-truth is `claude doctor` per Phase 1 red-team M1 — file
 * existence is too brittle if Claude Code ever changes its credentials
 * storage location. If doctor isn't available (CLI not installed at all),
 * we report `installed: false` and `authenticated: false`.
 *
 * Onboarding completion is persisted in `<userData>/cli-onboarding.json`.
 * The renderer-side modal reads this on startup to decide whether to show.
 */
export class CliService {
  private onboardingPath: string;

  constructor() {
    this.onboardingPath = path.join(app.getPath('userData'), ONBOARDING_FILE);
  }

  /**
   * Returns the resolved `claude` executable path. Mirrors the resolution
   * order from PtyManager.findClaudePath() so doctor checks the same
   * binary the terminal would spawn. Single source of truth via
   * runtime-paths.ts.
   */
  private findClaudePath(): { path: string; source: CliStatus['source'] } {
    if (app.isPackaged) {
      const bundled = findBundledRuntime();
      if (bundled) return { path: bundled.claudeBin, source: 'bundled' };
    }

    // Legacy + dev fallback.
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      path.join(os.homedir(), '.local', 'bin', 'claude'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return { path: candidate, source: 'path' };
    }

    // PATH fallback: trust that `claude` resolves at exec time. We can't
    // prove it exists without executing — claude doctor will tell us.
    return { path: 'claude', source: 'path' };
  }

  /**
   * Run `claude doctor` and infer the CLI state.
   *
   * Exit-code semantics (empirically — Anthropic docs only say doctor
   * gives "a more detailed check"):
   *   0 → CLI installed AND authenticated.
   *   non-zero → CLI installed but something's off; parse stderr/stdout
   *     for auth-related strings to disambiguate.
   *   ENOENT (spawn fails) → CLI not installed.
   */
  async getStatus(): Promise<CliStatus> {
    const { path: claudeBin, source } = this.findClaudePath();

    try {
      const { stdout, stderr } = await execFileAsync(claudeBin, ['doctor'], {
        timeout: DOCTOR_TIMEOUT_MS,
        windowsHide: true,
      });
      const combined = `${stdout}\n${stderr}`.toLowerCase();
      // Best-effort version extraction — looks for a "version: X.Y.Z" or
      // "claude vX.Y.Z" pattern. Doctor output format isn't documented,
      // so this is opportunistic; failure here doesn't fail the call.
      const versionMatch = combined.match(/(?:version[:\s]+|claude\s+v)(\d+\.\d+\.\d+)/);
      // Doctor's exit-code-0 is our authenticated signal, but we also
      // check for explicit "not authenticated" / "log in" wording in case
      // doctor exit codes change in a future CLI version.
      const looksAuthenticated = !/(not authenticated|please log in|please sign in|run.*claude login)/.test(
        combined
      );
      return {
        installed: true,
        authenticated: looksAuthenticated,
        version: versionMatch ? versionMatch[1] : null,
        source,
        lastError: null,
      };
    } catch (e: unknown) {
      // ENOENT = binary not found on PATH (or bundled location).
      const err = e as NodeJS.ErrnoException & { stderr?: string; code?: string };
      if (err.code === 'ENOENT') {
        return {
          installed: false,
          authenticated: false,
          version: null,
          source: 'missing',
          lastError: 'Claude Code CLI not found on this machine',
        };
      }
      // Non-zero exit. Could be: not authenticated, broken install, network
      // hiccup, telemetry timeout, etc. The 3.0.0-beta.1 testing pass showed
      // that returning `authenticated: false` on ANY non-zero exit was too
      // aggressive — it popped the CLI onboarding modal even for users who
      // were clearly authenticated (claude already running in the embedded
      // terminal), then their "Sign in" click sent `claude login` into the
      // running Claude session as chat text.
      //
      // New heuristic: only report `authenticated: false` when the output
      // explicitly mentions auth ("not authenticated", "please log in",
      // etc.). For any other non-zero exit, give the benefit of the doubt
      // and return `authenticated: true`. If they're actually signed out,
      // Claude itself will prompt them to /login when they try to use it —
      // a much less disruptive feedback path than a modal-on-every-launch.
      const errOutput = `${err.stderr ?? ''}\n${err.message}`.toLowerCase();
      const looksLikeAuthMissing = /(not authenticated|please log in|please sign in|run.*claude login)/.test(
        errOutput
      );
      return {
        installed: true,
        authenticated: !looksLikeAuthMissing,
        version: null,
        source,
        lastError: looksLikeAuthMissing
          ? 'Sign in required'
          : (err.message || 'claude doctor failed'),
      };
    }
  }

  /**
   * Soft-fail recovery for the Phase 4 NSIS bootstrap: re-runs the
   * npm install that should have happened at install time. Uses the
   * bundled npm so we don't depend on the user having Node installed.
   *
   * Optional `onProgress` streams each line of npm output as it arrives —
   * the renderer subscribes via the cli:install-progress IPC channel
   * to show real-time progress in the onboarding modal (Phase 6 M1).
   *
   * Only meaningful in packaged builds — in dev there's no bundled
   * runtime to install into. Returns a structured result rather than
   * throwing so the renderer can show error details.
   */
  async install(
    onProgress?: CliInstallProgressSink
  ): Promise<{ ok: boolean; output: string; error: string | null }> {
    if (!app.isPackaged) {
      return {
        ok: false,
        output: '',
        error: 'Install-CLI from app is only available in packaged builds. In dev, run `npm install -g @anthropic-ai/claude-code` manually.',
      };
    }

    // Where the runtime lives differs by platform — see runtime-paths.ts.
    // Windows: prefers resources/runtime/ (NSIS bootstrap layout).
    // macOS/Linux: <userData>/runtime/ (in-app bootstrap, app dir is RO).
    const { runtimeDir, nodeBin, npmCli } = targetRuntimePaths();

    // On macOS/Linux, the runtime dir may not exist on first launch
    // because there's no NSIS-style installer to seed it. Bootstrap Node
    // first if it's missing. On Windows, missing runtime means NSIS soft-
    // failed or the user deleted it — point them at reinstall.
    if (!fs.existsSync(nodeBin) || !fs.existsSync(npmCli)) {
      if (process.platform === 'win32') {
        return {
          ok: false,
          output: '',
          error: 'Bundled Node runtime is missing. Reinstall Claude Code Studio to recover.',
        };
      }

      // macOS/Linux: download + verify + extract Node into runtimeDir.
      const bootstrapResult = await this.bootstrapNodeRuntime(runtimeDir, onProgress);
      if (!bootstrapResult.ok) {
        return {
          ok: false,
          output: bootstrapResult.output,
          error: bootstrapResult.error,
        };
      }

      // After bootstrap, paths should now exist. Re-verify before
      // continuing — defensive against partial extracts.
      if (!fs.existsSync(nodeBin) || !fs.existsSync(npmCli)) {
        return {
          ok: false,
          output: bootstrapResult.output,
          error: 'Node bootstrap completed but expected files are missing. Try reinstalling Claude Code Studio.',
        };
      }
    }

    // Ensure runtime dir exists before npm install writes into it (mainly
    // matters when the bundled Node is present but the prefix subtree
    // hasn't been seeded yet — npm wants to write package-lock placeholders).
    try {
      fs.mkdirSync(runtimeDir, { recursive: true });
    } catch {
      // mkdir failure here means the install will fail anyway with a
      // clearer error from npm — let it.
    }

    // Use spawn (not execFile) so we can stream stdout/stderr line-by-line
    // to the renderer. execFile buffers all output until exit — fine for
    // small commands but a poor UX for a 30-90 second install. Drop
    // `--silent` so npm actually emits progress.
    const args = [
      npmCli,
      'install',
      '--prefix',
      runtimeDir,
      '--registry=https://registry.npmjs.org/',
      '--no-save',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      '--progress=false',
      '@anthropic-ai/claude-code',
    ];

    // npm lifecycle scripts of @anthropic-ai/claude-code (or its
    // transitive deps) may shell out to `node` / `npm` / `node-gyp` as
    // bare commands, expecting them on PATH. If PATH points at a
    // different system Node — or has no Node at all — those subprocess
    // spawns crash with "node: command not found", failing the install
    // late and confusingly. Prepend our bundled bin dir so subprocesses
    // resolve to the same Node we're driving.
    const bundledBinDir =
      process.platform === 'win32' ? runtimeDir : path.join(runtimeDir, 'bin');
    const childEnv = {
      ...process.env,
      PATH: `${bundledBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };

    return new Promise((resolve) => {
      const collected: string[] = [];
      const child = spawn(nodeBin, args, { windowsHide: true, env: childEnv });
      let buffer = '';

      const flushLines = (chunk: string) => {
        buffer += chunk;
        let nl: number;
        // eslint-disable-next-line no-cond-assign
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          if (line.length > 0) {
            collected.push(line);
            try {
              onProgress?.(line);
            } catch {
              // never let renderer-side handler break the install
            }
          }
        }
      };

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', flushLines);
      child.stderr?.on('data', flushLines);

      const timeoutHandle = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
      }, NPM_INSTALL_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        resolve({
          ok: false,
          output: collected.join('\n'),
          error: err.message || 'npm install spawn failed',
        });
      });

      child.on('exit', (code) => {
        clearTimeout(timeoutHandle);
        // Flush any trailing buffer that didn't end with a newline.
        if (buffer.length > 0) {
          collected.push(buffer);
          try { onProgress?.(buffer); } catch { /* ignore */ }
          buffer = '';
        }
        if (code === 0) {
          resolve({ ok: true, output: collected.join('\n'), error: null });
        } else {
          resolve({
            ok: false,
            output: collected.join('\n'),
            error: `npm install exited with code ${code ?? 'null'}`,
          });
        }
      });
    });
  }

  /**
   * macOS + Linux first-launch Node bootstrap. Downloads the pinned Node
   * tarball, verifies SHA256, extracts to `runtimeDir`, flattens the
   * versioned subdirectory so the layout matches what `runtime-paths.ts`
   * expects (bin/node, lib/node_modules/npm/...).
   *
   * Windows is NOT routed here — the NSIS installer does this at install
   * time, before the app ever launches. If somehow called on Windows
   * (defensive), refuses with a clear message.
   *
   * Progress (download bytes + extract status) streams via `onProgress`
   * for the same modal UI that the npm install uses (`Phase 6 M1`).
   */
  private async bootstrapNodeRuntime(
    runtimeDir: string,
    onProgress?: CliInstallProgressSink
  ): Promise<{ ok: boolean; output: string; error: string | null }> {
    if (process.platform === 'win32') {
      return {
        ok: false,
        output: '',
        error: 'Node bootstrap on Windows is handled by the NSIS installer, not the app.',
      };
    }

    const arch = process.arch;
    const download = nodeDownloadFor(process.platform, arch);
    if (!download) {
      return {
        ok: false,
        output: '',
        error: `No bundled Node available for ${process.platform}/${arch}. Install Node 22+ manually and use the system claude.`,
      };
    }

    const collected: string[] = [];
    const emit = (line: string) => {
      collected.push(line);
      try { onProgress?.(line); } catch { /* never crash install on UI errors */ }
    };

    const tmpDir = app.getPath('temp');
    const tmpArchive = path.join(tmpDir, download.filename);

    // --- Step 1: Download ---
    emit(`Downloading ${download.filename} (~30 MB)...`);
    try {
      await this.downloadFileWithProgress(download.url, tmpArchive, (percent) => {
        if (percent % 10 === 0) emit(`  download progress: ${percent}%`);
      });
    } catch (e) {
      try { fs.unlinkSync(tmpArchive); } catch { /* ignore */ }
      return {
        ok: false,
        output: collected.join('\n'),
        error: `Node download failed: ${(e as Error).message}`,
      };
    }

    // --- Step 2: Verify SHA256 ---
    emit('Verifying SHA256...');
    try {
      const actual = await this.fileSha256(tmpArchive);
      if (actual !== download.sha256) {
        try { fs.unlinkSync(tmpArchive); } catch { /* ignore */ }
        return {
          ok: false,
          output: collected.join('\n'),
          error: `SHA256 mismatch — refusing to use untrusted Node binary. Expected ${download.sha256}, got ${actual}.`,
        };
      }
    } catch (e) {
      return {
        ok: false,
        output: collected.join('\n'),
        error: `SHA256 verification failed: ${(e as Error).message}`,
      };
    }
    emit('SHA256 OK');

    // --- Step 3: Extract ---
    emit(`Extracting to ${runtimeDir}...`);
    try {
      fs.mkdirSync(runtimeDir, { recursive: true });
      await this.extractTo(tmpArchive, runtimeDir, download.archiveType, emit);
    } catch (e) {
      return {
        ok: false,
        output: collected.join('\n'),
        error: `Extract failed: ${(e as Error).message}`,
      };
    }

    // --- Step 4: Flatten the versioned dir ---
    // Tarball extracts to runtimeDir/node-vX.Y.Z-<plat>-<arch>/{bin,lib,...}
    // We want everything one level up so bin/node is at runtimeDir/bin/node.
    const versionedDir = path.join(runtimeDir, download.innerDirName);
    if (fs.existsSync(versionedDir)) {
      emit('Flattening directory layout...');
      try {
        for (const entry of fs.readdirSync(versionedDir)) {
          const src = path.join(versionedDir, entry);
          const dst = path.join(runtimeDir, entry);
          // If dst exists (re-run), remove first.
          if (fs.existsSync(dst)) {
            fs.rmSync(dst, { recursive: true, force: true });
          }
          fs.renameSync(src, dst);
        }
        fs.rmdirSync(versionedDir);
      } catch (e) {
        return {
          ok: false,
          output: collected.join('\n'),
          error: `Flatten failed: ${(e as Error).message}`,
        };
      }
    }

    // --- Step 5: Cleanup ---
    try { fs.unlinkSync(tmpArchive); } catch { /* ignore */ }

    emit('Node runtime ready.');
    return { ok: true, output: collected.join('\n'), error: null };
  }

  /** Downloads `url` to `destPath`, calling `onProgress(percent)` periodically. */
  private downloadFileWithProgress(
    url: string,
    destPath: string,
    onProgress: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(destPath);
      let cleaned = false;
      const cleanup = (err?: Error) => {
        if (cleaned) return;
        cleaned = true;
        writeStream.end();
        if (err) reject(err); else resolve();
      };

      const timeoutHandle = setTimeout(() => {
        cleanup(new Error('Download timeout'));
      }, NODE_BOOTSTRAP_TIMEOUT_MS);

      const doGet = (target: string, redirectsRemaining: number) => {
        https.get(target, { headers: { 'User-Agent': 'claude-code-studio' } }, (res) => {
          // Follow 3xx redirects (GitHub redirects to fastly).
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            redirectsRemaining > 0
          ) {
            res.resume();
            doGet(res.headers.location, redirectsRemaining - 1);
            return;
          }
          if (res.statusCode !== 200) {
            clearTimeout(timeoutHandle);
            cleanup(new Error(`HTTP ${res.statusCode} fetching ${target}`));
            return;
          }
          const total = Number.parseInt(res.headers['content-length'] ?? '0', 10);
          let received = 0;
          let lastReportedPercent = -1;
          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (total > 0) {
              const percent = Math.floor((received / total) * 100);
              if (percent !== lastReportedPercent) {
                lastReportedPercent = percent;
                try { onProgress(percent); } catch { /* ignore */ }
              }
            }
          });
          res.pipe(writeStream);
          res.on('error', (err) => {
            clearTimeout(timeoutHandle);
            cleanup(err);
          });
          writeStream.on('finish', () => {
            clearTimeout(timeoutHandle);
            cleanup();
          });
          writeStream.on('error', (err) => {
            clearTimeout(timeoutHandle);
            cleanup(err);
          });
        }).on('error', (err) => {
          clearTimeout(timeoutHandle);
          cleanup(err);
        });
      };

      doGet(url, 5);
    });
  }

  /** Returns lowercase SHA256 hex of the file at `filePath`. */
  private fileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Extracts `archive` into `destDir`. Uses the OS `tar` binary on macOS/
   * Linux — it ships with the OS, no extra dep needed.
   */
  private extractTo(
    archive: string,
    destDir: string,
    type: 'tar-gz' | 'tar-xz' | 'zip',
    emit: CliInstallProgressSink
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let cmd: string;
      let args: string[];
      if (type === 'tar-gz') {
        cmd = 'tar';
        args = ['-xzf', archive, '-C', destDir];
      } else if (type === 'tar-xz') {
        cmd = 'tar';
        args = ['-xJf', archive, '-C', destDir];
      } else {
        // zip — used only for Windows (which doesn't route here today)
        reject(new Error('zip extract via tar not supported; use PowerShell Expand-Archive on Windows.'));
        return;
      }
      const child = spawn(cmd, args, { windowsHide: true });
      let stderr = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (d: string) => {
        stderr += d;
        emit(`  extract: ${d.trim()}`);
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar exited ${code ?? 'null'}: ${stderr.trim()}`));
      });
    });
  }

  getOnboardingState(): CliOnboardingState {
    try {
      const raw = fs.readFileSync(this.onboardingPath, 'utf8');
      const parsed = JSON.parse(raw);
      // Defensive — file could be hand-edited / from a future version.
      return {
        complete: parsed.complete === true,
        completedAt: typeof parsed.completedAt === 'number' ? parsed.completedAt : null,
      };
    } catch {
      return { ...ONBOARDING_DEFAULT };
    }
  }

  setOnboardingComplete(): CliOnboardingState {
    const next: CliOnboardingState = {
      complete: true,
      completedAt: Date.now(),
    };
    try {
      fs.writeFileSync(this.onboardingPath, JSON.stringify(next, null, 2), 'utf8');
    } catch {
      // Persistence failure is non-fatal — the modal just shows again
      // next launch. Don't block the user on filesystem issues.
    }
    return next;
  }

  /** Reset for testing / user request via SettingsPanel. */
  resetOnboarding(): CliOnboardingState {
    try {
      fs.unlinkSync(this.onboardingPath);
    } catch {
      // Already gone; fine.
    }
    return { ...ONBOARDING_DEFAULT };
  }
}
