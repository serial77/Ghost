#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import validate_tracker as validator

DEFAULT_SNAPSHOTS_DIR = validator.SCRIPT_DIR / "snapshots"


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def normalize_label(label: str | None) -> str:
    if not label:
        return ""
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", label.strip()).strip("-").lower()
    return normalized


def next_snapshot_path(snapshots_dir: Path, label: str | None) -> Path:
    stamp = utc_stamp()
    label_part = normalize_label(label)
    base = f"tracker-snapshot-{stamp}"
    if label_part:
        base += f"--{label_part}"

    candidate = snapshots_dir / f"{base}.json"
    counter = 2
    while candidate.exists():
        candidate = snapshots_dir / f"{base}-{counter}.json"
        counter += 1
    return candidate


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a timestamped snapshot of project-tracker.json.")
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
    parser.add_argument(
        "--snapshots-dir",
        default=str(DEFAULT_SNAPSHOTS_DIR),
        help="Directory where snapshots are stored (default: ops/build-tracker/snapshots)",
    )
    parser.add_argument("--label", help="Optional snapshot label appended to filename")
    parser.add_argument(
        "--skip-validate",
        action="store_true",
        help="Skip validation before snapshot creation",
    )
    parser.add_argument(
        "--print-path",
        action="store_true",
        help="Print snapshot path only (useful for scripts)",
    )

    args = parser.parse_args()

    tracker_path = Path(args.file)
    schema_path = Path(args.schema)
    snapshots_dir = Path(args.snapshots_dir)

    try:
        tracker_data = validator.load_json_file(tracker_path)
        if not isinstance(tracker_data, dict):
            print("❌ tracker root must be an object")
            return 1

        warnings: list[str] = []
        if not args.skip_validate:
            schema_data = validator.load_json_file(schema_path)
            if not isinstance(schema_data, dict):
                print("❌ schema root must be an object")
                return 1

            errors, warnings = validator.validate_tracker_data(tracker_data, schema_data)
            if errors:
                print("Ghost Build Tracker Snapshot")
                print("❌ tracker failed validation; snapshot not created")
                for item in errors:
                    print(f"  - {item}")
                return 1

        snapshots_dir.mkdir(parents=True, exist_ok=True)
        snapshot_path = next_snapshot_path(snapshots_dir, args.label)
        snapshot_path.write_text(json.dumps(tracker_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        if args.print_path:
            print(snapshot_path)
            return 0

        print("Ghost Build Tracker Snapshot")
        print(f"✅ Snapshot created")
        print(f"- Source:   {tracker_path}")
        print(f"- Snapshot: {snapshot_path}")
        if warnings:
            print(f"⚠ Validation warnings ({len(warnings)}):")
            for item in warnings:
                print(f"  - {item}")

    except ValueError as exc:
        print(f"❌ {exc}")
        return 1
    except OSError as exc:
        print(f"❌ cannot write snapshot: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
