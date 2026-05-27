import { EventEmitter } from 'events';
import type { ResourceSnapshot } from '../shared/types';

let si: typeof import('systeminformation') | null = null;
try {
  si = require('systeminformation');
} catch {
  // systeminformation not available
}

/**
 * ResourceMonitor — system + per-bucket process aggregation.
 *
 * Originally tracked a single set of "claude" PIDs. v3.0.0-beta.3 split
 * into 3 buckets so a user running 5 local-model PTYs alongside Claude
 * gets honest numbers:
 *
 *   - `claude`  — PTYs running the Claude CLI (the original embedded
 *                 terminal flow). One per active terminal pane.
 *   - `models`  — PTYs spawned by MODELS_LAUNCH (typically `ollama run X`).
 *                 Each is a thin client; the heavy work happens in the
 *                 Ollama daemon child processes, which `getProcessTree`
 *                 picks up by walking the parent chain.
 *   - `ollama`  — the persistent Ollama daemon and its model-loader
 *                 children. NOT spawned by us — we discover it via a
 *                 process-name scan each poll. Includes RAM held by
 *                 currently-loaded models. (VRAM isn't reported here
 *                 — that requires vendor GPU SDKs; deferred.)
 *
 * Algorithmic note (perf):
 *   The previous version did O(n²) traversal: for each tracked root we
 *   did `list.find()` and `list.filter()` over the full system process
 *   list, every 2 seconds. With multi-model running 10+ PTYs each with
 *   5+ children, this got expensive. The new version builds a single
 *   parent-children adjacency map once per poll → O(n) walks per bucket.
 */
export class ResourceMonitor extends EventEmitter {
  private interval: ReturnType<typeof setInterval> | null = null;
  private claudePids: Set<number> = new Set();
  private modelPids: Set<number> = new Set();

  /** Back-compat single-PID setter — semantically "this is a Claude PTY". */
  setClaudePid(pid: number) {
    this.claudePids.clear();
    if (pid > 0) this.claudePids.add(pid);
  }

  /** Back-compat: existing callers that pre-date the bucket split call this
   *  with a flat list of every tracked PTY PID. We treat them all as
   *  Claude PIDs (pre-3.0.0-beta.3 behavior). Callers that know the
   *  per-pane command should use setTrackedPids() instead. */
  setClaudePids(pids: number[]) {
    this.claudePids.clear();
    for (const p of pids) {
      if (typeof p === 'number' && p > 0 && Number.isFinite(p)) {
        this.claudePids.add(p);
      }
    }
  }

  /**
   * Replace BOTH bucket sets at once. `claudePids` are PTYs running the
   * Claude CLI; `modelPids` are PTYs spawned via models:launch (typically
   * `ollama run X`). Both must be unique sets — overlaps de-duped by
   * `claude` winning the categorization tie.
   */
  setTrackedPids(claudePids: number[], modelPids: number[]) {
    this.claudePids.clear();
    this.modelPids.clear();
    for (const p of claudePids) {
      if (typeof p === 'number' && p > 0 && Number.isFinite(p)) {
        this.claudePids.add(p);
      }
    }
    for (const p of modelPids) {
      if (typeof p === 'number' && p > 0 && Number.isFinite(p)) {
        if (this.claudePids.has(p)) continue; // dedupe in favor of claude
        this.modelPids.add(p);
      }
    }
  }

  start(intervalMs = 2000) {
    if (this.interval || !si) return;
    this.poll();
    this.interval = setInterval(() => this.poll(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll() {
    if (!si) return;

    try {
      const needsProcs = this.claudePids.size > 0 || this.modelPids.size > 0;
      // Always fetch processes when models bucket may need to find the
      // Ollama daemon (which isn't in either tracked set — we name-match).
      const fetchProcs = needsProcs || true;
      const [cpu, mem, gpu, procs] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.graphics().catch(() => null),
        fetchProcs ? si.processes() : Promise.resolve(null),
      ]);

      // Build adjacency map ONCE per poll. Reused for every bucket walk.
      let byPid: Map<number, { cpu: number; mem_rss: number }> = new Map();
      let childrenOf: Map<number, number[]> = new Map();
      let ollamaDaemonPid: number | null = null;
      let ollamaRunnerCount = 0;
      if (procs) {
        for (const p of procs.list) {
          byPid.set(p.pid, { cpu: p.cpu, mem_rss: p.mem_rss });
          const siblings = childrenOf.get(p.parentPid);
          if (siblings) siblings.push(p.pid);
          else childrenOf.set(p.parentPid, [p.pid]);
        }
        // Name-scan for the Ollama daemon + helper processes. Most
        // installs run `ollama app.exe` (system tray UI) or just
        // `ollama.exe serve` (CLI daemon). Either way the binary basename
        // contains "ollama". We track the root daemon PID separately so
        // its CPU/RAM rolls up into the `ollama` bucket even when there
        // are no user-launched model PTYs.
        for (const p of procs.list as Array<{
          pid: number; parentPid: number; cpu: number; mem_rss: number;
          name?: string; command?: string;
        }>) {
          const name = (p.name || '').toLowerCase();
          const cmd = (p.command || '').toLowerCase();
          // ollama daemon detection: name starts with "ollama" AND (parent
          // is 0/1 OR command contains "serve"). Excludes our PTY-launched
          // `ollama run X` (parent is us, captured in modelPids).
          if (
            (name.startsWith('ollama') || cmd.includes('\\ollama') || cmd.includes('/ollama')) &&
            !this.modelPids.has(p.pid)
          ) {
            // Prefer the lowest-PID match if multiple daemons exist (unlikely).
            if (ollamaDaemonPid === null || p.pid < ollamaDaemonPid) {
              ollamaDaemonPid = p.pid;
            }
            // Also count any `ollama runner` / `llama-server` children that
            // are loading model weights — those are the real RAM owners.
            if (name.includes('runner') || cmd.includes(' runner') || name.includes('llama-server')) {
              ollamaRunnerCount++;
            }
          }
        }
      }

      const claudeAgg = this.aggregateTree(byPid, childrenOf, this.claudePids);
      const modelAgg = this.aggregateTree(byPid, childrenOf, this.modelPids);

      let ollamaCpu = 0;
      let ollamaRam = 0;
      let ollamaPidCount = 0;
      if (ollamaDaemonPid !== null) {
        const ollamaAgg = this.aggregateTree(
          byPid,
          childrenOf,
          new Set([ollamaDaemonPid])
        );
        ollamaCpu = ollamaAgg.cpu;
        ollamaRam = ollamaAgg.ram;
        ollamaPidCount = ollamaAgg.count;
      }

      const ramTotalGB = mem.total / (1024 ** 3);
      const ramUsedGB = mem.used / (1024 ** 3);

      let gpuPercent: number | null = null;
      if (gpu?.controllers?.length) {
        const ctrl = gpu.controllers[0];
        if (typeof ctrl.utilizationGpu === 'number') {
          gpuPercent = ctrl.utilizationGpu;
        }
      }

      const snapshot: ResourceSnapshot = {
        system: {
          cpuPercent: Math.round(cpu.currentLoad * 10) / 10,
          ramPercent: Math.round((ramUsedGB / ramTotalGB) * 1000) / 10,
          ramUsedGB: Math.round(ramUsedGB * 100) / 100,
          ramTotalGB: Math.round(ramTotalGB * 100) / 100,
          gpuPercent,
        },
        claude: {
          cpuPercent: Math.round(claudeAgg.cpu * 10) / 10,
          ramPercent: Math.round((claudeAgg.ram / mem.total) * 1000) / 10,
          ramMB: Math.round(claudeAgg.ram / (1024 * 1024)),
          pidCount: claudeAgg.count,
        },
        models: {
          cpuPercent: Math.round(modelAgg.cpu * 10) / 10,
          ramMB: Math.round(modelAgg.ram / (1024 * 1024)),
          pidCount: modelAgg.count,
        },
        ollama: {
          present: ollamaDaemonPid !== null,
          cpuPercent: Math.round(ollamaCpu * 10) / 10,
          ramMB: Math.round(ollamaRam / (1024 * 1024)),
          pidCount: ollamaPidCount,
          runnerCount: ollamaRunnerCount,
        },
        timestamp: Date.now(),
      };

      this.emit('update', snapshot);
    } catch {
      // Silently skip failed polls — next tick retries.
    }
  }

  /**
   * Walk parent → children using a pre-built adjacency map and sum CPU + RAM
   * for every reachable pid. Visited set prevents accidental double-count
   * across multiple roots that share an ancestor.
   */
  private aggregateTree(
    byPid: Map<number, { cpu: number; mem_rss: number }>,
    childrenOf: Map<number, number[]>,
    roots: Set<number>
  ): { cpu: number; ram: number; count: number } {
    let cpu = 0;
    let ram = 0;
    let count = 0;
    const visited = new Set<number>();
    const queue: number[] = [];
    for (const r of roots) queue.push(r);
    while (queue.length > 0) {
      const pid = queue.shift()!;
      if (visited.has(pid)) continue;
      visited.add(pid);
      const stats = byPid.get(pid);
      if (stats) {
        cpu += stats.cpu;
        ram += stats.mem_rss;
        count++;
      }
      const children = childrenOf.get(pid);
      if (children) {
        for (const c of children) {
          if (!visited.has(c)) queue.push(c);
        }
      }
    }
    return { cpu, ram, count };
  }
}
