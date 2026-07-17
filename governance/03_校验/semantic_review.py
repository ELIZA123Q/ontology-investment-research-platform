#!/usr/bin/env python3
"""独立语义审查合同与输入哈希校验。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from validator_utils import load_yaml_file


SCHEMA_NAME = "independent_semantic_review"
SCHEMA_VERSION = "1.0.0"
CHECKS = {
    "local_evidence_not_globalized",
    "parent_aggregation_complete",
    "incremental_update_is_local_first",
    "title_represents_major_scopes",
    "conditions_scope_and_prohibitions_preserved",
}
RESULTS = {"pass", "fail", "needs_human"}


def validate_independent_semantic_review(
    path: str | Path,
    *,
    stage_hashes: Mapping[str, str],
    contract_version: str,
    run_mode: str,
    producer_id: str,
) -> dict[str, Any]:
    data = load_yaml_file(Path(path))
    if not isinstance(data, dict):
        raise ValueError("independent_semantic_review 必须是 YAML 对象")
    if data.get("schema_name") != SCHEMA_NAME or str(data.get("schema_version")) != SCHEMA_VERSION:
        raise ValueError(f"独立语义审查必须使用 {SCHEMA_NAME}/{SCHEMA_VERSION}")
    reviewer = data.get("reviewer")
    inputs = data.get("inputs")
    checks = data.get("checks")
    if not isinstance(reviewer, dict) or not isinstance(inputs, dict) or not isinstance(checks, list):
        raise ValueError("独立语义审查缺少 reviewer/inputs/checks")
    reviewer_id = str(reviewer.get("reviewer_id", "")).strip()
    reviewer_type = str(reviewer.get("reviewer_type", "")).strip()
    if not reviewer_id or reviewer_type not in {"model", "human", "test_fixture"}:
        raise ValueError("独立语义审查 reviewer_id/reviewer_type 非法")
    if reviewer_id == producer_id or reviewer.get("independent_from_producer") is not True:
        raise ValueError("生产者不得自审，reviewer 必须独立")
    if run_mode == "production" and (reviewer_type == "test_fixture" or reviewer.get("test_reviewer") is True):
        raise ValueError("生产模式禁止测试 reviewer")
    expected_hashes = {stage: stage_hashes[stage] for stage in ["stage_02", "stage_03", "stage_04", "stage_05"]}
    if inputs.get("stage_hashes") != expected_hashes:
        raise ValueError("独立语义审查输入哈希与冻结后的 02—05 内容不一致")
    if str(inputs.get("public_contract_version", "")) != contract_version:
        raise ValueError("独立语义审查公共合同版本过期")
    by_id: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(checks, 1):
        if not isinstance(item, dict):
            raise ValueError(f"independent_semantic_review.checks[{index}] 必须是对象")
        check_id = str(item.get("check_id", "")).strip()
        result = str(item.get("result", "")).strip()
        if check_id not in CHECKS or check_id in by_id or result not in RESULTS:
            raise ValueError(f"independent_semantic_review.checks[{index}] ID/result 非法或重复")
        if not str(item.get("reason", "")).strip():
            raise ValueError(f"independent_semantic_review.checks[{index}].reason 不得为空")
        if result != "pass" and str(item.get("return_to_stage", "")) not in {"02", "03", "04", "05"}:
            raise ValueError(f"independent_semantic_review.checks[{index}] 未通过时必须指定 return_to_stage")
        by_id[check_id] = item
    if set(by_id) != CHECKS:
        raise ValueError("独立语义审查必须完整覆盖五项固定审查")
    derived = "pass"
    if any(item["result"] == "fail" for item in by_id.values()):
        derived = "fail"
    elif any(item["result"] == "needs_human" for item in by_id.values()):
        derived = "needs_human"
    if str(data.get("verdict", "")) != derived:
        raise ValueError(f"独立语义审查 verdict 应由检查项派生为 {derived}")
    return {"verdict": derived, "reviewer_id": reviewer_id, "reviewer_type": reviewer_type}
