#!/usr/bin/env python3
"""Validate optional 05 material readiness inside a 03 snapshot directory."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from quality_gate_utils import MATERIAL_READINESS_STATUSES, MATERIAL_REQUIRED_ACTIONS
from validator_utils import error_payload, fail, ok_payload, read_csv


def find_material_readiness_csv(snapshot_dir: Path) -> Path | None:
    candidates = [
        snapshot_dir / "04_05_materials" / "05_material_readiness.csv",
        snapshot_dir / "05_material_readiness.csv",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def validate_05_materials(
    snapshot_dir: Path,
    *,
    quality_status: Any,
    label: str,
) -> dict[str, object] | None:
    path = find_material_readiness_csv(snapshot_dir)
    if path is None:
        return None
    if str(quality_status) != "high_quality_pass":
        return {"path": str(path), "checked": False, "reason": "quality_status_not_publish"}

    rows = read_csv(path)
    if not rows:
        fail(f"{label}: {path.name} 至少需要一行")

    not_ready: list[str] = []
    for row in rows:
        material_id = row.get("material_unit_id", "")
        status = str(row.get("status", ""))
        action = str(row.get("required_action", "none"))
        if status not in MATERIAL_READINESS_STATUSES:
            fail(f"{label}#{material_id}.status 非法: {status}")
        if action not in MATERIAL_REQUIRED_ACTIONS:
            fail(f"{label}#{material_id}.required_action 非法: {action}")
        if status != "report_grade_ready":
            not_ready.append(material_id)

    if not_ready:
        fail(
            f"{label}: 05 成稿素材未达 report_grade_ready（{', '.join(not_ready)}）；"
            "拟 high_quality_pass 发布时应退回 03 补证据、补数据或补图表素材"
        )

    return {
        "path": str(path),
        "checked": True,
        "material_unit_total": len(rows),
        "report_grade_ready_count": len(rows),
    }


def main(argv: list[str]) -> int:
    if len(argv) not in {2, 3}:
        print("usage: validate_05_materials.py <数据与证据快照目录> [quality_status]")
        return 2
    try:
        snapshot_dir = Path(argv[1])
        quality_status = argv[2] if len(argv) == 3 else "high_quality_pass"
        result = validate_05_materials(snapshot_dir, quality_status=quality_status, label="05_material_readiness")
        if result is None:
            print(error_payload(ValueError("快照目录缺少 05_material_readiness.csv")))
            return 1
        print(ok_payload(**result))
        return 0
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
