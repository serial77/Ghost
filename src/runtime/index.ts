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
export { selectRoute } from './router.js';
export type { RouterConfig, RouteOverrides, RouteResult } from './router.js';

// approval.ts
export {
  APPROVAL_CONFIG,
  detectRiskLevel,
  assessApprovalRisk,
} from './approval.js';
export type { RiskFinding, RiskLevel, RiskDetectionResult, GovernancePolicy } from './approval.js';

// memory.ts — primary public API
export {
  extractMemories,
  consolidateMemories,
  storeMemories,
  // supporting exports (used by workflow pre-LLM nodes)
  shouldExtractMemory,
  buildExtractionPrompt,
} from './memory.js';
export type {
  MemoryScope,
  MemoryCategory,
  MemoryTier,
  MemoryStatus,
  MemorySourceType,
  MemoryContext,
  ShouldExtractResult,
  MemoryCandidate,
  MemoryWriteRow,
  ExtractMemoriesResult,
  ConsolidationResult,
} from './memory.js';

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
