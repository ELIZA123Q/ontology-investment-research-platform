#!/usr/bin/env python3
"""Validate delivery readiness inside a 03 snapshot directory.

Delivery readiness is intentionally independent from the 03 evidence quality gate.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "05_control_evaluation" / "03_校验"))
from repo_paths import ensure_run_path  # noqa: E402

ensure_run_path()

from quality_gate_utils import (  # noqa: E402
    DELIVERY_ARCHETYPES,
    DELIVERY_DIMENSION_STATUSES,
    DELIVERY_READINESS_STATUSES,
    DELIVERY_REQUIRED_ACTIONS,
)
from validator_utils import error_payload, fail, ok_payload, read_csv  # noqa: E402


def find_delivery_readiness_csv(snapshot_dir: Path) -> Path | None:
    candidates = [
        snapshot_dir / "04_05_materials" / "delivery_readiness.csv",
        snapshot_dir / "delivery_readiness.csv",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def validate_delivery_readiness(
    snapshot_dir: Path,
    *,
    quality_status: Any = None,
    label: str,
) -> dict[str, object] | None:
    """Validate only the delivery contract; quality_status is reported, never gated."""
    path = find_delivery_readiness_csv(snapshot_dir)
    if path is None:
        return None

    rows = read_csv(path)
    if len(rows) != 1:
        fail(f"{label}: {path.name} 必须且只能有一行总体交付准备度")

    row = rows[0]
    readiness_id = row.get("delivery_readiness_id", "")
    status = str(row.get("status", ""))
    action = str(row.get("gap_action", "none"))
    report_type = str(row.get("target_report_type", ""))
    if report_type not in DELIVERY_ARCHETYPES:
        fail(f"{label}#{readiness_id}.target_report_type 非法: {report_type}")
    if status not in DELIVERY_READINESS_STATUSES:
        fail(f"{label}#{readiness_id}.status 非法: {status}")
    if action not in DELIVERY_REQUIRED_ACTIONS:
        fail(f"{label}#{readiness_id}.gap_action 非法: {action}")
    dimensions: dict[str, str] = {}
    for field in ["chart_readiness", "table_readiness", "source_annotation_readiness"]:
        value = str(row.get(field, ""))
        if value not in DELIVERY_DIMENSION_STATUSES:
            fail(f"{label}#{readiness_id}.{field} 非法: {value}")
        dimensions[field] = value

    if status == "ready" and "missing" in dimensions.values():
        fail(f"{label}#{readiness_id}: status=ready 时适用维度不得为 missing")
    if status != "ready" and action == "none":
        fail(f"{label}#{readiness_id}: 未就绪时必须记录 gap_action")

    return {
        "path": str(path),
        "checked": True,
        "evidence_quality_status": str(quality_status),
        "target_report_type": report_type,
        "status": status,
        **dimensions,
    }


def main(argv: list[str]) -> int:
    if len(argv) not in {2, 3}:
        print("usage: validate_delivery_readiness.py <数据与证据快照目录> [quality_status]")
        return 2
    try:
        snapshot_dir = Path(argv[1])
        quality_status = argv[2] if len(argv) == 3 else "high_quality_pass"
        result = validate_delivery_readiness(snapshot_dir, quality_status=quality_status, label="delivery_readiness")
        if result is None:
            print(error_payload(ValueError("快照目录缺少 delivery_readiness.csv")))
            return 1
        print(ok_payload(**result))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
