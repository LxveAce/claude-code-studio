import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { UpdaterSettings, UpdaterState, UpdateChannel } from '../shared/types';

const STORE_FILE = 'updater-settings.json';

const DEFAULTS: UpdaterSettings = {
  enabled: true,
  channel: 'stable',
};

/**
 * Public callbacks. We don't import NotificationsService here to keep the
 * dependency tree one-way (main wiring composes the two).
 */
export interface UpdaterCallbacks {
  /** Called when an update is fully downloaded and ready to install on next launch. */
  onUpdateDownloaded?: (version: string) => void;
  /** Called for any updater error (non-fatal — typical on first-run / no releases yet). */
  onError?: (message: string) => void;
  /** Called with rounded download percent (0-100) during update download. */
  onDownloadProgress?: (percent: number) => void;
}

/**
 * UpdaterService wraps `electron-updater`'s autoUpdater (Phase 7 of the
 * bootstrap-installer migration — replaced `update-electron-app` which was
 * tied to the Squirrel.Windows pipeline).
 *
 * Why electron-updater (not update-electron-app)?
 *   - v1.1 ships via electron-builder + NSIS, not electron-forge + Squirrel.
 *     `update-electron-app` is designed for Squirrel.{Windows,Mac} and uses
 *     update.electronjs.org as a proxy. electron-updater speaks directly to
 *     electron-builder's `latest.yml` format, which is what `npm run dist:publish`
 *     emits to GitHub Releases.
 *   - electron-updater supports NSIS, AppImage, dmg, and zip targets uniformly,
 *     so future macOS/Linux ports inherit the same updater plumbing.
 *
 * Skip conditions (preserved from the previous service so the UI contract
 * stays stable — per Phase 4 red-team L1):
 *   - dev-mode (MAIN_WINDOW_VITE_DEV_SERVER_URL set): don't init the updater
 *     at all — there's no installed app to update.
 *   - Truly exotic platform (not win32/darwin/linux): surface
 *     'unsupported-platform' rather than spinning a broken updater.
 *     v2.0 enabled all three major platforms; updater self-disables
 *     gracefully on deb/rpm Linux installs (those use the distro pkg
 *     manager — electron-updater detects the format at runtime).
 *   - User disabled: respect it.
 *
 * Squirrel-to-NSIS migration cliff (Phase 1 H1 / Phase 7 plan):
 *   - Users on v1.0 (installed via Squirrel) will NOT receive updates via this
 *     service. They must follow MIGRATING_FROM_V1.md to uninstall + reinstall
 *     once. After that, v1.1+ updates land via electron-updater seamlessly.
 */
export class UpdaterService {
  private storePath: string;
  private settings: UpdaterSettings;
  private state: UpdaterState;
  private callbacks: UpdaterCallbacks;
  private wired = false;
  /** Floor between checkNow invocations to prevent renderer-side spam. */
  private lastCheckNowAt = 0;
  private static CHECK_NOW_MIN_INTERVAL_MS = 5000;

  constructor(opts: { isDevMode: boolean; callbacks?: UpdaterCallbacks }) {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.settings = this.read();
    this.callbacks = opts.callbacks ?? {};

    const currentVersion = app.getVersion();
    const productionMode = !opts.isDevMode;

    this.state = {
      currentVersion,
      productionMode,
      active: false,
      inactiveReason: opts.isDevMode ? 'dev-mode' : null,
      channel: this.settings.channel,
      lastCheckedAt: null,
      lastUpdateFoundAt: null,
      pendingVersion: null,
      lastError: null,
    };
  }

  /**
   * Wire up electron-updater. Safe to call once per process.
   * Returns the new state for telemetry.
   */
  start(): UpdaterState {
    if (this.wired) return this.getState();
    this.wired = true;

    // GATE 1 — dev mode (no installed app to update).
    if (!this.state.productionMode) {
      this.state.inactiveReason = 'dev-mode';
      return this.getState();
    }

    // GATE 2 — unsupported platform. electron-updater supports Windows
    // (NSIS via latest.yml), macOS (zip via latest-mac.yml — DMG is the
    // delivery format but updates apply from the bundled zip), and Linux
    // AppImage (latest-linux.yml). deb/rpm rely on the distro package
    // manager — electron-updater detects that at runtime and self-disables
    // gracefully (the OS pkg manager is the source of updates there).
    const supportedPlatforms: NodeJS.Platform[] = ['win32', 'darwin', 'linux'];
    if (!supportedPlatforms.includes(process.platform)) {
      this.state.inactiveReason = 'unsupported-platform';
      return this.getState();
    }

    // GATE 3 — user disabled.
    if (!this.settings.enabled) {
      this.state.inactiveReason = 'disabled';
      return this.getState();
    }

    // GATE 4 — beta builds skip auto-update entirely. Added 3.0.0-beta.3
    // after the beta.2 install repeatedly fired the auto-updater against
    // the public repo's latest published release (v1.0.0), which lacks a
    // `latest.yml` asset → unhandled 404 stack trace in the user's logs.
    // Beta builds aren't in the GitHub release feed at all, so the only
    // correct behavior is to not check. UI shows the version as "beta"
    // and prompts manual install from the testing repo if needed.
    if (/-beta\./i.test(app.getVersion())) {
      this.state.inactiveReason = 'disabled';
      this.state.lastError = 'Auto-update disabled for beta builds (install new betas manually).';
      return this.getState();
    }

    try {
      // Dynamic require so dev mode and unsupported-platform paths don't
      // need the module on disk during typecheck or first-run launches.
      // electron-updater's autoUpdater is a different export from
      // Electron's built-in `autoUpdater` — namespace explicitly.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { autoUpdater } = require('electron-updater') as {
        autoUpdater: {
          autoDownload: boolean;
          autoInstallOnAppQuit: boolean;
          allowPrerelease: boolean;
          channel: string;
          on(event: string, cb: (...args: unknown[]) => void): void;
          checkForUpdates(): Promise<unknown>;
          checkForUpdatesAndNotify(): Promise<unknown>;
          logger: unknown;
        };
      };

      // Auto-download keeps the UX consistent with the old Squirrel path:
      // an available update gets pulled in the background, then surfaces
      // via onUpdateDownloaded and applies on next launch.
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;

      // CHANNEL: beta = include prereleases; stable = stable only.
      // Until we have a real beta-channel publisher pipeline (Phase 4b /
      // C3 in BACKLOG), `beta` simply allows prereleases through if the
      // maintainer publishes any. UI calls this out so users aren't
      // surprised that "beta" with no published prereleases acts like
      // stable.
      autoUpdater.allowPrerelease = this.settings.channel === 'beta';

      // Pipe electron-updater's logs to console. Keeps debugging in the
      // dev tools console without spamming any persistent log file.
      autoUpdater.logger = {
        // eslint-disable-next-line no-console
        debug: (...a: unknown[]) => console.debug('[updater]', ...a),
        // eslint-disable-next-line no-console
        info: (...a: unknown[]) => console.info('[updater]', ...a),
        // eslint-disable-next-line no-console
        warn: (...a: unknown[]) => console.warn('[updater]', ...a),
        // eslint-disable-next-line no-console
        error: (...a: unknown[]) => console.error('[updater]', ...a),
      };

      autoUpdater.on('checking-for-update', () => {
        this.state.lastCheckedAt = new Date().toISOString();
      });
      autoUpdater.on('update-available', (info: unknown) => {
        const version = (info as { version?: string })?.version;
        this.state.lastUpdateFoundAt = new Date().toISOString();
        this.state.pendingVersion = typeof version === 'string' ? version : null;
        // Don't fire callback yet — wait for full download. update-available
        // fires when the manifest says a newer version exists, not when
        // bits are on disk ready to install.
      });
      autoUpdater.on('update-not-available', () => {
        // No-op for UI purposes; lastCheckedAt already updated.
      });
      autoUpdater.on('download-progress', (progress: unknown) => {
        const raw = (progress as { percent?: number })?.percent;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
        // Round to integer to avoid spamming the renderer with 0.001%
        // increments. The UI shows "Downloading update… 45%" granularity.
        const rounded = Math.max(0, Math.min(100, Math.round(raw)));
        try {
          this.callbacks.onDownloadProgress?.(rounded);
        } catch {
          // never let UI bookkeeping crash the updater
        }
      });
      autoUpdater.on('update-downloaded', (info: unknown) => {
        const version = (info as { version?: string })?.version;
        const v = typeof version === 'string' ? version : '';
        this.state.pendingVersion = v || null;
        try {
          this.callbacks.onUpdateDownloaded?.(v);
        } catch {
          // never let UI bookkeeping crash the updater
        }
      });
      autoUpdater.on('error', (err: unknown) => {
        const e = err as Error | undefined;
        const msg = e?.message ?? String(err);
        // Demote the "missing latest.yml" 404 to a friendly state.
        // Older releases (<= v3.2.0) were built before the CI workflow
        // started uploading latest.yml as a release asset, so the
        // updater HTTP-404s trying to fetch it. The stack trace this
        // produces in the UI was noisy + confusing — surface a clean
        // "up to date" instead, and log the underlying detail.
        const is404OnLatestYml =
          /HttpError:\s*404/i.test(msg) &&
          /(latest(-mac|-linux)?\.yml|release artifacts)/i.test(msg);
        if (is404OnLatestYml) {
          console.warn('[updater] no latest.yml on the current release — treating as up-to-date');
          this.state.lastError = null;
          return;
        }
        this.state.lastError = msg;
        try {
          this.callbacks.onError?.(msg);
        } catch {
          // ignore
        }
      });

      // Kick off the first check on a short delay so the window has time
      // to load before the updater starts logging.
      setTimeout(() => {
        try {
          void autoUpdater.checkForUpdates();
        } catch (e) {
          // First-check errors are typical when there are no releases yet
          // or the user is offline. lastError captures the detail.
          this.state.lastError = (e as Error).message ?? String(e);
        }
      }, 3000);

      this.state.active = true;
      this.state.inactiveReason = null;
      return this.getState();
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      this.state.active = false;
      this.state.inactiveReason = 'init-error';
      this.state.lastError = msg;
      return this.getState();
    }
  }

  /**
   * Trigger an immediate check. No-op (but updates lastError) when inactive.
   * Throttled at 5s to prevent renderer-side spam.
   */
  checkNow(): UpdaterState {
    if (!this.state.active) {
      this.state.lastError =
        this.state.inactiveReason === 'dev-mode'
          ? 'Auto-update is disabled in development mode.'
          : this.state.inactiveReason === 'unsupported-platform'
            ? 'Auto-update is not supported on this platform.'
            : this.state.inactiveReason === 'disabled'
              ? 'Auto-update is disabled in settings.'
              : (this.state.lastError ?? 'Auto-updater is not active.');
      return this.getState();
    }
    const now = Date.now();
    if (now - this.lastCheckNowAt < UpdaterService.CHECK_NOW_MIN_INTERVAL_MS) {
      return this.getState();
    }
    this.lastCheckNowAt = now;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { autoUpdater } = require('electron-updater') as {
        autoUpdater: { checkForUpdates(): Promise<unknown> };
      };
      // Fire-and-forget; the on('checking-for-update') handler will
      // update lastCheckedAt.
      void autoUpdater.checkForUpdates();
    } catch (e) {
      this.state.lastError = (e as Error).message ?? String(e);
    }
    return this.getState();
  }

  getState(): UpdaterState {
    return { ...this.state, channel: this.settings.channel };
  }

  getSettings(): UpdaterSettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<UpdaterSettings>): UpdaterSettings {
    const next: UpdaterSettings = { ...this.settings };
    if (partial.enabled !== undefined) {
      if (typeof partial.enabled !== 'boolean') {
        throw new Error('enabled must be boolean');
      }
      next.enabled = partial.enabled;
    }
    if (partial.channel !== undefined) {
      if (partial.channel !== 'stable' && partial.channel !== 'beta') {
        throw new Error('channel must be "stable" or "beta"');
      }
      next.channel = partial.channel;
    }
    this.settings = next;
    this.write();
    // Note: toggling `enabled` requires app restart to take effect; we
    // surface this in the UI copy. Same contract as the previous
    // implementation. Channel changes also require restart (the
    // autoUpdater.allowPrerelease flag is set at start time).
    return { ...this.settings };
  }

  // --- internals ---

  private read(): UpdaterSettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULTS };
      return { ...DEFAULTS };
    }
    let parsed: Partial<UpdaterSettings>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULTS };
    }
    const channel: UpdateChannel =
      parsed.channel === 'stable' || parsed.channel === 'beta'
        ? parsed.channel
        : DEFAULTS.channel;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULTS.enabled,
      channel,
    };
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.storePath);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw e;
    }
  }
}
