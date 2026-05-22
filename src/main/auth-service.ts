import { app, safeStorage } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AuthBackend,
  AuthCredentials,
  AuthSession,
  AuthState,
  AuthUser,
  SyncedSettings,
} from '../shared/types';

// HTTP contract this service implements (and that a Cloudflare Worker /
// other backend can drop into by setting backend.mode = 'http'):
//
//   POST {baseUrl}/auth/register   { email, password }  → { user, token }
//   POST {baseUrl}/auth/login      { email, password }  → { user, token }
//   POST {baseUrl}/auth/logout     headers: Authorization: Bearer <token>  → 204
//   GET  {baseUrl}/auth/me         headers: Authorization: Bearer <token>  → { user }
//   GET  {baseUrl}/settings        headers: Authorization: Bearer <token>  → SyncedSettings
//   PUT  {baseUrl}/settings        headers: Authorization: Bearer <token>  body: SyncedSettings → SyncedSettings
//
// In 'local-stub' mode this file simulates the same surface using local
// JSON files in userData. No network. No real auth. The UI surfaces
// "Local only" so users don't mistake it for a security boundary.

const USERS_FILE = 'auth-users.json';
const SESSION_FILE = 'auth-session.json';
const SYNC_FILE_PREFIX = 'auth-synced-settings.';
const CONFIG_FILE = 'auth-config.json';
const LEGACY_SYNC_FILE = 'auth-synced-settings.json';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]+$/i;
const MIN_PASSWORD_LEN = 8;
const SCRYPT_KEYLEN = 64;
const SALT_HEX_LEN = 32;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const FETCH_TIMEOUT_MS = 10_000;

interface StoredUser {
  id: string;
  email: string;
  createdAt: string;
  salt: string;
  hash: string;
}

interface StoredSession {
  userId: string;
  email: string;
  issuedAt: string;
  expiresAt: string;
  // Locally stored secret (encrypted via safeStorage when available).
  // For 'http' mode this is the bearer token returned by the backend.
  encryptedToken?: string;
  plainToken?: string;
}

interface StoredConfig {
  mode: 'local-stub' | 'http';
  baseUrl: string | null;
}

export class AuthService {
  private usersPath: string;
  private sessionPath: string;
  private syncDir: string;
  private configPath: string;
  private users: Record<string, StoredUser>;
  private session: StoredSession | null;
  private config: StoredConfig;

  constructor() {
    const userData = app.getPath('userData');
    this.usersPath = path.join(userData, USERS_FILE);
    this.sessionPath = path.join(userData, SESSION_FILE);
    this.syncDir = userData;
    this.configPath = path.join(userData, CONFIG_FILE);
    // Best-effort: remove the pre-C1 shared sync file so its data can't
    // leak into a new account's "Pull settings" call.
    const legacy = path.join(userData, LEGACY_SYNC_FILE);
    try {
      fs.unlinkSync(legacy);
    } catch {
      // file may not exist
    }

    // Order matters: readSession references this.config and this.users
    // when running in local-stub mode (to reject planted sessions).
    this.users = this.readUsers();
    this.config = this.readConfig();
    this.session = this.readSession();

    if (this.session) {
      const exp = Date.parse(this.session.expiresAt);
      if (!Number.isFinite(exp) || exp < Date.now()) {
        this.clearSession();
      }
    }
  }

  getState(): AuthState {
    return {
      signedIn: this.session !== null,
      session: this.session ? this.sessionToPublic(this.session) : null,
      backend: { mode: this.config.mode, baseUrl: this.config.baseUrl },
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  getBackend(): AuthBackend {
    return { mode: this.config.mode, baseUrl: this.config.baseUrl };
  }

  setBackend(next: Partial<AuthBackend>): AuthBackend {
    const merged: StoredConfig = {
      mode: next.mode ?? this.config.mode,
      baseUrl: next.baseUrl ?? this.config.baseUrl,
    };
    if (merged.mode !== 'local-stub' && merged.mode !== 'http') {
      throw new Error(`Invalid backend mode: ${String(merged.mode)}`);
    }
    if (merged.mode === 'http') {
      if (!merged.baseUrl || typeof merged.baseUrl !== 'string') {
        throw new Error('HTTP backend requires a baseUrl');
      }
      let parsed: URL;
      try {
        parsed = new URL(merged.baseUrl);
      } catch {
        throw new Error(`Invalid baseUrl: ${merged.baseUrl}`);
      }
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
        throw new Error('HTTP backend baseUrl must use https:// (or be on localhost for dev)');
      }
      merged.baseUrl = parsed.toString().replace(/\/$/, '');
    }
    // Switching backend invalidates any existing session (token is backend-specific).
    if (merged.mode !== this.config.mode || merged.baseUrl !== this.config.baseUrl) {
      this.clearSession();
    }
    this.config = merged;
    this.writeConfig();
    return { mode: merged.mode, baseUrl: merged.baseUrl };
  }

  async register(creds: AuthCredentials): Promise<AuthState> {
    this.validateCredentials(creds);
    const allowPlaintext = creds.allowPlaintextToken === true;
    if (this.config.mode === 'http') {
      const body = await this.httpPost('/auth/register', {
        email: this.normalizeEmail(creds.email),
        password: creds.password,
      });
      this.acceptHttpSession(body, allowPlaintext);
      return this.getState();
    }
    const email = this.normalizeEmail(creds.email);
    if (this.users[email]) {
      // Generic message to avoid account enumeration.
      throw new Error('Could not create account');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = this.scryptHash(creds.password, salt);
    const user: StoredUser = {
      id: crypto.randomUUID(),
      email,
      createdAt: new Date().toISOString(),
      salt,
      hash,
    };
    this.users[email] = user;
    this.writeUsers();
    this.startLocalSession(user, allowPlaintext);
    return this.getState();
  }

  async login(creds: AuthCredentials): Promise<AuthState> {
    this.validateCredentials(creds);
    const allowPlaintext = creds.allowPlaintextToken === true;
    if (this.config.mode === 'http') {
      const body = await this.httpPost('/auth/login', {
        email: this.normalizeEmail(creds.email),
        password: creds.password,
      });
      this.acceptHttpSession(body, allowPlaintext);
      return this.getState();
    }
    const email = this.normalizeEmail(creds.email);
    const user = this.users[email];
    if (!user) throw new Error('Invalid email or password');
    if (!this.scryptVerify(creds.password, user.salt, user.hash)) {
      throw new Error('Invalid email or password');
    }
    this.startLocalSession(user, allowPlaintext);
    return this.getState();
  }

  async logout(): Promise<AuthState> {
    if (this.config.mode === 'http' && this.session) {
      const token = this.readSessionToken();
      if (token) {
        try {
          await this.httpPost('/auth/logout', undefined, token);
        } catch {
          // ignore — local clear still proceeds
        }
      }
    }
    this.clearSession();
    return this.getState();
  }

  async pullSettings(): Promise<SyncedSettings | null> {
    if (!this.session) throw new Error('Not signed in');
    if (this.config.mode === 'http') {
      const token = this.readSessionToken();
      if (!token) throw new Error('Session token unavailable');
      const body = await this.httpGet('/settings', token);
      return body as SyncedSettings;
    }
    try {
      const raw = fs.readFileSync(this.syncPathFor(this.session.userId), 'utf8');
      return JSON.parse(raw) as SyncedSettings;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async pushSettings(next: SyncedSettings): Promise<SyncedSettings> {
    if (!this.session) throw new Error('Not signed in');
    const sanitized = this.sanitizeSyncedSettings(next);
    if (this.config.mode === 'http') {
      const token = this.readSessionToken();
      if (!token) throw new Error('Session token unavailable');
      const body = await this.httpPut('/settings', sanitized, token);
      return body as SyncedSettings;
    }
    this.writeJsonAtomic(this.syncPathFor(this.session.userId), sanitized);
    return sanitized;
  }

  // --- internals ---

  private validateCredentials(creds: AuthCredentials): void {
    if (!creds || typeof creds.email !== 'string' || typeof creds.password !== 'string') {
      throw new Error('Email and password are required');
    }
    if (!EMAIL_RE.test(creds.email.trim())) {
      throw new Error('Email is not a valid address');
    }
    if (creds.password.length < MIN_PASSWORD_LEN) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters`);
    }
    if (creds.password.length > 256) {
      throw new Error('Password is too long');
    }
  }

  private normalizeEmail(email: string): string {
    return email.normalize('NFKC').toLowerCase().trim();
  }

  private syncPathFor(userId: string): string {
    if (!UUID_RE.test(userId)) throw new Error('Invalid userId for sync path');
    return path.join(this.syncDir, `${SYNC_FILE_PREFIX}${userId}.json`);
  }

  private scryptHash(password: string, saltHex: string): string {
    const salt = Buffer.from(saltHex, 'hex');
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    return derived.toString('hex');
  }

  private scryptVerify(password: string, saltHex: string, expectedHex: string): boolean {
    // Refuse malformed stored values rather than computing with attacker-controlled keylen.
    if (!HEX_RE.test(saltHex) || saltHex.length !== SALT_HEX_LEN) return false;
    if (!HEX_RE.test(expectedHex) || expectedHex.length !== SCRYPT_KEYLEN * 2) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    const candidate = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
    if (expected.length !== candidate.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  }

  private startLocalSession(user: StoredUser, allowPlaintext: boolean): void {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const session: StoredSession = {
      userId: user.id,
      email: user.email,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };
    this.attachToken(session, token, allowPlaintext);
    this.session = session;
    this.writeSession();
  }

  private acceptHttpSession(body: unknown, allowPlaintext: boolean): void {
    if (!body || typeof body !== 'object') throw new Error('Backend returned malformed response');
    const b = body as { user?: unknown; token?: unknown; expiresAt?: unknown };
    const u = b.user as { id?: unknown; email?: unknown; createdAt?: unknown } | undefined;
    if (!u || typeof u.id !== 'string' || !UUID_RE.test(u.id)) {
      throw new Error('Backend returned malformed user.id');
    }
    if (typeof u.email !== 'string' || !EMAIL_RE.test(u.email)) {
      throw new Error('Backend returned malformed user.email');
    }
    if (typeof b.token !== 'string' || !b.token || b.token.length > 4096) {
      throw new Error('Backend returned malformed token');
    }
    const now = Date.now();
    let expiresAtMs = now + SESSION_TTL_MS;
    if (typeof b.expiresAt === 'string') {
      const parsed = Date.parse(b.expiresAt);
      if (Number.isFinite(parsed) && parsed > now) expiresAtMs = parsed;
    }
    const session: StoredSession = {
      userId: u.id,
      email: u.email,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    this.attachToken(session, b.token, allowPlaintext);
    this.session = session;
    this.writeSession();
  }

  private attachToken(session: StoredSession, token: string, allowPlaintext: boolean): void {
    if (safeStorage.isEncryptionAvailable()) {
      session.encryptedToken = safeStorage.encryptString(token).toString('base64');
      return;
    }
    if (!allowPlaintext) {
      throw new Error(
        'OS keychain (safeStorage) is not available on this system. ' +
          'Refusing to store the session token in plaintext. ' +
          'Tick the plaintext consent box and try again, or unlock your keychain.'
      );
    }
    session.plainToken = token;
  }

  private readSessionToken(): string | null {
    if (!this.session) return null;
    if (this.session.encryptedToken && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(this.session.encryptedToken, 'base64'));
      } catch {
        return null;
      }
    }
    return this.session.plainToken ?? null;
  }

  private clearSession(): void {
    this.session = null;
    try {
      fs.unlinkSync(this.sessionPath);
    } catch {
      // file may not exist
    }
  }

  private sessionToPublic(session: StoredSession): AuthSession {
    const user: AuthUser = {
      id: session.userId,
      email: session.email,
      createdAt: this.users[session.email]?.createdAt ?? session.issuedAt,
    };
    return {
      user,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    };
  }

  private sanitizeSyncedSettings(input: SyncedSettings): SyncedSettings {
    const out: SyncedSettings = {
      theme: typeof input?.theme === 'string' ? input.theme.slice(0, 64) : null,
      lmm:
        input?.lmm && typeof input.lmm === 'object'
          ? {
              enabled: !!input.lmm.enabled,
              variant: input.lmm.variant === 'deep' ? 'deep' : 'quick',
            }
          : null,
      updatedAt: new Date().toISOString(),
    };
    return out;
  }

  // --- HTTP layer (used when mode === 'http') ---

  private async httpPost(p: string, body?: unknown, bearer?: string): Promise<unknown> {
    return this.httpRequest('POST', p, body, bearer);
  }

  private async httpGet(p: string, bearer: string): Promise<unknown> {
    return this.httpRequest('GET', p, undefined, bearer);
  }

  private async httpPut(p: string, body: unknown, bearer: string): Promise<unknown> {
    return this.httpRequest('PUT', p, body, bearer);
  }

  private async httpRequest(
    method: string,
    p: string,
    body: unknown,
    bearer?: string
  ): Promise<unknown> {
    if (!this.config.baseUrl) throw new Error('HTTP backend is not configured');
    const url = `${this.config.baseUrl}${p}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (bearer) headers['authorization'] = `Bearer ${bearer}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`Network error reaching ${url}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return null;
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // non-JSON; continue with null
    }
    if (res.status === 401) {
      // Backend rejected the bearer — clear local session so the renderer
      // reflects reality on next state read.
      this.clearSession();
    }
    if (!res.ok) {
      const msg =
        (payload && typeof payload === 'object' && 'error' in payload && (payload as { error: string }).error) ||
        `${res.status} ${res.statusText}`;
      throw new Error(`Auth backend error: ${msg}`);
    }
    return payload;
  }

  // --- persistence ---

  private readUsers(): Record<string, StoredUser> {
    try {
      const raw = fs.readFileSync(this.usersPath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error(
        `Refusing to use ${this.usersPath}: not valid JSON (${(e as Error).message}). ` +
          `Fix or delete the file to recover.`
      );
    }
  }

  private writeUsers(): void {
    this.writeJsonAtomic(this.usersPath, this.users);
  }

  private readSession(): StoredSession | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.sessionPath, 'utf8');
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.userId !== 'string' || !UUID_RE.test(p.userId)) return null;
    if (typeof p.email !== 'string' || !EMAIL_RE.test(p.email)) return null;
    if (typeof p.issuedAt !== 'string' || !Number.isFinite(Date.parse(p.issuedAt))) return null;
    if (typeof p.expiresAt !== 'string' || !Number.isFinite(Date.parse(p.expiresAt))) return null;
    if (p.encryptedToken !== undefined && typeof p.encryptedToken !== 'string') return null;
    if (p.plainToken !== undefined && typeof p.plainToken !== 'string') return null;
    // For local-stub mode, refuse sessions that don't match a known user.
    // (For http mode the user list is server-side; trust the parsed shape.)
    if (this.config?.mode === 'local-stub') {
      const knownUser = this.users[p.email];
      if (!knownUser || knownUser.id !== p.userId) return null;
    }
    return p as unknown as StoredSession;
  }

  private writeSession(): void {
    if (!this.session) return;
    this.writeJsonAtomic(this.sessionPath, this.session);
  }

  private readConfig(): StoredConfig {
    const defaults: StoredConfig = { mode: 'local-stub', baseUrl: null };
    try {
      const raw = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoredConfig>;
      return {
        mode: parsed.mode === 'http' ? 'http' : 'local-stub',
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : null,
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
      return defaults;
    }
  }

  private writeConfig(): void {
    this.writeJsonAtomic(this.configPath, this.config);
  }

  private writeJsonAtomic(target: string, payload: unknown): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target);
  }
}
