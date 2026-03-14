"use strict";

const path = require("path");
const {
  buildApprovalItem,
  inferCurrentEnvironment,
  loadPhase7Foundations,
} = require("./foundation-runtime");

const projectRoot = path.join(__dirname, "..");

function fail(message) {
  console.error(message);
  process.exit(1);
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
  const foundations = loadPhase7Foundations(projectRoot);

  const workerId = args.worker;
  const requestedBy = args["requested-by"];
  const summary = args.summary;
  const reason = args.reason;
  const environment = args.environment;
  const category = args.category;
  const riskLevel = args["risk-level"] || "caution";
  const capabilities = asArray(args.capability);
  const requestedForWorkerId = args["requested-for-worker"] || "";

  if (!workerId || !requestedBy || !summary || !reason || !environment || !category || capabilities.length === 0) {
    fail("required args: --worker --requested-by --summary --reason --environment --category --capability <cap> [--capability <cap>]");
  }

  const normalizedEnvironment = inferCurrentEnvironment(foundations, environment);
  const item = buildApprovalItem({
    foundations,
    workerId,
    requestedBy,
    summary,
    reason,
    category,
    riskLevel,
    capabilities,
    environment: normalizedEnvironment,
    requestedForWorkerId,
  });

  console.log(JSON.stringify(item, null, 2));
}

main();
