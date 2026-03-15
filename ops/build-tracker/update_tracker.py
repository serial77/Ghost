#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import validate_tracker as validator


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_json_atomic(path: Path, data: Any) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp_path.replace(path)


def find_step_or_substep(data: dict[str, Any], target_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    phases = data.get("phases")
    if not isinstance(phases, list):
        return None, None

    for phase in phases:
        if not isinstance(phase, dict):
            continue
        steps = phase.get("steps")
        if not isinstance(steps, list):
            continue

        for step in steps:
            if not isinstance(step, dict):
                continue
            if step.get("id") == target_id:
                return step, phase

            substeps = step.get("substeps")
            if isinstance(substeps, list):
                for substep in substeps:
                    if isinstance(substep, dict) and substep.get("id") == target_id:
                        return substep, phase

    return None, None


def find_phase_by_id(data: dict[str, Any], phase_id: str) -> dict[str, Any] | None:
    phases = data.get("phases")
    if not isinstance(phases, list):
        return None
    for phase in phases:
        if isinstance(phase, dict) and phase.get("id") == phase_id:
            return phase
    return None


def ensure_worker_positions_container(data: dict[str, Any]) -> dict[str, Any]:
    worker_positions = data.get("worker_positions")
    if not isinstance(worker_positions, dict):
        worker_positions = {
            "canonical_runtime_workers": [],
            "external_implementation_workers": [],
        }
        data["worker_positions"] = worker_positions

    for key in ("canonical_runtime_workers", "external_implementation_workers"):
        if not isinstance(worker_positions.get(key), list):
            worker_positions[key] = []

    return worker_positions


def ensure_valid_timestamp(value: str, label: str) -> str:
    if not validator.parse_utc_timestamp(value):
        raise ValueError(f"{label} must be ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ)")
    return value


def ensure_tracker_is_valid(data: dict[str, Any], schema: dict[str, Any], label: str) -> list[str]:
    errors, warnings = validator.validate_tracker_data(data, schema)
    if errors:
        formatted = "\n".join(f"  - {item}" for item in errors)
        raise ValueError(f"{label} failed validation:\n{formatted}")
    return warnings


def set_project_last_updated(data: dict[str, Any], timestamp: str) -> None:
    if not isinstance(data.get("project"), dict):
        data["project"] = {}
    data["project"]["last_updated"] = timestamp


def set_project_focus_if_provided(data: dict[str, Any], focus: str | None) -> None:
    if not focus:
        return
    if not isinstance(data.get("project"), dict):
        data["project"] = {}
    data["project"]["current_focus"] = focus


def run() -> int:
    parser = argparse.ArgumentParser(description="Update Ghost Build Tracker JSON safely.")
    parser.add_argument(
        "--file",
        default=str(validator.DEFAULT_TRACKER_PATH),
        help="Path to tracker JSON (default: ops/build-tracker/project-tracker.json)",
    )
    parser.add_argument(
        "--schema",
        default=str(validator.DEFAULT_SCHEMA_PATH),
        help="Path to schema JSON (default: ops/build-tracker/project-tracker.schema.json)",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    set_status = subparsers.add_parser("set-status", help="Set step/substep status by id")
    set_status.add_argument("--id", required=True, help="Step or substep id")
    set_status.add_argument("--status", required=True, help="Status value")
    set_status.add_argument("--updated-at", help="ISO-8601 UTC timestamp")
    set_status.add_argument("--current-focus", help="Optional project.current_focus update")

    upsert_worker = subparsers.add_parser("worker-upsert", help="Add or update active worker marker")
    upsert_worker.add_argument("--id", required=True, help="Step or substep id")
    upsert_worker.add_argument("--name", required=True, help="Worker name")
    upsert_worker.add_argument("--status", required=True, help="Worker status")
    upsert_worker.add_argument("--task", required=True, help="Current task text")
    upsert_worker.add_argument("--branch", help="Optional branch")
    upsert_worker.add_argument("--updated-at", help="ISO-8601 UTC timestamp")
    upsert_worker.add_argument("--current-focus", help="Optional project.current_focus update")

    remove_worker = subparsers.add_parser("worker-remove", help="Remove active worker marker")
    remove_worker.add_argument("--id", required=True, help="Step or substep id")
    remove_worker.add_argument("--name", required=True, help="Worker name")
    remove_worker.add_argument("--updated-at", help="ISO-8601 UTC timestamp")
    remove_worker.add_argument("--current-focus", help="Optional project.current_focus update")

    add_activity = subparsers.add_parser("add-activity", help="Append or prepend recent activity entry")
    add_activity.add_argument("--worker", required=True, help="Worker name")
    add_activity.add_argument("--status", required=True, help="Worker status")
    add_activity.add_argument("--step-id", required=True, help="Target step/substep id")
    add_activity.add_argument("--note", required=True, help="Activity note")
    add_activity.add_argument("--time", help="ISO-8601 UTC timestamp")
    add_activity.add_argument("--append", action="store_true", help="Append to end instead of prepending")
    add_activity.add_argument("--current-focus", help="Optional project.current_focus update")

    position_upsert = subparsers.add_parser("position-upsert", help="Add or update top-level worker position")
    position_upsert.add_argument("--group", choices=["canonical", "external"], required=True, help="Worker group")
    position_upsert.add_argument("--name", required=True, help="Worker name")
    position_upsert.add_argument("--lane", help="Lane/type label (required when creating new position)")
    position_upsert.add_argument("--status", help="Worker position status (required when creating new position)")
    position_upsert.add_argument("--summary", help="Short assignment summary (required when creating new position)")
    position_upsert.add_argument("--phase-id", help="Optional assigned phase id")
    position_upsert.add_argument("--step-id", help="Optional assigned step/substep id")
    position_upsert.add_argument("--clear-assignment", action="store_true", help="Clear assigned phase/step fields")
    position_upsert.add_argument("--note", help="Optional short note")
    position_upsert.add_argument("--branch", help="Optional branch")
    position_upsert.add_argument("--blocking-on", help="Optional dependency/blocker note")
    position_upsert.add_argument("--updated-at", help="ISO-8601 UTC timestamp")
    position_upsert.add_argument("--current-focus", help="Optional project.current_focus update")

    position_remove = subparsers.add_parser("position-remove", help="Remove top-level worker position")
    position_remove.add_argument("--group", choices=["canonical", "external"], required=True, help="Worker group")
    position_remove.add_argument("--name", required=True, help="Worker name")
    position_remove.add_argument("--updated-at", help="ISO-8601 UTC timestamp")
    position_remove.add_argument("--current-focus", help="Optional project.current_focus update")

    args = parser.parse_args()

    tracker_path = Path(args.file)
    schema_path = Path(args.schema)

    try:
        schema = validator.load_json_file(schema_path)
        tracker = validator.load_json_file(tracker_path)
    except ValueError as exc:
        print(f"❌ {exc}")
        return 1

    if not isinstance(schema, dict):
        print("❌ schema root must be an object")
        return 1
    if not isinstance(tracker, dict):
        print("❌ tracker root must be an object")
        return 1

    step_statuses = validator.get_schema_enum_values(
        schema,
        ["$defs", "stepStatus"],
        ["complete", "active", "pending", "blocked", "frozen"],
    )
    worker_statuses = validator.get_schema_enum_values(
        schema,
        ["$defs", "workerStatus"],
        ["working", "blocked", "waiting", "review", "done"],
    )
    worker_position_statuses = validator.get_schema_enum_values(
        schema,
        ["$defs", "workerPositionStatus"],
        ["assigned", "available", "pending_assignment", "standby", "blocked", "completed", "unavailable"],
    )

    try:
        pre_warnings = ensure_tracker_is_valid(tracker, schema, "Existing tracker")
        if pre_warnings:
            print(f"⚠ Existing tracker has {len(pre_warnings)} warning(s); continuing with update")

        updated = copy.deepcopy(tracker)
        command = args.command

        if command == "set-status":
            if args.status not in step_statuses:
                raise ValueError(
                    f"status '{args.status}' is invalid. Allowed: {', '.join(sorted(step_statuses))}"
                )

            target, _phase = find_step_or_substep(updated, args.id)
            if target is None:
                raise ValueError(f"step/substep id '{args.id}' not found")

            target["status"] = args.status
            changed_at = ensure_valid_timestamp(args.updated_at, "--updated-at") if args.updated_at else now_utc_iso()
            set_project_last_updated(updated, changed_at)
            set_project_focus_if_provided(updated, args.current_focus)

            summary = f"set status: {args.id} -> {args.status}"

        elif command == "worker-upsert":
            if args.status not in worker_statuses:
                raise ValueError(
                    f"worker status '{args.status}' is invalid. Allowed: {', '.join(sorted(worker_statuses))}"
                )

            target, _phase = find_step_or_substep(updated, args.id)
            if target is None:
                raise ValueError(f"step/substep id '{args.id}' not found")

            workers = target.get("active_workers")
            if not isinstance(workers, list):
                raise ValueError(f"step/substep '{args.id}' has malformed active_workers field")

            worker_timestamp = ensure_valid_timestamp(args.updated_at, "--updated-at") if args.updated_at else now_utc_iso()
            worker_payload: dict[str, Any] = {
                "name": args.name,
                "status": args.status,
                "task": args.task,
                "updated_at": worker_timestamp,
            }
            if args.branch:
                worker_payload["branch"] = args.branch

            normalized_name = args.name.strip().lower()
            existing_index = None
            for index, worker in enumerate(workers):
                if isinstance(worker, dict) and str(worker.get("name", "")).strip().lower() == normalized_name:
                    existing_index = index
                    break

            if existing_index is None:
                workers.append(worker_payload)
                action = "added"
            else:
                workers[existing_index] = worker_payload
                action = "updated"

            set_project_last_updated(updated, worker_timestamp)
            set_project_focus_if_provided(updated, args.current_focus)
            summary = f"worker {action}: {args.name} on {args.id}"

        elif command == "worker-remove":
            target, _phase = find_step_or_substep(updated, args.id)
            if target is None:
                raise ValueError(f"step/substep id '{args.id}' not found")

            workers = target.get("active_workers")
            if not isinstance(workers, list):
                raise ValueError(f"step/substep '{args.id}' has malformed active_workers field")

            normalized_name = args.name.strip().lower()
            next_workers = [
                worker
                for worker in workers
                if not (
                    isinstance(worker, dict)
                    and str(worker.get("name", "")).strip().lower() == normalized_name
                )
            ]

            if len(next_workers) == len(workers):
                raise ValueError(f"worker '{args.name}' not found on '{args.id}'")

            target["active_workers"] = next_workers
            changed_at = ensure_valid_timestamp(args.updated_at, "--updated-at") if args.updated_at else now_utc_iso()
            set_project_last_updated(updated, changed_at)
            set_project_focus_if_provided(updated, args.current_focus)
            summary = f"worker removed: {args.name} from {args.id}"

        elif command == "add-activity":
            if args.status not in worker_statuses:
                raise ValueError(
                    f"activity status '{args.status}' is invalid. Allowed: {', '.join(sorted(worker_statuses))}"
                )

            target, _phase = find_step_or_substep(updated, args.step_id)
            if target is None:
                raise ValueError(f"step/substep id '{args.step_id}' not found")

            activity_time = ensure_valid_timestamp(args.time, "--time") if args.time else now_utc_iso()
            entry = {
                "time": activity_time,
                "worker": args.worker,
                "status": args.status,
                "step_id": args.step_id,
                "note": args.note,
            }

            activity = updated.get("recent_activity")
            if activity is None:
                activity = []
                updated["recent_activity"] = activity
            if not isinstance(activity, list):
                raise ValueError("recent_activity must be an array")

            if args.append:
                activity.append(entry)
            else:
                activity.insert(0, entry)

            set_project_last_updated(updated, activity_time)
            set_project_focus_if_provided(updated, args.current_focus)
            summary = f"activity {'appended' if args.append else 'prepended'} for {args.worker} on {args.step_id}"

        elif command == "position-upsert":
            worker_positions = ensure_worker_positions_container(updated)
            canonical_names = set(updated.get("core_framing", {}).get("canonical_worker_registry", [])) if isinstance(updated.get("core_framing"), dict) else set()

            if args.group == "canonical" and args.name not in canonical_names:
                raise ValueError(f"canonical worker '{args.name}' must exist in core_framing.canonical_worker_registry")
            if args.group == "external" and args.name in canonical_names:
                raise ValueError(f"external worker '{args.name}' cannot be a canonical runtime worker")

            key = "canonical_runtime_workers" if args.group == "canonical" else "external_implementation_workers"
            target_list = worker_positions[key]
            other_key = "external_implementation_workers" if args.group == "canonical" else "canonical_runtime_workers"
            other_list = worker_positions[other_key]

            normalized_name = args.name.strip().lower()

            existing_index = None
            existing_entry: dict[str, Any] = {}
            for index, entry in enumerate(target_list):
                if isinstance(entry, dict) and str(entry.get("name", "")).strip().lower() == normalized_name:
                    existing_index = index
                    existing_entry = entry
                    break

            resolved_lane = args.lane or (existing_entry.get("lane") if isinstance(existing_entry.get("lane"), str) else None)
            resolved_status = args.status or (existing_entry.get("status") if isinstance(existing_entry.get("status"), str) else None)
            resolved_summary = args.summary or (existing_entry.get("summary") if isinstance(existing_entry.get("summary"), str) else None)

            if not resolved_lane or not str(resolved_lane).strip():
                raise ValueError("--lane is required when creating a new position")
            if not resolved_status or not str(resolved_status).strip():
                raise ValueError("--status is required when creating a new position")
            if not resolved_summary or not str(resolved_summary).strip():
                raise ValueError("--summary is required when creating a new position")

            resolved_status = str(resolved_status).strip()
            resolved_lane = str(resolved_lane).strip()
            resolved_summary = str(resolved_summary).strip()

            if resolved_status not in worker_position_statuses:
                raise ValueError(
                    f"position status '{resolved_status}' is invalid. Allowed: {', '.join(sorted(worker_position_statuses))}"
                )

            assigned_phase_id = existing_entry.get("assigned_phase_id") if isinstance(existing_entry.get("assigned_phase_id"), str) else None
            assigned_step_id = existing_entry.get("assigned_step_id") if isinstance(existing_entry.get("assigned_step_id"), str) else None

            if args.clear_assignment:
                assigned_phase_id = None
                assigned_step_id = None

            if args.step_id:
                assigned_step_id = args.step_id
                target, phase = find_step_or_substep(updated, assigned_step_id)
                if target is None or phase is None:
                    raise ValueError(f"step/substep id '{assigned_step_id}' not found")
                resolved_phase_id = phase.get("id") if isinstance(phase.get("id"), str) else None
                if args.phase_id and resolved_phase_id and args.phase_id != resolved_phase_id:
                    raise ValueError(
                        f"step/substep '{assigned_step_id}' belongs to '{resolved_phase_id}', not '{args.phase_id}'"
                    )
                assigned_phase_id = args.phase_id or resolved_phase_id
            elif args.phase_id:
                if not find_phase_by_id(updated, args.phase_id):
                    raise ValueError(f"phase id '{args.phase_id}' not found")
                assigned_phase_id = args.phase_id
                if assigned_step_id:
                    target, phase = find_step_or_substep(updated, assigned_step_id)
                    if target is None or phase is None:
                        raise ValueError(f"step/substep id '{assigned_step_id}' not found")
                    resolved_phase_id = phase.get("id") if isinstance(phase.get("id"), str) else None
                    if resolved_phase_id and assigned_phase_id != resolved_phase_id:
                        assigned_step_id = None

            if assigned_phase_id and not find_phase_by_id(updated, assigned_phase_id):
                raise ValueError(f"phase id '{assigned_phase_id}' not found")

            if assigned_step_id:
                target, phase = find_step_or_substep(updated, assigned_step_id)
                if target is None or phase is None:
                    raise ValueError(f"step/substep id '{assigned_step_id}' not found")
                resolved_phase_id = phase.get("id") if isinstance(phase.get("id"), str) else None
                if assigned_phase_id and resolved_phase_id and assigned_phase_id != resolved_phase_id:
                    raise ValueError(
                        f"step/substep '{assigned_step_id}' belongs to '{resolved_phase_id}', not '{assigned_phase_id}'"
                    )

            if resolved_status == "assigned" and not assigned_step_id:
                raise ValueError("status 'assigned' requires --step-id")

            position_timestamp = ensure_valid_timestamp(args.updated_at, "--updated-at") if args.updated_at else now_utc_iso()
            payload: dict[str, Any] = {
                "name": args.name,
                "lane": resolved_lane,
                "status": resolved_status,
                "summary": resolved_summary,
                "updated_at": position_timestamp,
            }
            if assigned_phase_id:
                payload["assigned_phase_id"] = assigned_phase_id
            if assigned_step_id:
                payload["assigned_step_id"] = assigned_step_id
            if args.note is not None:
                if args.note.strip():
                    payload["note"] = args.note.strip()
            elif isinstance(existing_entry.get("note"), str) and existing_entry.get("note").strip():
                payload["note"] = existing_entry.get("note").strip()

            if args.branch is not None:
                if args.branch.strip():
                    payload["branch"] = args.branch.strip()
            elif isinstance(existing_entry.get("branch"), str) and existing_entry.get("branch").strip():
                payload["branch"] = existing_entry.get("branch").strip()

            if args.blocking_on is not None:
                if args.blocking_on.strip():
                    payload["blocking_on"] = args.blocking_on.strip()
            elif isinstance(existing_entry.get("blocking_on"), str) and existing_entry.get("blocking_on").strip():
                payload["blocking_on"] = existing_entry.get("blocking_on").strip()

            worker_positions[other_key] = [
                entry
                for entry in other_list
                if not (isinstance(entry, dict) and str(entry.get("name", "")).strip().lower() == normalized_name)
            ]

            if existing_index is None:
                target_list.append(payload)
                action = "added"
            else:
                target_list[existing_index] = payload
                action = "updated"

            set_project_last_updated(updated, position_timestamp)
            set_project_focus_if_provided(updated, args.current_focus)
            summary = f"worker position {action}: {args.name} ({args.group})"

        elif command == "position-remove":
            worker_positions = ensure_worker_positions_container(updated)
            key = "canonical_runtime_workers" if args.group == "canonical" else "external_implementation_workers"
            target_list = worker_positions[key]

            normalized_name = args.name.strip().lower()
            next_list = [
                entry
                for entry in target_list
                if not (isinstance(entry, dict) and str(entry.get("name", "")).strip().lower() == normalized_name)
            ]

            if len(next_list) == len(target_list):
                raise ValueError(f"worker position '{args.name}' not found in {args.group} group")

            worker_positions[key] = next_list
            changed_at = ensure_valid_timestamp(args.updated_at, "--updated-at") if args.updated_at else now_utc_iso()
            set_project_last_updated(updated, changed_at)
            set_project_focus_if_provided(updated, args.current_focus)
            summary = f"worker position removed: {args.name} ({args.group})"

        else:
            raise ValueError(f"unknown command '{command}'")

        post_warnings = ensure_tracker_is_valid(updated, schema, "Updated tracker")
        write_json_atomic(tracker_path, updated)

        print(f"✅ {summary}")
        print(f"- file: {tracker_path}")
        if post_warnings:
            print(f"⚠ post-update warnings: {len(post_warnings)}")
            for warning in post_warnings:
                print(f"  - {warning}")

    except ValueError as exc:
        print(f"❌ {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(run())
