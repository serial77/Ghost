#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import validate_tracker as validator

DEFAULT_SNAPSHOTS_DIR = validator.SCRIPT_DIR / "snapshots"


def latest_snapshot_path(snapshots_dir: Path) -> Path | None:
    candidates = sorted(snapshots_dir.glob("*.json"))
    return candidates[-1] if candidates else None


def resolve_input_path(value: str | None, snapshots_dir: Path, fallback: Path | None = None) -> Path | None:
    if value is None:
        return fallback

    if value.lower() == "latest":
        return latest_snapshot_path(snapshots_dir)

    direct = Path(value)
    if direct.exists():
        return direct

    in_snapshots = snapshots_dir / value
    if in_snapshots.exists():
        return in_snapshots

    return direct


def phase_index(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    phases = data.get("phases") if isinstance(data, dict) else None
    if not isinstance(phases, list):
        return {}

    index: dict[str, dict[str, Any]] = {}
    for phase in phases:
        if not isinstance(phase, dict):
            continue
        phase_id = phase.get("id")
        if isinstance(phase_id, str):
            index[phase_id] = {
                "id": phase_id,
                "title": phase.get("title") if isinstance(phase.get("title"), str) else phase_id,
                "status": phase.get("status") if isinstance(phase.get("status"), str) else "pending",
            }
    return index


def worker_map(active_workers: Any) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if not isinstance(active_workers, list):
        return result

    for worker in active_workers:
        if not isinstance(worker, dict):
            continue
        name = worker.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        result[name.strip().lower()] = worker
    return result


def flatten_steps(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    flattened: dict[str, dict[str, Any]] = {}
    phases = data.get("phases") if isinstance(data, dict) else None
    if not isinstance(phases, list):
        return flattened

    def add_step(
        step: dict[str, Any],
        *,
        phase_id: str,
        phase_title: str,
        parent_id: str | None,
        parent_title: str | None,
    ) -> None:
        step_id = step.get("id")
        if not isinstance(step_id, str):
            return

        title = step.get("title") if isinstance(step.get("title"), str) else step_id
        status = step.get("status") if isinstance(step.get("status"), str) else "pending"

        if parent_title:
            path = f"{phase_title} / {parent_title} / {title}"
        else:
            path = f"{phase_title} / {title}"

        flattened[step_id] = {
            "id": step_id,
            "title": title,
            "status": status,
            "phase_id": phase_id,
            "phase_title": phase_title,
            "parent_id": parent_id,
            "path": path,
            "workers": worker_map(step.get("active_workers")),
        }

    for phase in phases:
        if not isinstance(phase, dict):
            continue
        phase_id = phase.get("id")
        if not isinstance(phase_id, str):
            continue
        phase_title = phase.get("title") if isinstance(phase.get("title"), str) else phase_id

        steps = phase.get("steps")
        if not isinstance(steps, list):
            continue

        for step in steps:
            if not isinstance(step, dict):
                continue
            add_step(step, phase_id=phase_id, phase_title=phase_title, parent_id=None, parent_title=None)

            step_id = step.get("id")
            step_title = step.get("title") if isinstance(step.get("title"), str) else step_id
            substeps = step.get("substeps")
            if isinstance(substeps, list):
                for substep in substeps:
                    if isinstance(substep, dict):
                        add_step(
                            substep,
                            phase_id=phase_id,
                            phase_title=phase_title,
                            parent_id=step_id if isinstance(step_id, str) else None,
                            parent_title=step_title if isinstance(step_title, str) else None,
                        )

    return flattened


def activity_key(entry: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (
        str(entry.get("time", "")),
        str(entry.get("worker", "")),
        str(entry.get("status", "")),
        str(entry.get("step_id", "")),
        str(entry.get("note", "")),
    )


def worker_locations(step_map: dict[str, dict[str, Any]]) -> dict[str, list[dict[str, str]]]:
    locations: dict[str, list[dict[str, str]]] = {}
    for step_id, step in step_map.items():
        workers = step.get("workers")
        if not isinstance(workers, dict):
            continue
        for lower_name, worker in workers.items():
            name = worker.get("name") if isinstance(worker.get("name"), str) else lower_name
            locations.setdefault(lower_name, []).append(
                {
                    "name": name,
                    "step_id": step_id,
                    "path": str(step.get("path", step_id)),
                }
            )
    return locations


def build_report(from_data: dict[str, Any], to_data: dict[str, Any], *, ignore_metadata: bool) -> dict[str, list[dict[str, Any]]]:
    report: dict[str, list[dict[str, Any]]] = {
        "metadata": [],
        "phase_status": [],
        "step_status": [],
        "worker_moves": [],
        "worker_added": [],
        "worker_removed": [],
        "worker_updated": [],
        "activity_added": [],
    }

    from_project = from_data.get("project") if isinstance(from_data.get("project"), dict) else {}
    to_project = to_data.get("project") if isinstance(to_data.get("project"), dict) else {}

    if not ignore_metadata:
        for field in ["name", "schema_version", "last_updated", "current_focus"]:
            before = from_project.get(field)
            after = to_project.get(field)
            if before != after:
                report["metadata"].append({"field": field, "from": before, "to": after})

    from_phases = phase_index(from_data)
    to_phases = phase_index(to_data)

    for phase_id in sorted(set(from_phases.keys()) | set(to_phases.keys())):
        before = from_phases.get(phase_id)
        after = to_phases.get(phase_id)

        if before and not after:
            report["phase_status"].append(
                {
                    "phase_id": phase_id,
                    "title": before["title"],
                    "change": "removed",
                    "from": before["status"],
                    "to": None,
                }
            )
            continue

        if after and not before:
            report["phase_status"].append(
                {
                    "phase_id": phase_id,
                    "title": after["title"],
                    "change": "added",
                    "from": None,
                    "to": after["status"],
                }
            )
            continue

        assert before and after
        if before["status"] != after["status"]:
            report["phase_status"].append(
                {
                    "phase_id": phase_id,
                    "title": after["title"],
                    "change": "status",
                    "from": before["status"],
                    "to": after["status"],
                }
            )

    from_steps = flatten_steps(from_data)
    to_steps = flatten_steps(to_data)

    for step_id in sorted(set(from_steps.keys()) | set(to_steps.keys())):
        before = from_steps.get(step_id)
        after = to_steps.get(step_id)

        if before and not after:
            report["step_status"].append(
                {
                    "step_id": step_id,
                    "path": before["path"],
                    "change": "removed",
                    "from": before["status"],
                    "to": None,
                }
            )
            continue

        if after and not before:
            report["step_status"].append(
                {
                    "step_id": step_id,
                    "path": after["path"],
                    "change": "added",
                    "from": None,
                    "to": after["status"],
                }
            )
            continue

        assert before and after
        if before["status"] != after["status"]:
            report["step_status"].append(
                {
                    "step_id": step_id,
                    "path": after["path"],
                    "change": "status",
                    "from": before["status"],
                    "to": after["status"],
                }
            )

    from_locations = worker_locations(from_steps)
    to_locations = worker_locations(to_steps)

    moved_worker_names: set[str] = set()
    for worker_name in sorted(set(from_locations.keys()) & set(to_locations.keys())):
        from_ids = sorted(item["step_id"] for item in from_locations[worker_name])
        to_ids = sorted(item["step_id"] for item in to_locations[worker_name])
        if from_ids != to_ids:
            moved_worker_names.add(worker_name)
            report["worker_moves"].append(
                {
                    "name": from_locations[worker_name][0]["name"],
                    "from": from_locations[worker_name],
                    "to": to_locations[worker_name],
                }
            )

    for step_id in sorted(set(from_steps.keys()) & set(to_steps.keys())):
        before_workers = from_steps[step_id].get("workers", {})
        after_workers = to_steps[step_id].get("workers", {})

        if not isinstance(before_workers, dict) or not isinstance(after_workers, dict):
            continue

        for worker_name in sorted(set(before_workers.keys()) - set(after_workers.keys())):
            if worker_name in moved_worker_names:
                continue
            worker = before_workers[worker_name]
            report["worker_removed"].append(
                {
                    "name": worker.get("name", worker_name),
                    "step_id": step_id,
                    "path": from_steps[step_id]["path"],
                }
            )

        for worker_name in sorted(set(after_workers.keys()) - set(before_workers.keys())):
            if worker_name in moved_worker_names:
                continue
            worker = after_workers[worker_name]
            report["worker_added"].append(
                {
                    "name": worker.get("name", worker_name),
                    "step_id": step_id,
                    "path": to_steps[step_id]["path"],
                    "status": worker.get("status"),
                }
            )

        for worker_name in sorted(set(before_workers.keys()) & set(after_workers.keys())):
            before_worker = before_workers[worker_name]
            after_worker = after_workers[worker_name]
            field_changes: list[str] = []
            for field in ["status", "task", "branch", "updated_at"]:
                if before_worker.get(field) != after_worker.get(field):
                    field_changes.append(
                        f"{field}: {before_worker.get(field)!r} -> {after_worker.get(field)!r}"
                    )
            if field_changes:
                report["worker_updated"].append(
                    {
                        "name": after_worker.get("name", worker_name),
                        "step_id": step_id,
                        "path": to_steps[step_id]["path"],
                        "changes": field_changes,
                    }
                )

    from_activity = from_data.get("recent_activity") if isinstance(from_data.get("recent_activity"), list) else []
    to_activity = to_data.get("recent_activity") if isinstance(to_data.get("recent_activity"), list) else []

    from_keys = {activity_key(item) for item in from_activity if isinstance(item, dict)}
    for entry in to_activity:
        if not isinstance(entry, dict):
            continue
        key = activity_key(entry)
        if key not in from_keys:
            report["activity_added"].append(entry)

    return report


def report_has_changes(report: dict[str, list[dict[str, Any]]]) -> bool:
    return any(bool(items) for items in report.values())


def format_text(report: dict[str, list[dict[str, Any]]], from_path: Path, to_path: Path) -> str:
    lines: list[str] = []
    lines.append("Ghost Build Tracker Diff")
    lines.append(f"- From: {from_path}")
    lines.append(f"- To:   {to_path}")

    if not report_has_changes(report):
        lines.append("✅ No meaningful tracker changes detected.")
        return "\n".join(lines)

    def add_section(title: str, rows: list[str]) -> None:
        if not rows:
            return
        lines.append("")
        lines.append(f"{title}:")
        lines.extend(f"- {row}" for row in rows)

    add_section(
        "Metadata changes",
        [f"project.{item['field']}: {item['from']!r} -> {item['to']!r}" for item in report["metadata"]],
    )

    phase_rows: list[str] = []
    for item in report["phase_status"]:
        if item["change"] == "status":
            phase_rows.append(
                f"{item['phase_id']} ({item['title']}): {item['from']} -> {item['to']}"
            )
        elif item["change"] == "added":
            phase_rows.append(f"{item['phase_id']} ({item['title']}): added with status {item['to']}")
        else:
            phase_rows.append(f"{item['phase_id']} ({item['title']}): removed (was {item['from']})")
    add_section("Phase status changes", phase_rows)

    step_rows: list[str] = []
    for item in report["step_status"]:
        if item["change"] == "status":
            step_rows.append(f"{item['step_id']} [{item['path']}]: {item['from']} -> {item['to']}")
        elif item["change"] == "added":
            step_rows.append(f"{item['step_id']} [{item['path']}]: added with status {item['to']}")
        else:
            step_rows.append(f"{item['step_id']} [{item['path']}]: removed (was {item['from']})")
    add_section("Step/substep status changes", step_rows)

    move_rows: list[str] = []
    for item in report["worker_moves"]:
        before = ", ".join(f"{entry['step_id']}" for entry in item["from"])
        after = ", ".join(f"{entry['step_id']}" for entry in item["to"])
        move_rows.append(f"{item['name']}: {before} -> {after}")
    add_section("Worker marker moves", move_rows)

    add_section(
        "Worker marker additions",
        [
            f"{item['name']} added on {item['step_id']} [{item['path']}] (status={item.get('status')!r})"
            for item in report["worker_added"]
        ],
    )

    add_section(
        "Worker marker removals",
        [f"{item['name']} removed from {item['step_id']} [{item['path']}]" for item in report["worker_removed"]],
    )

    add_section(
        "Worker marker updates",
        [
            f"{item['name']} on {item['step_id']} [{item['path']}]: " + "; ".join(item["changes"])
            for item in report["worker_updated"]
        ],
    )

    add_section(
        "Recent activity additions",
        [
            f"{item.get('time')} | {item.get('worker')} {item.get('status')} | {item.get('step_id')} | {item.get('note')}"
            for item in report["activity_added"]
        ],
    )

    return "\n".join(lines)


def format_markdown(report: dict[str, list[dict[str, Any]]], from_path: Path, to_path: Path) -> str:
    lines: list[str] = []
    lines.append("# Ghost Build Tracker Diff")
    lines.append(f"- **From:** {from_path}")
    lines.append(f"- **To:** {to_path}")

    if not report_has_changes(report):
        lines.append("- ✅ No meaningful tracker changes detected.")
        return "\n".join(lines)

    def add_section(title: str, rows: list[str]) -> None:
        if not rows:
            return
        lines.append("")
        lines.append(f"## {title}")
        lines.extend(f"- {row}" for row in rows)

    add_section(
        "Metadata changes",
        [f"project.{item['field']}: {item['from']!r} -> {item['to']!r}" for item in report["metadata"]],
    )

    phase_rows = []
    for item in report["phase_status"]:
        if item["change"] == "status":
            phase_rows.append(f"{item['phase_id']} ({item['title']}): {item['from']} -> {item['to']}")
        elif item["change"] == "added":
            phase_rows.append(f"{item['phase_id']} ({item['title']}): added with status {item['to']}")
        else:
            phase_rows.append(f"{item['phase_id']} ({item['title']}): removed (was {item['from']})")
    add_section("Phase status changes", phase_rows)

    step_rows = []
    for item in report["step_status"]:
        if item["change"] == "status":
            step_rows.append(f"{item['step_id']} [{item['path']}]: {item['from']} -> {item['to']}")
        elif item["change"] == "added":
            step_rows.append(f"{item['step_id']} [{item['path']}]: added with status {item['to']}")
        else:
            step_rows.append(f"{item['step_id']} [{item['path']}]: removed (was {item['from']})")
    add_section("Step/substep status changes", step_rows)

    add_section(
        "Worker marker moves",
        [
            f"{item['name']}: {', '.join(entry['step_id'] for entry in item['from'])} -> {', '.join(entry['step_id'] for entry in item['to'])}"
            for item in report["worker_moves"]
        ],
    )

    add_section(
        "Worker marker additions",
        [
            f"{item['name']} added on {item['step_id']} [{item['path']}] (status={item.get('status')!r})"
            for item in report["worker_added"]
        ],
    )

    add_section(
        "Worker marker removals",
        [f"{item['name']} removed from {item['step_id']} [{item['path']}]" for item in report["worker_removed"]],
    )

    add_section(
        "Worker marker updates",
        [
            f"{item['name']} on {item['step_id']} [{item['path']}]: " + "; ".join(item["changes"])
            for item in report["worker_updated"]
        ],
    )

    add_section(
        "Recent activity additions",
        [
            f"{item.get('time')} | {item.get('worker')} {item.get('status')} | {item.get('step_id')} | {item.get('note')}"
            for item in report["activity_added"]
        ],
    )

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Diff Ghost Build Tracker snapshots/files and print concise change report.")
    parser.add_argument(
        "--from",
        dest="from_file",
        help="Base tracker file/snapshot path, or 'latest'. Defaults to latest snapshot.",
    )
    parser.add_argument(
        "--to",
        dest="to_file",
        help="Target tracker file/snapshot path. Defaults to canonical project-tracker.json.",
    )
    parser.add_argument(
        "--schema",
        default=str(validator.DEFAULT_SCHEMA_PATH),
        help="Path to schema JSON (default: ops/build-tracker/project-tracker.schema.json)",
    )
    parser.add_argument(
        "--snapshots-dir",
        default=str(DEFAULT_SNAPSHOTS_DIR),
        help="Snapshot directory (default: ops/build-tracker/snapshots)",
    )
    parser.add_argument(
        "--format",
        choices=["text", "markdown"],
        default="text",
        help="Output format (default: text)",
    )
    parser.add_argument(
        "--ignore-metadata",
        action="store_true",
        help="Ignore project metadata changes (name/schema_version/last_updated/current_focus)",
    )
    parser.add_argument(
        "--exit-nonzero-on-changes",
        action="store_true",
        help="Exit 2 when meaningful changes are detected.",
    )

    args = parser.parse_args()

    snapshots_dir = Path(args.snapshots_dir)
    schema_path = Path(args.schema)

    fallback_from = latest_snapshot_path(snapshots_dir)
    from_path = resolve_input_path(args.from_file, snapshots_dir, fallback=fallback_from)
    to_path = resolve_input_path(args.to_file, snapshots_dir, fallback=validator.DEFAULT_TRACKER_PATH)

    if from_path is None:
        print("❌ no baseline snapshot found. Create one with snapshot_tracker.py first.")
        return 1

    if to_path is None:
        print("❌ unable to resolve target tracker file")
        return 1

    if not from_path.exists():
        print(f"❌ from file not found: {from_path}")
        return 1

    if not to_path.exists():
        print(f"❌ to file not found: {to_path}")
        return 1

    try:
        schema_data = validator.load_json_file(schema_path)
        from_data = validator.load_json_file(from_path)
        to_data = validator.load_json_file(to_path)
    except ValueError as exc:
        print(f"❌ {exc}")
        return 1

    if not isinstance(schema_data, dict):
        print("❌ schema root must be an object")
        return 1
    if not isinstance(from_data, dict) or not isinstance(to_data, dict):
        print("❌ both tracker inputs must be JSON objects")
        return 1

    from_errors, from_warnings = validator.validate_tracker_data(from_data, schema_data)
    to_errors, to_warnings = validator.validate_tracker_data(to_data, schema_data)

    if from_errors or to_errors:
        print("Ghost Build Tracker Diff")
        print(f"- From: {from_path}")
        print(f"- To:   {to_path}")
        print("❌ diff aborted due to invalid tracker input")
        if from_errors:
            print("From-file errors:")
            for item in from_errors:
                print(f"  - {item}")
        if to_errors:
            print("To-file errors:")
            for item in to_errors:
                print(f"  - {item}")
        return 1

    report = build_report(from_data, to_data, ignore_metadata=args.ignore_metadata)

    if args.format == "markdown":
        output = format_markdown(report, from_path, to_path)
    else:
        output = format_text(report, from_path, to_path)

    print(output)

    if from_warnings:
        print(f"\n⚠ from-file validation warnings: {len(from_warnings)}")
    if to_warnings:
        print(f"⚠ to-file validation warnings: {len(to_warnings)}")

    if args.exit_nonzero_on_changes and report_has_changes(report):
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
