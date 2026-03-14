#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_TRACKER_PATH = SCRIPT_DIR / "project-tracker.json"
DEFAULT_SCHEMA_PATH = SCRIPT_DIR / "project-tracker.schema.json"

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")
TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
CANONICAL_WORKER_REGISTRY = [
    "Ghost Main",
    "Forge",
    "Probe",
    "Rector",
    "Archivist",
    "Operator",
    "Scout",
]


def load_json_file(path: Path) -> Any:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"invalid JSON in {path} at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc


def get_schema_enum_values(schema: dict[str, Any], path: list[str], default: list[str]) -> set[str]:
    node: Any = schema
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return set(default)
        node = node[key]

    enum_values = node.get("enum") if isinstance(node, dict) else None
    if not isinstance(enum_values, list) or not all(isinstance(item, str) for item in enum_values):
        return set(default)
    return set(enum_values)


def parse_utc_timestamp(value: str) -> bool:
    if not isinstance(value, str) or not TIMESTAMP_PATTERN.match(value):
        return False

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False

    return parsed.utcoffset() == timedelta(0)


def validate_tracker_data(data: Any, schema: dict[str, Any]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    allowed_step_status = get_schema_enum_values(
        schema,
        ["$defs", "stepStatus"],
        ["complete", "active", "pending", "blocked", "frozen"],
    )
    allowed_worker_status = get_schema_enum_values(
        schema,
        ["$defs", "workerStatus"],
        ["working", "blocked", "waiting", "review", "done"],
    )
    allowed_worker_position_status = get_schema_enum_values(
        schema,
        ["$defs", "workerPositionStatus"],
        ["assigned", "available", "pending_assignment", "standby", "blocked", "completed", "unavailable"],
    )

    phase_ids: set[str] = set()
    step_ids: set[str] = set()
    step_locations: dict[str, str] = {}
    step_to_phase_id: dict[str, str] = {}
    activity_times: list[str] = []
    allowed_registry_workers: set[str] | None = None
    known_position_workers: set[str] | None = None
    assignment_references: list[tuple[str, str | None, str | None, str | None]] = []

    def add_error(path: str, message: str) -> None:
        errors.append(f"{path}: {message}")

    def add_warning(path: str, message: str) -> None:
        warnings.append(f"{path}: {message}")

    def require_non_empty_string(obj: dict[str, Any], key: str, path: str) -> str | None:
        value = obj.get(key)
        if not isinstance(value, str) or not value.strip():
            add_error(path, f"'{key}' must be a non-empty string")
            return None
        return value

    def check_allowed_keys(obj: dict[str, Any], allowed: set[str], path: str) -> None:
        for key in obj.keys():
            if key not in allowed:
                add_error(path, f"unexpected field '{key}'")

    def validate_worker(worker: Any, path: str) -> None:
        if not isinstance(worker, dict):
            add_error(path, "worker marker must be an object")
            return

        allowed = {"name", "status", "task", "branch", "updated_at"}
        check_allowed_keys(worker, allowed, path)

        require_non_empty_string(worker, "name", path)
        worker_name = worker.get("name")
        worker_status = require_non_empty_string(worker, "status", path)
        require_non_empty_string(worker, "task", path)

        if allowed_registry_workers is not None and isinstance(worker_name, str) and worker_name.strip():
            if worker_name not in allowed_registry_workers:
                add_error(path, f"worker name '{worker_name}' is not in canonical_worker_registry")

        if worker_status and worker_status not in allowed_worker_status:
            add_error(path, f"worker status '{worker_status}' is invalid")

        if "branch" in worker and (not isinstance(worker["branch"], str) or not worker["branch"].strip()):
            add_error(path, "'branch' must be a non-empty string when provided")

        if "updated_at" in worker:
            updated_at = worker.get("updated_at")
            if not isinstance(updated_at, str) or not parse_utc_timestamp(updated_at):
                add_error(path, "'updated_at' must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)")

    def validate_step(step: Any, path: str, allow_substeps: bool, phase_id: str) -> None:
        if not isinstance(step, dict):
            add_error(path, "step must be an object")
            return

        allowed = {"id", "title", "detail", "status", "active_workers"}
        if allow_substeps:
            allowed.add("substeps")
        check_allowed_keys(step, allowed, path)

        step_id = require_non_empty_string(step, "id", path)
        require_non_empty_string(step, "title", path)
        step_status = require_non_empty_string(step, "status", path)

        if step_id:
            if not ID_PATTERN.match(step_id):
                add_error(path, f"id '{step_id}' is malformed")
            if step_id in step_ids:
                add_error(path, f"duplicate step/substep id '{step_id}' (already used at {step_locations[step_id]})")
            else:
                step_ids.add(step_id)
                step_locations[step_id] = path
                step_to_phase_id[step_id] = phase_id

        if step_status and step_status not in allowed_step_status:
            add_error(path, f"status '{step_status}' is invalid")

        if "detail" in step and not isinstance(step["detail"], str):
            add_error(path, "'detail' must be a string when provided")

        workers = step.get("active_workers")
        if not isinstance(workers, list):
            add_error(path, "'active_workers' must be an array")
            workers = []

        seen_worker_names: set[str] = set()
        for worker_index, worker in enumerate(workers):
            worker_path = f"{path}.active_workers[{worker_index}]"
            validate_worker(worker, worker_path)
            if isinstance(worker, dict):
                worker_name = worker.get("name")
                if isinstance(worker_name, str) and worker_name.strip():
                    normalized = worker_name.strip().lower()
                    if normalized in seen_worker_names:
                        add_error(worker_path, f"duplicate worker name '{worker_name}' on same step")
                    seen_worker_names.add(normalized)

        if workers and step.get("status") == "complete":
            add_warning(path, "status is 'complete' but active_workers is not empty")

        if allow_substeps:
            substeps = step.get("substeps")
            if substeps is not None:
                if not isinstance(substeps, list):
                    add_error(path, "'substeps' must be an array when provided")
                else:
                    for substep_index, substep in enumerate(substeps):
                        validate_step(substep, f"{path}.substeps[{substep_index}]", allow_substeps=False, phase_id=phase_id)
        elif "substeps" in step:
            add_error(path, "substeps can only exist one level below steps")

    def validate_phase(phase: Any, path: str) -> None:
        if not isinstance(phase, dict):
            add_error(path, "phase must be an object")
            return

        allowed = {"id", "title", "summary", "status", "steps"}
        check_allowed_keys(phase, allowed, path)

        phase_id = require_non_empty_string(phase, "id", path)
        require_non_empty_string(phase, "title", path)
        phase_status = require_non_empty_string(phase, "status", path)

        if "summary" in phase and (not isinstance(phase["summary"], str) or not phase["summary"].strip()):
            add_error(path, "'summary' must be a non-empty string when provided")

        if phase_id:
            if not ID_PATTERN.match(phase_id):
                add_error(path, f"id '{phase_id}' is malformed")
            if phase_id in phase_ids:
                add_error(path, f"duplicate phase id '{phase_id}'")
            phase_ids.add(phase_id)

        if phase_status and phase_status not in allowed_step_status:
            add_error(path, f"status '{phase_status}' is invalid")

        steps = phase.get("steps")
        if not isinstance(steps, list):
            add_error(path, "'steps' must be an array")
            return

        if len(steps) == 0:
            add_error(path, "phase must contain at least one step")

        for step_index, step in enumerate(steps):
            validate_step(step, f"{path}.steps[{step_index}]", allow_substeps=True, phase_id=phase_id or "")

    def validate_worker_position_entry(
        entry: Any,
        *,
        path: str,
        canonical: bool,
        seen_names: set[str],
    ) -> None:
        if not isinstance(entry, dict):
            add_error(path, "worker position entry must be an object")
            return

        allowed = {
            "name",
            "lane",
            "status",
            "assigned_phase_id",
            "assigned_step_id",
            "summary",
            "note",
            "branch",
            "blocking_on",
            "updated_at",
        }
        check_allowed_keys(entry, allowed, path)

        name = require_non_empty_string(entry, "name", path)
        lane = require_non_empty_string(entry, "lane", path)
        status = require_non_empty_string(entry, "status", path)
        summary = require_non_empty_string(entry, "summary", path)
        updated_at = require_non_empty_string(entry, "updated_at", path)

        _ = lane, summary

        if status and status not in allowed_worker_position_status:
            add_error(path, f"worker position status '{status}' is invalid")

        if updated_at and not parse_utc_timestamp(updated_at):
            add_error(path, "'updated_at' must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)")

        assigned_phase_id = entry.get("assigned_phase_id")
        assigned_step_id = entry.get("assigned_step_id")
        if assigned_phase_id is not None and (not isinstance(assigned_phase_id, str) or not assigned_phase_id.strip()):
            add_error(path, "'assigned_phase_id' must be a non-empty string when provided")
        if assigned_step_id is not None and (not isinstance(assigned_step_id, str) or not assigned_step_id.strip()):
            add_error(path, "'assigned_step_id' must be a non-empty string when provided")

        if assigned_step_id and not assigned_phase_id:
            add_error(path, "'assigned_phase_id' is required when 'assigned_step_id' is provided")

        if status == "assigned" and not assigned_step_id:
            add_error(path, "status 'assigned' requires an 'assigned_step_id'")

        if name:
            lower_name = name.strip().lower()
            if lower_name in seen_names:
                add_error(path, f"duplicate worker position for '{name}'")
            seen_names.add(lower_name)

            if canonical and name not in CANONICAL_WORKER_REGISTRY:
                add_error(path, f"canonical worker '{name}' is not in canonical worker registry")
            if not canonical and name in CANONICAL_WORKER_REGISTRY:
                add_error(path, f"external worker '{name}' must not be a canonical runtime worker")

        if "note" in entry and (not isinstance(entry["note"], str) or not entry["note"].strip()):
            add_error(path, "'note' must be a non-empty string when provided")
        if "branch" in entry and (not isinstance(entry["branch"], str) or not entry["branch"].strip()):
            add_error(path, "'branch' must be a non-empty string when provided")
        if "blocking_on" in entry and (not isinstance(entry["blocking_on"], str) or not entry["blocking_on"].strip()):
            add_error(path, "'blocking_on' must be a non-empty string when provided")

        assignment_references.append((path, assigned_phase_id if isinstance(assigned_phase_id, str) else None, assigned_step_id if isinstance(assigned_step_id, str) else None, status if isinstance(status, str) else None))

    def validate_non_empty_string_array(value: Any, key: str, path: str) -> None:
        if not isinstance(value, list) or len(value) == 0:
            add_error(path, f"'{key}' must be a non-empty array")
            return
        for index, item in enumerate(value):
            if not isinstance(item, str) or not item.strip():
                add_error(f"{path}.{key}[{index}]", "must be a non-empty string")

    if not isinstance(data, dict):
        add_error("$", "tracker must be a top-level JSON object")
        return errors, warnings

    top_allowed = {"project", "core_framing", "worker_positions", "phases", "recent_activity"}
    check_allowed_keys(data, top_allowed, "$")

    project = data.get("project")
    if not isinstance(project, dict):
        add_error("project", "'project' must be an object")
    else:
        project_allowed = {"name", "schema_version", "last_updated", "current_focus"}
        check_allowed_keys(project, project_allowed, "project")
        require_non_empty_string(project, "name", "project")

        schema_version = require_non_empty_string(project, "schema_version", "project")
        if schema_version and schema_version != "1.0":
            add_error("project", "schema_version must be '1.0'")

        last_updated = require_non_empty_string(project, "last_updated", "project")
        if last_updated and not parse_utc_timestamp(last_updated):
            add_error(
                "project",
                "last_updated must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)",
            )

        require_non_empty_string(project, "current_focus", "project")

    core_framing = data.get("core_framing")
    if core_framing is not None:
        if not isinstance(core_framing, dict):
            add_error("core_framing", "'core_framing' must be an object when provided")
        else:
            framing_allowed = {
                "title",
                "principles",
                "openclaw_alignment",
                "rollout_order",
                "canonical_worker_registry",
            }
            check_allowed_keys(core_framing, framing_allowed, "core_framing")
            require_non_empty_string(core_framing, "title", "core_framing")
            validate_non_empty_string_array(core_framing.get("principles"), "principles", "core_framing")
            validate_non_empty_string_array(core_framing.get("openclaw_alignment"), "openclaw_alignment", "core_framing")
            validate_non_empty_string_array(core_framing.get("rollout_order"), "rollout_order", "core_framing")
            validate_non_empty_string_array(core_framing.get("canonical_worker_registry"), "canonical_worker_registry", "core_framing")

            registry = core_framing.get("canonical_worker_registry")
            if isinstance(registry, list):
                normalized_registry = [item.strip() for item in registry if isinstance(item, str) and item.strip()]
                expected_registry = list(CANONICAL_WORKER_REGISTRY)
                if len(normalized_registry) != len(expected_registry) or set(normalized_registry) != set(expected_registry):
                    add_error(
                        "core_framing.canonical_worker_registry",
                        "must contain exactly: " + ", ".join(expected_registry),
                    )
                else:
                    allowed_registry_workers = set(normalized_registry)

    worker_positions = data.get("worker_positions")
    if not isinstance(worker_positions, dict):
        add_error("worker_positions", "'worker_positions' must be an object")
    else:
        positions_allowed = {"canonical_runtime_workers", "external_implementation_workers"}
        check_allowed_keys(worker_positions, positions_allowed, "worker_positions")

        canonical_workers = worker_positions.get("canonical_runtime_workers")
        external_workers = worker_positions.get("external_implementation_workers")

        if not isinstance(canonical_workers, list):
            add_error("worker_positions", "'canonical_runtime_workers' must be an array")
            canonical_workers = []
        if not isinstance(external_workers, list):
            add_error("worker_positions", "'external_implementation_workers' must be an array")
            external_workers = []

        seen_canonical: set[str] = set()
        seen_external: set[str] = set()
        canonical_names: set[str] = set()
        external_names: set[str] = set()

        for index, entry in enumerate(canonical_workers):
            path = f"worker_positions.canonical_runtime_workers[{index}]"
            validate_worker_position_entry(entry, path=path, canonical=True, seen_names=seen_canonical)
            if isinstance(entry, dict) and isinstance(entry.get("name"), str) and entry.get("name").strip():
                canonical_names.add(entry.get("name").strip())

        expected_canonical = set(CANONICAL_WORKER_REGISTRY)
        if canonical_names != expected_canonical:
            missing = sorted(expected_canonical - canonical_names)
            extra = sorted(canonical_names - expected_canonical)
            if missing:
                add_error("worker_positions.canonical_runtime_workers", f"missing canonical workers: {', '.join(missing)}")
            if extra:
                add_error("worker_positions.canonical_runtime_workers", f"unexpected canonical workers: {', '.join(extra)}")

        for index, entry in enumerate(external_workers):
            path = f"worker_positions.external_implementation_workers[{index}]"
            validate_worker_position_entry(entry, path=path, canonical=False, seen_names=seen_external)
            if isinstance(entry, dict) and isinstance(entry.get("name"), str) and entry.get("name").strip():
                external_names.add(entry.get("name").strip())

        overlap = canonical_names & external_names
        if overlap:
            add_error("worker_positions", "worker names must not exist in both canonical and external lists")

        known_position_workers = canonical_names | external_names

    phases = data.get("phases")
    if not isinstance(phases, list):
        add_error("phases", "'phases' must be an array")
        phases = []

    if len(phases) == 0:
        add_error("phases", "must contain at least one phase")

    phase_order: list[str] = []
    for phase_index, phase in enumerate(phases):
        validate_phase(phase, f"phases[{phase_index}]")
        if isinstance(phase, dict) and isinstance(phase.get("id"), str):
            phase_order.append(phase["id"])

    expected_phase_order = [f"phase-{index + 1}" for index in range(len(phase_order))]
    if phase_order and phase_order != expected_phase_order:
        add_warning("phases", "phase IDs are not in expected sequential order (phase-1..phase-N)")

    for path, assigned_phase_id, assigned_step_id, status in assignment_references:
        if assigned_phase_id and assigned_phase_id not in phase_ids:
            add_error(path, f"assigned_phase_id '{assigned_phase_id}' does not exist")
        if assigned_step_id and assigned_step_id not in step_ids:
            add_error(path, f"assigned_step_id '{assigned_step_id}' does not exist")
        if assigned_phase_id and assigned_step_id and assigned_step_id in step_to_phase_id:
            expected_phase = step_to_phase_id[assigned_step_id]
            if expected_phase != assigned_phase_id:
                add_error(
                    path,
                    f"assigned_step_id '{assigned_step_id}' belongs to '{expected_phase}', not '{assigned_phase_id}'",
                )
        if status == "assigned" and not assigned_step_id:
            add_error(path, "status 'assigned' requires a valid assigned_step_id")

    activity = data.get("recent_activity", [])
    if not isinstance(activity, list):
        add_error("recent_activity", "'recent_activity' must be an array when provided")
        activity = []

    previous_time: datetime | None = None
    for activity_index, entry in enumerate(activity):
        path = f"recent_activity[{activity_index}]"
        if not isinstance(entry, dict):
            add_error(path, "activity entry must be an object")
            continue

        allowed = {"time", "worker", "status", "step_id", "note"}
        check_allowed_keys(entry, allowed, path)

        timestamp = require_non_empty_string(entry, "time", path)
        worker_name = require_non_empty_string(entry, "worker", path)
        worker_status = require_non_empty_string(entry, "status", path)
        step_id = require_non_empty_string(entry, "step_id", path)
        note = require_non_empty_string(entry, "note", path)

        _ = worker_name, note

        if known_position_workers is not None and worker_name and worker_name not in known_position_workers:
            add_error(path, f"worker '{worker_name}' is not present in worker_positions")

        if worker_status and worker_status not in allowed_worker_status:
            add_error(path, f"activity status '{worker_status}' is invalid")

        if step_id and step_id not in step_ids:
            add_error(path, f"step_id '{step_id}' does not exist in phases/steps/substeps")

        if timestamp:
            if not parse_utc_timestamp(timestamp):
                add_error(path, "time must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)")
            else:
                dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                activity_times.append(timestamp)
                if previous_time and dt > previous_time:
                    add_warning(
                        "recent_activity",
                        "activity entries are not newest-first by time",
                    )
                previous_time = dt

    if isinstance(project, dict) and isinstance(project.get("last_updated"), str) and activity_times:
        project_updated = project["last_updated"]
        if parse_utc_timestamp(project_updated):
            latest_activity_time = max(datetime.fromisoformat(item.replace("Z", "+00:00")) for item in activity_times)
            if datetime.fromisoformat(project_updated.replace("Z", "+00:00")) < latest_activity_time:
                add_warning(
                    "project.last_updated",
                    "is older than the latest recent_activity.time",
                )

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Ghost Build Tracker JSON contract and structure.")
    parser.add_argument(
        "--file",
        default=str(DEFAULT_TRACKER_PATH),
        help="Path to tracker JSON (default: ops/build-tracker/project-tracker.json)",
    )
    parser.add_argument(
        "--schema",
        default=str(DEFAULT_SCHEMA_PATH),
        help="Path to schema JSON (default: ops/build-tracker/project-tracker.schema.json)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as failures.",
    )

    args = parser.parse_args()

    tracker_path = Path(args.file)
    schema_path = Path(args.schema)

    try:
        schema_data = load_json_file(schema_path)
        tracker_data = load_json_file(tracker_path)
    except ValueError as exc:
        print("Ghost Build Tracker Validation")
        print(f"❌ FAIL: {exc}")
        return 1

    errors, warnings = validate_tracker_data(tracker_data, schema_data)

    print("Ghost Build Tracker Validation")
    print(f"- Tracker: {tracker_path}")
    print(f"- Schema:  {schema_path}")

    if warnings:
        print(f"⚠ Warnings ({len(warnings)}):")
        for warning in warnings:
            print(f"  - {warning}")

    if errors:
        print(f"❌ FAIL ({len(errors)} errors)")
        for error in errors:
            print(f"  - {error}")
        return 1

    if args.strict and warnings:
        print("❌ FAIL (strict mode: warnings present)")
        return 1

    print("✅ PASS (tracker contract is valid)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
