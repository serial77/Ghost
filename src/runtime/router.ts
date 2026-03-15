// Extracted verbatim in behavior from "Select Route Plan" Code node in ghost-runtime-workflow.json
// Node ID: 367325d4-4a53-4aa8-b355-d969ef1422df
// Behavior must remain identical to the live workflow node.

import type { ProviderRoute, ProviderPolicies } from './config.js';
import type { CircuitState } from './circuit-breaker.js';
import { fetchCircuitStates } from './circuit-breaker.js';

export interface RouterConfig {
  provider_policies?: Partial<ProviderPolicies> & Record<string, ProviderRoute[] | undefined>;
  codex?: { model_alias?: string };
}

export interface RouteOverrides {
  force_task_class?: string;
  force_provider?: string;
  force_model?: string;
  /** Pre-fetched circuit states. Providers whose state is 'open' are skipped. */
  circuit_states?: Record<string, CircuitState>;
}

export interface RouteResult {
  task_class: string;
  provider: string;
  selected_model: string;
  route_chain: ProviderRoute[];
  fallback_chain: ProviderRoute[];
  /** true if all providers in the chain have open circuits */
  circuit_blocked?: boolean;
}

export function selectRoute(
  requestType: string,
  config: RouterConfig,
  overrides: RouteOverrides = {},
): RouteResult {
  const requestedTaskClass = overrides.force_task_class || requestType || 'chat';
  const policies = config.provider_policies || {};
  const routeChain: ProviderRoute[] = policies[requestedTaskClass] ?? policies['chat'] ?? [];
  const defaultCodexModel = config.codex?.model_alias ?? 'gpt-5.4';

  // Circuit-aware chain: filter out open-circuit providers if states are provided
  const circuitStates = overrides.circuit_states;
  const availableChain: ProviderRoute[] = circuitStates
    ? routeChain.filter((route) => circuitStates[route.provider] !== 'open')
    : routeChain;

  const circuitBlocked = circuitStates !== undefined && availableChain.length === 0 && routeChain.length > 0;

  let selected: ProviderRoute = availableChain[0] ?? routeChain[0] ?? { provider: 'ollama', model: 'qwen3:14b' };

  if (overrides.force_provider) {
    const chainToSearch = circuitStates ? availableChain : routeChain;
    const matchedRoute = chainToSearch.find((route) => route.provider === overrides.force_provider);
    if (matchedRoute) {
      selected = matchedRoute;
    } else if (overrides.force_provider === 'codex_oauth_worker') {
      selected = { provider: overrides.force_provider, model: defaultCodexModel };
    } else {
      selected = { provider: overrides.force_provider, model: overrides.force_model ?? selected.model };
    }
  }

  if (overrides.force_model) {
    selected = { provider: selected.provider, model: overrides.force_model };
  }

  return {
    task_class: requestedTaskClass,
    provider: selected.provider,
    selected_model: selected.model,
    route_chain: routeChain,
    fallback_chain: routeChain.slice(1),
    ...(circuitBlocked ? { circuit_blocked: true } : {}),
  };
}

/**
 * Async wrapper that fetches circuit states from Redis and then calls selectRoute.
 * Use this in production; selectRoute itself remains synchronous.
 */
export async function selectRouteWithCircuit(
  requestType: string,
  config: RouterConfig,
  overrides: Omit<RouteOverrides, 'circuit_states'> = {},
  redisUrl?: string,
): Promise<RouteResult> {
  const policies = config.provider_policies || {};
  const taskClass = overrides.force_task_class || requestType || 'chat';
  const routeChain: ProviderRoute[] = policies[taskClass] ?? policies['chat'] ?? [];
  const providers = [...new Set(routeChain.map((r) => r.provider))];

  const circuitStates = await fetchCircuitStates(providers, redisUrl);
  return selectRoute(requestType, config, { ...overrides, circuit_states: circuitStates });
}
