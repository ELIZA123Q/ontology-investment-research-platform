#!/usr/bin/env python3
"""Full-chain publish validator for the 01-05 research pipeline.

Enforces stage order, cross-stage reference integrity, downstream gate rules,
and per-stage contract validation. Produces PUBLISHABLE or RETURN_REQUIRED.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

from snapshot_layout_03 import SNAPSHOT_CSV_LAYOUT
from validator_utils import (
    error_payload,
    fail,
    file_name,
    load_yaml_file,
    parse_markdown,
    parse_triplet,
    read_csv,
    same_ref,
)

from validate_01_outputs import validate as validate_01
from validate_02_outputs import validate as validate_02
from validate_03_outputs import validate as validate_03
from validate_04_outputs import validate as validate_04
from validate_05_outputs import ARCHETYPE_NAME_MAP, validate as validate_05


STAGE_ORDER = ("01", "02", "03", "04", "05")
RETURN_STAGES = {"01", "02", "03", "04", "05"}
BLOCKING_QUALITY_STATUSES = {"return_required", "stop_with_gap_report"}
PUBLISH_QUALITY = "high_quality_pass"
DIRECTIONAL_CONCLUSIONS = {"confirmed", "directional"}
MATERIAL_READY_STATUSES = {"report_grade_ready", "ready", "usable_with_caveat"}


@dataclass(frozen=True)
class ErrorRoute:
    pattern: re.Pattern[str]
    return_to: str
    rule_id: str
    fix_hint: str


RETURN_ACTION_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?:return(?:_to)?|退回)[_\s-]*01", re.I), "01"),
    (re.compile(r"(?:return(?:_to)?|退回)[_\s-]*02", re.I), "02"),
    (re.compile(r"(?:return(?:_to)?|退回)[_\s-]*03", re.I), "03"),
    (re.compile(r"(?:return(?:_to)?|退回)[_\s-]*04", re.I), "04"),
    (re.compile(r"(?:return(?:_to)?|退回)[_\s-]*05", re.I), "05"),
    (re.compile(r"重写\s*04|rewrite[_\s-]*04", re.I), "04"),
    (re.compile(r"重写\s*05|rewrite[_\s-]*05", re.I), "05"),
]

VALIDATOR_ERROR_ROUTES: dict[str, list[ErrorRoute]] = {
    "02": [
        ErrorRoute(re.compile(r"source_document|01\.|投研需求说明|ready_for_matching"), "01", "02.validator.upstream_01", "先修正 01 需求说明，再重建 02"),
        ErrorRoute(re.compile(r"judgment_spine|minimum_question_tree|validation\.checks|state_variable_chain"), "02", "02.validator.structure", "补齐核心判断、问题树、路径或状态变量链"),
        ErrorRoute(re.compile(r"handoff_to_03|evidence_requirements|instance_requirements"), "02", "02.validator.handoff", "补齐 03 可执行的实例与证据需求"),
    ],
    "03": [
        ErrorRoute(re.compile(r"source_02|logic_id|view_id|研究逻辑|本体视图"), "02", "03.validator.upstream_02", "02 结构或引用断裂，退回重建判断结构"),
        ErrorRoute(re.compile(r"judgment_unit|path_readiness|state_variable|evidence_requirements"), "02", "03.validator.structure", "判断单元/路径/状态变量与 02 不一致"),
        ErrorRoute(re.compile(r"反证|counter_check|conflict_status"), "03", "03.validator.counter_evidence", "补反证检查或处理证据冲突"),
        ErrorRoute(re.compile(r"口径|source_tier|proxy|证据角色"), "03", "03.validator.evidence_quality", "补证据、修口径或降级准入"),
    ],
    "04": [
        ErrorRoute(re.compile(r"超过.*03.*使用上限|超过 readiness|readiness assessment|allowed_04_output|evidence_readiness"), "03", "04.validator.evidence_ceiling", "观点超过 03 证据上限，退回 03 补证据或降级"),
        ErrorRoute(re.compile(r"claim_register|overreach_check|claims_within_03"), "03", "04.validator.claim_overreach", "退回 03 调整 evidence_readiness 或降低观点强度"),
        ErrorRoute(re.compile(r"path_results|state_variable_results|ontology_context|judgment_unit"), "02", "04.validator.structure", "核心判断、路径或本体承接不足，退回 02"),
        ErrorRoute(re.compile(r"source_01|scope|研究范围|问题偷换"), "01", "04.validator.scope", "研究问题、用途或范围不清，退回 01"),
        ErrorRoute(re.compile(r"handoff_to_05|report_quality_check|表达|answer_first"), "04", "04.validator.expression", "在 04 重写报告或 handoff，不放大判断"),
    ],
    "05": [
        ErrorRoute(re.compile(r"图表|表格|数据密度|display_data|chart_data|table_material|05_material"), "03", "05.validator.material_data", "05 图表数据不足，退回 03 补 display/chart/table 素材"),
        ErrorRoute(re.compile(r"handoff|approved_core_claims|expression_strength|core_thesis|预期差|object_strength|claim"), "04", "05.validator.handoff", "05 表达超过 04 审计边界，退回 04 调整 handoff/claim"),
        ErrorRoute(re.compile(r"delivery_archetype|输出原型|target_05_archetype|01"), "01", "05.validator.archetype", "报告原型与 01 不一致，退回 01 确认"),
        ErrorRoute(re.compile(r"引用不存在|figure_id|table_id|data_candidate"), "03", "05.validator.missing_data_ref", "05 引用的数据候选在 03 快照中不存在"),
        ErrorRoute(re.compile(r"限制性表达|正文不得|标题应是"), "05", "05.validator.expression", "在 05 重写正文表达"),
    ],
}

DEFAULT_VALIDATOR_HINTS: dict[str, str] = {
    "01": "修正需求说明后重新校验",
    "02": "修正研究逻辑与本体视图后重新校验",
    "03": "补证据、修口径或更新准入后重新冻结快照",
    "04": "在证据边界内重写推理报告与审计",
    "05": "按 04 handoff 重写研报正文，不新增判断",
}


@dataclass
class RunArtifacts:
    run_dir: Path
    requirement: Path | None = None
    logic: Path | None = None
    view: Path | None = None
    preparation: Path | None = None
    snapshot_dir: Path | None = None
    report: Path | None = None
    audit: Path | None = None
    delivery: Path | None = None

    def triplet(self) -> tuple[str, str, str] | None:
        if self.requirement is not None:
            return parse_triplet(self.requirement, "投研需求说明", "01")
        if self.logic is not None:
            return parse_triplet(self.logic, "研究逻辑", "02")
        if self.preparation is not None:
            return parse_triplet(self.preparation, "数据与证据准备", "03")
        if self.report is not None:
            return parse_triplet(self.report, "推理报告", "04")
        if self.delivery is not None:
            for kind in ARCHETYPE_NAME_MAP:
                try:
                    return parse_triplet(self.delivery, kind, "05")
                except Exception:
                    continue
        return None


@dataclass
class StageResult:
    stage: str
    status: str
    validator_ok: bool = False
    quality_status: str | None = None
    errors: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class ReworkItem:
    rule_id: str
    message: str
    return_to: str
    affected_stage: str
    fix_hint: str = ""


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y"}


def _nullish(value: Any) -> bool:
    return value is None or str(value).strip().lower() in {"", "null", "none"}


def _normalize_return_stage(value: Any) -> str | None:
    if _nullish(value):
        return None
    stage = str(value).strip()
    if stage not in RETURN_STAGES:
        fail(f"return_stage 非法: {stage}")
    return stage


def _parse_return_action(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    for pattern, stage in RETURN_ACTION_PATTERNS:
        if pattern.search(text):
            return stage
    return None


def _route_validator_error(stage: str, error: str) -> tuple[str, str, str]:
    for route in VALIDATOR_ERROR_ROUTES.get(stage, []):
        if route.pattern.search(error):
            return route.return_to, route.rule_id, route.fix_hint
    return stage, f"{stage}.validator", DEFAULT_VALIDATOR_HINTS.get(stage, "修正后重新运行本阶段校验，再进入下游")


def _snapshot_csv(snapshot_dir: Path, logical_name: str) -> list[dict[str, str]]:
    return read_csv(snapshot_dir / SNAPSHOT_CSV_LAYOUT[logical_name])


def _read_manifest_row(snapshot_dir: Path) -> dict[str, str]:
    rows = _snapshot_csv(snapshot_dir, "manifest.csv")
    if len(rows) != 1:
        fail(f"{snapshot_dir.name}/manifest.csv 必须且只能有一行")
    return rows[0]


def _enforce_return_metadata(
    items: list[ReworkItem],
    *,
    label: str,
    return_required: Any,
    return_stage: Any,
    affected_stage: str,
    default_return_to: str | None = None,
) -> list[str]:
    errors: list[str] = []
    if _truthy(return_required) and _normalize_return_stage(return_stage) is None:
        message = f"{label} return_required=true 时必须填写 return_stage"
        errors.append(message)
        _append_rework(
            items,
            rule_id=f"{label}.return_stage_missing",
            message=message,
            return_to=default_return_to or affected_stage,
            affected_stage=affected_stage,
            fix_hint="在产物元数据中写明应退回哪个阶段",
        )
    return errors


def _summarize_rework(items: list[ReworkItem]) -> dict[str, list[str]]:
    summary: dict[str, list[str]] = {stage: [] for stage in STAGE_ORDER}
    for item in items:
        summary.setdefault(item.return_to, []).append(item.message)
    return {stage: messages for stage, messages in summary.items() if messages}


def _pick_optional(matches: list[Path], label: str, run_dir: Path) -> Path | None:
    files = sorted({path.resolve() for path in matches if path.is_file()})
    if not files:
        return None
    if len(files) > 1:
        names = ", ".join(path.name for path in files)
        fail(f"{run_dir} 中存在多个 {label}: {names}")
    return files[0]


def _pick_optional_dir(matches: list[Path], label: str, run_dir: Path) -> Path | None:
    dirs = sorted({path.resolve() for path in matches if path.is_dir()})
    if not dirs:
        return None
    if len(dirs) > 1:
        names = ", ".join(path.name for path in dirs)
        fail(f"{run_dir} 中存在多个 {label}: {names}")
    return dirs[0]


def discover_artifacts(run_dir: str | Path) -> RunArtifacts:
    run_dir = Path(run_dir).resolve()
    if not run_dir.is_dir():
        fail(f"{run_dir} 不是目录")

    requirement = _pick_optional(list(run_dir.glob("01-*投研需求说明-*.md")), "01 投研需求说明", run_dir)
    logic = _pick_optional(list(run_dir.glob("02-*研究逻辑-*.md")), "02 研究逻辑", run_dir)
    view = _pick_optional(list(run_dir.glob("02-*本体视图-*.yaml")), "02 本体视图", run_dir)
    preparation = _pick_optional(list(run_dir.glob("03-*数据与证据准备-*.md")), "03 数据与证据准备", run_dir)

    snapshot_matches = [
        path
        for path in run_dir.glob("03-*数据与证据快照-*")
        if path.is_dir() and not path.name.endswith(".__migrate_tmp")
    ]
    snapshot_dir = _pick_optional_dir(snapshot_matches, "03 数据与证据快照目录", run_dir)
    report = _pick_optional(list(run_dir.glob("04-*推理报告-*.md")), "04 推理报告", run_dir)
    audit = _pick_optional(list(run_dir.glob("04-*推理审计-*.yaml")), "04 推理审计", run_dir)

    delivery_matches: list[Path] = []
    for kind in ARCHETYPE_NAME_MAP:
        delivery_matches.extend(run_dir.glob(f"05-*{kind}-*.md"))
    delivery = _pick_optional(delivery_matches, "05 研报正文", run_dir)

    return RunArtifacts(
        run_dir=run_dir,
        requirement=requirement,
        logic=logic,
        view=view,
        preparation=preparation,
        snapshot_dir=snapshot_dir,
        report=report,
        audit=audit,
        delivery=delivery,
    )


def _stage_index(stage: str) -> int:
    return STAGE_ORDER.index(stage)


def _blocked_result(stage: str, reason: str) -> StageResult:
    return StageResult(stage=stage, status="blocked", errors=[reason])


def _missing_result(stage: str) -> StageResult:
    return StageResult(stage=stage, status="missing", errors=[f"{stage} 产物缺失，无法继续全链校验"])


def _record_stage_failures(items: list[ReworkItem], stage: str, errors: list[str], *, return_to: str | None = None) -> None:
    for error in errors:
        routed_to, rule_id, fix_hint = _route_validator_error(stage, error)
        target = return_to or routed_to
        _append_rework(
            items,
            rule_id=rule_id,
            message=error,
            return_to=target,
            affected_stage=stage,
            fix_hint=fix_hint,
        )


def _run_validator(stage: str, fn: Callable[[], dict[str, object]]) -> StageResult:
    try:
        details = fn()
        quality_status = str(details.get("quality_status", "")) or None
        return StageResult(
            stage=stage,
            status="pass",
            validator_ok=True,
            quality_status=quality_status,
            details=details,
        )
    except Exception as exc:
        return StageResult(stage=stage, status="fail", errors=[str(exc)])


def _append_rework(
    items: list[ReworkItem],
    *,
    rule_id: str,
    message: str,
    return_to: str,
    affected_stage: str,
    fix_hint: str = "",
) -> None:
    items.append(
        ReworkItem(
            rule_id=rule_id,
            message=message,
            return_to=return_to,
            affected_stage=affected_stage,
            fix_hint=fix_hint,
        )
    )


def _check_return_block(
    items: list[ReworkItem],
    *,
    stage: str,
    quality_status: str | None,
    return_required: Any,
    return_stage: Any,
    return_reason: str = "",
) -> list[str]:
    errors: list[str] = []
    if quality_status in BLOCKING_QUALITY_STATUSES:
        target = _normalize_return_stage(return_stage) or stage
        message = return_reason or f"{stage} quality_status={quality_status}，不得进入下游"
        errors.append(message)
        _append_rework(
            items,
            rule_id=f"{stage}.quality_status",
            message=message,
            return_to=target,
            affected_stage=stage,
            fix_hint="修正本阶段缺陷后重新运行确定性校验与语义审阅",
        )
    if _truthy(return_required):
        target = _normalize_return_stage(return_stage) or stage
        message = return_reason or f"{stage} return_required=true，不得进入下游"
        errors.append(message)
        _append_rework(
            items,
            rule_id=f"{stage}.return_required",
            message=message,
            return_to=target,
            affected_stage=stage,
            fix_hint="按 return_stage 退回对应阶段返工",
        )
        errors.extend(
            _enforce_return_metadata(
                items,
                label=stage,
                return_required=return_required,
                return_stage=return_stage,
                affected_stage=stage,
                default_return_to=target,
            )
        )
    return errors


def _require_triplet_match(
    items: list[ReworkItem],
    *,
    label: str,
    expected: tuple[str, str, str],
    actual: tuple[str, str, str],
    affected_stage: str,
) -> list[str]:
    if expected == actual:
        return []
    message = f"{label} 文件名三元组不一致: 期望 {expected}，实际 {actual}"
    _append_rework(
        items,
        rule_id="chain.triplet",
        message=message,
        return_to=affected_stage,
        affected_stage=affected_stage,
        fix_hint="同一运行的 01—05 产物必须使用相同核心主题、日期和当日序号",
    )
    return [message]


def _gate_01_to_02(artifacts: RunArtifacts, items: list[ReworkItem]) -> list[str]:
    assert artifacts.requirement is not None and artifacts.logic is not None and artifacts.view is not None
    errors: list[str] = []
    req_meta, _ = parse_markdown(artifacts.requirement)
    logic_meta, _ = parse_markdown(artifacts.logic)
    view = load_yaml_file(artifacts.view)
    task_context = view["task_context"]
    quality_control = view["quality_control"]

    if req_meta.get("status") != "ready_for_matching":
        errors.append("01 status 必须为 ready_for_matching 才能进入 02")
        _append_rework(items, rule_id="01.status", message=errors[-1], return_to="01", affected_stage="02")

    if not same_ref(logic_meta.get("source_document"), file_name(artifacts.requirement)):
        errors.append("02.source_document 必须指向当前 01 投研需求说明")
        _append_rework(items, rule_id="02.source_document", message=errors[-1], return_to="01", affected_stage="02")

    if not same_ref(task_context.get("source_document"), file_name(artifacts.requirement)):
        errors.append("02 本体视图 task_context.source_document 必须指向当前 01")
        _append_rework(items, rule_id="02.view.source_document", message=errors[-1], return_to="01", affected_stage="02")

    if not same_ref(logic_meta.get("task_id"), req_meta.get("task_id")):
        errors.append("02.task_id 必须与 01.task_id 一致")
        _append_rework(items, rule_id="02.task_id", message=errors[-1], return_to="01", affected_stage="02")

    if logic_meta.get("stage_status") == "returned_to_01":
        errors.append("02 stage_status=returned_to_01，应先退回 01 澄清后再继续")
        _append_rework(items, rule_id="02.stage_status", message=errors[-1], return_to="01", affected_stage="02")

    errors.extend(
        _check_return_block(
            items,
            stage="01",
            quality_status=str(req_meta.get("quality_status", "")),
            return_required=req_meta.get("return_required"),
            return_stage=req_meta.get("return_stage"),
        )
    )
    errors.extend(
        _check_return_block(
            items,
            stage="02",
            quality_status=str(logic_meta.get("quality_status", "")),
            return_required=logic_meta.get("return_required"),
            return_stage=logic_meta.get("return_stage"),
        )
    )
    errors.extend(
        _check_return_block(
            items,
            stage="02",
            quality_status=str(quality_control.get("quality_status", "")),
            return_required=quality_control.get("return_required"),
            return_stage=quality_control.get("return_stage"),
            return_reason="02 本体视图 quality_control 要求返工",
        )
    )
    if quality_control.get("stage_status") == "returned_to_01":
        errors.append("02 本体视图 stage_status=returned_to_01，应先退回 01")
        _append_rework(items, rule_id="02.view.stage_status", message=errors[-1], return_to="01", affected_stage="02")
    return errors


def _gate_02_to_03(artifacts: RunArtifacts, items: list[ReworkItem]) -> list[str]:
    assert artifacts.logic is not None and artifacts.view is not None and artifacts.preparation is not None
    errors: list[str] = []
    logic_meta, _ = parse_markdown(artifacts.logic)
    view = load_yaml_file(artifacts.view)
    prep_meta, _ = parse_markdown(artifacts.preparation)
    task_context = view["task_context"]

    if logic_meta.get("stage_status") != "aligned":
        errors.append("02 stage_status 必须为 aligned 才能进入 03")
        _append_rework(items, rule_id="02.stage_status", message=errors[-1], return_to="02", affected_stage="03")

    for label, actual, expected in [
        ("03.source_02_logic_ref", prep_meta.get("source_02_logic_ref"), file_name(artifacts.logic)),
        ("03.source_02_view_ref", prep_meta.get("source_02_view_ref"), file_name(artifacts.view)),
    ]:
        if not same_ref(actual, expected):
            errors.append(f"{label} 必须指向当前 02 配对产物")
            _append_rework(items, rule_id=label, message=errors[-1], return_to="02", affected_stage="03")

    if not same_ref(prep_meta.get("source_02_logic_id"), logic_meta.get("logic_id")):
        errors.append("03.source_02_logic_id 必须与 02.logic_id 一致")
        _append_rework(items, rule_id="03.source_02_logic_id", message=errors[-1], return_to="02", affected_stage="03")

    if not same_ref(prep_meta.get("source_02_view_id"), task_context.get("view_id")):
        errors.append("03.source_02_view_id 必须与 02.view_id 一致")
        _append_rework(items, rule_id="03.source_02_view_id", message=errors[-1], return_to="02", affected_stage="03")

    if not same_ref(prep_meta.get("task_id"), logic_meta.get("task_id")):
        errors.append("03.task_id 必须与 02/01 task_id 一致")
        _append_rework(items, rule_id="03.task_id", message=errors[-1], return_to="02", affected_stage="03")

    errors.extend(
        _check_return_block(
            items,
            stage="03",
            quality_status=str(prep_meta.get("quality_status", "")),
            return_required=prep_meta.get("return_required"),
            return_stage=prep_meta.get("return_stage"),
        )
    )

    errors.extend(
        _enforce_return_metadata(
            items,
            label="03.preparation",
            return_required=prep_meta.get("return_required"),
            return_stage=prep_meta.get("return_stage"),
            affected_stage="03",
            default_return_to="02",
        )
    )
    return errors


def _gate_03_snapshot_semantic(artifacts: RunArtifacts, items: list[ReworkItem]) -> list[str]:
    assert artifacts.preparation is not None and artifacts.snapshot_dir is not None
    errors: list[str] = []
    prep_meta, _ = parse_markdown(artifacts.preparation)
    manifest = _read_manifest_row(artifacts.snapshot_dir)

    for label, left, right in [
        ("manifest.return_required", manifest.get("return_required"), prep_meta.get("return_required")),
        ("manifest.return_stage", manifest.get("return_stage"), prep_meta.get("return_stage")),
        ("manifest.admission", manifest.get("admission"), prep_meta.get("admission")),
        ("manifest.task_id", manifest.get("task_id"), prep_meta.get("task_id")),
        ("manifest.execution_id", manifest.get("execution_id"), prep_meta.get("execution_id")),
    ]:
        if not same_ref(left, right):
            errors.append(f"03 快照 manifest 与准备文档不一致: {label}")
            _append_rework(
                items,
                rule_id="03.manifest.sync",
                message=errors[-1],
                return_to="03",
                affected_stage="03",
                fix_hint="重新冻结快照，确保 manifest 与准备文档一致",
            )

    errors.extend(
        _check_return_block(
            items,
            stage="03",
            quality_status=str(manifest.get("quality_status", "")),
            return_required=manifest.get("return_required"),
            return_stage=manifest.get("return_stage"),
            return_reason="03 快照 manifest 要求返工",
        )
    )
    errors.extend(
        _enforce_return_metadata(
            items,
            label="03.manifest",
            return_required=manifest.get("return_required"),
            return_stage=manifest.get("return_stage"),
            affected_stage="03",
            default_return_to="02",
        )
    )

    try:
        gap_rows = _snapshot_csv(artifacts.snapshot_dir, "gaps_and_risks.csv")
    except Exception:
        gap_rows = []

    for row in gap_rows:
        return_action = row.get("return_action", "")
        return_target = _parse_return_action(return_action)
        blocks = str(row.get("blocks_04_output", "")).strip().lower() in {"1", "true", "yes", "y"}
        gap_type = str(row.get("gap_type", "")).strip()
        if return_target and (blocks or gap_type in {"structure", "scope", "judgment_structure"}):
            message = f"03 缺口 {row.get('gap_id', '?')} 要求退回 {return_target}: {row.get('description', return_action)}"
            errors.append(message)
            _append_rework(
                items,
                rule_id=f"03.gap.{row.get('gap_id', 'unknown')}",
                message=message,
                return_to=return_target,
                affected_stage="03",
                fix_hint=str(row.get("suggested_next_step", "") or "按缺口说明补齐后再进入下游"),
            )
    return errors


def _gate_04_admission_ceiling(artifacts: RunArtifacts, items: list[ReworkItem]) -> list[str]:
    assert artifacts.preparation is not None and artifacts.report is not None and artifacts.audit is not None
    errors: list[str] = []
    prep_meta, _ = parse_markdown(artifacts.preparation)
    report_meta, _ = parse_markdown(artifacts.report)
    audit = load_yaml_file(artifacts.audit)
    admission = str(prep_meta.get("admission", ""))
    conclusion_level = str(report_meta.get("conclusion_level", ""))
    handoff = audit.get("handoff_to_05", {}) if isinstance(audit.get("handoff_to_05"), dict) else {}

    if admission == "incomplete_pass":
        if conclusion_level in DIRECTIONAL_CONCLUSIONS:
            message = "03 为 incomplete_pass，但 04 conclusion_level 仍为方向性判断"
            errors.append(message)
            _append_rework(
                items,
                rule_id="04.incomplete_pass_overreach",
                message=message,
                return_to="04",
                affected_stage="04",
                fix_hint="将 04 降级为暂不可判断/缺口说明，或退回 03 补证据",
            )
        elif handoff.get("output_ceiling") not in {None, "", "gap_report_only", "limited_report"}:
            message = "03 为 incomplete_pass，但 04 handoff output_ceiling 不允许仅缺口报告"
            errors.append(message)
            _append_rework(
                items,
                rule_id="04.incomplete_pass_handoff",
                message=message,
                return_to="04",
                affected_stage="04",
                fix_hint="调整 handoff_to_05.output_ceiling 为 gap_report_only 或 limited_report",
            )

    if admission == "failed":
        if conclusion_level in DIRECTIONAL_CONCLUSIONS:
            message = "03 admission=failed，04 不得输出方向性 conclusion_level"
            errors.append(message)
            _append_rework(
                items,
                rule_id="04.failed_admission_overreach",
                message=message,
                return_to="03",
                affected_stage="04",
                fix_hint="退回 03 补关键证据，或 04 只输出失败/缺口说明",
            )
    return errors


def _gate_04_audit_semantic(artifacts: RunArtifacts, items: list[ReworkItem]) -> list[str]:
    assert artifacts.audit is not None
    errors: list[str] = []
    audit = load_yaml_file(artifacts.audit)

    quality_check = audit.get("report_quality_check", {})
    if isinstance(quality_check, dict):
        errors.extend(
            _check_return_block(
                items,
                stage="04",
                quality_status=str(quality_check.get("quality_status", "")) if quality_check.get("quality_status") else None,
                return_required=quality_check.get("return_required"),
                return_stage=quality_check.get("return_stage"),
                return_reason="04 report_quality_check 要求返工",
            )
        )
        if quality_check.get("result") == "fail":
            reasons = quality_check.get("return_reasons") or []
            reason_text = "; ".join(str(item) for item in reasons) if isinstance(reasons, list) else str(reasons)
            target = _parse_return_action(reason_text) or "04"
            message = reason_text or "04 report_quality_check.result=fail"
            errors.append(message)
            _append_rework(
                items,
                rule_id="04.report_quality_check.fail",
                message=message,
                return_to=target,
                affected_stage="04",
                fix_hint="按 report_quality_check.return_reasons 在 04 修订表达与结构",
            )
        bool_checks = {
            "claims_within_03_use_limits": ("03", "04.audit.claims_within_limits", "观点超过 03 证据门禁"),
            "claim_labels_match_evidence_strength": ("04", "04.audit.claim_labels", "观点标签与证据强度不一致"),
            "object_differentiation_clear": ("04", "04.audit.object_diff", "对象分化不足"),
            "change_gates_observable": ("04", "04.audit.change_gates", "改判闸门不可观察"),
        }
        for key, (return_to, rule_id, message) in bool_checks.items():
            if quality_check.get(key) is False:
                errors.append(message)
                _append_rework(items, rule_id=rule_id, message=message, return_to=return_to, affected_stage="04")

    compliance = audit.get("compliance_check", {})
    if isinstance(compliance, dict):
        if compliance.get("no_scope_drift") is False:
            message = "04 审计标记 no_scope_drift=false，研究范围相对 01 发生漂移"
            errors.append(message)
            _append_rework(items, rule_id="04.compliance.scope_drift", message=message, return_to="01", affected_stage="04")
        if compliance.get("no_new_unfrozen_evidence") is False:
            message = "04 使用了 03 未冻结的新证据"
            errors.append(message)
            _append_rework(items, rule_id="04.compliance.unfrozen_evidence", message=message, return_to="03", affected_stage="04")

    integrity = audit.get("input_integrity", {})
    if isinstance(integrity, dict):
        integrity_checks = {
            "scope_consistent": ("01", "04.integrity.scope", "04 输入范围与 01/02 不一致"),
            "no_new_path_or_rule_created": ("02", "04.integrity.new_rule", "04 新建了 02 未定义的路径或规则"),
            "source_refs_resolvable": ("03", "04.integrity.refs", "04 引用的上游产物无法解析"),
            "no_unfrozen_evidence_used": ("03", "04.integrity.unfrozen", "04 使用未冻结证据"),
        }
        for key, (return_to, rule_id, message) in integrity_checks.items():
            if integrity.get(key) is False:
                errors.append(message)
                _append_rework(items, rule_id=rule_id, message=message, return_to=return_to, affected_stage="04")
        issues = integrity.get("issues", [])
        if isinstance(issues, list):
            for issue in issues:
                issue_text = str(issue).strip()
                if not issue_text:
                    continue
                target = _parse_return_action(issue_text) or "04"
                errors.append(f"04 input_integrity.issue: {issue_text}")
                _append_rework(
                    items,
                    rule_id="04.integrity.issue",
                    message=issue_text,
                    return_to=target,
                    affected_stage="04",
                    fix_hint="按 issue 描述退回对应阶段修复",
                )
    return errors


def _gate_05_snapshot_material(artifacts: RunArtifacts, items: list[ReworkItem]) -> list[str]:
    assert artifacts.snapshot_dir is not None and artifacts.preparation is not None
    errors: list[str] = []
    prep_meta, _ = parse_markdown(artifacts.preparation)
    archetype = str(prep_meta.get("target_05_archetype", ""))

    try:
        material_rows = _snapshot_csv(artifacts.snapshot_dir, "05_material_readiness.csv")
    except Exception:
        material_rows = []

    blocking_rows = [
        row
        for row in material_rows
        if str(row.get("status", "")).strip().lower() not in MATERIAL_READY_STATUSES
        and str(row.get("target_05_archetype", "")).strip() in {"", archetype}
    ]
    for row in blocking_rows:
        required_action = str(row.get("required_action", "")).strip()
        return_target = _parse_return_action(required_action) or _parse_return_action(str(row.get("impact_on_05", ""))) or "03"
        message = (
            f"05 素材 {row.get('material_unit', row.get('material_unit_id', '?'))} 未达研报级"
            f"（status={row.get('status', '')}）"
        )
        if required_action:
            message += f"；required_action={required_action}"
        errors.append(message)
        _append_rework(
            items,
            rule_id=f"05.material.{row.get('material_unit_id', 'unknown')}",
            message=message,
            return_to=return_target,
            affected_stage="05",
            fix_hint=required_action or "退回 03 补齐 chart/table/display 素材包",
        )

    try:
        gap_rows = _snapshot_csv(artifacts.snapshot_dir, "gaps_and_risks.csv")
    except Exception:
        gap_rows = []
    for row in gap_rows:
        if str(row.get("gap_type", "")).strip() != "05_material":
            continue
        if str(row.get("status", "")).strip().lower() in {"closed", "resolved", "met"}:
            continue
        return_target = _parse_return_action(str(row.get("return_action", ""))) or "03"
        message = f"05 素材缺口 {row.get('gap_id', '?')}: {row.get('description', '')}"
        errors.append(message)
        _append_rework(
            items,
            rule_id=f"05.material_gap.{row.get('gap_id', 'unknown')}",
            message=message,
            return_to=return_target,
            affected_stage="05",
            fix_hint=str(row.get("suggested_next_step", "") or "退回 03 登记并冻结 display/chart/table 数据"),
        )
    return errors


def _gate_03_to_04(artifacts: RunArtifacts, items: list[ReworkItem]) -> list[str]:
    assert (
        artifacts.preparation is not None
        and artifacts.snapshot_dir is not None
        and artifacts.report is not None
        and artifacts.audit is not None
    )
    errors: list[str] = []
    prep_meta, _ = parse_markdown(artifacts.preparation)
    report_meta, _ = parse_markdown(artifacts.report)
    audit = load_yaml_file(artifacts.audit)
    metadata = audit["metadata"]

    expected_snapshot_manifest = f"{artifacts.snapshot_dir.name}/manifest.csv"
    refs = [
        ("04.source_01_ref", report_meta.get("source_01_ref"), artifacts.requirement),
        ("04.source_02_logic_ref", report_meta.get("source_02_logic_ref"), artifacts.logic),
        ("04.source_02_view_ref", report_meta.get("source_02_view_ref"), artifacts.view),
        ("04.preparation_ref", report_meta.get("preparation_ref"), artifacts.preparation),
        ("04.snapshot_ref", report_meta.get("snapshot_ref"), expected_snapshot_manifest),
        ("04.audit_ref", report_meta.get("audit_ref"), artifacts.audit),
        ("audit.source_01_ref", metadata.get("source_01_ref"), artifacts.requirement),
        ("audit.source_02_logic_ref", metadata.get("source_02_logic_ref"), artifacts.logic),
        ("audit.source_02_view_ref", metadata.get("source_02_view_ref"), artifacts.view),
        ("audit.preparation_ref", metadata.get("preparation_ref"), artifacts.preparation),
        ("audit.snapshot_ref", metadata.get("snapshot_ref"), expected_snapshot_manifest),
        ("audit.report_ref", metadata.get("report_ref"), artifacts.report),
    ]
    for label, actual, expected in refs:
        expected_name = file_name(expected) if isinstance(expected, Path) else str(expected)
        if not same_ref(actual, expected_name):
            errors.append(f"{label} 必须指向当前运行产物: 期望 {expected_name}，实际 {actual}")
            _append_rework(items, rule_id=label, message=errors[-1], return_to="03", affected_stage="04")

    for label, left, right in [
        ("task_id", report_meta.get("task_id"), prep_meta.get("task_id")),
        ("execution_id", report_meta.get("execution_id"), prep_meta.get("execution_id")),
        ("audit.task_id", metadata.get("task_id"), prep_meta.get("task_id")),
        ("audit.execution_id", metadata.get("execution_id"), prep_meta.get("execution_id")),
    ]:
        if not same_ref(left, right):
            errors.append(f"04 {label} 必须与 03 一致")
            _append_rework(items, rule_id=f"04.{label}", message=errors[-1], return_to="03", affected_stage="04")

    errors.extend(
        _check_return_block(
            items,
            stage="04",
            quality_status=str(report_meta.get("quality_status", "")),
            return_required=report_meta.get("return_required"),
            return_stage=report_meta.get("return_stage"),
        )
    )
    errors.extend(
        _check_return_block(
            items,
            stage="04",
            quality_status=str(metadata.get("quality_status", "")),
            return_required=metadata.get("return_required"),
            return_stage=metadata.get("return_stage"),
            return_reason="04 审计 metadata 要求返工",
        )
    )

    handoff = audit.get("handoff_to_05", {})
    if isinstance(handoff, dict):
        if handoff.get("handoff_status") == "not_ready" and artifacts.delivery is not None:
            errors.append("04 handoff_status=not_ready，不得生成完整 05 研报")
            _append_rework(items, rule_id="04.handoff_status", message=errors[-1], return_to="04", affected_stage="05")
        if handoff.get("output_ceiling") == "gap_report_only" and artifacts.delivery is not None:
            errors.append("04 output_ceiling=gap_report_only，不得生成完整 05 研报")
            _append_rework(items, rule_id="04.output_ceiling", message=errors[-1], return_to="04", affected_stage="05")
        if handoff.get("formal_report_allowed") is False and artifacts.delivery is not None:
            errors.append("04 formal_report_allowed=false，不得生成完整 05 研报")
            _append_rework(items, rule_id="04.formal_report_allowed", message=errors[-1], return_to="04", affected_stage="05")
        if not same_ref(handoff.get("target_05_archetype"), prep_meta.get("target_05_archetype")):
            errors.append("04 handoff target_05_archetype 必须与 03/01 原型一致")
            _append_rework(items, rule_id="04.handoff_archetype", message=errors[-1], return_to="01", affected_stage="05")
    return errors


def _gate_04_to_05(artifacts: RunArtifacts, items: list[ReworkItem]) -> list[str]:
    assert artifacts.delivery is not None and artifacts.report is not None and artifacts.audit is not None
    errors: list[str] = []
    req_meta, _ = parse_markdown(artifacts.requirement)
    delivery_text = artifacts.delivery.read_text(encoding="utf-8-sig")
    if re.search(r"^---\s*\n", delivery_text):
        errors.append("05 正文不得包含 YAML front matter")
        _append_rework(items, rule_id="05.front_matter", message=errors[-1], return_to="05", affected_stage="05")

    archetype = req_meta.get("delivery_archetype", {})
    if isinstance(archetype, dict):
        primary = archetype.get("primary")
        for kind, mapped in ARCHETYPE_NAME_MAP.items():
            if kind in artifacts.delivery.name and primary != mapped:
                errors.append(f"05 文件名原型与 01 delivery_archetype.primary 不一致: {primary} vs {mapped}")
                _append_rework(items, rule_id="05.archetype", message=errors[-1], return_to="01", affected_stage="05")
    return errors


def _validate_stage_chain(
    artifacts: RunArtifacts,
    *,
    through: str,
    allow_minimum: bool,
) -> tuple[list[StageResult], list[ReworkItem]]:
    results: list[StageResult] = []
    rework_items: list[ReworkItem] = []
    chain_triplet = artifacts.triplet()
    upstream_ok = True

    def stop_downstream(stage: str) -> None:
        nonlocal upstream_ok
        upstream_ok = False
        start = _stage_index(stage) + 1
        for later in STAGE_ORDER[start:]:
            if _stage_index(later) > _stage_index(through):
                break
            results.append(_blocked_result(later, f"上游 {stage} 未通过，禁止继续校验 {later}"))

    if artifacts.requirement is None:
        missing = _missing_result("01")
        results.append(missing)
        _record_stage_failures(rework_items, "01", missing.errors)
        stop_downstream("01")
        return results, rework_items

    if artifacts.requirement is not None:
        stage_result = _run_validator("01", lambda: validate_01(artifacts.requirement))
        req_meta, _ = parse_markdown(artifacts.requirement)
        stage_result.quality_status = str(req_meta.get("quality_status", ""))
        results.append(stage_result)
        if stage_result.status != "pass":
            _record_stage_failures(rework_items, "01", stage_result.errors)
            stop_downstream("01")
        elif chain_triplet is None:
            chain_triplet = parse_triplet(artifacts.requirement, "投研需求说明", "01")

    if _stage_index(through) < 1:
        return results, rework_items

    if artifacts.logic is None or artifacts.view is None:
        missing = _missing_result("02")
        results.append(missing)
        _record_stage_failures(rework_items, "02", missing.errors, return_to="01")
        stop_downstream("02")
        return results, rework_items

    if upstream_ok and artifacts.logic is not None and artifacts.view is not None:
        stage_gate_errors: list[str] = []
        stage_gate_errors.extend(_gate_01_to_02(artifacts, rework_items))
        logic_triplet = parse_triplet(artifacts.logic, "研究逻辑", "02")
        view_triplet = parse_triplet(artifacts.view, "本体视图", "02")
        if chain_triplet is not None:
            stage_gate_errors.extend(
                _require_triplet_match(
                    rework_items,
                    label="02 研究逻辑",
                    expected=chain_triplet,
                    actual=logic_triplet,
                    affected_stage="02",
                )
            )
            stage_gate_errors.extend(
                _require_triplet_match(
                    rework_items,
                    label="02 本体视图",
                    expected=chain_triplet,
                    actual=view_triplet,
                    affected_stage="02",
                )
            )
        if stage_gate_errors:
            results.append(StageResult(stage="02", status="fail", errors=sorted(set(stage_gate_errors))))
            stop_downstream("02")
        else:
            stage_result = _run_validator("02", lambda: validate_02(artifacts.logic, artifacts.view))
            logic_meta, _ = parse_markdown(artifacts.logic)
            stage_result.quality_status = str(logic_meta.get("quality_status", ""))
            results.append(stage_result)
            if stage_result.status != "pass":
                _record_stage_failures(rework_items, "02", stage_result.errors)
                stop_downstream("02")

    if _stage_index(through) < 2:
        return results, rework_items

    if artifacts.preparation is None or artifacts.snapshot_dir is None:
        missing = _missing_result("03")
        results.append(missing)
        _record_stage_failures(rework_items, "03", missing.errors, return_to="02")
        stop_downstream("03")
        return results, rework_items

    if upstream_ok:
        stage_gate_errors = []
        stage_gate_errors.extend(_gate_02_to_03(artifacts, rework_items))
        stage_gate_errors.extend(_gate_03_snapshot_semantic(artifacts, rework_items))
        prep_triplet = parse_triplet(artifacts.preparation, "数据与证据准备", "03")
        snapshot_triplet = parse_triplet(artifacts.snapshot_dir, "数据与证据快照", "03")
        if chain_triplet is not None:
            stage_gate_errors.extend(
                _require_triplet_match(rework_items, label="03 准备", expected=chain_triplet, actual=prep_triplet, affected_stage="03")
            )
            stage_gate_errors.extend(
                _require_triplet_match(
                    rework_items,
                    label="03 快照",
                    expected=chain_triplet,
                    actual=snapshot_triplet,
                    affected_stage="03",
                )
            )
        if stage_gate_errors:
            results.append(StageResult(stage="03", status="fail", errors=sorted(set(stage_gate_errors))))
            stop_downstream("03")
        else:
            stage_result = _run_validator("03", lambda: validate_03(artifacts.preparation, artifacts.snapshot_dir))
            prep_meta, _ = parse_markdown(artifacts.preparation)
            stage_result.quality_status = str(prep_meta.get("quality_status", ""))
            results.append(stage_result)
            if stage_result.status != "pass":
                _record_stage_failures(rework_items, "03", stage_result.errors)
                stop_downstream("03")

    if _stage_index(through) < 3:
        return results, rework_items

    if artifacts.report is None or artifacts.audit is None:
        missing = _missing_result("04")
        results.append(missing)
        _record_stage_failures(rework_items, "04", missing.errors, return_to="03")
        stop_downstream("04")
        return results, rework_items

    if upstream_ok:
        stage_gate_errors = []
        stage_gate_errors.extend(_gate_03_to_04(artifacts, rework_items))
        stage_gate_errors.extend(_gate_04_admission_ceiling(artifacts, rework_items))
        stage_gate_errors.extend(_gate_04_audit_semantic(artifacts, rework_items))
        report_triplet = parse_triplet(artifacts.report, "推理报告", "04")
        audit_triplet = parse_triplet(artifacts.audit, "推理审计", "04")
        if chain_triplet is not None:
            stage_gate_errors.extend(
                _require_triplet_match(rework_items, label="04 报告", expected=chain_triplet, actual=report_triplet, affected_stage="04")
            )
            stage_gate_errors.extend(
                _require_triplet_match(rework_items, label="04 审计", expected=chain_triplet, actual=audit_triplet, affected_stage="04")
            )
        if stage_gate_errors:
            results.append(StageResult(stage="04", status="fail", errors=sorted(set(stage_gate_errors))))
            stop_downstream("04")
        else:
            stage_result = _run_validator(
                "04",
                lambda: validate_04(artifacts.report, artifacts.audit, artifacts.snapshot_dir),
            )
            report_meta, _ = parse_markdown(artifacts.report)
            stage_result.quality_status = str(report_meta.get("quality_status", ""))
            results.append(stage_result)
            if stage_result.status != "pass":
                _record_stage_failures(rework_items, "04", stage_result.errors)
                stop_downstream("04")

    if _stage_index(through) < 4:
        return results, rework_items

    if artifacts.delivery is None:
        missing = _missing_result("05")
        results.append(missing)
        _record_stage_failures(rework_items, "05", missing.errors, return_to="04")
        return results, rework_items

    if upstream_ok:
        stage_gate_errors = _gate_04_to_05(artifacts, rework_items)
        stage_gate_errors.extend(_gate_05_snapshot_material(artifacts, rework_items))
        if stage_gate_errors:
            results.append(StageResult(stage="05", status="fail", errors=sorted(set(stage_gate_errors))))
        else:
            stage_result = _run_validator(
                "05",
                lambda: validate_05(
                    artifacts.delivery,
                    artifacts.requirement,
                    artifacts.audit,
                    artifacts.snapshot_dir,
                    allow_minimum=allow_minimum,
                ),
            )
            stage_result.quality_status = str(stage_result.details.get("quality_status", ""))
            results.append(stage_result)
            if stage_result.status != "pass":
                _record_stage_failures(rework_items, "05", stage_result.errors)

    return results, rework_items


def _dedupe_rework(items: list[ReworkItem]) -> list[ReworkItem]:
    seen: set[tuple[str, str, str]] = set()
    deduped: list[ReworkItem] = []
    for item in items:
        key = (item.rule_id, item.return_to, item.message)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _publish_status(
    *,
    through: str,
    stage_results: list[StageResult],
    rework_items: list[ReworkItem],
    require_high_quality: bool,
) -> str:
    if _stage_index(through) < len(STAGE_ORDER) - 1:
        required = {stage for stage in STAGE_ORDER[: _stage_index(through) + 1]}
        present = {result.stage for result in stage_results if result.status != "missing"}
        if required - present:
            return "INCOMPLETE_CHAIN"

    for result in stage_results:
        if result.status in {"missing", "blocked", "fail"}:
            return "RETURN_REQUIRED"

    if rework_items:
        return "RETURN_REQUIRED"

    qualities = [result.quality_status for result in stage_results if result.status == "pass"]
    if require_high_quality and any(status != PUBLISH_QUALITY for status in qualities):
        return "RETURN_REQUIRED"

    if through == "05" and all(result.status == "pass" for result in stage_results):
        return "PUBLISHABLE"

    if all(result.status == "pass" for result in stage_results):
        return "STAGE_READY"

    return "RETURN_REQUIRED"


def validate_publish(
    artifacts: RunArtifacts,
    *,
    through: str = "05",
    require_high_quality: bool = True,
    allow_minimum: bool = False,
) -> dict[str, Any]:
    if through not in STAGE_ORDER:
        fail(f"--through 非法: {through}")

    stage_results, rework_items = _validate_stage_chain(
        artifacts,
        through=through,
        allow_minimum=allow_minimum,
    )
    rework_items = _dedupe_rework(rework_items)

    publish_status = _publish_status(
        through=through,
        stage_results=stage_results,
        rework_items=rework_items,
        require_high_quality=require_high_quality,
    )

    task_id = None
    execution_id = None
    validated_stages = {result.stage for result in stage_results if result.status in {"pass", "fail"}}
    if "01" in validated_stages and artifacts.requirement is not None:
        task_id = parse_markdown(artifacts.requirement)[0].get("task_id")
    if "03" in validated_stages and artifacts.preparation is not None:
        prep_meta = parse_markdown(artifacts.preparation)[0]
        task_id = task_id or prep_meta.get("task_id")
        execution_id = prep_meta.get("execution_id")
    if "04" in validated_stages and artifacts.report is not None and execution_id is None:
        execution_id = parse_markdown(artifacts.report)[0].get("execution_id")

    low_quality_stages = [
        result.stage
        for result in stage_results
        if result.status == "pass" and result.quality_status not in {None, PUBLISH_QUALITY}
    ]
    if low_quality_stages and require_high_quality and publish_status != "INCOMPLETE_CHAIN":
        for stage in low_quality_stages:
            _append_rework(
                rework_items,
                rule_id=f"{stage}.quality_below_publish",
                message=f"{stage} quality_status={next(r.quality_status for r in stage_results if r.stage == stage)}，未达到正式发布门槛",
                return_to=stage,
                affected_stage=stage,
                fix_hint="按 00A 完成独立语义审阅并提升到 high_quality_pass",
            )
        publish_status = "RETURN_REQUIRED"
        rework_items = _dedupe_rework(rework_items)

    ok = publish_status in {"PUBLISHABLE", "STAGE_READY"}
    return {
        "ok": ok,
        "publish_status": publish_status,
        "through": through,
        "task_id": task_id,
        "execution_id": execution_id,
        "triplet": list(artifacts.triplet() or ()),
        "run_dir": str(artifacts.run_dir),
        "stages": {result.stage: asdict(result) for result in stage_results},
        "rework_items": [asdict(item) for item in rework_items],
        "rework_summary": _summarize_rework(rework_items),
    }


def _build_artifacts_from_args(args: argparse.Namespace) -> RunArtifacts:
    if args.run_dir:
        return discover_artifacts(args.run_dir)

    run_dir = Path(args.run_dir_explicit or ".").resolve()
    required = {
        "01": args.requirement,
        "02": args.logic and args.view,
        "03": args.preparation and args.snapshot_dir,
        "04": args.report and args.audit,
        "05": args.delivery,
    }
    through_index = _stage_index(args.through)
    for stage in STAGE_ORDER[: through_index + 1]:
        if stage == "02" and not required["02"]:
            fail("显式模式缺少 02 研究逻辑或本体视图")
        if stage != "02" and not required.get(stage):
            fail(f"显式模式缺少 {stage} 产物路径")

    return RunArtifacts(
        run_dir=run_dir,
        requirement=Path(args.requirement).resolve() if args.requirement else None,
        logic=Path(args.logic).resolve() if args.logic else None,
        view=Path(args.view).resolve() if args.view else None,
        preparation=Path(args.preparation).resolve() if args.preparation else None,
        snapshot_dir=Path(args.snapshot_dir).resolve() if args.snapshot_dir else None,
        report=Path(args.report).resolve() if args.report else None,
        audit=Path(args.audit).resolve() if args.audit else None,
        delivery=Path(args.delivery).resolve() if args.delivery else None,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate 01-05 publish chain order and gates.")
    parser.add_argument("run_dir", nargs="?", help="运行目录，自动发现 01-05 产物")
    parser.add_argument("--through", choices=STAGE_ORDER, default="05", help="校验截止到哪个阶段")
    parser.add_argument("--allow-minimum", action="store_true", help="05 图表密度不足时允许 minimum_pass")
    parser.add_argument(
        "--allow-minimum-publish",
        action="store_true",
        help="不把 minimum_pass 视为发布阻断（默认正式发布必须全部 high_quality_pass）",
    )
    parser.add_argument("--requirement", help="01 投研需求说明路径")
    parser.add_argument("--logic", help="02 研究逻辑路径")
    parser.add_argument("--view", help="02 本体视图路径")
    parser.add_argument("--preparation", help="03 数据与证据准备路径")
    parser.add_argument("--snapshot-dir", help="03 数据与证据快照目录")
    parser.add_argument("--report", help="04 推理报告路径")
    parser.add_argument("--audit", help="04 推理审计路径")
    parser.add_argument("--delivery", help="05 研报正文路径")
    parser.add_argument("--run-dir", dest="run_dir_explicit", help="显式模式下的运行根目录")
    args = parser.parse_args(argv)

    if not args.run_dir and not args.requirement:
        parser.print_help()
        return 2

    try:
        artifacts = _build_artifacts_from_args(args)
        payload = validate_publish(
            artifacts,
            through=args.through,
            require_high_quality=not args.allow_minimum_publish,
            allow_minimum=args.allow_minimum,
        )
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0 if payload["ok"] else 1
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
