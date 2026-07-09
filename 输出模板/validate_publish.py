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

from quality_gate_utils import QUALITY_STATUSES
from validator_utils import (
    error_payload,
    fail,
    file_name,
    load_yaml_file,
    ok_payload,
    parse_markdown,
    parse_triplet,
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


def _resolve_ref(run_dir: Path, ref: str) -> Path:
    candidate = Path(ref)
    if candidate.is_file():
        return candidate.resolve()
    resolved = (run_dir / ref).resolve()
    if resolved.is_file() or resolved.is_dir():
        return resolved
    fail(f"无法解析引用: {ref}")


def _snapshot_dir_from_ref(run_dir: Path, ref: str) -> Path:
    text = str(ref).strip().replace("\\", "/")
    if "/" in text:
        return _resolve_ref(run_dir, text.split("/", 1)[0])
    fail(f"snapshot_ref 无法解析快照目录: {ref}")


def _pick_unique(matches: list[Path], label: str, run_dir: Path) -> Path:
    files = sorted({path.resolve() for path in matches if path.is_file()})
    if not files:
        fail(f"{run_dir} 中未找到 {label}")
    if len(files) > 1:
        names = ", ".join(path.name for path in files)
        fail(f"{run_dir} 中存在多个 {label}: {names}")
    return files[0]


def _pick_optional(matches: list[Path], label: str, run_dir: Path) -> Path | None:
    files = sorted({path.resolve() for path in matches if path.is_file()})
    if not files:
        return None
    if len(files) > 1:
        names = ", ".join(path.name for path in files)
        fail(f"{run_dir} 中存在多个 {label}: {names}")
    return files[0]


def _pick_unique_dir(matches: list[Path], label: str, run_dir: Path) -> Path:
    dirs = sorted({path.resolve() for path in matches if path.is_dir()})
    if not dirs:
        fail(f"{run_dir} 中未找到 {label}")
    if len(dirs) > 1:
        names = ", ".join(path.name for path in dirs)
        fail(f"{run_dir} 中存在多个 {label}: {names}")
    return dirs[0]


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

    admission = str(prep_meta.get("admission", ""))
    if admission == "failed":
        errors.append("03 admission=failed，不得进入 04 方向性推理")
        _append_rework(
            items,
            rule_id="03.admission.failed",
            message=errors[-1],
            return_to="03",
            affected_stage="04",
            fix_hint="补证据、修口径或明确缺口说明后再冻结快照",
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
) -> tuple[list[StageResult], list[ReworkItem], list[str]]:
    results: list[StageResult] = []
    rework_items: list[ReworkItem] = []
    gate_errors: list[str] = []
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

    if through != "01" and artifacts.requirement is None:
        results.append(_missing_result("01"))
        stop_downstream("01")
        return results, rework_items, gate_errors

    if artifacts.requirement is not None:
        stage_result = _run_validator("01", lambda: validate_01(artifacts.requirement))
        req_meta, _ = parse_markdown(artifacts.requirement)
        stage_result.quality_status = str(req_meta.get("quality_status", ""))
        results.append(stage_result)
        if stage_result.status != "pass":
            stop_downstream("01")
        elif chain_triplet is None:
            chain_triplet = parse_triplet(artifacts.requirement, "投研需求说明", "01")

    if _stage_index(through) < 1:
        return results, rework_items, gate_errors

    for required, label in [
        (artifacts.logic, "02 研究逻辑"),
        (artifacts.view, "02 本体视图"),
    ]:
        if required is None:
            results.append(_missing_result("02"))
            stop_downstream("02")
            return results, rework_items, gate_errors

    if upstream_ok and artifacts.logic is not None and artifacts.view is not None:
        gate_errors.extend(_gate_01_to_02(artifacts, rework_items))
        logic_triplet = parse_triplet(artifacts.logic, "研究逻辑", "02")
        view_triplet = parse_triplet(artifacts.view, "本体视图", "02")
        if chain_triplet is not None:
            gate_errors.extend(
                _require_triplet_match(
                    rework_items,
                    label="02 研究逻辑",
                    expected=chain_triplet,
                    actual=logic_triplet,
                    affected_stage="02",
                )
            )
            gate_errors.extend(
                _require_triplet_match(
                    rework_items,
                    label="02 本体视图",
                    expected=chain_triplet,
                    actual=view_triplet,
                    affected_stage="02",
                )
            )
        if gate_errors:
            results.append(StageResult(stage="02", status="fail", errors=sorted(set(gate_errors))))
            stop_downstream("02")
        else:
            stage_result = _run_validator("02", lambda: validate_02(artifacts.logic, artifacts.view))
            logic_meta, _ = parse_markdown(artifacts.logic)
            stage_result.quality_status = str(logic_meta.get("quality_status", ""))
            results.append(stage_result)
            if stage_result.status != "pass":
                stop_downstream("02")

    if _stage_index(through) < 2:
        return results, rework_items, gate_errors

    if artifacts.preparation is None or artifacts.snapshot_dir is None:
        results.append(_missing_result("03"))
        stop_downstream("03")
        return results, rework_items, gate_errors

    if upstream_ok:
        gate_errors.extend(_gate_02_to_03(artifacts, rework_items))
        prep_triplet = parse_triplet(artifacts.preparation, "数据与证据准备", "03")
        snapshot_triplet = parse_triplet(artifacts.snapshot_dir, "数据与证据快照", "03")
        if chain_triplet is not None:
            gate_errors.extend(
                _require_triplet_match(rework_items, label="03 准备", expected=chain_triplet, actual=prep_triplet, affected_stage="03")
            )
            gate_errors.extend(
                _require_triplet_match(
                    rework_items,
                    label="03 快照",
                    expected=chain_triplet,
                    actual=snapshot_triplet,
                    affected_stage="03",
                )
            )
        if gate_errors:
            results.append(StageResult(stage="03", status="fail", errors=sorted(set(gate_errors))))
            stop_downstream("03")
        else:
            stage_result = _run_validator("03", lambda: validate_03(artifacts.preparation, artifacts.snapshot_dir))
            prep_meta, _ = parse_markdown(artifacts.preparation)
            stage_result.quality_status = str(prep_meta.get("quality_status", ""))
            results.append(stage_result)
            if stage_result.status != "pass":
                stop_downstream("03")

    if _stage_index(through) < 3:
        return results, rework_items, gate_errors

    if artifacts.report is None or artifacts.audit is None:
        results.append(_missing_result("04"))
        stop_downstream("04")
        return results, rework_items, gate_errors

    if upstream_ok:
        gate_errors.extend(_gate_03_to_04(artifacts, rework_items))
        report_triplet = parse_triplet(artifacts.report, "推理报告", "04")
        audit_triplet = parse_triplet(artifacts.audit, "推理审计", "04")
        if chain_triplet is not None:
            gate_errors.extend(
                _require_triplet_match(rework_items, label="04 报告", expected=chain_triplet, actual=report_triplet, affected_stage="04")
            )
            gate_errors.extend(
                _require_triplet_match(rework_items, label="04 审计", expected=chain_triplet, actual=audit_triplet, affected_stage="04")
            )
        if gate_errors:
            results.append(StageResult(stage="04", status="fail", errors=sorted(set(gate_errors))))
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
                stop_downstream("04")

    if _stage_index(through) < 4:
        return results, rework_items, gate_errors

    if artifacts.delivery is None:
        results.append(_missing_result("05"))
        return results, rework_items, gate_errors

    if upstream_ok:
        gate_errors.extend(_gate_04_to_05(artifacts, rework_items))
        if gate_errors:
            results.append(StageResult(stage="05", status="fail", errors=sorted(set(gate_errors))))
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

    return results, rework_items, gate_errors


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

    stage_results, rework_items, gate_errors = _validate_stage_chain(
        artifacts,
        through=through,
        allow_minimum=allow_minimum,
    )
    rework_items = _dedupe_rework(rework_items)

    if gate_errors and not any(item.rule_id.startswith("chain.") for item in rework_items):
        for message in sorted(set(gate_errors)):
            _append_rework(
                rework_items,
                rule_id="chain.gate",
                message=message,
                return_to="01",
                affected_stage="chain",
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
    if artifacts.requirement is not None:
        task_id = parse_markdown(artifacts.requirement)[0].get("task_id")
    if artifacts.preparation is not None:
        prep_meta = parse_markdown(artifacts.preparation)[0]
        task_id = task_id or prep_meta.get("task_id")
        execution_id = prep_meta.get("execution_id")
    if artifacts.report is not None and execution_id is None:
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
