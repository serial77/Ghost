"use strict";

const fs = require("fs");
const path = require("path");

function loadJson(projectRoot, relPath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relPath), "utf8"));
}

function loadPhase7Foundations(projectRoot = path.join(__dirname, "..")) {
  return {
    approvalModel: loadJson(projectRoot, "ops/foundation/approval-model.json"),
    workers: loadJson(projectRoot, "ops/foundation/workers.json"),
    capabilities: loadJson(projectRoot, "ops/foundation/capabilities.json"),
    environments: loadJson(projectRoot, "ops/foundation/environments.json"),
  };
}

function getApprovalLifecycle(foundations) {
  const lifecycle = foundations?.approvalModel?.lifecycle;
  if (!lifecycle || typeof lifecycle !== "object") {
    throw new Error("approval lifecycle is not configured");
  }
  return lifecycle;
}

function inferCurrentEnvironment(foundations, explicitEnvironment = "") {
  const knownIds = new Set(foundations.environments.environments.map((entry) => entry.id));
  const candidate = String(explicitEnvironment || process.env.GHOST_RUNTIME_ENV || process.env.GHOST_ENV || "").trim();
  if (candidate) {
    if (candidate === "production" && knownIds.has("prod")) {
      return "prod";
    }
    if (knownIds.has(candidate)) {
      return candidate;
    }
  }
  return "lab";
}

function makeApprovalRuntimeConfig(foundations) {
  const workersById = {};
  for (const worker of foundations.workers.workers) {
    workersById[worker.id] = {
      id: worker.id,
      visibility_label: worker.visibility_label,
      operator_identity: worker.operator_identity,
      environment_scope: worker.environment_scope,
    };
  }

  const capabilitiesById = {};
  for (const capability of foundations.capabilities.capabilities) {
    capabilitiesById[capability.id] = {
      id: capability.id,
      class: capability.class,
      approval_required: capability.approval_required,
      environment_restriction: capability.environment_restriction,
      description: capability.description,
    };
  }

  const environmentsById = {};
  for (const environment of foundations.environments.environments) {
    environmentsById[environment.id] = {
      id: environment.id,
      label: environment.label,
      governance_posture: environment.governance_posture,
      restricted_capabilities: environment.restricted_capabilities,
      mutable: environment.mutable,
    };
  }

  return {
    approval_model: {
      version: foundations.approvalModel.version,
      initial_state: foundations.approvalModel.lifecycle.initial_state,
      categories: foundations.approvalModel.categories,
      risk_levels: foundations.approvalModel.risk_levels,
      required_fields: foundations.approvalModel.required_fields,
    },
    workers_by_id: workersById,
    capabilities_by_id: capabilitiesById,
    worker_capabilities: foundations.capabilities.worker_capabilities,
    environments_by_id: environmentsById,
  };
}

function makeWorkerRuntimeConfig(foundations) {
  const workersById = {};
  for (const worker of foundations.workers.workers) {
    workersById[worker.id] = {
      id: worker.id,
      visibility_label: worker.visibility_label,
      role: worker.role,
      purpose: worker.purpose,
      invocation_intent: worker.invocation_intent,
      operator_identity: worker.operator_identity,
      responsibility_domain: worker.responsibility_domain,
      environment_scope: worker.environment_scope,
    };
  }

  const capabilitiesById = {};
  for (const capability of foundations.capabilities.capabilities) {
    capabilitiesById[capability.id] = {
      id: capability.id,
      class: capability.class,
      approval_required: capability.approval_required,
      environment_restriction: capability.environment_restriction,
      description: capability.description,
    };
  }

  const environmentsById = {};
  for (const environment of foundations.environments.environments) {
    environmentsById[environment.id] = {
      id: environment.id,
      label: environment.label,
      governance_posture: environment.governance_posture,
      restricted_capabilities: environment.restricted_capabilities,
      mutable: environment.mutable,
    };
  }

  return {
    workers_by_id: workersById,
    capabilities_by_id: capabilitiesById,
    worker_capabilities: foundations.capabilities.worker_capabilities,
    environments_by_id: environmentsById,
  };
}

function hashId(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `approval_${Math.abs(hash).toString(16).slice(0, 12)}`;
}

function buildApprovalItem({
  foundations,
  workerId,
  requestedBy,
  summary,
  reason,
  category,
  riskLevel = "caution",
  capabilities,
  environment,
  requestedForWorkerId = "",
  extra = {},
}) {
  const runtimeConfig = makeApprovalRuntimeConfig(foundations);
  const worker = runtimeConfig.workers_by_id[workerId];
  if (!worker) {
    throw new Error(`unknown worker: ${workerId}`);
  }
  const targetWorker = requestedForWorkerId ? runtimeConfig.workers_by_id[requestedForWorkerId] : null;
  const envId = inferCurrentEnvironment(foundations, environment);
  const env = runtimeConfig.environments_by_id[envId];
  const normalizedCapabilities = Array.from(new Set((Array.isArray(capabilities) ? capabilities : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)));

  for (const capabilityId of normalizedCapabilities) {
    if (!runtimeConfig.capabilities_by_id[capabilityId]) {
      throw new Error(`unknown capability: ${capabilityId}`);
    }
  }

  const capabilityRecords = normalizedCapabilities.map((capabilityId) => runtimeConfig.capabilities_by_id[capabilityId]);
  const approvalRequiredCapabilities = capabilityRecords
    .filter((entry) => entry.approval_required)
    .map((entry) => entry.id);
  const restrictedCapabilities = capabilityRecords
    .filter((entry) => env.restricted_capabilities.includes(entry.id))
    .map((entry) => entry.id);
  const outOfScopeCapabilities = capabilityRecords
    .filter((entry) => !entry.environment_restriction.includes(envId))
    .map((entry) => entry.id);

  return {
    approval_id: hashId([
      workerId,
      requestedBy,
      summary,
      envId,
      category,
      normalizedCapabilities.join(","),
      targetWorker?.id || "",
    ].join("|")),
    state: runtimeConfig.approval_model.initial_state,
    requested_at: new Date().toISOString(),
    requested_by: String(requestedBy || "").trim(),
    requester_worker_id: worker.id,
    requester_label: worker.visibility_label,
    environment: envId,
    category,
    risk_level: String(riskLevel || "caution").trim() || "caution",
    capabilities: normalizedCapabilities,
    summary: String(summary || "").trim(),
    reason: String(reason || "").trim(),
    target_worker_id: targetWorker?.id || null,
    target_worker_label: targetWorker?.visibility_label || null,
    governance: {
      environment_posture: env.governance_posture,
      restricted_capabilities: restrictedCapabilities,
      out_of_scope_capabilities: outOfScopeCapabilities,
      approval_required_capabilities: approvalRequiredCapabilities,
      destructive_capabilities: capabilityRecords
        .filter((entry) => entry.class === "destructive")
        .map((entry) => entry.id),
      operator_identity: worker.operator_identity,
      worker_environment_scope: worker.environment_scope,
    },
    ...extra,
  };
}

function buildApprovalPolicy(approvalItem) {
  const governance = approvalItem && approvalItem.governance && typeof approvalItem.governance === "object"
    ? approvalItem.governance
    : {};
  const restricted = Array.isArray(governance.restricted_capabilities) ? governance.restricted_capabilities : [];
  const outOfScope = Array.isArray(governance.out_of_scope_capabilities) ? governance.out_of_scope_capabilities : [];
  const approvalRequired = Array.isArray(governance.approval_required_capabilities)
    ? governance.approval_required_capabilities
    : [];
  const blockingCapabilities = Array.from(new Set([...restricted, ...outOfScope]));
  const state = blockingCapabilities.length > 0
    ? "environment_restricted"
    : approvalRequired.length > 0
      ? "approval_required"
      : "allowed";
  const summaryParts = [];
  if (approvalRequired.length > 0) {
    summaryParts.push(`approval required for ${approvalRequired.join(", ")}`);
  }
  if (restricted.length > 0) {
    summaryParts.push(`restricted in ${approvalItem.environment}: ${restricted.join(", ")}`);
  }
  if (outOfScope.length > 0) {
    summaryParts.push(`outside ${approvalItem.environment} scope: ${outOfScope.join(", ")}`);
  }
  summaryParts.push(`environment posture ${governance.environment_posture || "unknown"}`);
  return {
    state,
    summary: summaryParts.join("; "),
    blocking_capabilities: blockingCapabilities,
    environment: approvalItem.environment || null,
    environment_posture: governance.environment_posture || null,
    approval_required_capabilities: approvalRequired,
    restricted_capabilities: restricted,
    out_of_scope_capabilities: outOfScope,
    destructive_capabilities: Array.isArray(governance.destructive_capabilities) ? governance.destructive_capabilities : [],
    operator_identity: governance.operator_identity || null,
    worker_environment_scope: Array.isArray(governance.worker_environment_scope) ? governance.worker_environment_scope : [],
  };
}

function normalizeApprovalState(foundations, state, fieldName = "approval state") {
  const normalized = String(state || "").trim().toLowerCase();
  const states = Array.isArray(foundations?.approvalModel?.states)
    ? foundations.approvalModel.states
    : [];
  if (!normalized || !states.includes(normalized)) {
    throw new Error(`unknown ${fieldName}: ${state}`);
  }
  return normalized;
}

function assertApprovalTransitionAllowed(foundations, fromState, toState) {
  const lifecycle = getApprovalLifecycle(foundations);
  const normalizedFrom = normalizeApprovalState(foundations, fromState, "approval from-state");
  const normalizedTo = normalizeApprovalState(foundations, toState, "approval to-state");
  const allowedTransitions = lifecycle.allowed_transitions || {};
  const allowed = Array.isArray(allowedTransitions[normalizedFrom]) ? allowedTransitions[normalizedFrom] : [];
  if (!allowed.includes(normalizedTo)) {
    throw new Error(`approval transition not allowed: ${normalizedFrom} -> ${normalizedTo}`);
  }
  return { fromState: normalizedFrom, toState: normalizedTo };
}

module.exports = {
  assertApprovalTransitionAllowed,
  buildApprovalPolicy,
  buildApprovalItem,
  getApprovalLifecycle,
  inferCurrentEnvironment,
  loadPhase7Foundations,
  makeApprovalRuntimeConfig,
  makeWorkerRuntimeConfig,
  normalizeApprovalState,
};
