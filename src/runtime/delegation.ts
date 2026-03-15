// Extracted verbatim in behavior from "Build Delegation Request" + "Build Delegation Context"
// Code nodes in ghost-runtime-workflow.json
// Node IDs: 71c8b260-fda1-212a-9d94-a7318ce5503c + 36fdb14c-6220-e1ed-09dc-13e288c05f9b
// Behavior must remain identical to the live workflow nodes.

// ─── Embedded worker runtime config (verbatim from live nodes) ───────────────

export const WORKER_RUNTIME = {
  workers_by_id: {
    ghost_main: {
      id: 'ghost_main',
      visibility_label: 'Ghost Main',
      role: 'primary_orchestrator',
      purpose: 'Owns the parent conversation, resolves route/policy decisions, and returns the canonical parent-facing reply.',
      invocation_intent: ['default_chat_owner', 'route_resolution', 'parent_reply'],
      operator_identity: 'parent-owner',
      responsibility_domain: ['conversation_ownership', 'routing', 'policy_handoff', 'parent_response'],
      environment_scope: ['prod', 'staging', 'lab', 'sandbox', 'scratch'],
    },
    forge: {
      id: 'forge',
      visibility_label: 'Forge',
      role: 'implementation_worker',
      purpose: 'Performs bounded technical work that requires code modification or artifact production.',
      invocation_intent: ['technical_work', 'code_change', 'artifact_build'],
      operator_identity: 'delegated-worker',
      responsibility_domain: ['code_editing', 'artifact_generation', 'task_execution'],
      environment_scope: ['staging', 'lab', 'sandbox', 'scratch'],
    },
    probe: {
      id: 'probe',
      visibility_label: 'Probe',
      role: 'verification_worker',
      purpose: 'Runs smoke, probes, and narrow runtime verification tasks against existing behavior.',
      invocation_intent: ['smoke_check', 'runtime_probe', 'post_change_verification'],
      operator_identity: 'verification-worker',
      responsibility_domain: ['verification', 'probe_execution', 'health_confirmation'],
      environment_scope: ['prod', 'staging', 'lab', 'sandbox'],
    },
    rector: {
      id: 'rector',
      visibility_label: 'Rector',
      role: 'change_governance_worker',
      purpose: 'Applies guarded remediation or cleanup work when explicitly authorized by policy or operator action.',
      invocation_intent: ['guarded_cleanup', 'narrow_remediation', 'policy_constrained_change'],
      operator_identity: 'governed-change-worker',
      responsibility_domain: ['governed_remediation', 'cleanup', 'riskier_write_paths'],
      environment_scope: ['staging', 'lab', 'sandbox', 'scratch'],
    },
    archivist: {
      id: 'archivist',
      visibility_label: 'Archivist',
      role: 'memory_audit_worker',
      purpose: 'Handles memory, retention framing, and durable evidence packaging for later interpretation.',
      invocation_intent: ['memory_write', 'audit_packaging', 'history_summary'],
      operator_identity: 'memory-audit-worker',
      responsibility_domain: ['memory', 'history', 'evidence_packaging'],
      environment_scope: ['prod', 'staging', 'lab', 'sandbox'],
    },
    operator: {
      id: 'operator',
      visibility_label: 'Operator',
      role: 'ops_control_worker',
      purpose: 'Owns promotion, rollback, runtime trace, and governance-facing operator actions.',
      invocation_intent: ['deployment_promotion', 'rollback', 'runtime_trace', 'governance_action'],
      operator_identity: 'ops-worker',
      responsibility_domain: ['ops', 'promotion', 'rollback', 'runtime_debug'],
      environment_scope: ['prod', 'staging', 'lab'],
    },
    scout: {
      id: 'scout',
      visibility_label: 'Scout',
      role: 'research_worker',
      purpose: 'Performs bounded external or internal research when discovery is needed before action.',
      invocation_intent: ['recon', 'research', 'preflight_discovery'],
      operator_identity: 'research-worker',
      responsibility_domain: ['research', 'discovery', 'preflight_visibility'],
      environment_scope: ['prod', 'staging', 'lab', 'sandbox', 'scratch'],
    },
  } as Record<string, WorkerDefinition>,
  worker_capabilities: {
    ghost_main: ['code.read', 'shell.safe', 'git.inspect', 'db.read'],
    forge:      ['code.read', 'code.write', 'shell.safe', 'git.inspect', 'artifact.publish'],
    probe:      ['code.read', 'shell.safe', 'git.inspect', 'db.read', 'web.research'],
    rector:     ['code.read', 'code.write', 'shell.safe', 'shell.destructive', 'git.inspect', 'git.write', 'db.read', 'db.write'],
    archivist:  ['code.read', 'db.read', 'memory.write', 'artifact.publish'],
    operator:   ['code.read', 'shell.safe', 'shell.destructive', 'git.inspect', 'git.write', 'deploy.promote', 'db.read', 'db.write', 'artifact.publish'],
    scout:      ['code.read', 'shell.safe', 'git.inspect', 'db.read', 'web.research'],
  } as Record<string, string[]>,
  capabilities_by_id: {
    'code.read':        { id: 'code.read',        class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox', 'scratch'] },
    'code.write':       { id: 'code.write',       class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox', 'scratch'] },
    'shell.safe':       { id: 'shell.safe',       class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox', 'scratch'] },
    'shell.destructive':{ id: 'shell.destructive',class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox', 'scratch'] },
    'git.inspect':      { id: 'git.inspect',      class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox', 'scratch'] },
    'git.write':        { id: 'git.write',        class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox', 'scratch'] },
    'deploy.promote':   { id: 'deploy.promote',   class: 'destructive',     approval_required: true,  environment_restriction: ['prod', 'staging'] },
    'db.read':          { id: 'db.read',          class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox'] },
    'db.write':         { id: 'db.write',         class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox', 'scratch'] },
    'memory.write':     { id: 'memory.write',     class: 'destructive',     approval_required: true,  environment_restriction: ['prod', 'staging', 'lab', 'sandbox'] },
    'web.research':     { id: 'web.research',     class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox', 'scratch'] },
    'artifact.publish': { id: 'artifact.publish', class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox'] },
  } as Record<string, { id: string; class: string; approval_required: boolean; environment_restriction: string[] }>,
  environments_by_id: {
    prod:    { id: 'prod',    label: 'Production', governance_posture: 'highest',  restricted_capabilities: ['code.write', 'shell.destructive', 'git.write', 'db.write', 'memory.write'] },
    staging: { id: 'staging', label: 'Staging',    governance_posture: 'high',     restricted_capabilities: ['deploy.promote'] },
    lab:     { id: 'lab',     label: 'Lab',         governance_posture: 'moderate', restricted_capabilities: [] },
    sandbox: { id: 'sandbox', label: 'Sandbox',     governance_posture: 'moderate', restricted_capabilities: [] },
    scratch: { id: 'scratch', label: 'Scratch',     governance_posture: 'low',      restricted_capabilities: [] },
  } as Record<string, { id: string; label: string; governance_posture: string; restricted_capabilities: string[] }>,
};

// Required capabilities hardcoded in "Build Delegation Context" live node
export const DELEGATION_REQUIRED_CAPABILITIES = ['code.write', 'artifact.publish'] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkerDefinition {
  id: string;
  visibility_label: string;
  role: string;
  purpose: string;
  invocation_intent: string[];
  operator_identity: string;
  responsibility_domain: string[];
  environment_scope: string[];
}

export interface DelegationContext {
  task_class?: string;
  task_summary?: string;
  conversation_id?: string;
  parent_message_id?: string;
  parent_owner_agent_id?: string;
  parent_owner_agent_key?: string;
  parent_owner_label?: string;
  parent_provider?: string;
  parent_model?: string;
  delegated_provider?: string;
  delegated_model?: string;
  approval_required?: boolean;
  risk_reasons?: string[];
  n8n_execution_id?: string;
  entrypoint?: string;
  message?: string;
}

export interface WorkerConfig {
  delegation_id?: string;
  orchestration_task_id?: string;
  worker_conversation_id?: string;
  worker_agent_id?: string;
  worker_provider?: string;
  worker_model?: string;
}

export interface WorkerGovernancePolicy {
  state: 'allowed' | 'approval_required' | 'environment_restricted';
  summary: string;
  environment: string;
  environment_posture: string | null;
  approval_required_capabilities: string[];
  restricted_capabilities: string[];
  out_of_scope_capabilities: string[];
  blocking_capabilities: string[];
}

export interface DelegationResult {
  delegated_worker_id: string;
  delegated_worker_label: string;
  delegated_worker_role: string;
  delegated_worker_operator_identity: string;
  request_title: string;
  request_summary: string;
  delegation_id: string;
  orchestration_task_id: string;
  worker_conversation_id: string;
  worker_agent_id: string;
  approval_required: boolean;
  governance_environment: string;
  governance_policy: WorkerGovernancePolicy;
  requested_capabilities: readonly string[];
  worker_registry_id: string;
  worker_role: string;
  worker_operator_identity: string;
  worker_environment_scope: string[];
  worker_allowed_capabilities: string[];
  delegated_provider: string;
  delegated_model: string;
  worker_runtime_input: {
    request_summary: string;
    delegated_from_conversation_id: string;
    delegated_from_message_id: string;
    delegated_provider: string;
    delegated_model: string;
  };
  worker_runtime_context: {
    delegation_id: string;
    orchestration_task_id: string;
    parent_conversation_id: string;
    parent_owner_label: string;
    worker_registry_id: string;
    worker_role: string;
    worker_operator_identity: string;
    delegated_provider: string;
    delegated_model: string;
    entrypoint: string;
    n8n_execution_id: string;
  };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function compact(value: unknown, limit = 800): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function resolveEnvironment(explicitEnv?: string): string {
  if (!explicitEnv) return 'lab';
  if (explicitEnv === 'production' && WORKER_RUNTIME.environments_by_id['prod']) return 'prod';
  if (WORKER_RUNTIME.environments_by_id[explicitEnv]) return explicitEnv;
  return 'lab';
}

// ─── Core export ─────────────────────────────────────────────────────────────

/**
 * Select a delegated worker by task_class invocation_intent and build the full
 * delegation request and context. Adapted from "Build Delegation Request" +
 * "Build Delegation Context" live workflow nodes (verbatim in behavior).
 *
 * @param context - Parent conversation context (from Resolve Parent Conversation Strategy)
 * @param workerConfig - Delegation DB record (from Create Delegation DB Record)
 * @param governanceEnv - Runtime environment key; defaults to 'lab' (same as live node)
 */
export function buildDelegationRequest(
  context: DelegationContext,
  workerConfig: WorkerConfig,
  governanceEnv?: string,
): DelegationResult {
  // ── Worker selection by invocation_intent (Build Delegation Request logic) ──
  const candidateWorkers = Object.values(WORKER_RUNTIME.workers_by_id);
  const selectedWorker =
    candidateWorkers.find(
      (worker) =>
        Array.isArray(worker.invocation_intent) &&
        worker.invocation_intent.includes(context.task_class ?? ''),
    ) ??
    WORKER_RUNTIME.workers_by_id['forge'] ??
    null;

  if (!selectedWorker) {
    throw new Error('No delegated worker registry entry is available for technical work');
  }

  const workerId = selectedWorker.id;
  const workerRegistry = WORKER_RUNTIME.workers_by_id[workerId];
  if (!workerRegistry) {
    throw new Error(`Missing delegated worker registry definition for ${workerId}`);
  }

  const workerCapabilities = WORKER_RUNTIME.worker_capabilities[workerId] ?? [];
  const requiredCapabilities = DELEGATION_REQUIRED_CAPABILITIES;

  // ── Governance policy evaluation (Build Delegation Context logic) ─────────
  const runtimeEnvironment = resolveEnvironment(governanceEnv);
  const environmentDoc =
    WORKER_RUNTIME.environments_by_id[runtimeEnvironment] ??
    WORKER_RUNTIME.environments_by_id['lab']!;

  const capabilityRecords = requiredCapabilities
    .map((capId) => WORKER_RUNTIME.capabilities_by_id[capId] ?? null)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const approvalRequiredCapabilities = capabilityRecords
    .filter((c) => c.approval_required)
    .map((c) => c.id);

  const restrictedCapabilities = capabilityRecords
    .filter((c) => (environmentDoc.restricted_capabilities ?? []).includes(c.id))
    .map((c) => c.id);

  const outOfScopeCapabilities = capabilityRecords
    .filter((c) => !(c.environment_restriction ?? []).includes(runtimeEnvironment))
    .map((c) => c.id);

  const workerGovernanceState: WorkerGovernancePolicy['state'] =
    restrictedCapabilities.length > 0 || outOfScopeCapabilities.length > 0
      ? 'environment_restricted'
      : approvalRequiredCapabilities.length > 0
        ? 'approval_required'
        : 'allowed';

  const summaryParts: string[] = [
    approvalRequiredCapabilities.length ? `approval required for ${approvalRequiredCapabilities.join(', ')}` : '',
    restrictedCapabilities.length ? `restricted in ${runtimeEnvironment}: ${restrictedCapabilities.join(', ')}` : '',
    outOfScopeCapabilities.length ? `outside ${runtimeEnvironment} scope: ${outOfScopeCapabilities.join(', ')}` : '',
    `environment posture ${environmentDoc.governance_posture ?? 'unknown'}`,
  ].filter(Boolean);

  const workerGovernancePolicy: WorkerGovernancePolicy = {
    state: workerGovernanceState,
    summary: summaryParts.join('; '),
    environment: runtimeEnvironment,
    environment_posture: environmentDoc.governance_posture ?? null,
    approval_required_capabilities: approvalRequiredCapabilities,
    restricted_capabilities: restrictedCapabilities,
    out_of_scope_capabilities: outOfScopeCapabilities,
    blocking_capabilities: Array.from(new Set([...restrictedCapabilities, ...outOfScopeCapabilities])),
  };

  // ── Capability validation ─────────────────────────────────────────────────
  const missingCapabilities = requiredCapabilities.filter((capId) => !workerCapabilities.includes(capId));
  if (missingCapabilities.length > 0) {
    throw new Error(
      `${workerRegistry.visibility_label ?? workerId} worker is missing required capabilities: ${missingCapabilities.join(', ')}`,
    );
  }

  // ── Build result fields ───────────────────────────────────────────────────
  const requestTitle = compact(
    context.task_summary ?? context.message ?? 'Ghost delegated worker task',
    160,
  ) || 'Ghost delegated worker task';
  const requestSummary = compact(context.message ?? context.task_summary ?? '');
  const delegatedProvider = workerConfig.worker_provider ?? context.delegated_provider ?? '';
  const delegatedModel = workerConfig.worker_model ?? context.delegated_model ?? '';
  const delegationId = workerConfig.delegation_id ?? '';

  return {
    delegated_worker_id: selectedWorker.id,
    delegated_worker_label: selectedWorker.visibility_label,
    delegated_worker_role: selectedWorker.role,
    delegated_worker_operator_identity: selectedWorker.operator_identity,
    request_title: requestTitle,
    request_summary: requestSummary,
    delegation_id: delegationId,
    orchestration_task_id: workerConfig.orchestration_task_id ?? '',
    worker_conversation_id: workerConfig.worker_conversation_id ?? '',
    worker_agent_id: workerConfig.worker_agent_id ?? '',
    approval_required:
      context.approval_required === true ||
      workerGovernancePolicy.state === 'environment_restricted',
    governance_environment: runtimeEnvironment,
    governance_policy: workerGovernancePolicy,
    requested_capabilities: requiredCapabilities,
    worker_registry_id: workerRegistry.id,
    worker_role: workerRegistry.role,
    worker_operator_identity: workerRegistry.operator_identity,
    worker_environment_scope: workerRegistry.environment_scope ?? [],
    worker_allowed_capabilities: workerCapabilities,
    delegated_provider: delegatedProvider,
    delegated_model: delegatedModel,
    worker_runtime_input: {
      request_summary: requestSummary,
      delegated_from_conversation_id: context.conversation_id ?? '',
      delegated_from_message_id: context.parent_message_id ?? '',
      delegated_provider: delegatedProvider,
      delegated_model: delegatedModel,
    },
    worker_runtime_context: {
      delegation_id: delegationId,
      orchestration_task_id: workerConfig.orchestration_task_id ?? '',
      parent_conversation_id: context.conversation_id ?? '',
      parent_owner_label: context.parent_owner_label ?? 'Ghost',
      worker_registry_id: workerRegistry.id,
      worker_role: workerRegistry.role,
      worker_operator_identity: workerRegistry.operator_identity,
      delegated_provider: delegatedProvider,
      delegated_model: delegatedModel,
      entrypoint: context.entrypoint ?? 'direct_webhook',
      n8n_execution_id: context.n8n_execution_id ?? '',
    },
  };
}

/**
 * Resolve the worker that handles a given invocation intent.
 * Verbatim from "Build Delegation Request" worker selection logic.
 */
export function resolveWorkerByIntent(taskClass: string): WorkerDefinition | null {
  const candidates = Object.values(WORKER_RUNTIME.workers_by_id);
  return (
    candidates.find(
      (worker) =>
        Array.isArray(worker.invocation_intent) &&
        worker.invocation_intent.includes(taskClass),
    ) ??
    WORKER_RUNTIME.workers_by_id['forge'] ??
    null
  );
}
