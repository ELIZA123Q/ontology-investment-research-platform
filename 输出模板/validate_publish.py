#!/usr/bin/env python3
"""Validate a full 01—05 run and enforce cross-stage quality-gate state."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from quality_gate_utils import normalize_return_required, validate_gate_review_fields
from return_routing import build_return_plan, collect_declared_returns, primary_return_stage
from validate_01_outputs import validate as validate_01
from validate_02_outputs import validate as validate_02
from validate_03_outputs import validate as validate_03
from validate_04_outputs import validate as validate_04
from validate_05_outputs import KNOWN_DELIVERY_KINDS, validate as validate_05
from validate_05_materials import find_material_readiness_csv, validate_05_materials
from validator_utils import error_payload, fail, load_yaml_file, ok_payload, parse_markdown, parse_triplet, read_csv, same_ref


PUBLISH_QUALITY = "high_quality_pass"
MINIMUM_PUBLISH_QUALITY = "minimum_pass"
STAGE_ORDER = ("01", "02", "03", "04", "05")


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
    deliverable: Path | None = None
    expression_audit: Path | None = None


def _pick_optional(matches: list[Path], label: str) -> Path | None:
    if not matches:
        return None
    if len(matches) > 1:
        fail(f"{label} 在运行目录中存在多个候选文件")
    return matches[0]


def _pick_optional_dir(matches: list[Path], label: str) -> Path | None:
    if not matches:
        return None
    if len(matches) > 1:
        fail(f"{label} 在运行目录中存在多个候选目录")
    return matches[0]


def _glob_one(run_dir: Path, patterns: list[str], label: str) -> Path | None:
    matches: list[Path] = []
    for pattern in patterns:
        matches.extend(run_dir.glob(pattern))
    unique = sorted({path.resolve() for path in matches})
    return _pick_optional([Path(path) for path in unique], label)


def discover_artifacts(run_dir: str | Path) -> RunArtifacts:
    run_dir = Path(run_dir)
    deliverable: Path | None = None
    for kind in sorted(KNOWN_DELIVERY_KINDS):
        match = _glob_one(
            run_dir,
            [f"05-*{kind}-*.md", f"*{kind}-*.md"],
            f"05 {kind}",
        )
        if match is not None:
            deliverable = match
            break
    return RunArtifacts(
        run_dir=run_dir,
        requirement=_glob_one(
            run_dir,
            ["*投研需求说明-*.md", "01-*投研需求说明-*.md"],
            "01 投研需求说明",
        ),
        logic=_glob_one(
            run_dir,
            ["*研究逻辑-*.md", "02-*研究逻辑-*.md"],
            "02 研究逻辑",
        ),
        view=_glob_one(
            run_dir,
            ["*本体视图-*.yaml", "02-*本体视图-*.yaml"],
            "02 本体视图",
        ),
        preparation=_glob_one(
            run_dir,
            ["*数据与证据准备-*.md", "03-*数据与证据准备-*.md"],
            "03 数据与证据准备",
        ),
        snapshot_dir=_pick_optional_dir(
            [Path(path) for path in sorted(
                {
                    path.resolve()
                    for pattern in ["*数据与证据快照-*/", "03-*数据与证据快照-*/"]
                    for path in run_dir.glob(pattern)
                    if path.is_dir()
                }
            )],
            "03 数据与证据快照",
        ),
        report=_glob_one(
            run_dir,
            ["*推理报告-*.md", "04-*推理报告-*.md"],
            "04 推理报告",
        ),
        audit=_glob_one(
            run_dir,
            ["*推理审计-*.yaml", "04-*推理审计-*.yaml"],
            "04 推理审计",
        ),
        deliverable=deliverable,
        expression_audit=_glob_one(
            run_dir,
            ["05-*表达审计-*.yaml", "*表达审计-*.yaml"],
            "05 表达审计",
        ),
    )


def _required_pass_stages(through: str, *, has_deliverable: bool) -> set[str]:
    index = STAGE_ORDER.index(through)
    required = set(STAGE_ORDER[: index + 1])
    if has_deliverable and through in {"04", "05"}:
        required.add("05")
    return required


def _collect_run_triplets(artifacts: RunArtifacts) -> dict[str, tuple[str, str, str]]:
    triplets: dict[str, tuple[str, str, str]] = {}
    if artifacts.requirement:
        triplets["01"] = parse_triplet(artifacts.requirement, "投研需求说明", stage="01")
    if artifacts.logic:
        triplets["02-logic"] = parse_triplet(artifacts.logic, "研究逻辑", stage="02")
    if artifacts.view:
        triplets["02-view"] = parse_triplet(artifacts.view, "本体视图", stage="02")
    if artifacts.preparation:
        triplets["03-prep"] = parse_triplet(artifacts.preparation, "数据与证据准备", stage="03")
    if artifacts.snapshot_dir:
        triplets["03-snapshot"] = parse_triplet(artifacts.snapshot_dir, "数据与证据快照", stage="03")
    if artifacts.report:
        triplets["04-report"] = parse_triplet(artifacts.report, "推理报告", stage="04")
    if artifacts.audit:
        triplets["04-audit"] = parse_triplet(artifacts.audit, "推理审计", stage="04")
    if artifacts.deliverable:
        for kind in KNOWN_DELIVERY_KINDS:
            if kind in artifacts.deliverable.name:
                triplets["05"] = parse_triplet(artifacts.deliverable, kind, stage="05")
                break
    if artifacts.expression_audit:
        triplets["05-audit"] = parse_triplet(artifacts.expression_audit, "表达审计", stage="05")
    return triplets


def _validate_triplet_consistency(triplets: dict[str, tuple[str, str, str]]) -> list[str]:
    if not triplets:
        return []
    values = list(triplets.values())
    reference = values[0]
    errors: list[str] = []
    for label, triplet in triplets.items():
        if triplet != reference:
            errors.append(
                f"运行三元组不一致: {label}={triplet}，基准={reference}"
            )
    return errors


def _validate_task_identity(artifacts: RunArtifacts) -> list[str]:
    errors: list[str] = []
    task_ids: list[str] = []
    execution_ids: list[str] = []

    if artifacts.requirement:
        meta, _ = parse_markdown(artifacts.requirement)
        task_ids.append(str(meta.get("task_id", "")))
    if artifacts.logic:
        meta, _ = parse_markdown(artifacts.logic)
        task_ids.append(str(meta.get("task_id", "")))
    if artifacts.view:
        view = load_yaml_file(artifacts.view)
        task_context = view.get("task_context", {})
        if isinstance(task_context, dict):
            task_ids.append(str(task_context.get("task_id", "")))
    if artifacts.preparation:
        meta, _ = parse_markdown(artifacts.preparation)
        task_ids.append(str(meta.get("task_id", "")))
        execution_ids.append(str(meta.get("execution_id", "")))
    if artifacts.snapshot_dir:
        from validator_utils import read_csv

        rows = read_csv(artifacts.snapshot_dir / "manifest.csv")
        if len(rows) == 1:
            task_ids.append(str(rows[0].get("task_id", "")))
            execution_ids.append(str(rows[0].get("execution_id", "")))
    if artifacts.report:
        meta, _ = parse_markdown(artifacts.report)
        task_ids.append(str(meta.get("task_id", "")))
        execution_ids.append(str(meta.get("execution_id", "")))
    if artifacts.audit:
        audit = load_yaml_file(artifacts.audit)
        metadata = audit.get("metadata", {})
        if isinstance(metadata, dict):
            task_ids.append(str(metadata.get("task_id", "")))
            execution_ids.append(str(metadata.get("execution_id", "")))
    if artifacts.expression_audit:
        expression_audit = load_yaml_file(artifacts.expression_audit)
        metadata = expression_audit.get("metadata", {})
        if isinstance(metadata, dict):
            task_ids.append(str(metadata.get("task_id", "")))
            execution_ids.append(str(metadata.get("execution_id", "")))

    task_ids = [value for value in task_ids if value.strip()]
    execution_ids = [value for value in execution_ids if value.strip()]
    if task_ids and len(set(task_ids)) != 1:
        errors.append(f"task_id 在全链产物中不一致: {', '.join(sorted(set(task_ids)))}")
    if execution_ids and len(set(execution_ids)) != 1:
        errors.append(f"execution_id 在 03—04 产物中不一致: {', '.join(sorted(set(execution_ids)))}")
    return errors


def _validate_publish_quality(
    artifacts: RunArtifacts,
    *,
    require_publish_quality: bool,
) -> list[str]:
    allowed = {PUBLISH_QUALITY} if require_publish_quality else {PUBLISH_QUALITY, MINIMUM_PUBLISH_QUALITY}
    errors: list[str] = []
    for item in _artifact_return_meta(artifacts):
        meta = item["meta"]
        quality_status = meta.get("quality_status")
        if quality_status is None:
            continue
        if str(quality_status) not in allowed:
            errors.append(
                f"{item['stage']} {item['label']} quality_status={quality_status} 不满足发布门槛"
            )
    return errors


def _artifact_return_meta(artifacts: RunArtifacts) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    if artifacts.requirement:
        meta, _ = parse_markdown(artifacts.requirement)
        items.append({"stage": "01", "label": str(artifacts.requirement), "meta": meta})

    if artifacts.view:
        view = load_yaml_file(artifacts.view)
        quality_control = view.get("quality_control")
        if isinstance(quality_control, dict):
            items.append({"stage": "02", "label": str(artifacts.view), "meta": quality_control})

    if artifacts.preparation:
        meta, _ = parse_markdown(artifacts.preparation)
        items.append({"stage": "03", "label": str(artifacts.preparation), "meta": meta})

    if artifacts.snapshot_dir:
        from validator_utils import read_csv

        manifest_rows = read_csv(artifacts.snapshot_dir / "manifest.csv")
        if len(manifest_rows) == 1:
            items.append(
                {
                    "stage": "03",
                    "label": f"{artifacts.snapshot_dir}/manifest.csv",
                    "meta": manifest_rows[0],
                }
            )

    if artifacts.report:
        meta, _ = parse_markdown(artifacts.report)
        items.append({"stage": "04", "label": str(artifacts.report), "meta": meta})

    if artifacts.audit:
        audit = load_yaml_file(artifacts.audit)
        metadata = audit.get("metadata")
        if isinstance(metadata, dict):
            items.append({"stage": "04", "label": str(artifacts.audit), "meta": metadata})
        report_quality_check = audit.get("report_quality_check")
        if isinstance(report_quality_check, dict) and normalize_return_required(report_quality_check.get("return_required")):
            items.append(
                {
                    "stage": "04",
                    "label": f"{artifacts.audit}#report_quality_check",
                    "meta": report_quality_check,
                }
            )

    if artifacts.expression_audit:
        expression_audit = load_yaml_file(artifacts.expression_audit)
        metadata = expression_audit.get("metadata")
        if isinstance(metadata, dict):
            items.append({"stage": "05", "label": str(artifacts.expression_audit), "meta": metadata})

    return items


def _validate_chain_gate_review(artifacts: RunArtifacts) -> list[str]:
    errors: list[str] = []
    for item in _artifact_return_meta(artifacts):
        meta = item["meta"]
        label = str(item["label"])
        try:
            if "quality_status" in meta:
                validate_gate_review_fields(meta, label)
                if str(meta.get("quality_status")) == PUBLISH_QUALITY:
                    if meta.get("deterministic_check_status") is None or meta.get("semantic_review_status") is None:
                        errors.append(f"{item['stage']} {label} 标记 high_quality_pass 但缺少双层门禁字段")
        except Exception as exc:
            errors.append(f"{item['stage']}: {exc}")
    return errors


def validate_publish(run_dir: str | Path, *, through: str = "05", require_publish_quality: bool = True) -> dict[str, object]:
    artifacts = discover_artifacts(run_dir)
    stages: dict[str, object] = {}
    errors: list[str] = []

    if through == "05" and not artifacts.deliverable:
        errors.append("05 产物缺失")
    if through == "05" and not artifacts.expression_audit:
        errors.append("05 表达审计缺失")

    if artifacts.requirement:
        try:
            stages["01"] = {"status": "pass", "details": validate_01(artifacts.requirement)}
        except Exception as exc:
            stages["01"] = {"status": "fail", "error": str(exc)}
            errors.append(f"01: {exc}")
    else:
        stages["01"] = {"status": "missing"}
        errors.append("01 产物缺失")

    if through in {"02", "03", "04", "05"} and stages.get("01", {}).get("status") == "pass" and artifacts.logic and artifacts.view:
        try:
            stages["02"] = {"status": "pass", "details": validate_02(artifacts.logic, artifacts.view)}
        except Exception as exc:
            stages["02"] = {"status": "fail", "error": str(exc)}
            errors.append(f"02: {exc}")
    elif through in {"02", "03", "04", "05"}:
        stages["02"] = {"status": "blocked" if stages.get("01", {}).get("status") != "pass" else "missing"}
        if stages["02"]["status"] == "missing":
            errors.append("02 产物缺失")

    if through in {"03", "04", "05"} and stages.get("02", {}).get("status") == "pass" and artifacts.preparation and artifacts.snapshot_dir:
        try:
            stages["03"] = {"status": "pass", "details": validate_03(artifacts.preparation, artifacts.snapshot_dir)}
        except Exception as exc:
            stages["03"] = {"status": "fail", "error": str(exc)}
            errors.append(f"03: {exc}")
    elif through in {"03", "04", "05"}:
        stages["03"] = {"status": "blocked" if stages.get("02", {}).get("status") != "pass" else "missing"}
        if stages["03"]["status"] == "missing":
            errors.append("03 产物缺失")

    if through in {"04", "05"} and stages.get("03", {}).get("status") == "pass" and artifacts.report and artifacts.audit and artifacts.snapshot_dir:
        try:
            stages["04"] = {"status": "pass", "details": validate_04(artifacts.report, artifacts.audit, artifacts.snapshot_dir)}
        except Exception as exc:
            stages["04"] = {"status": "fail", "error": str(exc)}
            errors.append(f"04: {exc}")
    elif through in {"04", "05"}:
        stages["04"] = {"status": "blocked" if stages.get("03", {}).get("status") != "pass" else "missing"}
        if stages["04"]["status"] == "missing":
            errors.append("04 产物缺失")

    if artifacts.deliverable and artifacts.expression_audit and artifacts.audit and stages.get("04", {}).get("status") == "pass":
        for kind in KNOWN_DELIVERY_KINDS:
            if kind in artifacts.deliverable.name:
                try:
                    stages["05"] = {
                        "status": "pass",
                        "details": validate_05(
                            artifacts.deliverable,
                            kind,
                            artifacts.expression_audit,
                            artifacts.audit,
                        ),
                    }
                except Exception as exc:
                    stages["05"] = {"status": "fail", "error": str(exc)}
                    errors.append(f"05: {exc}")
                break
    elif through == "05":
        stages["05"] = {"status": "blocked" if stages.get("04", {}).get("status") != "pass" else "missing"}

    errors.extend(_validate_triplet_consistency(_collect_run_triplets(artifacts)))
    errors.extend(_validate_task_identity(artifacts))
    errors.extend(_validate_publish_quality(artifacts, require_publish_quality=require_publish_quality))
    if (
        artifacts.deliverable
        and require_publish_quality
        and artifacts.snapshot_dir
        and stages.get("03", {}).get("status") == "pass"
    ):
        manifest_rows = read_csv(artifacts.snapshot_dir / "manifest.csv")
        quality_status = manifest_rows[0].get("quality_status") if len(manifest_rows) == 1 else None
        if str(quality_status) == PUBLISH_QUALITY:
            if find_material_readiness_csv(artifacts.snapshot_dir) is None:
                errors.append("存在 05 交付物但快照缺少 04_05_materials/05_material_readiness.csv")
            else:
                try:
                    validate_05_materials(
                        artifacts.snapshot_dir,
                        quality_status=quality_status,
                        label="05_material_readiness",
                    )
                except Exception as exc:
                    errors.append(f"05_materials: {exc}")
    gate_errors = _validate_chain_gate_review(artifacts)
    errors.extend(gate_errors)

    declared_returns = collect_declared_returns(_artifact_return_meta(artifacts))
    return_plan = build_return_plan(stages, errors, declared_returns=declared_returns)
    return_stage = primary_return_stage(return_plan)

    required_pass = _required_pass_stages(through, has_deliverable=artifacts.deliverable is not None)
    publishable = not errors and all(
        isinstance(stages.get(stage), dict) and stages[stage].get("status") == "pass"
        for stage in required_pass
    )

    triplet: list[str] = []
    run_triplets = _collect_run_triplets(artifacts)
    if "01" in run_triplets:
        triplet = list(run_triplets["01"])

    return {
        "publish_status": "PUBLISHABLE" if publishable else "RETURN_REQUIRED",
        "through": through,
        "triplet": triplet,
        "run_dir": str(artifacts.run_dir),
        "stages": stages,
        "errors": errors,
        "return_stage": return_stage,
        "return_plan": return_plan,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a full 01—05 publish run")
    parser.add_argument("run_dir", help="运行目录")
    parser.add_argument("--through", choices=list(STAGE_ORDER), default="05")
    parser.add_argument("--allow-minimum", action="store_true", help="不把 minimum_pass 视为发布阻断")
    args = parser.parse_args(argv)

    try:
        payload = validate_publish(args.run_dir, through=args.through, require_publish_quality=not args.allow_minimum)
        payload["ok"] = payload["publish_status"] == "PUBLISHABLE"
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0 if payload["ok"] else 1
    except Exception as exc:
        print(error_payload(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
