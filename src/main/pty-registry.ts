import { EventEmitter } from 'events';
import { PtyManager, type PtySpawnOpts } from './pty-manager';

/**
 * Per-pane PTY registry.
 *
 * Manages multiple {@link PtyManager} instances keyed by paneId so that the
 * renderer can host an arbitrary tree of terminal panes (see
 * {@link SplitLayout}) without changing the underlying single-PTY semantics.
 *
 * Forwarded events are decorated with the originating paneId so the renderer
 * can route them to the correct xterm instance.
 */
/** Resource-monitor bucket a pane's PTY contributes to. Added in
 *  3.0.0-beta.3 so the monitor can split RAM/CPU by category. */
export type PaneCategory = 'claude' | 'model' | 'other';

export class PtyRegistry extends EventEmitter {
  private panes = new Map<string, PtyManager>();
  /** Per-pane category — set at spawn time. Defaults to 'claude' for
   *  the existing terminal flow (no opts.command → spawns claude). */
  private paneCategory = new Map<string, PaneCategory>();
  /** Tracks per-pane listeners so dispose is symmetric (no leaks on close).
   *  Renamed from `listeners` to avoid clobbering the EventEmitter method. */
  private paneListeners = new Map<
    string,
    {
      onData: (data: string) => void;
      onExit: (code: number) => void;
      onReady: (pid: number) => void;
    }
  >();

  /** Hard cap on simultaneous PTYs to prevent runaway spawn-from-renderer. */
  static readonly MAX_PANES = 16;

  /** Validate paneIds coming over IPC. Must be opaque, finite-length. */
  static isValidPaneId(id: unknown): id is string {
    return (
      typeof id === 'string' &&
      id.length > 0 &&
      id.length <= 64 &&
      /^[A-Za-z0-9_\-:]+$/.test(id)
    );
  }

  has(paneId: string): boolean {
    return this.panes.has(paneId);
  }

  list(): string[] {
    return [...this.panes.keys()];
  }

  pidFor(paneId: string): number {
    return this.panes.get(paneId)?.pid ?? 0;
  }

  allPids(): number[] {
    const out: number[] = [];
    for (const p of this.panes.values()) {
      if (p.pid > 0) out.push(p.pid);
    }
    return out;
  }

  /** PIDs of panes in the given category (alive only). */
  pidsByCategory(category: PaneCategory): number[] {
    const out: number[] = [];
    for (const [paneId, mgr] of this.panes) {
      if (mgr.pid <= 0) continue;
      const cat = this.paneCategory.get(paneId) ?? 'claude';
      if (cat === category) out.push(mgr.pid);
    }
    return out;
  }

  /** Live listing of running model panes — used by ModelsPanel to rebuild
   *  its "Running" list after a panel re-mount. */
  listModelPanes(): Array<{
    paneId: string;
    pid: number;
    commandLine: string;
  }> {
    const out: Array<{ paneId: string; pid: number; commandLine: string }> = [];
    for (const [paneId, mgr] of this.panes) {
      if (mgr.pid <= 0) continue;
      const cat = this.paneCategory.get(paneId) ?? 'claude';
      if (cat !== 'model') continue;
      out.push({ paneId, pid: mgr.pid, commandLine: mgr.commandLine });
    }
    return out;
  }

  /**
   * Spawn a PTY for `paneId`, OR re-emit `ready` if one is already alive.
   *
   * This is the "renderer remounted, please reattach" semantics — when the
   * renderer's TerminalPanel mounts (e.g. on split, where the existing
   * paneId's component fiber gets recreated under a new tree position), it
   * calls `spawn(paneId)`. If we kill+respawn on every call, the user loses
   * scroll/state on every split. Instead: if alive, just re-emit `ready` so
   * the renderer can update its PID display, and the existing 'data' stream
   * continues uninterrupted.
   *
   * Use {@link kill} + {@link spawn} explicitly (or call from a hard restart
   * intent like the palette "Terminal: restart") to force a fresh PTY.
   *
   * Returns `true` if a NEW PTY was created, `false` if we reattached.
   */
  /**
   * Annotate the pane's category for ResourceMonitor bucketing. Called by
   * setupTerminal (default 'claude') and by MODELS_LAUNCH ('model'). Idempotent.
   */
  setPaneCategory(paneId: string, category: PaneCategory): void {
    this.paneCategory.set(paneId, category);
  }

  spawn(paneId: string, cwd?: string, opts?: PtySpawnOpts): boolean {
    if (!PtyRegistry.isValidPaneId(paneId)) {
      throw new Error(`Invalid paneId: ${String(paneId)}`);
    }
    const existing = this.panes.get(paneId);
    if (existing && existing.pid > 0) {
      // Reattach: synchronously notify the new listener of the current PID so
      // its StatusBar / PID display updates. setImmediate avoids "ready"
      // arriving before the caller's `await spawn(...)` resolves — which would
      // be racy for renderers that subscribe right after.
      const pid = existing.pid;
      setImmediate(() => this.emit('ready', paneId, pid));
      return false;
    }
    if (this.panes.size >= PtyRegistry.MAX_PANES && !this.panes.has(paneId)) {
      throw new Error(`Pane limit reached (${PtyRegistry.MAX_PANES})`);
    }

    if (existing) {
      // Existing but pid==0 (dead). Clean up before respawn.
      this.dispose(paneId);
    }

    const mgr = new PtyManager();
    const onData = (data: string) => this.emit('data', paneId, data);
    const onExit = (code: number) => this.emit('exit', paneId, code);
    const onReady = (pid: number) => this.emit('ready', paneId, pid);

    mgr.on('data', onData);
    mgr.on('exit', onExit);
    mgr.on('ready', onReady);

    this.panes.set(paneId, mgr);
    this.paneListeners.set(paneId, { onData, onExit, onReady });

    try {
      mgr.spawn(cwd, opts);
    } catch (e) {
      // Roll back map entries on spawn failure so a future spawn(paneId) works.
      this.dispose(paneId);
      throw e;
    }
    return true;
  }

  /** Resolved command-line for a pane, or empty string if not spawned. */
  commandLineFor(paneId: string): string {
    return this.panes.get(paneId)?.commandLine ?? '';
  }

  write(paneId: string, data: string): void {
    const mgr = this.panes.get(paneId);
    if (!mgr) return;
    mgr.write(data);
  }

  resize(paneId: string, cols: number, rows: number): void {
    const mgr = this.panes.get(paneId);
    if (!mgr) return;
    mgr.resize(cols, rows);
  }

  kill(paneId: string): void {
    const mgr = this.panes.get(paneId);
    if (!mgr) return;
    try {
      mgr.kill();
    } catch {
      // best-effort; the PTY may already be dead
    }
    this.dispose(paneId);
  }

  killAll(): void {
    for (const id of [...this.panes.keys()]) {
      this.kill(id);
    }
  }

  /**
   * Remove all listeners for paneId and drop it from the map.
   * Safe to call on an unknown paneId.
   */
  private dispose(paneId: string): void {
    const mgr = this.panes.get(paneId);
    const ls = this.paneListeners.get(paneId);
    if (mgr && ls) {
      mgr.off('data', ls.onData);
      mgr.off('exit', ls.onExit);
      mgr.off('ready', ls.onReady);
    }
    this.panes.delete(paneId);
    this.paneListeners.delete(paneId);
    this.paneCategory.delete(paneId);
  }
}
