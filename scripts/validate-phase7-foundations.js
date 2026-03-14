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

function main() {
  const baselinePath = path.join("ops", "foundation", "baseline.json");
  const baseline = loadJson(baselinePath);
  const workersPath = path.join("ops", "foundation", "workers.json");
  const workers = loadJson(workersPath);
  validateBaseline(baseline);
  validateWorkers(workers);

  const summary = {
    version: baseline.version,
    workflow_id: baseline.workflow.id,
    frozen_contract_count: baseline.frozen_contracts.length,
    truth_surface_groups: Object.keys(baseline.truth_surfaces).length,
    builder_module_count: baseline.builder_modules.length,
    do_not_touch_count: baseline.do_not_touch_casually.length,
    worker_count: workers.workers.length,
    foundation_dir: foundationDir,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
