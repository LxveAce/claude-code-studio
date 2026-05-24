import { app } from 'electron';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { CliStatus, CliOnboardingState } from '../shared/types';

const execFileAsync = promisify(execFile);

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
   * binary the terminal would spawn. Single source of truth would be
   * better long-term; for now we accept the duplication because the two
   * use cases (terminal spawn via node-pty vs doctor spawn via execFile)
   * have subtly different ergonomics.
   */
  private findClaudePath(): { path: string; source: CliStatus['source'] } {
    if (app.isPackaged) {
      const bundled = path.join(process.resourcesPath, 'runtime', 'claude.cmd');
      if (fs.existsSync(bundled)) return { path: bundled, source: 'bundled' };
      const bundledExe = path.join(process.resourcesPath, 'runtime', 'claude.exe');
      if (fs.existsSync(bundledExe)) return { path: bundledExe, source: 'bundled' };
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
      // Non-zero exit. Could be: not authenticated, broken install, etc.
      // Look at the output for auth-specific hints.
      const errOutput = `${err.stderr ?? ''}\n${err.message}`.toLowerCase();
      const looksLikeAuthMissing = /(not authenticated|please log in|please sign in|run.*claude login)/.test(
        errOutput
      );
      // If output mentions auth, the CLI IS installed but unauthenticated.
      // Otherwise it's some other doctor failure — still report installed
      // but unauthenticated, with the error message for diagnostics.
      return {
        installed: true,
        authenticated: false,
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
   * Only meaningful in packaged builds — in dev there's no bundled
   * runtime to install into. Returns a structured result rather than
   * throwing so the renderer can show error details.
   */
  async install(): Promise<{ ok: boolean; output: string; error: string | null }> {
    if (!app.isPackaged) {
      return {
        ok: false,
        output: '',
        error: 'Install-CLI from app is only available in packaged builds. In dev, run `npm install -g @anthropic-ai/claude-code` manually.',
      };
    }

    const runtimeDir = path.join(process.resourcesPath, 'runtime');
    const nodeBin = path.join(runtimeDir, 'node.exe');
    const npmCli = path.join(runtimeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');

    if (!fs.existsSync(nodeBin) || !fs.existsSync(npmCli)) {
      return {
        ok: false,
        output: '',
        error: 'Bundled Node runtime is missing. Reinstall Claude Code Studio to recover.',
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        nodeBin,
        [
          npmCli,
          'install',
          '--prefix',
          runtimeDir,
          '--registry=https://registry.npmjs.org/',
          '--no-save',
          '--no-package-lock',
          '--no-audit',
          '--no-fund',
          '--silent',
          '@anthropic-ai/claude-code',
        ],
        {
          timeout: NPM_INSTALL_TIMEOUT_MS,
          windowsHide: true,
        }
      );
      return { ok: true, output: `${stdout}\n${stderr}`.trim(), error: null };
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
      return {
        ok: false,
        output: `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim(),
        error: err.message || 'npm install failed',
      };
    }
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
