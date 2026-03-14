"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const foundationDir = path.join(projectRoot, "ops", "foundation");

function fail(message) {
  throw new Error(message);
}

function loadJson(relPath) {
  const fullPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(fullPath)) {
    fail(`missing foundation file: ${relPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function requireString(value, context) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`expected non-empty string for ${context}`);
  }
}

function requireArray(value, context) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`expected non-empty array for ${context}`);
  }
}

function ensurePathExists(relPath) {
  const fullPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(fullPath)) {
    fail(`referenced path does not exist: ${relPath}`);
  }
}

function validateBaseline(baseline) {
  requireString(baseline.version, "baseline.version");
  if (!baseline.workflow || typeof baseline.workflow !== "object") {
    fail("baseline.workflow must be an object");
  }
  requireString(baseline.workflow.name, "baseline.workflow.name");
  requireString(baseline.workflow.id, "baseline.workflow.id");
  requireString(baseline.workflow.builder, "baseline.workflow.builder");
  requireString(baseline.workflow.workflow_json, "baseline.workflow.workflow_json");
  ensurePathExists(baseline.workflow.builder);
  ensurePathExists(baseline.workflow.workflow_json);

  requireArray(baseline.frozen_contracts, "baseline.frozen_contracts");
  for (const contract of baseline.frozen_contracts) {
    requireString(contract.id, "frozen_contract.id");
    requireString(contract.scope, "frozen_contract.scope");
    requireString(contract.description, "frozen_contract.description");
    requireString(contract.primary_reference, "frozen_contract.primary_reference");
  }

  if (!baseline.truth_surfaces || typeof baseline.truth_surfaces !== "object") {
    fail("baseline.truth_surfaces must be an object");
  }
  for (const [key, value] of Object.entries(baseline.truth_surfaces)) {
    requireArray(value, `baseline.truth_surfaces.${key}`);
  }

  requireArray(baseline.builder_modules, "baseline.builder_modules");
  for (const modulePath of baseline.builder_modules) {
    requireString(modulePath, "baseline.builder_modules[]");
    ensurePathExists(modulePath);
  }

  requireArray(baseline.do_not_touch_casually, "baseline.do_not_touch_casually");
  for (const boundary of baseline.do_not_touch_casually) {
    requireString(boundary.boundary, "do_not_touch_casually.boundary");
    requireString(boundary.reason, "do_not_touch_casually.reason");
  }
}

function validateWorkers(workersDoc) {
  requireString(workersDoc.version, "workers.version");
  requireArray(workersDoc.workers, "workers.workers");
  const ids = new Set();
  for (const worker of workersDoc.workers) {
    requireString(worker.id, "worker.id");
    requireString(worker.visibility_label, `worker.${worker.id}.visibility_label`);
    requireString(worker.role, `worker.${worker.id}.role`);
    requireString(worker.purpose, `worker.${worker.id}.purpose`);
    requireArray(worker.invocation_intent, `worker.${worker.id}.invocation_intent`);
    requireArray(worker.responsibility_domain, `worker.${worker.id}.responsibility_domain`);
    requireString(worker.success_contract, `worker.${worker.id}.success_contract`);
    requireString(worker.failure_contract, `worker.${worker.id}.failure_contract`);
    requireString(worker.operator_identity, `worker.${worker.id}.operator_identity`);
    requireArray(worker.environment_scope, `worker.${worker.id}.environment_scope`);
    if (ids.has(worker.id)) {
      fail(`duplicate worker id: ${worker.id}`);
    }
    ids.add(worker.id);
  }
}

function validateCapabilities(capabilitiesDoc, workersDoc) {
  requireString(capabilitiesDoc.version, "capabilities.version");
  requireArray(capabilitiesDoc.capabilities, "capabilities.capabilities");
  if (!capabilitiesDoc.worker_capabilities || typeof capabilitiesDoc.worker_capabilities !== "object") {
    fail("capabilities.worker_capabilities must be an object");
  }

  const capabilityIds = new Set();
  for (const capability of capabilitiesDoc.capabilities) {
    requireString(capability.id, "capability.id");
    requireString(capability.class, `capability.${capability.id}.class`);
    requireString(capability.description, `capability.${capability.id}.description`);
    if (typeof capability.approval_required !== "boolean") {
      fail(`capability.${capability.id}.approval_required must be boolean`);
    }
    requireArray(capability.environment_restriction, `capability.${capability.id}.environment_restriction`);
    if (capabilityIds.has(capability.id)) {
      fail(`duplicate capability id: ${capability.id}`);
    }
    capabilityIds.add(capability.id);
  }

  const workerIds = new Set(workersDoc.workers.map((worker) => worker.id));
  for (const [workerId, grantedCapabilities] of Object.entries(capabilitiesDoc.worker_capabilities)) {
    if (!workerIds.has(workerId)) {
      fail(`worker_capabilities references unknown worker: ${workerId}`);
    }
    requireArray(grantedCapabilities, `worker_capabilities.${workerId}`);
    for (const capabilityId of grantedCapabilities) {
      if (!capabilityIds.has(capabilityId)) {
        fail(`worker ${workerId} references unknown capability: ${capabilityId}`);
      }
    }
  }
}

function validateApprovalModel(approvalModel, capabilitiesDoc) {
  requireString(approvalModel.version, "approval.version");
  requireArray(approvalModel.states, "approval.states");
  requireArray(approvalModel.risk_levels, "approval.risk_levels");
  requireArray(approvalModel.categories, "approval.categories");
  requireArray(approvalModel.required_fields, "approval.required_fields");
  if (!approvalModel.lifecycle || typeof approvalModel.lifecycle !== "object") {
    fail("approval.lifecycle must be an object");
  }
  requireString(approvalModel.lifecycle.initial_state, "approval.lifecycle.initial_state");
  requireString(approvalModel.lifecycle.operator_queue_state, "approval.lifecycle.operator_queue_state");
  requireArray(approvalModel.lifecycle.terminal_states, "approval.lifecycle.terminal_states");
  if (!approvalModel.lifecycle.allowed_transitions || typeof approvalModel.lifecycle.allowed_transitions !== "object") {
    fail("approval.lifecycle.allowed_transitions must be an object");
  }

  const states = new Set(approvalModel.states);
  if (!states.has(approvalModel.lifecycle.initial_state)) {
    fail("approval initial_state must exist in approval.states");
  }
  if (!states.has(approvalModel.lifecycle.operator_queue_state)) {
    fail("approval operator_queue_state must exist in approval.states");
  }
  for (const state of approvalModel.lifecycle.terminal_states) {
    if (!states.has(state)) {
      fail(`approval terminal state not declared in states: ${state}`);
    }
  }
  for (const [fromState, toStates] of Object.entries(approvalModel.lifecycle.allowed_transitions)) {
    if (!states.has(fromState)) {
      fail(`approval transition source not declared in states: ${fromState}`);
    }
    requireArray(toStates.length === 0 ? ["__empty__"] : toStates, `approval.lifecycle.allowed_transitions.${fromState}`);
    for (const toState of toStates) {
      if (!states.has(toState)) {
        fail(`approval transition target not declared in states: ${fromState} -> ${toState}`);
      }
    }
  }

  const capabilityIds = new Set(capabilitiesDoc.capabilities.map((entry) => entry.id));
  if (!capabilityIds.size) {
    fail("approval validation requires non-empty capabilities");
  }
}

function validateActionModel(actionModel) {
  requireString(actionModel.version, "action_model.version");
  requireArray(actionModel.entities, "action_model.entities");
  requireArray(actionModel.event_types, "action_model.event_types");
  requireArray(actionModel.relationships, "action_model.relationships");
  requireArray(actionModel.required_record_fields, "action_model.required_record_fields");

  const entities = new Set(actionModel.entities);
  const eventIds = new Set();
  for (const event of actionModel.event_types) {
    requireString(event.id, "action_model.event_type.id");
    requireString(event.entity, `action_model.event_type.${event.id}.entity`);
    requireString(event.description, `action_model.event_type.${event.id}.description`);
    if (!entities.has(event.entity)) {
      fail(`action event references unknown entity: ${event.id} -> ${event.entity}`);
    }
    if (eventIds.has(event.id)) {
      fail(`duplicate action event id: ${event.id}`);
    }
    eventIds.add(event.id);
  }

  for (const relationship of actionModel.relationships) {
    requireString(relationship.from, "action_model.relationship.from");
    requireString(relationship.to, "action_model.relationship.to");
    requireString(relationship.description, "action_model.relationship.description");
    if (!entities.has(relationship.from) || !entities.has(relationship.to)) {
      fail(`action relationship references unknown entity: ${relationship.from} -> ${relationship.to}`);
    }
  }
}

function validateDiagnostics(diagDoc) {
  requireString(diagDoc.version, "diagnostics.version");
  requireArray(diagDoc.categories, "diagnostics.categories");
  requireArray(diagDoc.hotspot_modules, "diagnostics.hotspot_modules");
  const ids = new Set();
  for (const category of diagDoc.categories) {
    requireString(category.id, "diagnostics.category.id");
    requireString(category.description, `diagnostics.category.${category.id}.description`);
    if (ids.has(category.id)) {
      fail(`duplicate diagnostics category id: ${category.id}`);
    }
    ids.add(category.id);
  }
  for (const modulePath of diagDoc.hotspot_modules) {
    requireString(modulePath, "diagnostics.hotspot_modules[]");
    ensurePathExists(modulePath);
  }
}

function validateEnvironments(envDoc, capabilitiesDoc) {
  requireString(envDoc.version, "environments.version");
  requireArray(envDoc.environments, "environments.environments");
  const capabilityIds = new Set(capabilitiesDoc.capabilities.map((entry) => entry.id));
  const envIds = new Set();
  for (const env of envDoc.environments) {
    requireString(env.id, "environment.id");
    requireString(env.label, `environment.${env.id}.label`);
    if (typeof env.mutable !== "boolean") {
      fail(`environment.${env.id}.mutable must be boolean`);
    }
    requireArray(env.promotion_sources.length === 0 ? ["__empty__"] : env.promotion_sources, `environment.${env.id}.promotion_sources`);
    requireArray(env.restricted_capabilities.length === 0 ? ["__empty__"] : env.restricted_capabilities, `environment.${env.id}.restricted_capabilities`);
    requireString(env.governance_posture, `environment.${env.id}.governance_posture`);
    requireString(env.notes, `environment.${env.id}.notes`);
    if (envIds.has(env.id)) {
      fail(`duplicate environment id: ${env.id}`);
    }
    envIds.add(env.id);
    for (const source of env.promotion_sources) {
      if (source !== "__empty__" && !["prod", "staging", "lab", "sandbox", "scratch"].includes(source)) {
        fail(`environment.${env.id}.promotion_source is not in the known Phase 7 environment taxonomy: ${source}`);
      }
    }
    for (const capabilityId of env.restricted_capabilities) {
      if (capabilityId !== "__empty__" && !capabilityIds.has(capabilityId)) {
        fail(`environment.${env.id}.restricted_capabilities references unknown capability: ${capabilityId}`);
      }
    }
  }
}

function main() {
  const baselinePath = path.join("ops", "foundation", "baseline.json");
  const baseline = loadJson(baselinePath);
  const workersPath = path.join("ops", "foundation", "workers.json");
  const workers = loadJson(workersPath);
  const capabilitiesPath = path.join("ops", "foundation", "capabilities.json");
  const capabilities = loadJson(capabilitiesPath);
  const approvalPath = path.join("ops", "foundation", "approval-model.json");
  const approvalModel = loadJson(approvalPath);
  const actionModelPath = path.join("ops", "foundation", "action-model.json");
  const actionModel = loadJson(actionModelPath);
  const diagnosticsPath = path.join("ops", "foundation", "diagnostics.json");
  const diagnostics = loadJson(diagnosticsPath);
  const environmentsPath = path.join("ops", "foundation", "environments.json");
  const environments = loadJson(environmentsPath);
  validateBaseline(baseline);
  validateWorkers(workers);
  validateCapabilities(capabilities, workers);
  validateApprovalModel(approvalModel, capabilities);
  validateActionModel(actionModel);
  validateDiagnostics(diagnostics);
  validateEnvironments(environments, capabilities);

  const summary = {
    version: baseline.version,
    workflow_id: baseline.workflow.id,
    frozen_contract_count: baseline.frozen_contracts.length,
    truth_surface_groups: Object.keys(baseline.truth_surfaces).length,
    builder_module_count: baseline.builder_modules.length,
    do_not_touch_count: baseline.do_not_touch_casually.length,
    worker_count: workers.workers.length,
    capability_count: capabilities.capabilities.length,
    approval_state_count: approvalModel.states.length,
    action_event_count: actionModel.event_types.length,
    diagnostic_category_count: diagnostics.categories.length,
    environment_count: environments.environments.length,
    foundation_dir: foundationDir,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
