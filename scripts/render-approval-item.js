"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const projectRoot = path.join(__dirname, "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relPath), "utf8"));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      fail(`unknown argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for --${key}`);
    }
    if (args[key]) {
      if (!Array.isArray(args[key])) {
        args[key] = [args[key]];
      }
      args[key].push(value);
    } else {
      args[key] = value;
    }
    i += 1;
  }
  return args;
}

function asArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workers = loadJson("ops/foundation/workers.json");
  const capabilitiesDoc = loadJson("ops/foundation/capabilities.json");
  const approvalModel = loadJson("ops/foundation/approval-model.json");

  const workerId = args.worker;
  const requestedBy = args["requested-by"];
  const summary = args.summary;
  const reason = args.reason;
  const environment = args.environment;
  const category = args.category;
  const riskLevel = args["risk-level"] || "caution";
  const capabilities = asArray(args.capability);

  if (!workerId || !requestedBy || !summary || !reason || !environment || !category || capabilities.length === 0) {
    fail("required args: --worker --requested-by --summary --reason --environment --category --capability <cap> [--capability <cap>]");
  }

  const worker = workers.workers.find((entry) => entry.id === workerId);
  if (!worker) fail(`unknown worker: ${workerId}`);

  const capabilityIds = new Set(capabilitiesDoc.capabilities.map((entry) => entry.id));
  for (const capability of capabilities) {
    if (!capabilityIds.has(capability)) {
      fail(`unknown capability: ${capability}`);
    }
  }

  if (!approvalModel.categories.some((entry) => entry.id === category)) {
    fail(`unknown approval category: ${category}`);
  }
  if (!approvalModel.risk_levels.includes(riskLevel)) {
    fail(`unknown risk level: ${riskLevel}`);
  }

  const approvalId = crypto.createHash("md5")
    .update(`${workerId}|${requestedBy}|${summary}|${environment}|${category}|${capabilities.join(",")}`)
    .digest("hex")
    .slice(0, 16);

  const item = {
    approval_id: approvalId,
    state: approvalModel.lifecycle.initial_state,
    requested_at: new Date().toISOString(),
    requested_by: requestedBy,
    requester_worker_id: workerId,
    requester_label: worker.visibility_label,
    environment,
    category,
    risk_level: riskLevel,
    capabilities,
    summary,
    reason,
    governance: {
      operator_identity: worker.operator_identity,
      approval_required_capability_count: capabilitiesDoc.capabilities
        .filter((entry) => capabilities.includes(entry.id) && entry.approval_required)
        .length,
      destructive_capability_count: capabilitiesDoc.capabilities
        .filter((entry) => capabilities.includes(entry.id) && entry.class === "destructive")
        .length
    }
  };

  console.log(JSON.stringify(item, null, 2));
}

main();
