#!/usr/bin/env python3
"""一次性刷新两套已冻结样例的阶段哈希与独立审查绑定。"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "运行校验"))

from research_contract import current_versions  # noqa: E402
from validate_publish import discover_artifacts  # noqa: E402
from validate_run import IMMEDIATE_UPSTREAM, STAGES, _stage_hash, _stage_paths  # noqa: E402


def refresh(run_dir: Path) -> None:
    artifacts = discover_artifacts(run_dir)
    paths = _stage_paths(artifacts)
    hashes = {stage: _stage_hash(paths[stage], run_dir) for stage in STAGES}
    review_path = artifacts.semantic_review
    if review_path:
        review = yaml.safe_load(review_path.read_text(encoding="utf-8"))
        review.setdefault("inputs", {})["public_contract_version"] = current_versions()["contract"]
        review["inputs"]["stage_hashes"] = {
            stage: hashes[stage] for stage in ("stage_02", "stage_03", "stage_04", "stage_05")
        }
        review_path.write_text(
            yaml.safe_dump(review, allow_unicode=True, sort_keys=False, width=120),
            encoding="utf-8",
        )

    manifest_path = run_dir / "run_manifest.yaml"
    manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    manifest["versions"] = current_versions()
    for stage in STAGES:
        manifest["stages"][stage]["hash"] = hashes[stage]
        upstream = IMMEDIATE_UPSTREAM[stage]
        manifest["stages"][stage]["source_hashes"] = {upstream: hashes[upstream]} if upstream else {}
        manifest["stages"][stage]["validity_status"] = "current"
    manifest["validation_issues"] = []
    manifest_path.write_text(
        yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False, width=120),
        encoding="utf-8",
    )


if __name__ == "__main__":
    for name in ("示例1", "示例2"):
        refresh(ROOT / name)
