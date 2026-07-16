#!/usr/bin/env python3
"""一次性把 03/04 运行产物迁移为实例图权威。"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "运行校验"))
sys.path.insert(0, str(ROOT / "03_数据与证据"))

from runtime_instance_graph import (  # noqa: E402
    AUDIT_REASONING_LISTS,
    compact_reasoning_audit,
    compact_stage03_manifest,
    write_yaml,
)
from validator_utils import load_yaml_text  # noqa: E402


RUNS = [
    "示例2",
    "示例2-基线-20260710-1",
    "示例1",
    "示例1-基线-20260713-1",
]


def _find_one(run_dir: Path, pattern: str) -> Path | None:
    matches = sorted(run_dir.glob(pattern))
    return matches[0] if matches else None


def migrate_run(run_name: str) -> None:
    run_dir = ROOT / run_name
    audit_path = _find_one(run_dir, "04-*推理审计-*.yaml")
    manifest_path = _find_one(run_dir, "03-*语义域与证据域实例清单-*.yaml")
    snapshot_dir = None
    for child in sorted(run_dir.iterdir()):
        if child.is_dir() and child.name.startswith("03-") and "快照" in child.name:
            snapshot_dir = child
            break
    if audit_path is None or manifest_path is None or snapshot_dir is None:
        raise SystemExit(f"{run_name} 缺少 03/04 产物")

    audit = load_yaml_text(audit_path.read_text(encoding="utf-8-sig"), str(audit_path))
    if "business_instance_graph" not in audit:
        # load_yaml_text 不物化；若已是列表权威则压缩
        compacted = compact_reasoning_audit(audit)
    else:
        # 已含图但可能仍双写
        for section in AUDIT_REASONING_LISTS:
            audit.pop(section, None)
        compacted = compact_reasoning_audit(audit)
    write_yaml(audit_path, compacted)

    manifest = load_yaml_text(manifest_path.read_text(encoding="utf-8-sig"), str(manifest_path))
    compacted_manifest = compact_stage03_manifest(manifest, snapshot_dir)
    write_yaml(manifest_path, compacted_manifest)
    print(f"MIGRATED {run_name}: {audit_path.name} + {manifest_path.name}")


def main() -> int:
    targets = sys.argv[1:] or RUNS
    for name in targets:
        migrate_run(name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
