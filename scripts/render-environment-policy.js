"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relPath), "utf8"));
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--environment") {
  fail("usage: scripts/render-environment-policy.js --environment <id>");
}

const envId = args[1];
const environments = loadJson("ops/foundation/environments.json");
const capabilities = loadJson("ops/foundation/capabilities.json");

const env = environments.environments.find((entry) => entry.id === envId);
if (!env) fail(`unknown environment: ${envId}`);

const restricted = capabilities.capabilities
  .filter((entry) => env.restricted_capabilities.includes(entry.id))
  .map((entry) => ({
    id: entry.id,
    approval_required: entry.approval_required,
    class: entry.class
  }));

console.log(JSON.stringify({
  id: env.id,
  label: env.label,
  mutable: env.mutable,
  governance_posture: env.governance_posture,
  promotion_sources: env.promotion_sources,
  restricted_capabilities: restricted,
  notes: env.notes
}, null, 2));
