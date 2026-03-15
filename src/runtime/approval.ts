// Extracted verbatim in behavior from "Assess Approval Risk" Code node in ghost-runtime-workflow.json
// Node ID: 9c9f8c66-a681-4819-8171-042e032d8391
// Behavior must remain identical to the live workflow node.

// ─── Embedded approval config (verbatim from live node) ──────────────────────

export const APPROVAL_CONFIG = {
  approval_model: {
    version: 'phase7-approval-v1',
    initial_state: 'proposed',
    categories: [
      { id: 'destructive_change', description: 'Any request that mutates code, runtime state, or durable records.' },
      { id: 'production_promotion', description: 'Live activation, rollback, or publish operations against a promoted environment.' },
      { id: 'database_mutation', description: 'Changes to application or workflow database state.' },
      { id: 'runtime_control', description: 'Actions that restart, stop, reconfigure, or otherwise alter runtime behavior.' },
      { id: 'memory_or_artifact_write', description: 'Durable writes to memory, evidence packages, or published artifacts.' },
    ],
    risk_levels: ['safe', 'caution', 'high', 'critical'] as const,
    required_fields: [
      'approval_id', 'state', 'requested_at', 'requested_by', 'requester_worker_id',
      'environment', 'category', 'risk_level', 'capabilities', 'summary', 'reason',
    ],
  },
  workers_by_id: {
    ghost_main: { id: 'ghost_main', visibility_label: 'Ghost Main', operator_identity: 'parent-owner', environment_scope: ['prod', 'staging', 'lab', 'sandbox', 'scratch'] },
    forge:      { id: 'forge',      visibility_label: 'Forge',       operator_identity: 'delegated-worker',       environment_scope: ['staging', 'lab', 'sandbox', 'scratch'] },
    probe:      { id: 'probe',      visibility_label: 'Probe',       operator_identity: 'verification-worker',    environment_scope: ['prod', 'staging', 'lab', 'sandbox'] },
    rector:     { id: 'rector',     visibility_label: 'Rector',      operator_identity: 'governed-change-worker', environment_scope: ['staging', 'lab', 'sandbox', 'scratch'] },
    archivist:  { id: 'archivist',  visibility_label: 'Archivist',   operator_identity: 'memory-audit-worker',   environment_scope: ['prod', 'staging', 'lab', 'sandbox'] },
    operator:   { id: 'operator',   visibility_label: 'Operator',    operator_identity: 'ops-worker',            environment_scope: ['prod', 'staging', 'lab'] },
    scout:      { id: 'scout',      visibility_label: 'Scout',       operator_identity: 'research-worker',       environment_scope: ['prod', 'staging', 'lab', 'sandbox', 'scratch'] },
  } as Record<string, { id: string; visibility_label: string; operator_identity: string; environment_scope: string[] }>,
  capabilities_by_id: {
    'code.read':        { id: 'code.read',        class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox', 'scratch'], description: 'Read source files, generated artifacts, and builder modules.' },
    'code.write':       { id: 'code.write',       class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox', 'scratch'],         description: 'Modify source files or generated workflow artifacts.' },
    'shell.safe':       { id: 'shell.safe',       class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox', 'scratch'], description: 'Run bounded, non-destructive shell commands for inspection or validation.' },
    'shell.destructive':{ id: 'shell.destructive',class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox', 'scratch'],         description: 'Run commands that can mutate runtime state or remove data.' },
    'git.inspect':      { id: 'git.inspect',      class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox', 'scratch'], description: 'Inspect repository history, status, and diffs.' },
    'git.write':        { id: 'git.write',        class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox', 'scratch'],         description: 'Create commits or otherwise mutate repository state.' },
    'deploy.promote':   { id: 'deploy.promote',   class: 'destructive',     approval_required: true,  environment_restriction: ['prod', 'staging'],                             description: 'Promote, publish, or roll back live workflows.' },
    'db.read':          { id: 'db.read',          class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox'],           description: 'Read application or workflow database state.' },
    'db.write':         { id: 'db.write',         class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox', 'scratch'],         description: 'Mutate application or workflow database state.' },
    'memory.write':     { id: 'memory.write',     class: 'destructive',     approval_required: true,  environment_restriction: ['prod', 'staging', 'lab', 'sandbox'],           description: 'Persist durable memory or history records.' },
    'web.research':     { id: 'web.research',     class: 'non_destructive', approval_required: false, environment_restriction: ['prod', 'staging', 'lab', 'sandbox', 'scratch'], description: 'Perform external or internal research for discovery and preflight work.' },
    'artifact.publish': { id: 'artifact.publish', class: 'destructive',     approval_required: true,  environment_restriction: ['staging', 'lab', 'sandbox'],                  description: 'Publish or persist generated artifacts intended for wider system use.' },
  } as Record<string, { id: string; class: string; approval_required: boolean; environment_restriction: string[]; description: string }>,
  worker_capabilities: {
    ghost_main: ['code.read', 'shell.safe', 'git.inspect', 'db.read'],
    forge:      ['code.read', 'code.write', 'shell.safe', 'git.inspect', 'artifact.publish'],
    probe:      ['code.read', 'shell.safe', 'git.inspect', 'db.read', 'web.research'],
    rector:     ['code.read', 'code.write', 'shell.safe', 'shell.destructive', 'git.inspect', 'git.write', 'db.read', 'db.write'],
    archivist:  ['code.read', 'db.read', 'memory.write', 'artifact.publish'],
    operator:   ['code.read', 'shell.safe', 'shell.destructive', 'git.inspect', 'git.write', 'deploy.promote', 'db.read', 'db.write', 'artifact.publish'],
    scout:      ['code.read', 'shell.safe', 'git.inspect', 'db.read', 'web.research'],
  } as Record<string, string[]>,
  environments_by_id: {
    prod:    { id: 'prod',    label: 'Production', governance_posture: 'highest',  restricted_capabilities: ['code.write', 'shell.destructive', 'git.write', 'db.write', 'memory.write'], mutable: true },
    staging: { id: 'staging', label: 'Staging',    governance_posture: 'high',     restricted_capabilities: ['deploy.promote'],                                                            mutable: true },
    lab:     { id: 'lab',     label: 'Lab',         governance_posture: 'moderate', restricted_capabilities: [],                                                                           mutable: true },
    sandbox: { id: 'sandbox', label: 'Sandbox',     governance_posture: 'moderate', restricted_capabilities: [],                                                                           mutable: true },
    scratch: { id: 'scratch', label: 'Scratch',     governance_posture: 'low',      restricted_capabilities: [],                                                                           mutable: true },
  } as Record<string, { id: string; label: string; governance_posture: string; restricted_capabilities: string[]; mutable: boolean }>,
};

// ─── Destructive / caution pattern rules (verbatim from live node) ────────────

export interface RiskFinding {
  level: 'destructive' | 'caution';
  code: string;
  reason: string;
}

const DESTRUCTIVE_RULES: Array<{ label: string; pattern: RegExp; reason: string }> = [
  {
    label: 'delete_or_rm',
    pattern: /(^|\s)(rm\s+-rf|rm\s+-r|rm\s+|delete\s+(the\s+)?file|delete\s+(the\s+)?directory|remove\s+(the\s+)?file|unlink\s+|shred\s+)/i,
    reason: 'Requests file deletion or removal.',
  },
  {
    label: 'docker_live_change',
    pattern: /docker\s+compose\s+(down|restart|up|stop)|docker\s+(restart|stop)\b/i,
    reason: 'Requests live container lifecycle changes.',
  },
  {
    label: 'destructive_sql',
    pattern: /\b(drop\s+table|drop\s+database|truncate\s+table|delete\s+from|alter\s+table\s+.*drop\s+column)\b/i,
    reason: 'Contains destructive SQL operations.',
  },
  {
    label: 'critical_move',
    pattern: /\b(move|mv|rename)\b.*\b(docker-compose\.ya?ml|\.env|systemd|workflow|workflows\/|base\/)\b/i,
    reason: 'Moves or renames critical runtime files.',
  },
];

const CAUTION_RULES: Array<{ label: string; pattern: RegExp; reason: string }> = [
  {
    label: 'critical_file_edit',
    pattern: /\b(edit|modify|change|update|patch|rewrite)\b.*\b(docker-compose\.ya?ml|\.env(\.|\b)|systemd|service unit|workflow id|production workflow|ghost-chat-v3|Yh6h9OJyVCfREbp3)\b/i,
    reason: 'Touches critical runtime configuration or live workflow identifiers.',
  },
  {
    label: 'broad_sql',
    pattern: /\b(update|delete)\b.*\b(sql|postgres|database|table)\b/i,
    reason: 'Requests a database-changing operation.',
  },
  {
    label: 'infrastructure_change',
    pattern: /\b(deploy|deployment|infrastructure|nginx|kubernetes|compose file|dockerfile)\b/i,
    reason: 'Requests infrastructure-related changes.',
  },
];

export type RiskLevel = 'safe' | 'caution' | 'destructive';

export interface RiskDetectionResult {
  riskLevel: RiskLevel;
  findings: RiskFinding[];
}

/** Evaluate destructive/caution patterns against user text. Verbatim from "Assess Approval Risk" live node. */
export function detectRiskLevel(sourceText: string): RiskDetectionResult {
  const findings: RiskFinding[] = [];
  let riskLevel: RiskLevel = 'safe';

  for (const rule of DESTRUCTIVE_RULES) {
    if (rule.pattern.test(sourceText)) {
      findings.push({ level: 'destructive', code: rule.label, reason: rule.reason });
    }
  }
  if (!findings.length) {
    for (const rule of CAUTION_RULES) {
      if (rule.pattern.test(sourceText)) {
        findings.push({ level: 'caution', code: rule.label, reason: rule.reason });
      }
    }
  }

  if (findings.some((f) => f.level === 'destructive')) riskLevel = 'destructive';
  else if (findings.some((f) => f.level === 'caution')) riskLevel = 'caution';

  return { riskLevel, findings };
}

// ─── Governance policy types ──────────────────────────────────────────────────

export interface GovernancePolicy {
  state: 'allowed' | 'approval_required' | 'environment_restricted';
  summary: string;
  blocking_capabilities: string[];
  environment: string;
  environment_posture: string | null;
  approval_required_capabilities: string[];
  restricted_capabilities: string[];
  out_of_scope_capabilities: string[];
  destructive_capabilities: string[];
  operator_identity: string | null;
  worker_environment_scope: string[];
}

// ─── Core export ─────────────────────────────────────────────────────────────

/**
 * Evaluate governance policy for a worker performing specific capabilities in an environment.
 * Adapted from __buildApprovalItem + __buildApprovalPolicy in "Assess Approval Risk" live node.
 */
export function assessApprovalRisk(
  workerId: string,
  capabilities: string[],
  environment: string,
): GovernancePolicy {
  const worker = APPROVAL_CONFIG.workers_by_id[workerId] ?? null;
  if (!worker) {
    throw new Error(`Unknown approval worker: ${workerId}`);
  }

  const environmentDoc =
    APPROVAL_CONFIG.environments_by_id[environment] ??
    APPROVAL_CONFIG.environments_by_id['lab']!;

  const normalizedCapabilities = Array.from(new Set(capabilities)).filter(
    (capId) => !!APPROVAL_CONFIG.capabilities_by_id[capId],
  );

  const capabilityRecords = normalizedCapabilities.map(
    (capId) => APPROVAL_CONFIG.capabilities_by_id[capId]!,
  );

  const approvalRequiredCapabilities = capabilityRecords
    .filter((c) => c.approval_required)
    .map((c) => c.id);

  const destructiveCapabilities = capabilityRecords
    .filter((c) => c.class === 'destructive')
    .map((c) => c.id);

  const restrictedCapabilities = capabilityRecords
    .filter((c) => (environmentDoc.restricted_capabilities ?? []).includes(c.id))
    .map((c) => c.id);

  const outOfScopeCapabilities = capabilityRecords
    .filter((c) => !(c.environment_restriction ?? []).includes(environment))
    .map((c) => c.id);

  const blockingCapabilities = Array.from(new Set([...restrictedCapabilities, ...outOfScopeCapabilities]));

  const state: GovernancePolicy['state'] =
    blockingCapabilities.length > 0
      ? 'environment_restricted'
      : approvalRequiredCapabilities.length > 0
        ? 'approval_required'
        : 'allowed';

  const summaryParts: string[] = [];
  if (approvalRequiredCapabilities.length > 0) summaryParts.push(`approval required for ${approvalRequiredCapabilities.join(', ')}`);
  if (restrictedCapabilities.length > 0) summaryParts.push(`restricted in ${environment}: ${restrictedCapabilities.join(', ')}`);
  if (outOfScopeCapabilities.length > 0) summaryParts.push(`outside ${environment} scope: ${outOfScopeCapabilities.join(', ')}`);
  summaryParts.push(`environment posture ${environmentDoc.governance_posture ?? 'unknown'}`);

  return {
    state,
    summary: summaryParts.join('; '),
    blocking_capabilities: blockingCapabilities,
    environment,
    environment_posture: environmentDoc.governance_posture ?? null,
    approval_required_capabilities: approvalRequiredCapabilities,
    restricted_capabilities: restrictedCapabilities,
    out_of_scope_capabilities: outOfScopeCapabilities,
    destructive_capabilities: destructiveCapabilities,
    operator_identity: worker.operator_identity ?? null,
    worker_environment_scope: Array.isArray(worker.environment_scope) ? worker.environment_scope : [],
  };
}
