import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  CostDayTotal,
  CostModel,
  CostRateTable,
  CostSettings,
  CostStatus,
  SessionTotal,
} from '../shared/types';

const STATE_DIR = path.join(os.homedir(), '.claude', 'compact-controller');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const VAULT_DIR = path.join(STATE_DIR, 'vault');
const HISTORY_FILE = 'cost-history.json';
const SETTINGS_FILE = 'cost-settings.json';

const POLL_INTERVAL_MS = 30_000;
const HISTORY_KEEP_DAYS = 90; // keep recent history; trim older
const RETURN_DAYS = 30;
const MAX_VAULT_BYTES = 1024 * 1024; // mirror cloud-sync cap
const MAX_DAILY_TOKENS = 1_000_000_000; // 1B per day — sanity ceiling to defuse junk
const MAX_HISTORY_BYTES = 4 * 1024 * 1024; // cap our own history file (4 MB → ~90 days × 1k sessions)
const MAX_SESSIONS_TRACKED = 5_000; // sanity ceiling on session map size
const MAX_VAULTS_PER_SAMPLE = 500; // bound vault dir scan per poll
const VAULT_NAME_RE = /^vault-[A-Za-z0-9._-]+\.json$/;

// ---------------------------------------------------------------------------
// Rates: USD per 1M tokens. EDIT IF ANTHROPIC PRICING CHANGES.
// Last verified: 2026-05-27 against anthropic.com/pricing
//   - Opus 4.x:    $15 input / $75 output per 1M
//   - Sonnet 4.x:  $3 input / $15 output per 1M
//   - Haiku 4.x:   $1 input / $5 output per 1M  (was $0.8/$4 — bumped May 2026)
// The dashboard is a heuristic; actual invoiced cost will differ. We render
// a "rough estimate" disclaimer prominently so the number isn't mistaken
// for billing truth.
// ---------------------------------------------------------------------------
export const COST_RATES: CostRateTable = {
  opus: { inputPerMillion: 15, outputPerMillion: 75 },
  sonnet: { inputPerMillion: 3, outputPerMillion: 15 },
  haiku: { inputPerMillion: 1, outputPerMillion: 5 },
};

const COST_DISCLAIMER =
  'Rough estimate only. Counts only Anthropic API usage (local models via ' +
  'Ollama are free — never counted). Model used per turn isn\'t recorded, ' +
  'rates assume your selected model in settings, and history-only sessions ' +
  'lack per-call output counts. Trust anthropic.com/console for billing.';

interface StateJson {
  session_id?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  turn_count?: unknown;
  [k: string]: unknown;
}

interface VaultJson {
  session_id?: unknown;
  context_tokens?: unknown;
  output_tokens_total?: unknown;
  output_tokens?: unknown;
  turn_count?: unknown;
  [k: string]: unknown;
}

interface SessionSample {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  /** Local-date (YYYY-MM-DD) bucket key. */
  date: string;
  /** Source kind for tie-break: state.json wins over vault for the same session. */
  source: 'state' | 'vault';
}

interface HistoryStore {
  /** date -> CostDayTotal (rebuilt every poll from session map). */
  days: Record<string, CostDayTotal>;
  /**
   * sessionId -> {inputTokens, outputTokens, date} latest sample.
   * Allows recomputing daily totals without double-counting when a
   * session updates (state.json grows; then vault replaces it).
   */
  sessions: Record<string, { inputTokens: number; outputTokens: number; date: string }>;
  /**
   * Date on which the budget-exceeded notification was last fired.
   * Prevents notification spam: at most one alert per day per device.
   */
  lastBudgetAlertDate: string | null;
}

const DEFAULT_SETTINGS: CostSettings = {
  dailyBudgetUSD: 0,
  model: 'sonnet',
};

function freshHistory(): HistoryStore {
  return { days: {}, sessions: {}, lastBudgetAlertDate: null };
}

export class CostService {
  private historyPath: string;
  private settingsPath: string;
  private history: HistoryStore;
  private settings: CostSettings;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSampledAt: string | null = null;
  private sampling = false;
  /** vault file name -> last mtime (ms) we processed. Avoids re-parsing
   *  unchanged vault files every 30 s. */
  private vaultMtimeCache = new Map<string, number>();
  /** Most recent session_id seen in state.json. null when state.json is
   *  absent or unparseable. Used by listSessions() to flag the active
   *  conversation in the panel. */
  private currentSessionId: string | null = null;

  constructor(private onBudgetExceeded: (today: CostDayTotal, budget: number) => void = () => {}) {
    const userData = app.getPath('userData');
    this.historyPath = path.join(userData, HISTORY_FILE);
    this.settingsPath = path.join(userData, SETTINGS_FILE);
    this.history = this.readHistory();
    this.settings = this.readSettings();
  }

  start(): void {
    if (this.timer) return;
    // Fire one sample immediately so the panel paints with data, then poll.
    void this.sample();
    this.timer = setInterval(() => {
      void this.sample();
    }, POLL_INTERVAL_MS);
    // Don't block the event loop from exiting on app quit.
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus(): CostStatus {
    const today = this.todayKey();
    const todayTotal = this.history.days[today] ?? this.emptyDay(today);
    const budget = this.settings.dailyBudgetUSD;
    const budgetExceeded = budget > 0 && todayTotal.estCostUSD >= budget;
    return {
      today: todayTotal,
      last30Days: this.last30Days(),
      rates: COST_RATES,
      settings: { ...this.settings },
      budgetExceeded,
      lastSampledAt: this.lastSampledAt,
      disclaimer: COST_DISCLAIMER,
    };
  }

  getSettings(): CostSettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<CostSettings>): CostSettings {
    const next: CostSettings = { ...this.settings };
    if (partial.dailyBudgetUSD !== undefined) {
      const v = partial.dailyBudgetUSD;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000) {
        throw new Error('dailyBudgetUSD must be a finite number in [0, 10000]');
      }
      next.dailyBudgetUSD = v;
    }
    if (partial.model !== undefined) {
      if (partial.model !== 'opus' && partial.model !== 'sonnet' && partial.model !== 'haiku') {
        throw new Error('model must be one of: opus, sonnet, haiku');
      }
      next.model = partial.model;
    }
    this.settings = next;
    this.writeSettings();
    // Recompute days using new model rates so the panel reflects immediately.
    this.recomputeDays();
    this.writeHistory();
    return { ...this.settings };
  }

  resetHistory(): void {
    this.history = freshHistory();
    // Drop the per-vault mtime cache so the next sample re-ingests history
    // from the vault dir. Without this, "reset" would feel broken — totals
    // would stay at zero until a new vault file landed.
    this.vaultMtimeCache.clear();
    this.writeHistory();
  }

  /** Test seam — force one sample cycle. */
  async sampleNow(): Promise<void> {
    await this.sample();
  }

  // -------------------------------------------------------------------------
  // Sampling
  // -------------------------------------------------------------------------

  private async sample(): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const samples: SessionSample[] = [];

      const stateSample = this.readStateSample();
      if (stateSample) samples.push(stateSample);

      for (const vaultSample of this.readVaultSamples()) {
        samples.push(vaultSample);
      }

      // Apply samples: state wins over vault for the same session_id, so we
      // iterate state-first then only insert vault entries for unseen sessions.
      // (The vault is written at session-end with context_tokens which may
      // overstate "input tokens billed" — we use it as the lower-bound proxy.)
      const seenStateSessions = new Set<string>();
      for (const s of samples) {
        if (s.source === 'state') seenStateSessions.add(s.sessionId);
      }
      for (const s of samples) {
        if (s.source === 'vault' && seenStateSessions.has(s.sessionId)) continue;
        this.recordSession(s);
      }

      this.recomputeDays();
      this.lastSampledAt = new Date().toISOString();
      this.writeHistory();
      this.maybeFireBudgetAlert();
    } catch {
      // Sampling is best-effort. Don't propagate — next tick will retry.
    } finally {
      this.sampling = false;
    }
  }

  /**
   * Per-conversation token totals (Phase 7f). Returns one row per
   * session_id ever seen, sorted by last-activity date descending
   * (most recent first). Cost is estimated against the currently-selected
   * model rate — same heuristic caveats as the daily totals apply.
   */
  listSessions(): SessionTotal[] {
    const out: SessionTotal[] = [];
    const current = this.currentSessionId;
    for (const [sid, rec] of Object.entries(this.history.sessions)) {
      if (!rec || typeof rec !== 'object') continue;
      if (typeof sid !== 'string' || sid.length === 0 || sid.length > 256) continue;
      if (!isValidDateKey(rec.date)) continue;
      const inputTokens = clampTokens(rec.inputTokens);
      const outputTokens = clampTokens(rec.outputTokens);
      out.push({
        sessionId: sid,
        inputTokens,
        outputTokens,
        estCostUSD: this.estimateCost(inputTokens, outputTokens),
        lastActivityDate: rec.date,
        isCurrent: current === sid,
      });
    }
    // Sort by date desc; current session pinned to top regardless of date
    // (so the active conversation is always visible without scrolling even
    // if it hasn't crossed a date boundary).
    out.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return b.lastActivityDate.localeCompare(a.lastActivityDate);
    });
    return out;
  }

  private readStateSample(): SessionSample | null {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(STATE_FILE);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.size > MAX_VAULT_BYTES) return null;
    let raw: string;
    try {
      raw = fs.readFileSync(STATE_FILE, 'utf8');
    } catch {
      return null;
    }
    // The state file can be observed mid-write by the compact-controller hooks.
    // Treat parse failures as transient — the next 30 s tick will catch up.
    let parsed: StateJson;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : null;
    if (!sessionId) return null;
    if (sessionId.length === 0 || sessionId.length > 256) return null;
    // Remember the live state's session_id so listSessions() can flag it
    // even if input+output is 0 (a brand-new conversation may exist before
    // the first input lands in state.json).
    this.currentSessionId = sessionId;
    const input = clampTokens(parsed.input_tokens);
    const output = clampTokens(parsed.output_tokens);
    if (input === 0 && output === 0) return null;
    return {
      sessionId,
      inputTokens: input,
      outputTokens: output,
      // Bucket by file mtime — this is when the controller last wrote the
      // counters. Wall-clock now() would skew toward "today" for sessions
      // that started yesterday and didn't update.
      date: localDateKey(stat.mtime),
      source: 'state',
    };
  }

  private *readVaultSamples(): Generator<SessionSample> {
    let entries: string[];
    try {
      entries = fs.readdirSync(VAULT_DIR);
    } catch {
      return;
    }
    // Cap how many vault files we look at per poll to bound CPU/IO. If the
    // vault dir grows past MAX_VAULTS_PER_SAMPLE we prefer the alphabetically
    // last entries — vault names embed timestamps so this gives newest-first.
    if (entries.length > MAX_VAULTS_PER_SAMPLE) {
      entries.sort();
      entries = entries.slice(-MAX_VAULTS_PER_SAMPLE);
    }
    // Bound the mtime cache so it can't grow unboundedly across long uptimes
    // when vaults rotate. Trim before potentially adding to it.
    if (this.vaultMtimeCache.size > MAX_VAULTS_PER_SAMPLE * 2) {
      this.vaultMtimeCache.clear();
    }
    // Aggregate to latest snapshot per session_id (vaults can rotate).
    const latestBySession = new Map<string, SessionSample>();
    for (const name of entries) {
      if (!VAULT_NAME_RE.test(name)) continue;
      const full = path.resolve(VAULT_DIR, name);
      // Path-traversal guard: must be a direct child of VAULT_DIR.
      if (path.dirname(full) !== path.resolve(VAULT_DIR)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_VAULT_BYTES) continue;
      // Skip vaults we've already parsed and that haven't changed since.
      // Their session is already recorded in this.history.sessions, so we
      // can safely avoid the disk read + JSON parse cost.
      const mtimeMs = stat.mtime.getTime();
      const seenMtime = this.vaultMtimeCache.get(name);
      if (seenMtime === mtimeMs) continue;
      let raw: string;
      try {
        raw = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      let parsed: VaultJson;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : null;
      if (!sessionId) continue;
      if (sessionId.length === 0 || sessionId.length > 256) continue;
      // context_tokens reflects the input-context size at session end. We treat
      // it as the lower-bound proxy for "input tokens used by this session"
      // since per-call accounting isn't surfaced in the vault.
      const input = clampTokens(parsed.context_tokens);
      // Vault may also store cumulative output_tokens (newer controller versions);
      // fall back to 0 if absent. Output cost is therefore *under*-counted for
      // historical sessions — we surface this in the UI disclaimer.
      const output = clampTokens(parsed.output_tokens_total ?? parsed.output_tokens);
      // Mark as seen even if we won't yield (input+output=0) — we don't want
      // to re-read this unchanged file on the next tick.
      this.vaultMtimeCache.set(name, mtimeMs);
      if (input === 0 && output === 0) continue;
      const sample: SessionSample = {
        sessionId,
        inputTokens: input,
        outputTokens: output,
        date: localDateKey(stat.mtime),
        source: 'vault',
      };
      const prev = latestBySession.get(sessionId);
      if (!prev || sample.inputTokens + sample.outputTokens > prev.inputTokens + prev.outputTokens) {
        latestBySession.set(sessionId, sample);
      }
    }
    for (const s of latestBySession.values()) yield s;
  }

  private recordSession(s: SessionSample): void {
    // Bound session map size. If we're at the ceiling and this is a new id,
    // drop the oldest-dated session to make room. Existing-id updates are
    // always allowed (so an active session can keep growing its counters).
    if (
      !(s.sessionId in this.history.sessions) &&
      Object.keys(this.history.sessions).length >= MAX_SESSIONS_TRACKED
    ) {
      let oldestSid: string | null = null;
      // YYYY-MM-DD lexicographic sort works for our date format. '9999-99-99'
      // is a valid sentinel greater than any plausible value we'd store.
      let oldestDate = '9999-99-99';
      for (const [sid, rec] of Object.entries(this.history.sessions)) {
        if (rec && rec.date < oldestDate) {
          oldestDate = rec.date;
          oldestSid = sid;
        }
      }
      if (oldestSid) delete this.history.sessions[oldestSid];
    }
    this.history.sessions[s.sessionId] = {
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      date: s.date,
    };
  }

  private recomputeDays(): void {
    const days: Record<string, CostDayTotal> = {};
    for (const rec of Object.values(this.history.sessions)) {
      if (!rec || typeof rec !== 'object') continue;
      const date = rec.date;
      if (!isValidDateKey(date)) continue;
      const input = clampTokens(rec.inputTokens);
      const output = clampTokens(rec.outputTokens);
      const day = days[date] ?? this.emptyDay(date);
      day.inputTokens += input;
      day.outputTokens += output;
      day.sessionCount += 1;
      days[date] = day;
    }
    for (const date of Object.keys(days)) {
      const d = days[date];
      // Cap per-day totals to a sanity ceiling — defuses corrupt data without
      // letting the UI render an absurd number.
      d.inputTokens = Math.min(d.inputTokens, MAX_DAILY_TOKENS);
      d.outputTokens = Math.min(d.outputTokens, MAX_DAILY_TOKENS);
      d.estCostUSD = this.estimateCost(d.inputTokens, d.outputTokens);
    }
    // Trim history beyond HISTORY_KEEP_DAYS to bound file growth.
    const cutoff = daysAgoKey(HISTORY_KEEP_DAYS);
    for (const date of Object.keys(days)) {
      if (date < cutoff) delete days[date];
    }
    this.history.days = days;
    // Also trim sessions whose date is past cutoff to bound memory.
    for (const sid of Object.keys(this.history.sessions)) {
      const rec = this.history.sessions[sid];
      if (!rec || rec.date < cutoff) delete this.history.sessions[sid];
    }
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    const rate = COST_RATES[this.settings.model];
    const inputCost = (inputTokens / 1_000_000) * rate.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * rate.outputPerMillion;
    return roundUSD(inputCost + outputCost);
  }

  private maybeFireBudgetAlert(): void {
    const budget = this.settings.dailyBudgetUSD;
    if (budget <= 0) return;
    const today = this.todayKey();
    const day = this.history.days[today];
    if (!day || day.estCostUSD < budget) return;
    if (this.history.lastBudgetAlertDate === today) return; // fired already today
    this.history.lastBudgetAlertDate = today;
    this.writeHistory();
    try {
      this.onBudgetExceeded(day, budget);
    } catch {
      // notification surface must never crash the sampling loop
    }
  }

  // -------------------------------------------------------------------------
  // History views
  // -------------------------------------------------------------------------

  private last30Days(): CostDayTotal[] {
    const out: CostDayTotal[] = [];
    for (let i = RETURN_DAYS - 1; i >= 0; i--) {
      const key = daysAgoKey(i);
      out.push(this.history.days[key] ?? this.emptyDay(key));
    }
    return out;
  }

  private emptyDay(date: string): CostDayTotal {
    return {
      date,
      inputTokens: 0,
      outputTokens: 0,
      estCostUSD: 0,
      sessionCount: 0,
    };
  }

  private todayKey(): string {
    return localDateKey(new Date());
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private readHistory(): HistoryStore {
    // Stat first so a corrupt/oversized history file can't OOM us on startup.
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.historyPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return freshHistory();
      return freshHistory();
    }
    if (!stat.isFile()) return freshHistory();
    if (stat.size > MAX_HISTORY_BYTES) {
      // Don't try to parse — quarantine and start over. Loud disclaimer about
      // why: any file this big is almost certainly a bug or attack, not real
      // 90-day usage data.
      this.quarantineHistoryFile();
      return freshHistory();
    }
    let raw: string;
    try {
      raw = fs.readFileSync(this.historyPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return freshHistory();
      }
      return freshHistory();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt file: rename it aside so we don't silently overwrite a file
      // that may carry user-recoverable data — then start fresh.
      this.quarantineHistoryFile();
      return freshHistory();
    }
    if (!parsed || typeof parsed !== 'object') return freshHistory();
    const rec = parsed as Record<string, unknown>;
    const days: Record<string, CostDayTotal> = {};
    const sessions: Record<string, { inputTokens: number; outputTokens: number; date: string }> = {};
    if (rec.days && typeof rec.days === 'object') {
      for (const [key, value] of Object.entries(rec.days as Record<string, unknown>)) {
        if (!isValidDateKey(key)) continue;
        const v = value as Partial<CostDayTotal>;
        if (!v || typeof v !== 'object') continue;
        days[key] = {
          date: key,
          inputTokens: clampTokens(v.inputTokens),
          outputTokens: clampTokens(v.outputTokens),
          estCostUSD: roundUSD(typeof v.estCostUSD === 'number' ? v.estCostUSD : 0),
          sessionCount: Math.max(0, Math.floor(typeof v.sessionCount === 'number' ? v.sessionCount : 0)),
        };
      }
    }
    if (rec.sessions && typeof rec.sessions === 'object') {
      let loaded = 0;
      for (const [sid, value] of Object.entries(rec.sessions as Record<string, unknown>)) {
        if (loaded >= MAX_SESSIONS_TRACKED) break;
        if (typeof sid !== 'string' || sid.length === 0 || sid.length > 256) continue;
        const v = value as { inputTokens?: unknown; outputTokens?: unknown; date?: unknown };
        if (!v || typeof v !== 'object') continue;
        const date = typeof v.date === 'string' ? v.date : null;
        if (!date || !isValidDateKey(date)) continue;
        sessions[sid] = {
          inputTokens: clampTokens(v.inputTokens),
          outputTokens: clampTokens(v.outputTokens),
          date,
        };
        loaded++;
      }
    }
    const lastBudgetAlertDate =
      typeof rec.lastBudgetAlertDate === 'string' && isValidDateKey(rec.lastBudgetAlertDate)
        ? rec.lastBudgetAlertDate
        : null;
    return { days, sessions, lastBudgetAlertDate };
  }

  private quarantineHistoryFile(): void {
    try {
      const quarantine = `${this.historyPath}.corrupt-${Date.now()}`;
      fs.renameSync(this.historyPath, quarantine);
    } catch {
      // best-effort
    }
  }

  private writeHistory(): void {
    this.writeJsonAtomic(this.historyPath, this.history);
  }

  private readSettings(): CostSettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.settingsPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS };
    }
    let parsed: Partial<CostSettings>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
    const budget =
      typeof parsed.dailyBudgetUSD === 'number' &&
      Number.isFinite(parsed.dailyBudgetUSD) &&
      parsed.dailyBudgetUSD >= 0 &&
      parsed.dailyBudgetUSD <= 10_000
        ? parsed.dailyBudgetUSD
        : DEFAULT_SETTINGS.dailyBudgetUSD;
    const model: CostModel =
      parsed.model === 'opus' || parsed.model === 'sonnet' || parsed.model === 'haiku'
        ? parsed.model
        : DEFAULT_SETTINGS.model;
    return { dailyBudgetUSD: budget, model };
  }

  private writeSettings(): void {
    this.writeJsonAtomic(this.settingsPath, this.settings);
  }

  private writeJsonAtomic(target: string, payload: unknown): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, target);
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

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clampTokens(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  // Cap at MAX_DAILY_TOKENS to defuse corrupt vault rows.
  return Math.min(Math.floor(value), MAX_DAILY_TOKENS);
}

function roundUSD(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10_000) / 10_000;
}

function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysAgoKey(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return localDateKey(d);
}

function isValidDateKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
