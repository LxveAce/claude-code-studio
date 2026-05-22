import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Octokit } from '@octokit/rest';
import type {
  LocalVault,
  RemoteVault,
  SyncSettings,
  SyncStatus,
  VaultPreview,
} from '../shared/types';
import type { GitHubService } from './github-service';

import * as crypto from 'node:crypto';

const SETTINGS_FILE = 'cloud-sync-settings.json';
const PUSHED_INDEX_FILE = 'cloud-sync-pushed.json';
const VAULT_DIR = path.join(os.homedir(), '.claude', 'compact-controller', 'vault');
const DEFAULT_REPO_NAME = 'claude-conversation-vaults';
const DEFAULT_BRANCH = 'main';
const DEFAULT_DEBOUNCE_MS = 5000;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MB hard cap per vault
const REQUIRED_SCOPES = ['repo']; // private-repo write
const DEVICE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/i;
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;
const VAULT_NAME_RE = /^vault-[A-Za-z0-9._-]+\.json$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_FAIL_ATTEMPTS = 3;
const FAIL_BACKOFF_MS = 15 * 60 * 1000; // 15 min before re-trying a failing file
const PUSH_DELAY_MS = 500; // light token-bucket for sequential pushes

interface PushedIndex {
  [vaultName: string]: { sha: string; pushedAt: string };
}

interface FailRecord {
  attempts: number;
  lastFailAt: string;
  lastError: string;
}

export class CloudSyncService {
  private settingsPath: string;
  private pushedPath: string;
  private settings: SyncSettings;
  private pushed: PushedIndex;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  private pendingCount = 0;
  private failures = new Map<string, FailRecord>();

  constructor(
    private githubService: GitHubService,
    private onSyncError: (message: string) => void = () => {}
  ) {
    const userData = app.getPath('userData');
    this.settingsPath = path.join(userData, SETTINGS_FILE);
    this.pushedPath = path.join(userData, PUSHED_INDEX_FILE);
    this.settings = this.readSettings();
    this.pushed = this.readPushed();
    if (this.settings.enabled && this.settings.consentAt) {
      this.startWatcher();
    }
  }

  getSettings(): SyncSettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<SyncSettings>): SyncSettings {
    const next: SyncSettings = { ...this.settings };

    if (partial.enabled !== undefined) {
      if (typeof partial.enabled !== 'boolean') {
        throw new Error('enabled must be a boolean');
      }
      next.enabled = partial.enabled;
    }
    if (partial.owner !== undefined) {
      if (partial.owner === null) {
        next.owner = null;
      } else if (typeof partial.owner === 'string' && OWNER_RE.test(partial.owner)) {
        next.owner = partial.owner;
      } else {
        throw new Error(`Invalid owner: ${String(partial.owner)}`);
      }
    }
    if (partial.repo !== undefined) {
      if (partial.repo === null) {
        next.repo = null;
      } else if (typeof partial.repo === 'string' && REPO_NAME_RE.test(partial.repo)) {
        next.repo = partial.repo;
      } else {
        throw new Error(`Invalid repo name: ${String(partial.repo)}`);
      }
    }
    if (partial.deviceName !== undefined) {
      if (typeof partial.deviceName !== 'string' || !DEVICE_NAME_RE.test(partial.deviceName)) {
        throw new Error(`Invalid deviceName: ${String(partial.deviceName)}`);
      }
      next.deviceName = partial.deviceName;
    }
    if (partial.branch !== undefined) {
      if (typeof partial.branch !== 'string' || !BRANCH_RE.test(partial.branch)) {
        throw new Error(`Invalid branch: ${String(partial.branch)}`);
      }
      next.branch = partial.branch;
    }
    if (partial.consentAt !== undefined) {
      if (partial.consentAt === null) {
        next.consentAt = null;
      } else if (typeof partial.consentAt === 'string' && Number.isFinite(Date.parse(partial.consentAt))) {
        next.consentAt = partial.consentAt;
      } else {
        throw new Error('Invalid consentAt');
      }
    }
    if (partial.debounceMs !== undefined) {
      if (typeof partial.debounceMs !== 'number' || partial.debounceMs < 1000 || partial.debounceMs > 300000) {
        throw new Error('debounceMs must be a number in [1000, 300000]');
      }
      next.debounceMs = partial.debounceMs;
    }

    // Enabling requires repo configured + consent recorded.
    if (next.enabled) {
      if (!next.owner || !next.repo) {
        throw new Error('Cannot enable: owner/repo not configured. Use the setup wizard first.');
      }
      if (!next.consentAt) {
        throw new Error('Cannot enable: vault upload consent not recorded.');
      }
    }

    this.settings = next;
    this.writeSettings();

    if (next.enabled) {
      this.startWatcher();
    } else {
      this.stopWatcher();
    }

    return { ...this.settings };
  }

  async getStatus(): Promise<SyncStatus> {
    const ghState = this.githubService.getAuthState();
    const ghScopeOk =
      ghState.hasToken &&
      REQUIRED_SCOPES.every((s) => ghState.scopes.includes(s));
    const local = this.listLocalVaults();
    return {
      configured: Boolean(this.settings.owner && this.settings.repo && this.settings.consentAt),
      enabled: this.settings.enabled,
      ghConnected: ghState.hasToken,
      ghScopeOk,
      ghScopes: ghState.scopes,
      localVaultCount: local.length,
      pushedCount: local.filter((v) => v.pushed).length,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      pendingCount: this.pendingCount,
    };
  }

  listLocalVaults(): LocalVault[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(VAULT_DIR);
    } catch {
      return [];
    }
    const out: LocalVault[] = [];
    for (const name of entries) {
      if (!VAULT_NAME_RE.test(name)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(path.join(VAULT_DIR, name));
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      out.push({
        name,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        pushed: Boolean(this.pushed[this.remoteKey(name)]),
      });
    }
    return out.sort((a, b) => b.modified.localeCompare(a.modified));
  }

  previewVault(name: string): VaultPreview | null {
    if (!VAULT_NAME_RE.test(name)) return null;
    const target = path.resolve(VAULT_DIR, name);
    if (path.dirname(target) !== path.resolve(VAULT_DIR)) return null;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    let parsed: Record<string, unknown>;
    try {
      const raw = fs.readFileSync(target, 'utf8');
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const tail = typeof parsed.transcript_tail === 'string' ? parsed.transcript_tail : '';
    return {
      name,
      size: stat.size,
      sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : null,
      contextTokens: typeof parsed.context_tokens === 'number' ? parsed.context_tokens : null,
      turnCount: typeof parsed.turn_count === 'number' ? parsed.turn_count : null,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : null,
      transcriptTailExcerpt: tail.slice(0, 800),
      transcriptTailBytes: Buffer.byteLength(tail, 'utf8'),
    };
  }

  async listRemoteVaults(): Promise<RemoteVault[]> {
    const { client, owner, repo, deviceName } = this.requireConfig();
    try {
      const { data } = await client.repos.getContent({
        owner,
        repo,
        path: deviceName,
        ref: this.settings.branch,
      });
      if (!Array.isArray(data)) return [];
      return data
        .filter((d) => d.type === 'file' && VAULT_NAME_RE.test(d.name))
        .map((d) => ({
          name: d.name,
          size: d.size,
          sha: d.sha,
          path: d.path,
          htmlUrl: d.html_url ?? '',
        }));
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      if (status === 404) return [];
      throw e;
    }
  }

  async createRepo(repoName: string): Promise<{ owner: string; name: string }> {
    if (!REPO_NAME_RE.test(repoName)) {
      throw new Error(`Invalid repo name: ${repoName}`);
    }
    const client = this.requireClient();
    const { data } = await client.repos.createForAuthenticatedUser({
      name: repoName,
      private: true,
      auto_init: true,
      description: 'Claude Code Studio — conversation vault backups',
    });
    return { owner: data.owner.login, name: data.name };
  }

  async verifyRepo(owner: string, repo: string): Promise<{ defaultBranch: string; isPrivate: boolean }> {
    if (!OWNER_RE.test(owner) || !REPO_NAME_RE.test(repo)) {
      throw new Error('Invalid owner/repo');
    }
    const client = this.requireClient();
    const { data } = await client.repos.get({ owner, repo });
    if (!data.private) {
      throw new Error('Refusing to use a public repository for vault sync. Make it private first.');
    }
    const me = await client.users.getAuthenticated();
    let permission: string | null = null;
    try {
      const perm = await client.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username: me.data.login,
      });
      permission = perm.data.permission;
    } catch {
      permission = null;
    }
    if (!permission || !['admin', 'write', 'maintain'].includes(permission)) {
      throw new Error(
        `You don't have write access to ${owner}/${repo} (got: ${permission ?? 'none'}). ` +
          `Vault sync needs admin/maintain/write permission.`
      );
    }
    return { defaultBranch: data.default_branch, isPrivate: data.private };
  }

  async deleteRemoteVault(name: string): Promise<{ deleted: boolean }> {
    if (!VAULT_NAME_RE.test(name)) throw new Error(`Invalid vault name: ${name}`);
    const { client, owner, repo, deviceName } = this.requireConfig();
    const remotePath = `${deviceName}/${name}`;
    const existing = await client.repos.getContent({
      owner,
      repo,
      path: remotePath,
      ref: this.settings.branch,
    });
    if (Array.isArray(existing.data) || existing.data.type !== 'file') {
      throw new Error(`Remote vault ${name} not found`);
    }
    await client.repos.deleteFile({
      owner,
      repo,
      path: remotePath,
      message: `Delete vault ${name} from ${deviceName}`,
      sha: existing.data.sha,
      branch: this.settings.branch,
    });
    delete this.pushed[this.remoteKey(name)];
    this.writePushed();
    return { deleted: true };
  }

  async syncNow(): Promise<SyncStatus> {
    if (this.syncing) return this.getStatus();
    if (!this.settings.enabled) return this.getStatus();
    this.syncing = true;
    this.lastError = null;
    const perFileErrors: string[] = [];
    try {
      const { client, owner, repo, deviceName } = this.requireConfig();
      const local = this.listLocalVaults();
      this.pendingCount = local.filter((v) => !v.pushed).length;
      let pushedThisRun = 0;
      for (const v of local) {
        if (this.pushed[this.remoteKey(v.name)]) continue;
        if (this.shouldSkipFailed(v.name)) continue;
        try {
          if (pushedThisRun > 0) {
            await new Promise((r) => setTimeout(r, PUSH_DELAY_MS));
          }
          await this.pushVault(client, owner, repo, deviceName, v.name);
          this.failures.delete(v.name);
          pushedThisRun++;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          this.recordFailure(v.name, msg);
          perFileErrors.push(`${v.name}: ${msg}`);
        } finally {
          this.pendingCount = Math.max(0, this.pendingCount - 1);
        }
      }
      this.lastSyncAt = new Date().toISOString();
      this.lastError = perFileErrors.length === 0 ? null : perFileErrors.join('; ');
    } catch (e: unknown) {
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.syncing = false;
    }
    if (this.lastError) {
      try {
        this.onSyncError(this.lastError);
      } catch {
        // notification callback must never break sync
      }
    }
    return this.getStatus();
  }

  private shouldSkipFailed(name: string): boolean {
    const f = this.failures.get(name);
    if (!f) return false;
    if (f.attempts < MAX_FAIL_ATTEMPTS) return false;
    const ms = Date.now() - Date.parse(f.lastFailAt);
    return Number.isFinite(ms) && ms < FAIL_BACKOFF_MS;
  }

  private recordFailure(name: string, error: string): void {
    const existing = this.failures.get(name);
    this.failures.set(name, {
      attempts: (existing?.attempts ?? 0) + 1,
      lastFailAt: new Date().toISOString(),
      lastError: error,
    });
  }

  // --- internals ---

  private async pushVault(
    client: Octokit,
    owner: string,
    repo: string,
    deviceName: string,
    name: string
  ): Promise<void> {
    const source = path.resolve(VAULT_DIR, name);
    if (path.dirname(source) !== path.resolve(VAULT_DIR)) {
      throw new Error(`Vault escapes vault dir: ${name}`);
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(source);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size === 0) return;
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`Vault ${name} is ${stat.size}B (cap ${MAX_FILE_BYTES}B) — skipping`);
    }
    const content = fs.readFileSync(source);
    const remotePath = `${deviceName}/${name}`;
    const message = `Vault ${name} from ${deviceName}`;

    let sha: string | undefined;
    try {
      const existing = await client.repos.getContent({
        owner,
        repo,
        path: remotePath,
        ref: this.settings.branch,
      });
      if (!Array.isArray(existing.data) && existing.data.type === 'file') {
        sha = existing.data.sha;
      }
    } catch (e: unknown) {
      if ((e as { status?: number }).status !== 404) throw e;
    }

    const { data } = await client.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: remotePath,
      message,
      content: content.toString('base64'),
      branch: this.settings.branch,
      sha,
    });

    const newSha = data.content?.sha ?? sha ?? '';
    this.pushed[this.remoteKey(name)] = {
      sha: newSha,
      pushedAt: new Date().toISOString(),
    };
    this.writePushed();
  }

  private remoteKey(vaultName: string): string {
    return `${this.settings.deviceName}/${vaultName}`;
  }

  private requireClient(): Octokit {
    const client = this.githubService.getClientOrNull();
    if (!client) {
      throw new Error('GitHub is not connected. Add a PAT in the GitHub panel first.');
    }
    const state = this.githubService.getAuthState();
    if (!REQUIRED_SCOPES.every((s) => state.scopes.includes(s))) {
      // Do NOT echo the user's other scopes — they may include sensitive ones
      // the user wouldn't want surfaced in a screen-shared session.
      throw new Error(
        `GitHub PAT is missing required scope. Vault sync needs the "repo" scope. ` +
          `Regenerate the PAT in the GitHub panel.`
      );
    }
    return client;
  }

  private requireConfig(): {
    client: Octokit;
    owner: string;
    repo: string;
    deviceName: string;
  } {
    if (!this.settings.owner || !this.settings.repo) {
      throw new Error('Sync not configured. Use the setup wizard.');
    }
    if (!DEVICE_NAME_RE.test(this.settings.deviceName)) {
      throw new Error(`Invalid device name in settings: ${this.settings.deviceName}`);
    }
    return {
      client: this.requireClient(),
      owner: this.settings.owner,
      repo: this.settings.repo,
      deviceName: this.settings.deviceName,
    };
  }

  private startWatcher(): void {
    this.stopWatcher();
    try {
      fs.mkdirSync(VAULT_DIR, { recursive: true });
    } catch {
      // ignore
    }
    try {
      this.watcher = fs.watch(VAULT_DIR, { persistent: false }, (eventType, filename) => {
        if (!filename || typeof filename !== 'string') return;
        if (!VAULT_NAME_RE.test(filename)) return;
        this.scheduleSync();
      });
      // On Windows, fs.watch silently dies if the watched dir is removed.
      // Reconnect on error/close so sync doesn't go quietly offline.
      this.watcher.on('error', () => this.handleWatcherDeath());
      this.watcher.on('close', () => this.handleWatcherDeath());
    } catch {
      this.watcher = null;
      this.handleWatcherDeath();
    }
    // Also schedule one immediately to catch anything that landed while disabled.
    this.scheduleSync();
  }

  private handleWatcherDeath(): void {
    if (!this.settings.enabled) return;
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore
      }
      this.watcher = null;
    }
    // Try to reconnect after a short backoff.
    setTimeout(() => {
      if (this.settings.enabled && !this.watcher) this.startWatcher();
    }, 5000);
  }

  private stopWatcher(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore
      }
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private scheduleSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow();
    }, this.settings.debounceMs);
  }

  private readSettings(): SyncSettings {
    const defaults: SyncSettings = {
      enabled: false,
      owner: null,
      repo: null,
      deviceName: this.defaultDeviceName(),
      branch: DEFAULT_BRANCH,
      consentAt: null,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    };
    let raw: string;
    try {
      raw = fs.readFileSync(this.settingsPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
      return defaults;
    }
    let parsed: Partial<SyncSettings>;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `Refusing to use ${this.settingsPath}: not valid JSON (${(e as Error).message}). ` +
          `Fix or delete to restore defaults.`
      );
    }
    const owner =
      typeof parsed.owner === 'string' && OWNER_RE.test(parsed.owner) ? parsed.owner : null;
    const repo =
      typeof parsed.repo === 'string' && REPO_NAME_RE.test(parsed.repo) ? parsed.repo : null;
    const consentAt =
      typeof parsed.consentAt === 'string' && Number.isFinite(Date.parse(parsed.consentAt))
        ? parsed.consentAt
        : null;
    // Defense-in-depth: enabled-without-configured should never persist.
    // If any required field was corrupted, force enabled off so the panel
    // surfaces "Not configured" instead of silently looking active.
    const enabledRaw = typeof parsed.enabled === 'boolean' ? parsed.enabled : defaults.enabled;
    const enabled = enabledRaw && owner && repo && consentAt ? true : false;
    return {
      enabled,
      owner,
      repo,
      deviceName:
        typeof parsed.deviceName === 'string' && DEVICE_NAME_RE.test(parsed.deviceName)
          ? parsed.deviceName
          : defaults.deviceName,
      branch:
        typeof parsed.branch === 'string' && BRANCH_RE.test(parsed.branch)
          ? parsed.branch
          : defaults.branch,
      consentAt,
      debounceMs:
        typeof parsed.debounceMs === 'number' &&
        parsed.debounceMs >= 1000 &&
        parsed.debounceMs <= 300000
          ? parsed.debounceMs
          : defaults.debounceMs,
    };
  }

  private writeSettings(): void {
    this.writeJsonAtomic(this.settingsPath, this.settings);
  }

  private readPushed(): PushedIndex {
    try {
      const raw = fs.readFileSync(this.pushedPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as PushedIndex;
    } catch {
      return {};
    }
  }

  private writePushed(): void {
    this.writeJsonAtomic(this.pushedPath, this.pushed);
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

  private defaultDeviceName(): string {
    const raw = os.hostname() || 'device';
    const sanitized = raw
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-._]+|[-._]+$/g, '')
      .slice(0, 63);
    return DEVICE_NAME_RE.test(sanitized) ? sanitized : 'device';
  }
}
