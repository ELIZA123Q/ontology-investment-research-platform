#!/usr/bin/env python3
"""权威状态字段及其唯一派生规则。

人工产物只维护 stage_status、quality_status、evidence_grade、
judgment_level、path_readiness_status 与 path_result_status。
01 另维护 task_disposition（accepted / needs_clarification /
out_of_scope / split_required），只表达任务处置结果，不得写入
stage_status。

- path_readiness_status（03）：路径是否具备推理条件
- path_result_status（04）：路径推理的业务结果

反证结果由证据明细归一化。唯一派生矩阵只使用
evidence_grade × counterevidence_result × path_readiness_status，
不得使用 path_result_status，否则会形成“先用路径结果算最大 J、
但路径结果又要靠 04 才能得到”的循环。其余限制字段只能由本模块
计算，不能作为独立输入。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from itertools import product
from pathlib import Path
import re
from typing import Any, Iterable, Mapping

import yaml


_REASONING_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "一级通用本体规范" / "reasoning.yaml"
_REASONING_SCHEMA = yaml.safe_load(_REASONING_SCHEMA_PATH.read_text(encoding="utf-8"))
_THRESHOLD_POLICY = _REASONING_SCHEMA["rules"]["judgment_evidence_threshold"]["parameters"]

STAGE_STATUSES = {"not_started", "in_progress", "complete", "blocked", "returned"}
TASK_DISPOSITIONS = {
    "accepted",
    "needs_clarification",
    "out_of_scope",
    "split_required",
}
EVIDENCE_GRADES = set(_THRESHOLD_POLICY["evidence_grade_caps"])
JUDGMENT_LEVELS = set(_THRESHOLD_POLICY["level_outputs"])
PATH_READINESS_STATUSES = set(_THRESHOLD_POLICY["path_readiness_caps"])
PATH_RESULT_STATUSES = {
    "established",
    "partially_established",
    "weakened",
    "blocked",
    "insufficient_evidence",
    "contested",
    "not_applicable",
}
COUNTEREVIDENCE_RESULTS = set(_THRESHOLD_POLICY["counterevidence_caps"])

DERIVED_LIMIT_FIELDS = {
    "evidence_permission",
    "allowed_04_output",
    "maximum_judgment_level",
    "publishable",
}

# 已废弃并行限制字段；出现即拒绝，不再做兼容映射。
RETIRED_PARALLEL_FIELDS = {
    "admission",
    "admission_status",
    "claim_mode",
    "judgment_status",
    "reasoning_readiness",
    "path_gate_status",
    "path_status",
}

# 已废弃的 03 包级证据准入状态；后续能力只由 stage_status + Q/反证/path_readiness 决定。
RETIRED_PACKAGE_ADMISSION_STATUSES = {
    "normal_pass",
    "restricted_pass",
    "incomplete_pass",
}

FORBIDDEN_MANUAL_LIMIT_FIELDS = DERIVED_LIMIT_FIELDS | RETIRED_PARALLEL_FIELDS

_GRADE_CAP = {str(key): str(value) for key, value in _THRESHOLD_POLICY["evidence_grade_caps"].items()}
_COUNTEREVIDENCE_CAP = {str(key): str(value) for key, value in _THRESHOLD_POLICY["counterevidence_caps"].items()}
_PATH_READINESS_CAP = {str(key): str(value) for key, value in _THRESHOLD_POLICY["path_readiness_caps"].items()}
_LEVEL_OUTPUT = {
    str(level): (
        str(values["evidence_permission"]),
        str(values["allowed_04_output"]),
        str(values["allowed_expression"]),
    )
    for level, values in _THRESHOLD_POLICY["level_outputs"].items()
}


def _rank(level: str) -> int:
    return int(level[1])


@dataclass(frozen=True)
class DerivedConstraint:
    maximum_judgment_level: str
    evidence_permission: str
    allowed_04_output: str
    allowed_expression: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


def canonical_evidence_grade(value: Any) -> str:
    """Return the canonical Q0—Q4 code; retired aliases are rejected."""
    text = str(value).strip()
    if text not in EVIDENCE_GRADES:
        raise ValueError(f"evidence_grade 非法: {value}")
    return text


def canonical_path_readiness_status(value: Any) -> str:
    """Return ready/restricted/blocked/not_applicable; retired aliases are rejected."""
    text = str(value).strip()
    if text not in PATH_READINESS_STATUSES:
        raise ValueError(f"path_readiness_status 非法: {value}")
    return text


def evidence_profile_quality_floor(profile_id: str) -> str:
    """从二级 EvidenceProfile 实例派生质量下限；画像实例是权威源。"""
    profile_path = Path(__file__).resolve().parent.parent / "二级半导体领域本体规范" / "business_instances.yaml"
    document = yaml.safe_load(profile_path.read_text(encoding="utf-8"))
    graph = document.get("business_instance_graph") or {}
    for item in graph.get("objects") or []:
        if item.get("type") != "EvidenceProfile" or str(item.get("id")) != str(profile_id):
            continue
        props = item.get("properties") or {}
        explicit = str(props.get("quality_floor") or props.get("minimum_quality_level") or "").strip()
        if explicit in EVIDENCE_GRADES:
            return explicit
        requirements = props.get("minimum_requirements") or []
        if isinstance(requirements, list) and len(requirements) >= 3:
            return "Q3"
        return "Q2"
    raise ValueError(f"未找到 EvidenceProfile 实例: {profile_id}")


def canonical_path_result_status(value: Any) -> str:
    """Return 04 path reasoning result status."""
    text = str(value).strip()
    if text not in PATH_RESULT_STATUSES:
        raise ValueError(f"path_result_status 非法: {value}")
    return text


def normalize_counterevidence_result(value: Any) -> str:
    """Normalize machine observations; this result is never a manual authority field."""
    text = str(value).strip().lower()
    aliases = {
        "checked_clear": "cleared",
        "checked": "cleared",
        "met": "cleared",
        "covered": "cleared",
        "no_material_conflict": "cleared",
        "checked_weakened": "weakened",
        "partial": "weakened",
        "material_counterevidence": "weakened",
        "material_conflict": "contested",
        "unresolved_conflict": "contested",
        "blocked": "decisive",
        "decisive_counterevidence": "decisive",
        "missing": "not_checked",
        "not_checked": "not_checked",
        "not_applicable": "not_applicable",
    }
    normalized = aliases.get(text, text)
    if normalized not in COUNTEREVIDENCE_RESULTS:
        raise ValueError(f"反证归一化结果非法: {value}")
    return normalized


def effective_path_readiness_status(values: Iterable[Any]) -> str:
    """Collapse linked paths once, using blocked > restricted > ready."""
    statuses = set()
    for value in values:
        text = str(value).strip()
        if not text:
            continue
        statuses.add(canonical_path_readiness_status(text))
    if not statuses:
        return "not_applicable"
    if "blocked" in statuses:
        return "blocked"
    if "restricted" in statuses:
        return "restricted"
    if "ready" in statuses:
        return "ready"
    return "not_applicable"


def derive_constraint(
    evidence_grade: Any,
    counterevidence_result: Any,
    path_readiness_status: Any,
) -> DerivedConstraint:
    """The only Q × counterevidence × path_readiness → J/expression mapping."""
    grade = canonical_evidence_grade(evidence_grade)
    counter = normalize_counterevidence_result(counterevidence_result)
    path = canonical_path_readiness_status(path_readiness_status)
    maximum = min(
        (_GRADE_CAP[grade], _COUNTEREVIDENCE_CAP[counter], _PATH_READINESS_CAP[path]),
        key=_rank,
    )
    permission, output, expression = _LEVEL_OUTPUT[maximum]
    return DerivedConstraint(maximum, permission, output, expression)


# 展开后的 120 个组合只在内存中生成；仓库不再维护第二张手工矩阵。
DERIVATION_MATRIX = {
    (grade, counter, path): derive_constraint(grade, counter, path)
    for grade, counter, path in product(
        sorted(EVIDENCE_GRADES),
        sorted(COUNTEREVIDENCE_RESULTS),
        sorted(PATH_READINESS_STATUSES),
    )
}


RETIRED_PACKAGE_ADMISSION_TERMS = (
    "normal_pass",
    "restricted_pass",
    "incomplete_pass",
    "admission_status",
)


def reject_legacy_package_admission(text: Any, label: str) -> None:
    """Reject retired package-level admission vocabulary in authored prose/meta."""
    body = str(text or "")
    hits = [term for term in RETIRED_PACKAGE_ADMISSION_TERMS if term in body]
    hits.extend(token for token in RETIRED_PACKAGE_ADMISSION_STATUSES if token in body)
    if re.search(r"(?m)^\s*admission\s*:", body):
        hits.append("admission")
    if "整体准入状态" in body:
        hits.append("整体准入状态")
    if hits:
        raise ValueError(
            f"{label} 不得再使用已废弃的包级证据准入状态 "
            f"{', '.join(sorted(set(hits)))}；请改用 stage_status + evidence_grade + path_readiness_status"
        )


def reject_manual_derived_fields(data: Any, label: str) -> None:
    """Reject derived and retired parallel fields anywhere in an authored object."""
    found: list[str] = []

    def visit(value: Any, path: str) -> None:
        if isinstance(value, Mapping):
            for key, item in value.items():
                key_text = str(key)
                child = f"{path}.{key_text}"
                if key_text in FORBIDDEN_MANUAL_LIMIT_FIELDS:
                    found.append(child)
                visit(item, child)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{path}[{index}]")

    visit(data, label)
    if found:
        raise ValueError("不得人工填写派生或废弃的并行限制字段: " + ", ".join(found))


def _self_test() -> None:
    assert len(DERIVATION_MATRIX) == 120
    assert derive_constraint("Q4", "cleared", "ready").maximum_judgment_level == "J4"
    assert derive_constraint("Q4", "weakened", "ready").maximum_judgment_level == "J2"
    assert derive_constraint("Q4", "contested", "ready").maximum_judgment_level == "J1"
    assert derive_constraint("Q4", "cleared", "blocked").maximum_judgment_level == "J0"
    assert derive_constraint("Q2", "cleared", "ready").allowed_04_output == "conditional_only"
    assert effective_path_readiness_status(["ready", "restricted"]) == "restricted"
    assert canonical_path_result_status("partially_established") == "partially_established"
    try:
        canonical_path_readiness_status("active")
    except ValueError:
        pass
    else:  # pragma: no cover - executable contract
        raise AssertionError("retired path readiness alias 必须被拒绝")
    try:
        reject_manual_derived_fields({"nested": {"path_status": "ready"}}, "fixture")
    except ValueError:
        pass
    else:  # pragma: no cover - executable contract
        raise AssertionError("废弃 path_status 必须被递归拒绝")
    try:
        reject_manual_derived_fields({"nested": {"claim_mode": "conditional"}}, "fixture")
    except ValueError:
        pass
    else:  # pragma: no cover - executable contract
        raise AssertionError("并行字段必须被递归拒绝")
    try:
        reject_legacy_package_admission("整体准入状态 restricted_pass", "fixture")
    except ValueError:
        pass
    else:  # pragma: no cover - executable contract
        raise AssertionError("包级准入状态必须被拒绝")


if __name__ == "__main__":
    _self_test()
    print("STATUS_DERIVATION_PASS: 120 个组合与关键边界校验通过。")
