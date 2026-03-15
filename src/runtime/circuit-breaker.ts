/**
 * circuit-breaker.ts
 *
 * Per-provider circuit breaker with Redis-backed state.
 * States: closed → (failures ≥ threshold) → open → (cooldown expires) → half_open → probe
 *
 * Design: Redis client is injectable for testability. If no client is provided,
 * a minimal client is created from REDIS_URL env var (default redis://localhost:6380).
 */

import { createConnection } from 'net';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = 'closed' | 'open' | 'half_open';
export type FailureCategory =
  | 'rate_limited'
  | 'server_error'
  | 'overloaded'
  | 'timeout'
  | 'unknown';

export interface CircuitStatus {
  provider: string;
  state: CircuitState;
  failure_count: number;
  last_failure: number | null;
  last_failure_code: number | string | null;
  last_failure_category: FailureCategory | null;
  cooldown_until: number | null;
}

export interface FailureInfo {
  code?: number | string;
  category?: FailureCategory;
  retry_after?: number; // seconds, for 429
}

// ---------------------------------------------------------------------------
// Minimal Redis client interface (injectable)
// ---------------------------------------------------------------------------

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  quit(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Minimal Redis client using Node net (no npm dependency)
// ---------------------------------------------------------------------------

interface RedisCommand {
  resolve: (value: string | null) => void;
  reject: (err: Error) => void;
}

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

export function createMinimalRedisClient(url: string): RedisClient {
  const { host, port, password } = parseRedisUrl(url);
  let buffer = '';
  let connected = false;
  let socket: ReturnType<typeof createConnection> | null = null;
  const queue: RedisCommand[] = [];

  function encodeCommand(args: string[]): string {
    let cmd = `*${args.length}\r\n`;
    for (const arg of args) {
      const encoded = Buffer.from(arg);
      cmd += `$${encoded.length}\r\n${arg}\r\n`;
    }
    return cmd;
  }

  function parseResponse(raw: string): { value: string | null; remaining: string } | null {
    if (raw.length === 0) return null;
    const type = raw[0];

    if (type === '+' || type === '-' || type === ':') {
      const end = raw.indexOf('\r\n');
      if (end === -1) return null;
      const value = raw.slice(1, end);
      return { value: type === '-' ? null : value, remaining: raw.slice(end + 2) };
    }

    if (type === '$') {
      const end = raw.indexOf('\r\n');
      if (end === -1) return null;
      const len = parseInt(raw.slice(1, end), 10);
      if (len === -1) return { value: null, remaining: raw.slice(end + 2) };
      const start = end + 2;
      if (raw.length < start + len + 2) return null;
      const value = raw.slice(start, start + len);
      return { value, remaining: raw.slice(start + len + 2) };
    }

    // Bulk array (e.g. from MULTI responses) — skip for our use case
    return null;
  }

  function processBuffer(): void {
    while (queue.length > 0 && buffer.length > 0) {
      const result = parseResponse(buffer);
      if (result === null) break;
      buffer = result.remaining;
      const cmd = queue.shift();
      if (cmd) cmd.resolve(result.value);
    }
  }

  function ensureConnected(): Promise<void> {
    if (connected && socket) return Promise.resolve();

    return new Promise((resolve, reject) => {
      socket = createConnection({ host, port }, () => {
        connected = true;
        if (password) {
          const authCmd = encodeCommand(['AUTH', password]);
          socket!.write(authCmd);
          // wait for AUTH response before resolving
          const authListener = (data: Buffer | string) => {
            const str = typeof data === 'string' ? data : data.toString('utf8');
            if (str.startsWith('+OK')) {
              socket!.removeListener('data', authListener);
              resolve();
            } else if (str.startsWith('-')) {
              reject(new Error(`Redis AUTH failed: ${str}`));
            }
          };
          socket!.on('data', authListener);
        } else {
          resolve();
        }
      });

      socket.on('data', (data: Buffer | string) => {
        const str = typeof data === 'string' ? data : data.toString('utf8');
        buffer += str;
        processBuffer();
      });

      socket.on('error', (err: Error) => {
        connected = false;
        const pending = queue.splice(0);
        for (const cmd of pending) cmd.reject(err);
        if (!connected) reject(err);
      });

      socket.on('close', () => {
        connected = false;
        socket = null;
      });
    });
  }

  function sendCommand(args: string[]): Promise<string | null> {
    return ensureConnected().then(() => {
      return new Promise<string | null>((resolve, reject) => {
        queue.push({ resolve, reject });
        socket!.write(encodeCommand(args));
      });
    });
  }

  return {
    get(key: string): Promise<string | null> {
      return sendCommand(['GET', key]);
    },
    set(key: string, value: string): Promise<void> {
      return sendCommand(['SET', key, value]).then(() => undefined);
    },
    quit(): Promise<void> {
      if (socket) {
        socket.end();
        socket = null;
        connected = false;
      }
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory mock Redis client (for testing)
// ---------------------------------------------------------------------------

export function createInMemoryRedisClient(): RedisClient {
  const store = new Map<string, string>();
  return {
    get(key: string): Promise<string | null> {
      return Promise.resolve(store.get(key) ?? null);
    },
    set(key: string, value: string): Promise<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    quit(): Promise<void> {
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIP_THRESHOLD = 3;
const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 300000;

// Cooldown durations in ms
const COOLDOWN = {
  overloaded: 60_000,   // 529
  server_error: 300_000, // 500
  rate_limited: 300_000, // 429 (default, override with retry_after)
  timeout: 300_000,
  unknown: 300_000,
};

// ---------------------------------------------------------------------------
// Pure helper functions (no I/O, fully testable)
// ---------------------------------------------------------------------------

export function categorizeFailure(
  code?: number | string,
  retryAfter?: number,
): { category: FailureCategory; cooldownSeconds: number } {
  const numCode = typeof code === 'string' ? parseInt(code, 10) : code;

  if (numCode === 429) {
    const cooldownSeconds = retryAfter && retryAfter > 0 ? retryAfter : 300;
    return { category: 'rate_limited', cooldownSeconds };
  }
  if (numCode === 500) {
    return { category: 'server_error', cooldownSeconds: 300 };
  }
  if (numCode === 529) {
    return { category: 'overloaded', cooldownSeconds: 60 };
  }
  if (code === 'timeout' || numCode === 408 || numCode === 504) {
    return { category: 'timeout', cooldownSeconds: 300 };
  }
  return { category: 'unknown', cooldownSeconds: 300 };
}

export function calculateBackoff(attempt: number): number {
  const jitter = Math.random() * BASE_BACKOFF_MS;
  const exponential = BASE_BACKOFF_MS * Math.pow(2, attempt) + jitter;
  return Math.min(exponential, MAX_BACKOFF_MS);
}

export function buildCircuitEventPayload(
  provider: string,
  status: CircuitStatus,
  previousState: CircuitState,
): object {
  return {
    event_type: 'circuit_state_change',
    provider,
    state: status.state,
    previous_state: previousState,
    failure_count: status.failure_count,
    failure_code: status.last_failure_code,
    failure_category: status.last_failure_category,
    cooldown_until: status.cooldown_until,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Redis state helpers
// ---------------------------------------------------------------------------

const REDIS_KEY_PREFIX = 'ghost:circuit:';

interface PersistedState {
  state: CircuitState;
  failure_count: number;
  last_failure: number | null;
  last_failure_code: number | string | null;
  last_failure_category: FailureCategory | null;
  cooldown_until: number | null;
}

function defaultState(): PersistedState {
  return {
    state: 'closed',
    failure_count: 0,
    last_failure: null,
    last_failure_code: null,
    last_failure_category: null,
    cooldown_until: null,
  };
}

async function loadState(provider: string, client: RedisClient): Promise<PersistedState> {
  try {
    const raw = await client.get(`${REDIS_KEY_PREFIX}${provider}`);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

async function saveState(
  provider: string,
  state: PersistedState,
  client: RedisClient,
): Promise<void> {
  try {
    await client.set(`${REDIS_KEY_PREFIX}${provider}`, JSON.stringify(state));
  } catch {
    // log but don't throw — circuit breaker must not break the request path
    console.error(`[circuit-breaker] Failed to save state for provider ${provider}`);
  }
}

function persistedToStatus(provider: string, p: PersistedState): CircuitStatus {
  // Re-evaluate state: if circuit is open but cooldown has expired, transition to half_open
  const now = Date.now();
  let resolvedState = p.state;
  if (p.state === 'open' && p.cooldown_until !== null && now >= p.cooldown_until) {
    resolvedState = 'half_open';
  }
  return {
    provider,
    state: resolvedState,
    failure_count: p.failure_count,
    last_failure: p.last_failure,
    last_failure_code: p.last_failure_code,
    last_failure_category: p.last_failure_category,
    cooldown_until: p.cooldown_until,
  };
}

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

async function emitStateChange(
  provider: string,
  status: CircuitStatus,
  previousState: CircuitState,
): Promise<void> {
  const payload = buildCircuitEventPayload(provider, status, previousState);
  // Attempt Postgres write if pg is available; otherwise log
  // We use dynamic import to avoid a hard dependency on pg
  try {
    const pgUrl = process.env.DATABASE_URL;
    if (pgUrl) {
      // Dynamic import — only available if pg is installed in the environment
      const { default: pg } = await import('pg' as string) as { default: { Client: new (opts: { connectionString: string }) => { connect(): Promise<void>; query(sql: string, params: unknown[]): Promise<unknown>; end(): Promise<void> } } };
      const client = new pg.Client({ connectionString: pgUrl });
      await client.connect();
      await client.query(
        `INSERT INTO ghost_events (event_type, payload, created_at) VALUES ($1, $2, NOW())
         ON CONFLICT DO NOTHING`,
        ['circuit_state_change', JSON.stringify(payload)],
      );
      await client.end();
      return;
    }
  } catch {
    // pg not available or table doesn't exist — fall through to log
  }
  console.log('[circuit-breaker] state change event:', JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Client factory (uses env REDIS_URL or provided url)
// ---------------------------------------------------------------------------

let _sharedClient: RedisClient | null = null;

function getDefaultClient(redisUrl?: string): RedisClient {
  const url = redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6380';
  if (!_sharedClient) {
    _sharedClient = createMinimalRedisClient(url);
  }
  return _sharedClient;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getCircuitStatus(
  provider: string,
  redisUrlOrClient?: string | RedisClient,
): Promise<CircuitStatus> {
  const client =
    typeof redisUrlOrClient === 'object' && redisUrlOrClient !== null
      ? redisUrlOrClient
      : getDefaultClient(redisUrlOrClient as string | undefined);

  const state = await loadState(provider, client);
  return persistedToStatus(provider, state);
}

export async function recordFailure(
  provider: string,
  failure: FailureInfo,
  redisUrlOrClient?: string | RedisClient,
): Promise<CircuitStatus> {
  const client =
    typeof redisUrlOrClient === 'object' && redisUrlOrClient !== null
      ? redisUrlOrClient
      : getDefaultClient(redisUrlOrClient as string | undefined);

  const persisted = await loadState(provider, client);
  const previousStatus = persistedToStatus(provider, persisted);
  const previousState = previousStatus.state;

  const { category, cooldownSeconds } = failure.category
    ? { category: failure.category, cooldownSeconds: COOLDOWN[failure.category] }
    : categorizeFailure(failure.code, failure.retry_after);

  // Override cooldown for rate_limited with retry_after if provided
  const effectiveCooldownMs =
    failure.category === 'rate_limited' && failure.retry_after
      ? failure.retry_after * 1000
      : cooldownSeconds * 1000;

  const now = Date.now();

  const newCount = persisted.failure_count + 1;
  let newState: CircuitState = persisted.state;
  let cooldown_until = persisted.cooldown_until;

  if (newCount >= TRIP_THRESHOLD || persisted.state === 'half_open') {
    newState = 'open';
    cooldown_until = now + effectiveCooldownMs;
  }

  const updated: PersistedState = {
    state: newState,
    failure_count: newCount,
    last_failure: now,
    last_failure_code: failure.code ?? null,
    last_failure_category: category,
    cooldown_until,
  };

  await saveState(provider, updated, client);
  const status = persistedToStatus(provider, updated);

  if (status.state !== previousState) {
    await emitStateChange(provider, status, previousState);
  }

  return status;
}

export async function recordSuccess(
  provider: string,
  redisUrlOrClient?: string | RedisClient,
): Promise<CircuitStatus> {
  const client =
    typeof redisUrlOrClient === 'object' && redisUrlOrClient !== null
      ? redisUrlOrClient
      : getDefaultClient(redisUrlOrClient as string | undefined);

  const persisted = await loadState(provider, client);
  const previousStatus = persistedToStatus(provider, persisted);
  const previousState = previousStatus.state;

  const updated: PersistedState = {
    state: 'closed',
    failure_count: 0,
    last_failure: persisted.last_failure,
    last_failure_code: persisted.last_failure_code,
    last_failure_category: persisted.last_failure_category,
    cooldown_until: null,
  };

  await saveState(provider, updated, client);
  const status = persistedToStatus(provider, updated);

  if (status.state !== previousState) {
    await emitStateChange(provider, status, previousState);
  }

  return status;
}

export async function isCircuitOpen(
  provider: string,
  redisUrlOrClient?: string | RedisClient,
): Promise<boolean> {
  const status = await getCircuitStatus(provider, redisUrlOrClient);
  return status.state === 'open';
}

export async function fetchCircuitStates(
  providers: string[],
  redisUrlOrClient?: string | RedisClient,
): Promise<Record<string, CircuitState>> {
  const client =
    typeof redisUrlOrClient === 'object' && redisUrlOrClient !== null
      ? redisUrlOrClient
      : getDefaultClient(redisUrlOrClient as string | undefined);

  const entries = await Promise.all(
    providers.map(async (provider) => {
      const status = await getCircuitStatus(provider, client);
      return [provider, status.state] as [string, CircuitState];
    }),
  );

  return Object.fromEntries(entries);
}
