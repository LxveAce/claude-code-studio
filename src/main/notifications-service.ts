import { app, Notification } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NotificationSettings } from '../shared/types';

const STORE_FILE = 'notifications-settings.json';
const MIN_INTERVAL_MS = 1000; // throttle to once per second

const DEFAULTS: NotificationSettings = {
  enabled: false,
  notifyOnPtyExit: true,
  notifyOnSyncError: true,
};

type NotifKind = 'pty-exit' | 'sync-error' | 'test' | 'other';

export class NotificationsService {
  private storePath: string;
  private settings: NotificationSettings;
  private lastShownAt = new Map<NotifKind, number>();

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.settings = this.read();
  }

  isSupported(): boolean {
    return Notification.isSupported();
  }

  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<NotificationSettings>): NotificationSettings {
    const next: NotificationSettings = { ...this.settings };
    if (partial.enabled !== undefined) {
      if (typeof partial.enabled !== 'boolean') throw new Error('enabled must be boolean');
      next.enabled = partial.enabled;
    }
    if (partial.notifyOnPtyExit !== undefined) {
      if (typeof partial.notifyOnPtyExit !== 'boolean') {
        throw new Error('notifyOnPtyExit must be boolean');
      }
      next.notifyOnPtyExit = partial.notifyOnPtyExit;
    }
    if (partial.notifyOnSyncError !== undefined) {
      if (typeof partial.notifyOnSyncError !== 'boolean') {
        throw new Error('notifyOnSyncError must be boolean');
      }
      next.notifyOnSyncError = partial.notifyOnSyncError;
    }
    this.settings = next;
    this.write();
    return { ...this.settings };
  }

  notifyPtyExit(exitCode: number): void {
    if (!this.settings.enabled || !this.settings.notifyOnPtyExit) return;
    this.show('pty-exit', {
      title: 'Claude Code exited',
      body: `Process exited with code ${exitCode}.`,
    });
  }

  notifySyncError(message: string): void {
    if (!this.settings.enabled || !this.settings.notifyOnSyncError) return;
    this.show('sync-error', {
      title: 'Vault sync error',
      body: this.truncate(message, 200),
    });
  }

  /** Manual smoke-test fired from the settings UI. Ignores enabled flag. */
  fireTest(): boolean {
    if (!this.isSupported()) return false;
    this.show('test', {
      title: 'Claude Code Studio',
      body: 'Notifications are working.',
    });
    return true;
  }

  // --- internals ---

  private show(kind: NotifKind, payload: { title: string; body: string }): void {
    if (!this.isSupported()) return;
    const now = Date.now();
    const last = this.lastShownAt.get(kind) ?? 0;
    if (now - last < MIN_INTERVAL_MS) return;
    this.lastShownAt.set(kind, now);
    try {
      const n = new Notification({
        title: this.truncate(payload.title, 80),
        body: this.truncate(payload.body, 300),
        silent: false,
      });
      n.show();
    } catch {
      // OS notification surface can fail; do not propagate to callers.
    }
  }

  private truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  private read(): NotificationSettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULTS };
      return { ...DEFAULTS };
    }
    let parsed: Partial<NotificationSettings>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULTS };
    }
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULTS.enabled,
      notifyOnPtyExit:
        typeof parsed.notifyOnPtyExit === 'boolean'
          ? parsed.notifyOnPtyExit
          : DEFAULTS.notifyOnPtyExit,
      notifyOnSyncError:
        typeof parsed.notifyOnSyncError === 'boolean'
          ? parsed.notifyOnSyncError
          : DEFAULTS.notifyOnSyncError,
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
