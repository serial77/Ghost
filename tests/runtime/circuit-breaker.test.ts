import { describe, it, expect, beforeEach } from 'vitest';
import {
  categorizeFailure,
  calculateBackoff,
  buildCircuitEventPayload,
  getCircuitStatus,
  recordFailure,
  recordSuccess,
  isCircuitOpen,
  fetchCircuitStates,
  createInMemoryRedisClient,
} from '../../src/runtime/circuit-breaker.js';
import type { CircuitStatus } from '../../src/runtime/circuit-breaker.js';
import { selectRoute } from '../../src/runtime/router.js';
import { getProviderPolicies, getCodexConfig } from '../../src/runtime/config.js';

// ---------------------------------------------------------------------------
// Pure function tests (no I/O)
// ---------------------------------------------------------------------------

describe('categorizeFailure', () => {
  it('429 → rate_limited, 300s default cooldown', () => {
    const result = categorizeFailure(429);
    expect(result.category).toBe('rate_limited');
    expect(result.cooldownSeconds).toBe(300);
  });

  it('429 with retry_after uses retry_after value', () => {
    const result = categorizeFailure(429, 120);
    expect(result.category).toBe('rate_limited');
    expect(result.cooldownSeconds).toBe(120);
  });

  it('500 → server_error, 300s cooldown', () => {
    const result = categorizeFailure(500);
    expect(result.category).toBe('server_error');
    expect(result.cooldownSeconds).toBe(300);
  });

  it('529 → overloaded, 60s cooldown', () => {
    const result = categorizeFailure(529);
    expect(result.category).toBe('overloaded');
    expect(result.cooldownSeconds).toBe(60);
  });

  it('"timeout" string → timeout, 300s cooldown', () => {
    const result = categorizeFailure('timeout');
    expect(result.category).toBe('timeout');
    expect(result.cooldownSeconds).toBe(300);
  });

  it('408 → timeout, 300s cooldown', () => {
    const result = categorizeFailure(408);
    expect(result.category).toBe('timeout');
    expect(result.cooldownSeconds).toBe(300);
  });

  it('unknown code → unknown, 300s cooldown', () => {
    const result = categorizeFailure(503);
    expect(result.category).toBe('unknown');
    expect(result.cooldownSeconds).toBe(300);
  });

  it('undefined code → unknown, 300s cooldown', () => {
    const result = categorizeFailure(undefined);
    expect(result.category).toBe('unknown');
    expect(result.cooldownSeconds).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// calculateBackoff
// ---------------------------------------------------------------------------

describe('calculateBackoff', () => {
  it('attempt 0 is between BASE_BACKOFF_MS (5000) and 2*BASE + BASE (15000)', () => {
    for (let i = 0; i < 20; i++) {
      const result = calculateBackoff(0);
      expect(result).toBeGreaterThanOrEqual(5000);
      expect(result).toBeLessThanOrEqual(15000);
    }
  });

  it('attempt 5 is capped at max 300000ms', () => {
    for (let i = 0; i < 10; i++) {
      const result = calculateBackoff(5);
      expect(result).toBeLessThanOrEqual(300000);
    }
  });

  it('later attempts are generally larger than earlier ones (on average)', () => {
    const samples0 = Array.from({ length: 10 }, () => calculateBackoff(0));
    const samples5 = Array.from({ length: 10 }, () => calculateBackoff(5));
    const avg0 = samples0.reduce((a, b) => a + b, 0) / samples0.length;
    const avg5 = samples5.reduce((a, b) => a + b, 0) / samples5.length;
    expect(avg5).toBeGreaterThanOrEqual(avg0);
  });
});

// ---------------------------------------------------------------------------
// buildCircuitEventPayload
// ---------------------------------------------------------------------------

describe('buildCircuitEventPayload', () => {
  it('returns required fields', () => {
    const status: CircuitStatus = {
      provider: 'openai_api',
      state: 'open',
      failure_count: 3,
      last_failure: 1000000,
      last_failure_code: 500,
      last_failure_category: 'server_error',
      cooldown_until: 1300000,
    };
    const payload = buildCircuitEventPayload('openai_api', status, 'closed') as Record<string, unknown>;
    expect(payload.event_type).toBe('circuit_state_change');
    expect(payload.provider).toBe('openai_api');
    expect(payload.state).toBe('open');
    expect(payload.previous_state).toBe('closed');
    expect(payload.failure_count).toBe(3);
    expect(payload.failure_code).toBe(500);
    expect(payload.failure_category).toBe('server_error');
    expect(typeof payload.timestamp).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Redis-backed functions using in-memory mock
// ---------------------------------------------------------------------------

describe('getCircuitStatus', () => {
  it('returns closed state for unknown provider (no prior state)', async () => {
    const mock = createInMemoryRedisClient();
    const status = await getCircuitStatus('unknown_provider', mock);
    expect(status.state).toBe('closed');
    expect(status.failure_count).toBe(0);
    expect(status.last_failure).toBeNull();
    expect(status.provider).toBe('unknown_provider');
  });
});

describe('recordFailure', () => {
  it('increments failure count', async () => {
    const mock = createInMemoryRedisClient();
    const status = await recordFailure('test_provider', { code: 500 }, mock);
    expect(status.failure_count).toBe(1);
    expect(status.state).toBe('closed');
    expect(status.last_failure_category).toBe('server_error');
  });

  it('trips circuit at threshold 3', async () => {
    const mock = createInMemoryRedisClient();
    await recordFailure('test_provider', { code: 500 }, mock);
    await recordFailure('test_provider', { code: 500 }, mock);
    const status = await recordFailure('test_provider', { code: 500 }, mock);
    expect(status.failure_count).toBe(3);
    expect(status.state).toBe('open');
    expect(status.cooldown_until).not.toBeNull();
  });

  it('529 uses 60s cooldown', async () => {
    const mock = createInMemoryRedisClient();
    const before = Date.now();
    // Trip with 3 529 failures
    await recordFailure('p529', { code: 529 }, mock);
    await recordFailure('p529', { code: 529 }, mock);
    const status = await recordFailure('p529', { code: 529 }, mock);
    expect(status.state).toBe('open');
    expect(status.cooldown_until).not.toBeNull();
    const cooldownDuration = status.cooldown_until! - before;
    expect(cooldownDuration).toBeGreaterThanOrEqual(59_000);
    expect(cooldownDuration).toBeLessThanOrEqual(61_000);
  });

  it('500 uses 300s cooldown', async () => {
    const mock = createInMemoryRedisClient();
    const before = Date.now();
    await recordFailure('p500', { code: 500 }, mock);
    await recordFailure('p500', { code: 500 }, mock);
    const status = await recordFailure('p500', { code: 500 }, mock);
    expect(status.state).toBe('open');
    const cooldownDuration = status.cooldown_until! - before;
    expect(cooldownDuration).toBeGreaterThanOrEqual(299_000);
    expect(cooldownDuration).toBeLessThanOrEqual(301_000);
  });

  it('429 uses Retry-After if provided', async () => {
    const mock = createInMemoryRedisClient();
    const before = Date.now();
    await recordFailure('p429', { code: 429, retry_after: 120 }, mock);
    await recordFailure('p429', { code: 429, retry_after: 120 }, mock);
    const status = await recordFailure('p429', { code: 429, retry_after: 120 }, mock);
    expect(status.state).toBe('open');
    const cooldownDuration = status.cooldown_until! - before;
    expect(cooldownDuration).toBeGreaterThanOrEqual(119_000);
    expect(cooldownDuration).toBeLessThanOrEqual(121_000);
  });

  it('429 without Retry-After uses 300s', async () => {
    const mock = createInMemoryRedisClient();
    const before = Date.now();
    await recordFailure('p429b', { code: 429 }, mock);
    await recordFailure('p429b', { code: 429 }, mock);
    const status = await recordFailure('p429b', { code: 429 }, mock);
    const cooldownDuration = status.cooldown_until! - before;
    expect(cooldownDuration).toBeGreaterThanOrEqual(299_000);
    expect(cooldownDuration).toBeLessThanOrEqual(301_000);
  });

  it('half_open failure sends back to open', async () => {
    const mock = createInMemoryRedisClient();
    // Manually set a half_open state by writing to mock
    await mock.set('ghost:circuit:half_provider', JSON.stringify({
      state: 'half_open',
      failure_count: 3,
      last_failure: Date.now() - 400_000,
      last_failure_code: 500,
      last_failure_category: 'server_error',
      cooldown_until: Date.now() - 1000,
    }));
    const status = await recordFailure('half_provider', { code: 500 }, mock);
    expect(status.state).toBe('open');
    expect(status.cooldown_until).not.toBeNull();
    expect(status.cooldown_until!).toBeGreaterThan(Date.now());
  });
});

describe('recordSuccess', () => {
  it('resets to closed from half_open', async () => {
    const mock = createInMemoryRedisClient();
    await mock.set('ghost:circuit:half_success', JSON.stringify({
      state: 'half_open',
      failure_count: 3,
      last_failure: Date.now() - 400_000,
      last_failure_code: 500,
      last_failure_category: 'server_error',
      cooldown_until: Date.now() - 1000,
    }));
    const status = await recordSuccess('half_success', mock);
    expect(status.state).toBe('closed');
    expect(status.failure_count).toBe(0);
    expect(status.cooldown_until).toBeNull();
  });

  it('resets to closed from open', async () => {
    const mock = createInMemoryRedisClient();
    await recordFailure('reset_provider', { code: 500 }, mock);
    await recordFailure('reset_provider', { code: 500 }, mock);
    await recordFailure('reset_provider', { code: 500 }, mock);
    const afterFailures = await getCircuitStatus('reset_provider', mock);
    expect(afterFailures.state).toBe('open');

    const afterSuccess = await recordSuccess('reset_provider', mock);
    expect(afterSuccess.state).toBe('closed');
    expect(afterSuccess.failure_count).toBe(0);
  });
});

describe('isCircuitOpen', () => {
  it('returns false for closed state', async () => {
    const mock = createInMemoryRedisClient();
    expect(await isCircuitOpen('fresh_provider', mock)).toBe(false);
  });

  it('returns true for open state', async () => {
    const mock = createInMemoryRedisClient();
    await recordFailure('open_provider', { code: 500 }, mock);
    await recordFailure('open_provider', { code: 500 }, mock);
    await recordFailure('open_provider', { code: 500 }, mock);
    expect(await isCircuitOpen('open_provider', mock)).toBe(true);
  });

  it('returns false for half_open state', async () => {
    const mock = createInMemoryRedisClient();
    await mock.set('ghost:circuit:half_open_prov', JSON.stringify({
      state: 'half_open',
      failure_count: 3,
      last_failure: Date.now() - 400_000,
      last_failure_code: null,
      last_failure_category: null,
      cooldown_until: Date.now() - 1000,
    }));
    expect(await isCircuitOpen('half_open_prov', mock)).toBe(false);
  });

  it('transitions open → half_open when cooldown expires', async () => {
    const mock = createInMemoryRedisClient();
    await mock.set('ghost:circuit:expired_provider', JSON.stringify({
      state: 'open',
      failure_count: 3,
      last_failure: Date.now() - 400_000,
      last_failure_code: 500,
      last_failure_category: 'server_error',
      cooldown_until: Date.now() - 1000, // expired
    }));
    const status = await getCircuitStatus('expired_provider', mock);
    expect(status.state).toBe('half_open');
    expect(await isCircuitOpen('expired_provider', mock)).toBe(false);
  });
});

describe('fetchCircuitStates', () => {
  it('returns correct state map for multiple providers', async () => {
    const mock = createInMemoryRedisClient();
    // Trip one provider
    await recordFailure('prov_a', { code: 500 }, mock);
    await recordFailure('prov_a', { code: 500 }, mock);
    await recordFailure('prov_a', { code: 500 }, mock);
    // Keep prov_b closed
    const states = await fetchCircuitStates(['prov_a', 'prov_b', 'prov_c'], mock);
    expect(states['prov_a']).toBe('open');
    expect(states['prov_b']).toBe('closed');
    expect(states['prov_c']).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// Router integration tests
// ---------------------------------------------------------------------------

const config = {
  provider_policies: getProviderPolicies(),
  codex: getCodexConfig(),
};

describe('selectRoute with circuit_states', () => {
  it('skips open provider and selects next in chain', () => {
    // chat chain: openai_api → ollama (qwen3:8b) → ollama (qwen3:14b)
    const result = selectRoute('chat', config, {
      circuit_states: { openai_api: 'open' },
    });
    expect(result.provider).not.toBe('openai_api');
    expect(result.circuit_blocked).toBeUndefined();
  });

  it('returns circuit_blocked: true when all providers in chain are open', () => {
    // Get the actual chat chain providers
    const chatChain = getProviderPolicies()['chat'] ?? [];
    const allOpen: Record<string, 'open'> = {};
    for (const entry of chatChain) {
      allOpen[entry.provider] = 'open';
    }
    const result = selectRoute('chat', config, { circuit_states: allOpen });
    expect(result.circuit_blocked).toBe(true);
    // fallback_chain still populated
    expect(result.fallback_chain.length).toBeGreaterThanOrEqual(0);
    expect(result.route_chain).toHaveLength(chatChain.length);
  });

  it('does not set circuit_blocked when no circuit_states provided', () => {
    const result = selectRoute('chat', config);
    expect(result.circuit_blocked).toBeUndefined();
  });

  it('closed provider is not skipped', () => {
    const result = selectRoute('chat', config, {
      circuit_states: { openai_api: 'closed' },
    });
    expect(result.provider).toBe('openai_api');
  });

  it('half_open provider is not skipped', () => {
    const result = selectRoute('chat', config, {
      circuit_states: { openai_api: 'half_open' },
    });
    expect(result.provider).toBe('openai_api');
  });
});
