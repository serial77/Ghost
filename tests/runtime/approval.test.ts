import { describe, it, expect } from 'vitest';
import {
  APPROVAL_CONFIG,
  assessApprovalRisk,
  detectRiskLevel,
} from '../../src/runtime/approval.js';

// ─── Config structure verification ───────────────────────────────────────────

describe('APPROVAL_CONFIG — structural counts match live runtime truth', () => {
  it('has exactly 5 risk categories', () => {
    expect(APPROVAL_CONFIG.approval_model.categories).toHaveLength(5);
    const ids = APPROVAL_CONFIG.approval_model.categories.map((c) => c.id);
    expect(ids).toContain('destructive_change');
    expect(ids).toContain('production_promotion');
    expect(ids).toContain('database_mutation');
    expect(ids).toContain('runtime_control');
    expect(ids).toContain('memory_or_artifact_write');
  });

  it('has exactly 4 risk levels', () => {
    expect(APPROVAL_CONFIG.approval_model.risk_levels).toHaveLength(4);
    expect(APPROVAL_CONFIG.approval_model.risk_levels).toEqual(['safe', 'caution', 'high', 'critical']);
  });

  it('has exactly 12 capabilities', () => {
    expect(Object.keys(APPROVAL_CONFIG.capabilities_by_id)).toHaveLength(12);
  });

  it('has exactly 7 workers', () => {
    expect(Object.keys(APPROVAL_CONFIG.workers_by_id)).toHaveLength(7);
    const workerIds = Object.keys(APPROVAL_CONFIG.workers_by_id);
    expect(workerIds).toContain('ghost_main');
    expect(workerIds).toContain('forge');
    expect(workerIds).toContain('probe');
    expect(workerIds).toContain('rector');
    expect(workerIds).toContain('archivist');
    expect(workerIds).toContain('operator');
    expect(workerIds).toContain('scout');
  });

  it('has exactly 5 environments', () => {
    expect(Object.keys(APPROVAL_CONFIG.environments_by_id)).toHaveLength(5);
    expect(Object.keys(APPROVAL_CONFIG.environments_by_id)).toEqual(
      expect.arrayContaining(['prod', 'staging', 'lab', 'sandbox', 'scratch']),
    );
  });

  it('worker_capabilities entries match worker registry', () => {
    const workerIds = Object.keys(APPROVAL_CONFIG.workers_by_id);
    const capWorkerIds = Object.keys(APPROVAL_CONFIG.worker_capabilities);
    expect(capWorkerIds.sort()).toEqual(workerIds.sort());
  });
});

describe('APPROVAL_CONFIG — capability details', () => {
  it('code.write is destructive and requires approval', () => {
    const cap = APPROVAL_CONFIG.capabilities_by_id['code.write']!;
    expect(cap.class).toBe('destructive');
    expect(cap.approval_required).toBe(true);
    expect(cap.environment_restriction).not.toContain('prod');
  });

  it('code.read is non_destructive and does not require approval', () => {
    const cap = APPROVAL_CONFIG.capabilities_by_id['code.read']!;
    expect(cap.class).toBe('non_destructive');
    expect(cap.approval_required).toBe(false);
  });

  it('deploy.promote is only available in prod and staging', () => {
    const cap = APPROVAL_CONFIG.capabilities_by_id['deploy.promote']!;
    expect(cap.environment_restriction).toEqual(['prod', 'staging']);
  });

  it('artifact.publish is not available in prod', () => {
    const cap = APPROVAL_CONFIG.capabilities_by_id['artifact.publish']!;
    expect(cap.environment_restriction).not.toContain('prod');
  });
});

describe('APPROVAL_CONFIG — environment restrictions', () => {
  it('prod has the most restricted capabilities', () => {
    const prod = APPROVAL_CONFIG.environments_by_id['prod']!;
    expect(prod.governance_posture).toBe('highest');
    expect(prod.restricted_capabilities).toContain('code.write');
    expect(prod.restricted_capabilities).toContain('shell.destructive');
    expect(prod.restricted_capabilities).toContain('git.write');
    expect(prod.restricted_capabilities).toContain('db.write');
    expect(prod.restricted_capabilities).toContain('memory.write');
  });

  it('staging restricts only deploy.promote', () => {
    const staging = APPROVAL_CONFIG.environments_by_id['staging']!;
    expect(staging.restricted_capabilities).toEqual(['deploy.promote']);
  });

  it('lab, sandbox, scratch have no restricted capabilities', () => {
    for (const envId of ['lab', 'sandbox', 'scratch']) {
      expect(APPROVAL_CONFIG.environments_by_id[envId]!.restricted_capabilities).toHaveLength(0);
    }
  });
});

// ─── assessApprovalRisk ───────────────────────────────────────────────────────

describe('assessApprovalRisk — allowed state', () => {
  it('returns allowed for non_destructive capabilities in lab', () => {
    const policy = assessApprovalRisk('ghost_main', ['code.read', 'shell.safe'], 'lab');
    expect(policy.state).toBe('allowed');
    expect(policy.blocking_capabilities).toHaveLength(0);
    expect(policy.approval_required_capabilities).toHaveLength(0);
  });

  it('returns allowed for non_destructive capabilities in prod', () => {
    const policy = assessApprovalRisk('probe', ['code.read', 'db.read', 'web.research'], 'prod');
    expect(policy.state).toBe('allowed');
  });
});

describe('assessApprovalRisk — approval_required state', () => {
  it('returns approval_required for destructive caps in lab (not restricted there)', () => {
    const policy = assessApprovalRisk('forge', ['code.write', 'artifact.publish'], 'lab');
    expect(policy.state).toBe('approval_required');
    expect(policy.approval_required_capabilities).toContain('code.write');
    expect(policy.approval_required_capabilities).toContain('artifact.publish');
    expect(policy.restricted_capabilities).toHaveLength(0);
  });

  it('returns approval_required for git.write in sandbox', () => {
    const policy = assessApprovalRisk('rector', ['git.write'], 'sandbox');
    expect(policy.state).toBe('approval_required');
    expect(policy.approval_required_capabilities).toContain('git.write');
  });
});

describe('assessApprovalRisk — environment_restricted state', () => {
  it('code.write is environment_restricted in prod', () => {
    const policy = assessApprovalRisk('forge', ['code.write'], 'prod');
    expect(policy.state).toBe('environment_restricted');
    expect(policy.restricted_capabilities).toContain('code.write');
    expect(policy.blocking_capabilities).toContain('code.write');
  });

  it('artifact.publish is out_of_scope in prod (not in environment_restriction)', () => {
    const policy = assessApprovalRisk('forge', ['artifact.publish'], 'prod');
    expect(policy.state).toBe('environment_restricted');
    expect(policy.out_of_scope_capabilities).toContain('artifact.publish');
  });

  it('deploy.promote in lab is out_of_scope (only allowed in prod/staging)', () => {
    const policy = assessApprovalRisk('operator', ['deploy.promote'], 'lab');
    expect(policy.state).toBe('environment_restricted');
    expect(policy.out_of_scope_capabilities).toContain('deploy.promote');
  });
});

describe('assessApprovalRisk — environment posture and worker metadata', () => {
  it('includes correct environment_posture for prod', () => {
    const policy = assessApprovalRisk('ghost_main', ['code.read'], 'prod');
    expect(policy.environment_posture).toBe('highest');
    expect(policy.environment).toBe('prod');
  });

  it('includes correct operator_identity for worker', () => {
    const policy = assessApprovalRisk('forge', ['code.read'], 'lab');
    expect(policy.operator_identity).toBe('delegated-worker');
    expect(policy.worker_environment_scope).toContain('lab');
    expect(policy.worker_environment_scope).not.toContain('prod');
  });

  it('unknown environment falls through to lab posture', () => {
    const policy = assessApprovalRisk('forge', ['code.read'], 'nonexistent');
    expect(policy.environment_posture).toBe('moderate');
  });
});

describe('assessApprovalRisk — destructive capability tracking', () => {
  it('tracks destructive_capabilities separately from blocking', () => {
    const policy = assessApprovalRisk('rector', ['code.write', 'db.write'], 'lab');
    expect(policy.destructive_capabilities).toContain('code.write');
    expect(policy.destructive_capabilities).toContain('db.write');
    // In lab neither is restricted, so blocking should be empty
    expect(policy.blocking_capabilities).toHaveLength(0);
  });
});

describe('assessApprovalRisk — unknown worker throws', () => {
  it('throws for unknown workerId', () => {
    expect(() => assessApprovalRisk('nonexistent_worker', ['code.read'], 'lab')).toThrow(
      'Unknown approval worker: nonexistent_worker',
    );
  });
});

describe('assessApprovalRisk — capability filtering', () => {
  it('ignores unknown capability IDs gracefully', () => {
    const policy = assessApprovalRisk('forge', ['code.read', 'nonexistent.cap'], 'lab');
    expect(policy.state).toBe('allowed');
    expect(policy.approval_required_capabilities).not.toContain('nonexistent.cap');
  });
});

// ─── detectRiskLevel ──────────────────────────────────────────────────────────

describe('detectRiskLevel — safe', () => {
  it('returns safe for plain conversational text', () => {
    const result = detectRiskLevel('Tell me about the Ghost architecture.');
    expect(result.riskLevel).toBe('safe');
    expect(result.findings).toHaveLength(0);
  });
});

describe('detectRiskLevel — caution', () => {
  it('detects broad_sql for update/delete sql references', () => {
    const result = detectRiskLevel('Can you update the database table?');
    expect(result.riskLevel).toBe('caution');
    expect(result.findings.some((f) => f.code === 'broad_sql')).toBe(true);
  });

  it('detects infrastructure_change for deploy references', () => {
    const result = detectRiskLevel('Can you update the deployment config?');
    expect(result.riskLevel).toBe('caution');
    expect(result.findings.some((f) => f.code === 'infrastructure_change')).toBe(true);
  });

  it('detects critical_file_edit for docker-compose references', () => {
    const result = detectRiskLevel('Please edit the docker-compose.yml file.');
    expect(result.riskLevel).toBe('caution');
    expect(result.findings.some((f) => f.code === 'critical_file_edit')).toBe(true);
  });
});

describe('detectRiskLevel — destructive', () => {
  it('detects delete_or_rm for rm -rf', () => {
    const result = detectRiskLevel('Run rm -rf /tmp/test to clean up.');
    expect(result.riskLevel).toBe('destructive');
    expect(result.findings.some((f) => f.code === 'delete_or_rm')).toBe(true);
  });

  it('detects destructive_sql for DROP TABLE', () => {
    const result = detectRiskLevel('Execute DROP TABLE users in postgres.');
    expect(result.riskLevel).toBe('destructive');
    expect(result.findings.some((f) => f.code === 'destructive_sql')).toBe(true);
  });

  it('detects docker_live_change for docker compose down', () => {
    const result = detectRiskLevel('Run docker compose down to restart.');
    expect(result.riskLevel).toBe('destructive');
    expect(result.findings.some((f) => f.code === 'docker_live_change')).toBe(true);
  });

  it('destructive takes priority over caution rules', () => {
    // contains both deploy (caution) and rm -rf (destructive)
    const result = detectRiskLevel('Deploy by running rm -rf old/ first.');
    expect(result.riskLevel).toBe('destructive');
    // caution rules not checked when destructive found
    expect(result.findings.every((f) => f.level === 'destructive')).toBe(true);
  });
});
