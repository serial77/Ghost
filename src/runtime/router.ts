// Extracted verbatim in behavior from "Select Route Plan" Code node in ghost-runtime-workflow.json
// Node ID: 367325d4-4a53-4aa8-b355-d969ef1422df
// Behavior must remain identical to the live workflow node.

import type { ProviderRoute, ProviderPolicies } from './config.js';

export interface RouterConfig {
  provider_policies?: Partial<ProviderPolicies> & Record<string, ProviderRoute[] | undefined>;
  codex?: { model_alias?: string };
}

export interface RouteOverrides {
  force_task_class?: string;
  force_provider?: string;
  force_model?: string;
}

export interface RouteResult {
  task_class: string;
  provider: string;
  selected_model: string;
  route_chain: ProviderRoute[];
  fallback_chain: ProviderRoute[];
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
  let selected: ProviderRoute = routeChain[0] ?? { provider: 'ollama', model: 'qwen3:14b' };

  if (overrides.force_provider) {
    const matchedRoute = routeChain.find((route) => route.provider === overrides.force_provider);
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
  };
}
