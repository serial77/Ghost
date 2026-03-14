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
    if (!token.startsWith("--")) fail(`unknown argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) fail(`missing value for --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const actionModel = loadJson("ops/foundation/action-model.json");
  const eventType = args["event-type"];
  const conversationId = args["conversation-id"];
  const requestId = args["request-id"];
  const summary = args.summary;

  if (!eventType || !conversationId || !requestId || !summary) {
    fail("required args: --event-type --conversation-id --request-id --summary");
  }

  const event = actionModel.event_types.find((entry) => entry.id === eventType);
  if (!event) fail(`unknown event type: ${eventType}`);

  const actionId = crypto.createHash("md5")
    .update(`${eventType}|${conversationId}|${requestId}|${summary}`)
    .digest("hex")
    .slice(0, 16);

  console.log(JSON.stringify({
    action_id: actionId,
    event_type: event.id,
    entity: event.entity,
    occurred_at: new Date().toISOString(),
    conversation_id: conversationId,
    request_id: requestId,
    delegation_id: args["delegation-id"] || null,
    runtime_task_id: args["runtime-task-id"] || null,
    approval_id: args["approval-id"] || null,
    artifact_id: args["artifact-id"] || null,
    outcome_status: args["outcome-status"] || null,
    summary
  }, null, 2));
}

main();
