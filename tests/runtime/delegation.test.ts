import { describe, it, expect } from 'vitest';
import {
  WORKER_RUNTIME,
  DELEGATION_REQUIRED_CAPABILITIES,
  buildDelegationRequest,
  resolveWorkerByIntent,
} from '../../src/runtime/delegation.js';

// ─── Config structure verification ───────────────────────────────────────────

describe('WORKER_RUNTIME — structural counts match live runtime truth', () => {
  it('has exactly 7 worker definitions', () => {
    expect(Object.keys(WORKER_RUNTIME.workers_by_id)).toHaveLength(7);
  });

  it('all 7 worker IDs are present', () => {
    const ids = Object.keys(WORKER_RUNTIME.workers_by_id);
    expect(ids).toContain('ghost_main');
    expect(ids).toContain('forge');
    expect(ids).toContain('probe');
    expect(ids).toContain('rector');
    expect(ids).toContain('archivist');
    expect(ids).toContain('operator');
    expect(ids).toContain('scout');
  });

  it('has exactly 12 capabilities', () => {
    expect(Object.keys(WORKER_RUNTIME.capabilities_by_id)).toHaveLength(12);
  });

  it('has exactly 5 environments', () => {
    expect(Object.keys(WORKER_RUNTIME.environments_by_id)).toHaveLength(5);
  });

  it('every worker has invocation_intent array', () => {
    for (const worker of Object.values(WORKER_RUNTIME.workers_by_id)) {
      expect(Array.isArray(worker.invocation_intent)).toBe(true);
      expect(worker.invocation_intent.length).toBeGreaterThan(0);
    }
  });
});

describe('WORKER_RUNTIME — worker role definitions (live runtime truth)', () => {
  it('forge handles technical_work intent', () => {
    const forge = WORKER_RUNTIME.workers_by_id['forge']!;
    expect(forge.role).toBe('implementation_worker');
    expect(forge.invocation_intent).toContain('technical_work');
    expect(forge.environment_scope).not.toContain('prod');
  });

  it('ghost_main handles default_chat_owner intent', () => {
    const main = WORKER_RUNTIME.workers_by_id['ghost_main']!;
    expect(main.role).toBe('primary_orchestrator');
    expect(main.invocation_intent).toContain('default_chat_owner');
  });

  it('probe handles smoke_check intent and is available in prod', () => {
    const probe = WORKER_RUNTIME.workers_by_id['probe']!;
    expect(probe.role).toBe('verification_worker');
    expect(probe.invocation_intent).toContain('smoke_check');
    expect(probe.environment_scope).toContain('prod');
  });

  it('operator handles deployment_promotion and is only in prod/staging/lab', () => {
    const operator = WORKER_RUNTIME.workers_by_id['operator']!;
    expect(operator.invocation_intent).toContain('deployment_promotion');
    expect(operator.environment_scope).toEqual(['prod', 'staging', 'lab']);
    expect(operator.environment_scope).not.toContain('sandbox');
  });

  it('archivist handles memory_write intent', () => {
    const archivist = WORKER_RUNTIME.workers_by_id['archivist']!;
    expect(archivist.invocation_intent).toContain('memory_write');
    expect(archivist.role).toBe('memory_audit_worker');
  });
});

describe('DELEGATION_REQUIRED_CAPABILITIES', () => {
  it('contains exactly code.write and artifact.publish (hardcoded in live node)', () => {
    expect(DELEGATION_REQUIRED_CAPABILITIES).toHaveLength(2);
    expect(DELEGATION_REQUIRED_CAPABILITIES).toContain('code.write');
    expect(DELEGATION_REQUIRED_CAPABILITIES).toContain('artifact.publish');
  });
});

// ─── resolveWorkerByIntent ────────────────────────────────────────────────────

describe('resolveWorkerByIntent — worker selection by task_class', () => {
  it('technical_work resolves to forge', () => {
    const worker = resolveWorkerByIntent('technical_work');
    expect(worker?.id).toBe('forge');
  });

  it('smoke_check resolves to probe', () => {
    const worker = resolveWorkerByIntent('smoke_check');
    expect(worker?.id).toBe('probe');
  });

  it('deployment_promotion resolves to operator', () => {
    const worker = resolveWorkerByIntent('deployment_promotion');
    expect(worker?.id).toBe('operator');
  });

  it('memory_write resolves to archivist', () => {
    const worker = resolveWorkerByIntent('memory_write');
    expect(worker?.id).toBe('archivist');
  });

  it('research resolves to scout', () => {
    const worker = resolveWorkerByIntent('research');
    expect(worker?.id).toBe('scout');
  });

  it('unknown intent defaults to forge', () => {
    const worker = resolveWorkerByIntent('totally_unknown_intent');
    expect(worker?.id).toBe('forge');
  });

  it('empty string defaults to forge', () => {
    const worker = resolveWorkerByIntent('');
    expect(worker?.id).toBe('forge');
  });
});

// ─── buildDelegationRequest ───────────────────────────────────────────────────

const baseContext = {
  task_class: 'technical_work',
  task_summary: 'Fix the broken authentication flow',
  conversation_id: 'conv-123',
  parent_message_id: 'msg-456',
  parent_owner_label: 'Ghost',
  parent_provider: 'openai_api',
  parent_model: 'gpt-4.1-mini',
  delegated_provider: 'codex_oauth_worker',
  delegated_model: 'gpt-5.4',
  n8n_execution_id: 'exec-789',
  entrypoint: 'direct_webhook',
};

const baseWorkerConfig = {
  delegation_id: 'del-abc',
  orchestration_task_id: 'orch-def',
  worker_conversation_id: 'conv-worker-xyz',
  worker_agent_id: 'agent-uuid',
  worker_provider: 'codex_oauth_worker',
  worker_model: 'gpt-5.4',
};

describe('buildDelegationRequest — worker selection', () => {
  it('selects forge for technical_work task_class', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'lab');
    expect(result.delegated_worker_id).toBe('forge');
    expect(result.delegated_worker_label).toBe('Forge');
    expect(result.delegated_worker_role).toBe('implementation_worker');
    expect(result.delegated_worker_operator_identity).toBe('delegated-worker');
  });

  it('smoke_check resolves to probe but buildDelegationRequest throws (probe lacks required caps)', () => {
    // resolveWorkerByIntent correctly returns probe, but probe does not carry
    // code.write / artifact.publish so the capability validation guard throws.
    // Only workers that carry DELEGATION_REQUIRED_CAPABILITIES can be delegated to.
    expect(() =>
      buildDelegationRequest(
        { ...baseContext, task_class: 'smoke_check' },
        baseWorkerConfig,
        'lab',
      ),
    ).toThrow(/missing required capabilities/);
  });

  it('defaults to forge for unknown task_class', () => {
    const result = buildDelegationRequest(
      { ...baseContext, task_class: 'unknown' },
      baseWorkerConfig,
      'lab',
    );
    expect(result.delegated_worker_id).toBe('forge');
  });
});

describe('buildDelegationRequest — request fields', () => {
  it('propagates delegation_id, orchestration_task_id, worker_conversation_id', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'lab');
    expect(result.delegation_id).toBe('del-abc');
    expect(result.orchestration_task_id).toBe('orch-def');
    expect(result.worker_conversation_id).toBe('conv-worker-xyz');
    expect(result.worker_agent_id).toBe('agent-uuid');
  });

  it('request_title is truncated task_summary', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'lab');
    expect(result.request_title).toBe('Fix the broken authentication flow');
  });

  it('populates worker_runtime_input correctly', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'lab');
    expect(result.worker_runtime_input.delegated_from_conversation_id).toBe('conv-123');
    expect(result.worker_runtime_input.delegated_from_message_id).toBe('msg-456');
    expect(result.worker_runtime_input.delegated_provider).toBe('codex_oauth_worker');
  });

  it('populates worker_runtime_context correctly', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'lab');
    expect(result.worker_runtime_context.delegation_id).toBe('del-abc');
    expect(result.worker_runtime_context.parent_owner_label).toBe('Ghost');
    expect(result.worker_runtime_context.worker_registry_id).toBe('forge');
    expect(result.worker_runtime_context.n8n_execution_id).toBe('exec-789');
    expect(result.worker_runtime_context.entrypoint).toBe('direct_webhook');
  });
});

describe('buildDelegationRequest — governance policy (lab environment)', () => {
  it('forge in lab → approval_required (code.write and artifact.publish require approval)', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'lab');
    expect(result.governance_policy.state).toBe('approval_required');
    expect(result.governance_policy.environment).toBe('lab');
    expect(result.governance_policy.approval_required_capabilities).toContain('code.write');
    expect(result.governance_policy.approval_required_capabilities).toContain('artifact.publish');
  });

  it('approval_required is false in lab when governance state is approval_required (only environment_restricted triggers it)', () => {
    // Live truth: approval_required output field = context.approval_required===true OR state==='environment_restricted'.
    // governance state 'approval_required' alone does NOT set the field to true.
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'lab');
    expect(result.approval_required).toBe(false);
  });
});

describe('buildDelegationRequest — governance policy (prod environment)', () => {
  it('forge in prod → environment_restricted (code.write blocked, artifact.publish out_of_scope)', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'prod');
    expect(result.governance_policy.state).toBe('environment_restricted');
    expect(result.governance_policy.restricted_capabilities).toContain('code.write');
    expect(result.governance_policy.out_of_scope_capabilities).toContain('artifact.publish');
    expect(result.approval_required).toBe(true);
  });
});

describe('buildDelegationRequest — context approval_required propagation', () => {
  it('approval_required is true when context.approval_required is true even though governance state is only approval_required (not environment_restricted)', () => {
    // forge in lab: governance state = 'approval_required', which alone does NOT set
    // approval_required field. But context.approval_required=true overrides and forces it.
    const forgeContext = { ...baseContext, task_class: 'technical_work', approval_required: true };
    const result = buildDelegationRequest(forgeContext, baseWorkerConfig, 'lab');
    expect(result.approval_required).toBe(true);
    expect(result.governance_policy.state).toBe('approval_required');
  });
});

describe('buildDelegationRequest — worker capability validation', () => {
  it('throws if worker is missing required capabilities', () => {
    // ghost_main lacks code.write and artifact.publish
    const ghostContext = { ...baseContext, task_class: 'default_chat_owner' };
    expect(() => buildDelegationRequest(ghostContext, baseWorkerConfig, 'lab')).toThrow(
      /missing required capabilities/,
    );
  });
});

describe('buildDelegationRequest — environment defaults', () => {
  it('defaults to lab when no environment provided', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig);
    expect(result.governance_environment).toBe('lab');
  });

  it('production string resolves to prod key', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'production');
    expect(result.governance_environment).toBe('prod');
  });

  it('unknown environment resolves to lab', () => {
    const result = buildDelegationRequest(baseContext, baseWorkerConfig, 'totally_unknown');
    expect(result.governance_environment).toBe('lab');
  });
});
