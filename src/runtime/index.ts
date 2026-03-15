export {
  classifyRequest,
  lightweightLocalSignals,
  technicalWorkSignals,
  technicalIntentSignals,
} from './classifier.js';

export type { Message, ClassificationResult } from './classifier.js';

export {
  getProviderPolicies,
  getOllamaModels,
  getOpenAIConfig,
  getCodexConfig,
} from './config.js';

export type {
  ProviderRoute,
  ProviderPolicies,
  OllamaModels,
  OpenAIConfig,
  CodexConfig,
} from './config.js';

// router.ts
export { selectRoute, selectRouteWithCircuit } from './router.js';
export type { RouterConfig, RouteOverrides, RouteResult } from './router.js';

// circuit-breaker.ts
export {
  getCircuitStatus,
  recordFailure,
  recordSuccess,
  isCircuitOpen,
  categorizeFailure,
  calculateBackoff,
  buildCircuitEventPayload,
  fetchCircuitStates,
  createInMemoryRedisClient,
} from './circuit-breaker.js';
export type { CircuitState, FailureCategory, CircuitStatus, FailureInfo } from './circuit-breaker.js';

// approval.ts
export {
  APPROVAL_CONFIG,
  detectRiskLevel,
  assessApprovalRisk,
} from './approval.js';
export type { RiskFinding, RiskLevel, RiskDetectionResult, GovernancePolicy } from './approval.js';

// delegation.ts
export {
  WORKER_RUNTIME,
  DELEGATION_REQUIRED_CAPABILITIES,
  buildDelegationRequest,
  resolveWorkerByIntent,
} from './delegation.js';
export type {
  WorkerDefinition,
  DelegationContext,
  WorkerConfig,
  WorkerGovernancePolicy,
  DelegationResult,
} from './delegation.js';
