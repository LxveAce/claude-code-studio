import * as os from 'os';
import si from 'systeminformation';

/**
 * HardwareDetection — quick read of the host's RAM / CPU / GPU, classified
 * into a tier that maps to the model catalog's hardwareTiers field.
 *
 * Tiers (sweet-spot for Q4_K_M quants — the catalog seeds use the same scale):
 *   toaster     — under-tier, only 1-3B models. Phones / very old laptops.
 *   low         — 7-8B at Q4 fits in RAM. Integrated GPU or 4-6 GB VRAM.
 *   mid         — 13-14B at Q4 or 7-8B at Q8. 16-32 GB RAM, 8-12 GB VRAM.
 *   high        — 32-34B at Q4 or 70B at Q2/Q3. 32-64 GB RAM, 16-24 GB VRAM.
 *   workstation — 70B at Q4-Q6 or larger MoE. 64+ GB RAM, 48+ GB VRAM or multi-GPU.
 *
 * The heuristic deliberately favors VRAM when present, because moving a model
 * off-GPU collapses throughput. RAM is the fallback for CPU-only inference.
 */

export type HardwareTier = 'toaster' | 'low' | 'mid' | 'high' | 'workstation';

export interface HardwareProfile {
  cpu: {
    model: string;
    physicalCores: number;
    logicalCores: number;
  };
  ramGB: number;
  gpus: Array<{
    name: string;
    vendor: string;
    vramGB: number | null;
  }>;
  /** Max VRAM across all GPUs (single-GPU heuristic). 0 = none detected. */
  maxVramGB: number;
  /** Sum of VRAM across all GPUs (multi-GPU upper bound). */
  totalVramGB: number;
  tier: HardwareTier;
  /** Short, opinionated paragraph: what this machine can realistically run. */
  summary: string;
  /** OS family for cross-platform behavior in the UI. */
  platform: 'win32' | 'darwin' | 'linux' | 'other';
  detectedAt: string;
}

let cache: { value: HardwareProfile; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function detectHardware(force = false): Promise<HardwareProfile> {
  if (!force && cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  // CPU + RAM via os module (cheap, no async). Use systeminformation for GPU
  // only because os has no GPU API.
  const ramGB = Math.round((os.totalmem() / 1e9) * 10) / 10;
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() || 'Unknown CPU';
  const logicalCores = cpus.length;

  let physicalCores = logicalCores;
  try {
    const cpuInfo = await si.cpu();
    if (typeof cpuInfo.physicalCores === 'number' && cpuInfo.physicalCores > 0) {
      physicalCores = cpuInfo.physicalCores;
    }
  } catch {
    // si.cpu failing is non-fatal; logical-cores estimate is fine.
  }

  const gpus: HardwareProfile['gpus'] = [];
  try {
    const g = await si.graphics();
    for (const c of g.controllers ?? []) {
      const vendor = (c.vendor || '').trim();
      const name = (c.model || '').trim();
      if (!name) continue;
      const vramMB = (c as unknown as { vram?: number }).vram;
      const vramGB =
        typeof vramMB === 'number' && vramMB > 0
          ? Math.round((vramMB / 1024) * 10) / 10
          : null;
      gpus.push({ name, vendor: vendor || 'Unknown', vramGB });
    }
  } catch {
    // GPU detection fails on locked-down systems; not fatal.
  }

  const vramValues = gpus.map((g) => g.vramGB ?? 0);
  const maxVramGB = vramValues.length ? Math.max(...vramValues) : 0;
  const totalVramGB = vramValues.reduce((a, b) => a + b, 0);

  const tier = classifyTier(ramGB, maxVramGB, totalVramGB, gpus.length);

  const profile: HardwareProfile = {
    cpu: { model: cpuModel, physicalCores, logicalCores },
    ramGB,
    gpus,
    maxVramGB,
    totalVramGB,
    tier,
    summary: buildSummary(ramGB, maxVramGB, tier, gpus),
    platform: normalizePlatform(process.platform),
    detectedAt: new Date().toISOString(),
  };

  cache = { value: profile, expiresAt: Date.now() + CACHE_TTL_MS };
  return profile;
}

export function classifyTier(
  ramGB: number,
  maxVramGB: number,
  totalVramGB: number,
  gpuCount: number
): HardwareTier {
  // Workstation: 70B-class workloads.
  if (ramGB >= 64 && (totalVramGB >= 48 || gpuCount >= 2)) return 'workstation';
  // High: 32B at Q4 single-GPU.
  if (ramGB >= 32 && maxVramGB >= 16) return 'high';
  // Mid: 13B at Q4 or 7B at Q8.
  if (ramGB >= 16 && maxVramGB >= 8) return 'mid';
  if (ramGB >= 16 && totalVramGB >= 8) return 'mid';
  if (ramGB >= 24) return 'mid'; // CPU-friendly mid: lots of RAM, weak GPU
  // Low: 7-8B at Q4 fits.
  if (ramGB >= 8) return 'low';
  return 'toaster';
}

function buildSummary(
  ramGB: number,
  maxVramGB: number,
  tier: HardwareTier,
  gpus: HardwareProfile['gpus']
): string {
  const gpuLabel =
    gpus.length === 0
      ? 'no dedicated GPU detected'
      : `${gpus[0].name}${maxVramGB > 0 ? ` (${maxVramGB} GB VRAM)` : ''}`;
  const sweetSpot = sweetSpotFor(tier);
  return `${ramGB} GB RAM · ${gpuLabel}. Sweet spot: ${sweetSpot}.`;
}

function sweetSpotFor(tier: HardwareTier): string {
  switch (tier) {
    case 'workstation':
      return '70B at Q4-Q6, or large MoE models';
    case 'high':
      return '32-34B at Q4, or 70B at heavy quant';
    case 'mid':
      return '13-14B at Q4, or 7-8B at Q8';
    case 'low':
      return '7-8B at Q4_K_M';
    case 'toaster':
      return '1-3B models at heavy quant';
  }
}

function normalizePlatform(p: NodeJS.Platform): HardwareProfile['platform'] {
  if (p === 'win32' || p === 'darwin' || p === 'linux') return p;
  return 'other';
}

/** Tier ordering for "this model needs at least tier X" comparisons. */
export const TIER_ORDER: Record<HardwareTier, number> = {
  toaster: 0,
  low: 1,
  mid: 2,
  high: 3,
  workstation: 4,
};

export function tierMeetsOrExceeds(have: HardwareTier, need: HardwareTier): boolean {
  return TIER_ORDER[have] >= TIER_ORDER[need];
}
