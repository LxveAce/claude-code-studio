import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  type NativeImage,
} from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TraySettings } from '../shared/types';

const STORE_FILE = 'tray-settings.json';

// Hand-verified 16x16 PNG of a purple circle. Used as the tray icon. If this
// fails to decode for any reason we fall back to an empty image (Electron
// will show a default placeholder) rather than crash.
const PURPLE_CIRCLE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAh0lEQVQ4jcWTwQ2AIAxFG0fQERzBERzBERzBHRzBHRzBHbqDIzhCmYM8CO0PpQfjpf3pj/2tXxqEcEsxxh0AfkRSMcb1xqMQwknEFwBcoHpEUkLzeJlBKcVRSimnlPYI1lqHvgT1FwiI9BcA8KqaAUDr8mqtJ1eImNG6vH8DAFhrnSPaWvszH3o7/wA9Hq8c2KGEhgAAAABJRU5ErkJggg==';

function makeTrayIcon(): NativeImage {
  try {
    const img = nativeImage.createFromDataURL(
      `data:image/png;base64,${PURPLE_CIRCLE_PNG_B64}`
    );
    if (img.isEmpty()) {
      // Tiny fallback: a 1x1 transparent pixel so Tray still constructs.
      return nativeImage.createFromBuffer(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'base64'
        )
      );
    }
    return img;
  } catch {
    return nativeImage.createEmpty();
  }
}

function defaultTraySettings(): TraySettings {
  // Per Phase 7d spec: ON for Windows, OFF for macOS. Linux defaults OFF
  // because tray support there is inconsistent across desktop environments.
  return {
    minimizeToTrayOnClose: process.platform === 'win32',
  };
}

interface TrayServiceHandlers {
  getWindow: () => BrowserWindow | null;
  onToggleCompact: () => void | Promise<void>;
  /** Imperatively initiate the real app quit (skipping the minimize-to-tray
   * intercept). The caller MUST set its internal "is quitting" flag before
   * calling this so the close handler does not re-hide the window. */
  onQuit: () => void;
}

export class TrayService {
  private storePath: string;
  private settings: TraySettings;
  private tray: Tray | null = null;
  private handlers: TrayServiceHandlers | null = null;

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.settings = this.read();
  }

  attach(handlers: TrayServiceHandlers): void {
    this.handlers = handlers;
    if (this.settings.minimizeToTrayOnClose) {
      this.ensureTray();
    }
  }

  getSettings(): TraySettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<TraySettings>): TraySettings {
    const next: TraySettings = { ...this.settings };
    if (partial.minimizeToTrayOnClose !== undefined) {
      if (typeof partial.minimizeToTrayOnClose !== 'boolean') {
        throw new Error('minimizeToTrayOnClose must be boolean');
      }
      next.minimizeToTrayOnClose = partial.minimizeToTrayOnClose;
    }
    this.settings = next;
    this.write();
    if (this.settings.minimizeToTrayOnClose) {
      this.ensureTray();
    } else {
      this.destroyTray();
    }
    return { ...this.settings };
  }

  isMinimizeToTrayEnabled(): boolean {
    return this.settings.minimizeToTrayOnClose;
  }

  /** Called from main when the app is genuinely about to quit. */
  dispose(): void {
    this.destroyTray();
  }

  // --- internals ---

  private ensureTray(): void {
    if (this.tray) return;
    if (!this.handlers) return;
    try {
      const icon = makeTrayIcon();
      this.tray = new Tray(icon);
      this.tray.setToolTip('Claude Code Studio');
      this.rebuildMenu();
      this.tray.on('click', () => this.showWindow());
      // Some platforms (Linux) don't always fire 'click' for the icon.
      this.tray.on('double-click', () => this.showWindow());
    } catch {
      // Tray construction can fail on systems with no notification area
      // (some Linux distros). In that case we simply don't have a tray.
      this.tray = null;
    }
  }

  private destroyTray(): void {
    if (!this.tray) return;
    try {
      this.tray.destroy();
    } catch {
      // ignore
    }
    this.tray = null;
  }

  private rebuildMenu(): void {
    if (!this.tray || !this.handlers) return;
    const menu = Menu.buildFromTemplate([
      {
        label: 'Show Window',
        click: () => this.showWindow(),
      },
      {
        label: 'Toggle compact controller',
        click: () => {
          // The handler is responsible for its own error-handling.
          void Promise.resolve(this.handlers?.onToggleCompact()).catch(() => {
            // swallow — tray callbacks must not throw
          });
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          this.handlers?.onQuit();
        },
      },
    ]);
    this.tray.setContextMenu(menu);
  }

  private showWindow(): void {
    const win = this.handlers?.getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }

  private read(): TraySettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return defaultTraySettings();
      }
      return defaultTraySettings();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaultTraySettings();
    }
    const def = defaultTraySettings();
    if (!parsed || typeof parsed !== 'object') return def;
    const obj = parsed as Record<string, unknown>;
    return {
      minimizeToTrayOnClose:
        typeof obj.minimizeToTrayOnClose === 'boolean'
          ? obj.minimizeToTrayOnClose
          : def.minimizeToTrayOnClose,
    };
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto
      .randomBytes(4)
      .toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), {
        mode: 0o600,
      });
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
