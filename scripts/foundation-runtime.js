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

module.exports = {
  buildApprovalItem,
  inferCurrentEnvironment,
  loadPhase7Foundations,
  makeApprovalRuntimeConfig,
};
