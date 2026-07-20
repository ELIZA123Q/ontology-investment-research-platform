#!/usr/bin/env python3
"""Validate workbench export packages (compact V3 file layout, Zod-projected fields)."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from package_kind import KIND_WORKBENCH, detect_package_kind, redirect_message  # noqa: E402
from runtime_deterministic_rules import (  # noqa: E402
    REQUIRED_RULES,
    assert_required_deterministic_rules,
)
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "runtime" / "engine"))
from ontology_instance_graph import InstanceGraphError, validate_instance_graph  # noqa: E402

REQUIRED_FILES = (
    "package_kind.yaml",
    "run_manifest.yaml",
    "01_task.yaml",
    "02_structure.yaml",
    "03_evidence.yaml",
    "04_judgment.yaml",
    "05_expression.yaml",
    "05_report.md",
    "business_instance_graph.yaml",
    "sources.json",
    "independent_review.yaml",
    "baseline.yaml",
    "evaluation.yaml",
)
MA_ID = re.compile(r"^MA-[A-Z0-9_-]+$")
STAGE_KEYS = ("stage_01", "stage_02", "stage_03", "stage_04", "stage_05")


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.name}: YAML root must be a mapping")
    return value


def _ids(items: list[Any], *fields: str) -> set[str]:
    found: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        for field in fields:
            value = item.get(field)
            if value:
                found.add(str(value))
                break
    return found


def _artifact_wrapper(path: Path, errors: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    wrapper = load(path)
    raw = wrapper.get("json_content")
    expected = str(wrapper.get("content_hash") or "")
    if not isinstance(raw, str):
        errors.append(f"{path.name} 缺少不可变 json_content")
        return wrapper, {}
    actual = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    if actual != expected:
        errors.append(f"{path.name} content_hash 与 json_content 不匹配")
    try:
        content = json.loads(raw)
    except Exception as exc:
        errors.append(f"{path.name}.json_content 无法解析: {exc}")
        content = {}
    if not isinstance(content, dict):
        errors.append(f"{path.name}.json_content 根必须为对象")
        content = {}
    return wrapper, content


def _required(item: dict[str, Any], fields: tuple[str, ...], label: str, errors: list[str]) -> None:
    for field in fields:
        value = item.get(field)
        if value is None or value == "" or (isinstance(value, list) and not value):
            errors.append(f"{label} 缺少实质字段 {field}")


def _terminal_adjudication_refs(
    judgment: dict[str, Any],
    final_applications: dict[str, dict[str, Any]],
) -> set[str]:
    """Return final adjudication applications that make a J0 stop auditable."""
    terminal_statuses = {"executed", "rejected", "blocked", "degraded"}
    refs = judgment.get("method_application_ids") or judgment.get("method_application_refs") or []
    return {
        str(ref)
        for ref in refs
        if (application := final_applications.get(str(ref)))
        and application.get("capability_type") == "adjudication"
        and application.get("status") in terminal_statuses
    }


def _is_strict_j0_stop(
    judgment: dict[str, Any],
    final_applications: dict[str, dict[str, Any]],
) -> bool:
    """J0 is an explicit, reasoned stop state—not a generic empty-output escape."""
    return (
        judgment.get("strength") == "J0"
        and judgment.get("decision_status") in {"blocked", "indeterminate", "contested"}
        and bool(str(judgment.get("not_judgeable_reason") or "").strip())
        and bool(_terminal_adjudication_refs(judgment, final_applications))
    )


def validate_workbench_package(run_dir: str | Path) -> list[str]:
    run_dir = Path(run_dir).resolve()
    errors: list[str] = []
    if not run_dir.is_dir():
        return [f"{run_dir} 不是目录"]

    kind = detect_package_kind(run_dir)
    if kind != KIND_WORKBENCH:
        return [redirect_message(kind, run_dir) if kind != "unknown" else f"{run_dir} 不是工作台导出包"]

    for name in REQUIRED_FILES:
        if not (run_dir / name).is_file():
            errors.append(f"缺少 {name}")
    if errors:
        return errors

    kind_marker = load(run_dir / "package_kind.yaml")
    if str(kind_marker.get("package_kind")) != KIND_WORKBENCH:
        errors.append("package_kind.yaml.package_kind 必须为 workbench_export")

    manifest = load(run_dir / "run_manifest.yaml")
    if str(manifest.get("schema_name")) != "controlled_research_run_manifest_workbench":
        errors.append("run_manifest.schema_name 必须为 controlled_research_run_manifest_workbench")
    if str(manifest.get("schema_version")) != "1.0.0":
        errors.append("run_manifest.schema_version 必须为 1.0.0")
    if str(manifest.get("package_kind")) != KIND_WORKBENCH:
        errors.append("run_manifest.package_kind 必须为 workbench_export")
    if str(manifest.get("run_mode")) != "workbench":
        errors.append("run_manifest.run_mode 必须为 workbench")
    if manifest.get("validation_summary", {}).get("publishable") is True:
        errors.append("工作台导出不得声明 publishable=true")

    contract_ref = manifest.get("contract_ref") or {}
    if str(contract_ref.get("schema_name")) != "controlled_research_run_manifest":
        errors.append("run_manifest.contract_ref.schema_name 必须指向正式 manifest")
    if str(contract_ref.get("schema_version")) != "1.3.0":
        errors.append("run_manifest.contract_ref.schema_version 必须为 1.3.0")

    task = load(run_dir / "01_task.yaml")
    structure = load(run_dir / "02_structure.yaml")
    evidence = load(run_dir / "03_evidence.yaml")
    judgment = load(run_dir / "04_judgment.yaml")
    expression = load(run_dir / "05_expression.yaml")
    report = (run_dir / "05_report.md").read_text(encoding="utf-8").strip()
    review_wrapper, review = _artifact_wrapper(run_dir / "independent_review.yaml", errors)
    baseline_wrapper, baseline = _artifact_wrapper(run_dir / "baseline.yaml", errors)
    evaluation_wrapper, evaluation = _artifact_wrapper(run_dir / "evaluation.yaml", errors)
    artifact_bindings = (manifest.get("export_meta") or {}).get("artifact_bindings") or {}
    for stage in STAGE_KEYS:
        binding = artifact_bindings.get(stage)
        if not isinstance(binding, dict) or not str(binding.get("artifact_id") or "") or not re.fullmatch(r"[a-f0-9]{64}", str(binding.get("content_hash") or "")):
            errors.append(f"run_manifest.export_meta.artifact_bindings.{stage} 缺少 artifact_id/content_hash")
    try:
        source_registry = json.loads((run_dir / "sources.json").read_text(encoding="utf-8"))
    except Exception as exc:
        source_registry = []
        errors.append(f"sources.json 无法解析: {exc}")
    if not isinstance(source_registry, list):
        errors.append("sources.json 根必须为数组")
        source_registry = []
    source_by_id = {str(item.get("id")): item for item in source_registry if isinstance(item, dict) and item.get("id")}

    graph_ids: set[str] = set()
    graph_types: dict[str, str] = {}
    graph_relations: list[dict[str, Any]] = []
    try:
        graph_doc = load(run_dir / "business_instance_graph.yaml")
        graph = copy.deepcopy(graph_doc.get("business_instance_graph") or {})
        graph["authority"] = "business_parameters"
        validate_instance_graph(graph)
        graph_ids = {str(item.get("id")) for item in graph.get("objects") or [] if isinstance(item, dict)}
        graph_types = {str(item.get("id")): str(item.get("type")) for item in graph.get("objects") or [] if isinstance(item, dict)}
        graph_relations = [item for item in graph.get("relations") or [] if isinstance(item, dict)]
        if not graph_ids:
            errors.append("business_instance_graph 不得为空")
        outgoing: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for relation in graph_relations:
            outgoing.setdefault((str(relation.get("sourceId")), str(relation.get("type"))), []).append(relation)
        semantic_requirements = {
            "JudgmentUnit": ("unitUsesScope",),
            "EvidenceClaim": ("claimCitesSource",),
            "EvidenceFact": ("factDerivedFromClaim",),
            "Signal": ("signalGroundedByFact", "signalEvaluatesHypothesis"),
            "Judgment": ("judgmentBasedOnHypothesis", "judgmentHasRuleEvaluation", "judgmentResolvesUnit", "runtimeJudgmentUsesMethodApplication"),
            "ReasoningTrace": ("reasoningTraceForJudgment", "traceIncludesNode"),
            "MethodApplication": ("runtimeMethodApplicationTargets",),
        }
        for object_id, object_type in graph_types.items():
            for relation_type in semantic_requirements.get(object_type, ()):
                if not outgoing.get((object_id, relation_type)):
                    errors.append(f"business_instance_graph {object_id} 缺少语义闭环关系 {relation_type}")
    except (ValueError, InstanceGraphError, OSError) as exc:
        errors.append(f"business_instance_graph 语义校验失败: {exc}")

    if not str(task.get("question") or task.get("normalized_question") or "").strip():
        errors.append("01_task 缺少 question/normalized_question")
    if len(report) < 20:
        errors.append("05_report.md 过短")

    units = _ids(structure.get("judgment_units") or [], "judgment_unit_id", "id")
    if not units:
        errors.append("02_structure 缺少 judgment_units")
    for unit_id in sorted(units - graph_ids):
        errors.append(f"business_instance_graph 缺少 JudgmentUnit {unit_id}")

    apps_02 = structure.get("method_applications") or []
    apps_03 = evidence.get("method_applications") or []
    apps_04 = judgment.get("method_applications") or []
    if not apps_02:
        errors.append("02_structure 缺少 method_applications")
    if not apps_03:
        errors.append("03_evidence 缺少 method_applications")
    if not apps_04:
        errors.append("04_judgment 缺少 method_applications")

    app_maps = [
        {str(item.get("application_id")): item for item in apps if isinstance(item, dict) and item.get("application_id")}
        for apps in (apps_02, apps_03, apps_04)
    ]
    if app_maps[0] and (set(app_maps[0]) != set(app_maps[1]) or set(app_maps[1]) != set(app_maps[2])):
        errors.append("MethodApplication 在 02/03/04 间存在静默新增或删除")
    for app_id in sorted(set().union(*[set(mapping) for mapping in app_maps])):
        versions = [mapping.get(app_id) for mapping in app_maps]
        present = [item for item in versions if item]
        identities = {(item.get("method_id"), item.get("method_version"), item.get("capability_type"), tuple(item.get("target_judgment_unit_refs") or [])) for item in present}
        if len(identities) > 1:
            errors.append(f"{app_id} 方法身份或目标跨阶段漂移")
        if versions[0] and versions[0].get("status") != "candidate":
            errors.append(f"{app_id} stage_02 必须为 candidate")
        final = versions[2]
        if final and final.get("status") not in {"executed", "rejected", "blocked", "degraded"}:
            errors.append(f"{app_id} stage_04 未收敛到最终状态")
        if final and final.get("status") == "executed":
            checks = final.get("precondition_checks") or []
            if not checks or any(not isinstance(check, dict) or check.get("result") != "pass" or not check.get("evidence_refs") for check in checks):
                errors.append(f"{app_id} executed 的前置条件未全部以具体证据通过")
            if not final.get("input_evidence_refs") or not (final.get("output_signal_refs") or final.get("output_judgment_refs")):
                errors.append(f"{app_id} executed 缺少实际输入或输出")
            if not str(final.get("execution_summary") or "").strip() or not str((final.get("provenance") or {}).get("recorded_at") or "").strip():
                errors.append(f"{app_id} executed 缺少执行摘要或时间")

    all_apps = [item for item in [*apps_02, *apps_03, *apps_04] if isinstance(item, dict)]
    app_ids: set[str] = set()
    for item in all_apps:
        app_id = str(item.get("application_id", ""))
        if not MA_ID.match(app_id):
            errors.append(f"非法 application_id: {app_id or '<empty>'}")
            continue
        if app_id in app_ids and item in apps_02:
            pass
        app_ids.add(app_id)
        for unit_ref in item.get("target_judgment_unit_refs") or []:
            if str(unit_ref) not in units:
                errors.append(f"{app_id} 引用未知 judgment unit {unit_ref}")

    drafts = evidence.get("evidence_drafts") or evidence.get("facts") or []
    draft_ids = _ids(drafts, "id", "evidence_id")
    if not drafts:
        errors.append("03_evidence 缺少 evidence_drafts/facts")
    for evidence_id in sorted(draft_ids - graph_ids):
        errors.append(f"business_instance_graph 缺少证据对象 {evidence_id}")
    for item in drafts:
        if not isinstance(item, dict):
            continue
        evidence_id = str(item.get("id") or item.get("evidence_id") or "")
        if item.get("kind") == "gap":
            _required(item, ("requirement", "evidence_role", "minimum_independent_sources", "judgment_unit_ids"), f"evidence gap {evidence_id}", errors)
            continue
        _required(item, (
            "statement", "subject_ref", "time_basis", "scope_ref", "observed_at", "valid_from",
            "published_at", "cutoff_at", "directness", "judgment_unit_ids",
        ), f"evidence {evidence_id}", errors)
        source_refs = [str(ref) for ref in (item.get("source_ids") or item.get("source_refs") or [])]
        if not source_refs:
            errors.append(f"evidence {evidence_id} 缺少事实级来源引用")
        for source_ref in source_refs:
            source = source_by_id.get(source_ref)
            if not source:
                errors.append(f"evidence {item.get('id') or item.get('evidence_id')} 引用未登记来源 {source_ref}")
                continue
            if not re.fullmatch(r"[a-f0-9]{64}", str(source.get("content_hash") or "")):
                errors.append(f"source {source_ref} 缺少正文 SHA-256")
            _required(source, ("captured_at", "published_at", "locator", "source_tier", "source_group", "source_quote"), f"source {source_ref}", errors)
            if source.get("usability_status") == "usable" and (source.get("retrieval_status") != "captured" or not bool(source.get("quote_verified"))):
                errors.append(f"source {source_ref} 声明 usable 但正文抓取/原文定位未验证")
            if source.get("usability_status") == "limited" and not item.get("limitations"):
                errors.append(f"evidence {evidence_id} 使用 limited 来源但未披露 limitations")

    judgments = judgment.get("judgments") or []
    signals = {str(item.get("id") or item.get("signal_id")): item for item in judgment.get("signals") or [] if isinstance(item, dict)}
    hypotheses = {str(item.get("id") or item.get("hypothesis_id")): item for item in judgment.get("hypotheses") or [] if isinstance(item, dict)}
    rule_evaluations = {str(item.get("id") or item.get("rule_evaluation_id")): item for item in judgment.get("rule_evaluations") or [] if isinstance(item, dict)}
    traces = [item for item in judgment.get("reasoning_traces") or [] if isinstance(item, dict)]
    for signal_id, signal in signals.items():
        _required(signal, ("statement", "role", "evidence_draft_ids", "target_hypothesis_ids"), f"signal {signal_id}", errors)
        for ref in signal.get("evidence_draft_ids") or []:
            if str(ref) not in draft_ids:
                errors.append(f"signal {signal_id} 引用未知证据 {ref}")
        for ref in signal.get("target_hypothesis_ids") or []:
            if str(ref) not in hypotheses:
                errors.append(f"signal {signal_id} 引用未知假设 {ref}")
    for hypothesis_id, hypothesis in hypotheses.items():
        # signal_ids is conditionally checked after the linked Judgment and its
        # terminal adjudication trace are known. It stays mandatory otherwise.
        _required(hypothesis, ("statement", "falsification_conditions", "time_horizon"), f"hypothesis {hypothesis_id}", errors)
        for ref in hypothesis.get("signal_ids") or []:
            signal = signals.get(str(ref))
            if not signal or hypothesis_id not in [str(value) for value in signal.get("target_hypothesis_ids") or []]:
                errors.append(f"hypothesis {hypothesis_id} 与 signal {ref} 未双向绑定")
    for rule_id, evaluation_item in rule_evaluations.items():
        _required(evaluation_item, ("rule_ref", "input_refs", "condition_results", "result", "deterministic_result"), f"rule evaluation {rule_id}", errors)
    errors.extend(assert_required_deterministic_rules(judgment, require_deterministic_on_all=True))
    judgment_ids = _ids(judgments, "judgment_id", "id")
    if not judgments:
        errors.append("04_judgment 缺少 judgments")
    for judgment_id in sorted(judgment_ids - graph_ids):
        errors.append(f"business_instance_graph 缺少 Judgment {judgment_id}")
    executed = {
        str(item.get("application_id"))
        for item in apps_04
        if isinstance(item, dict) and item.get("status") == "executed"
    }
    for item in judgments:
        if not isinstance(item, dict):
            continue
        jid = str(item.get("judgment_id") or item.get("id") or "")
        _required(item, (
            "judgment_unit_id", "title", "conclusion", "rationale", "strength", "confidence", "decision_status",
            "conflict_status", "scope_ref", "cutoff_at", "hypothesis_ids", "rule_evaluation_ids",
            "method_application_ids", "invalidation_conditions",
        ), f"judgment {jid}", errors)
        unit = str(item.get("judgment_unit_id") or "")
        if unit and unit not in units:
            errors.append(f"judgment {jid} 引用未知 judgment unit {unit}")
        ma_refs = item.get("method_application_ids") or item.get("method_application_refs") or []
        indeterminate = _is_strict_j0_stop(item, app_maps[2])
        if not ma_refs:
            errors.append(f"judgment {jid} 缺少 MethodApplication 引用")
        elif not indeterminate and not any(str(ref) in executed for ref in ma_refs):
            errors.append(f"judgment {jid} 缺少 executed MethodApplication")
        elif any(str(ref) not in app_maps[2] for ref in ma_refs):
            errors.append(f"judgment {jid} MethodApplication 引用无法解析")
        hypothesis_refs = [str(ref) for ref in item.get("hypothesis_ids") or []]
        evidence_refs = [str(ref) for ref in [*(item.get("supporting_evidence_draft_ids") or []), *(item.get("counter_evidence_draft_ids") or [])]]
        if not evidence_refs and not indeterminate:
            errors.append(f"judgment {jid} 缺少事实级证据")
        signal_evidence: set[str] = set()
        for hypothesis_ref in hypothesis_refs:
            hypothesis = hypotheses.get(hypothesis_ref)
            if not hypothesis:
                errors.append(f"judgment {jid} 引用未知假设 {hypothesis_ref}")
                continue
            for signal_ref in hypothesis.get("signal_ids") or []:
                signal_evidence.update(str(ref) for ref in (signals.get(str(signal_ref)) or {}).get("evidence_draft_ids") or [])
        bypass = [ref for ref in evidence_refs if ref not in signal_evidence]
        if bypass:
            errors.append(f"judgment {jid} 证据绕过 Signal/Hypothesis: {', '.join(bypass)}")
        required_trace_refs = {jid, *hypothesis_refs, *evidence_refs, *[str(ref) for ref in item.get("rule_evaluation_ids") or []], *[str(ref) for ref in ma_refs]}
        for hypothesis_ref in hypothesis_refs:
            required_trace_refs.update(str(ref) for ref in (hypotheses.get(hypothesis_ref) or {}).get("signal_ids") or [])
        matching_traces = [trace for trace in traces if str(trace.get("judgment_id") or trace.get("judgment_ref")) == jid]
        if not any(required_trace_refs.issubset({str(ref) for ref in trace.get("node_ids") or trace.get("node_refs") or []}) for trace in matching_traces):
            errors.append(f"judgment {jid} 缺少完整 ReasoningTrace")

    for hypothesis_id, hypothesis in hypotheses.items():
        if hypothesis.get("signal_ids"):
            continue
        linked_judgments = [
            item for item in judgments
            if isinstance(item, dict)
            and hypothesis_id in {str(ref) for ref in item.get("hypothesis_ids") or []}
        ]
        if not linked_judgments or not all(_is_strict_j0_stop(item, app_maps[2]) for item in linked_judgments):
            errors.append(f"hypothesis {hypothesis_id} 缺少实质字段 signal_ids")

    claims = expression.get("report_claims") or expression.get("expressions") or []
    if not claims:
        errors.append("05_expression 缺少 report_claims/expressions")
    for item in claims:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or item.get("expression_id") or "")
        # Empty evidence/source lineage is legal only for the strict J0 stop
        # checked below. Keeping this conditional avoids globally weakening 05.
        _required(item, ("statement",), f"expression {cid}", errors)
        j_refs = item.get("judgment_ids") or ([item["source_claim_id"]] if item.get("source_claim_id") else [])
        if not j_refs:
            errors.append(f"expression {cid} 缺少 judgment 追溯")
        referenced_judgments = []
        for ref in j_refs:
            if str(ref) not in judgment_ids:
                errors.append(f"expression {cid} 引用未知 judgment {ref}")
            else:
                referenced_judgments.append(next(
                    value for value in judgments
                    if str(value.get("judgment_id") or value.get("id")) == str(ref)
                ))
        only_indeterminate = bool(referenced_judgments) and all(
            _is_strict_j0_stop(value, app_maps[2]) for value in referenced_judgments
        )
        allowed_evidence = {
            str(ref)
            for value in referenced_judgments
            for ref in [
                *(value.get("supporting_evidence_draft_ids") or []),
                *(value.get("counter_evidence_draft_ids") or []),
            ]
        }
        expression_evidence = [str(ref) for ref in item.get("evidence_draft_ids") or []]
        if not expression_evidence and not only_indeterminate:
            errors.append(f"expression {cid} 缺少实质字段 evidence_draft_ids")
        expression_sources = [str(ref) for ref in item.get("source_ids") or []]
        if not expression_sources and not only_indeterminate:
            errors.append(f"expression {cid} 缺少实质字段 source_ids")
        for ref in expression_evidence:
            if ref not in allowed_evidence or ref not in draft_ids:
                errors.append(f"expression {cid} 引用来源 Judgment 未使用的证据 {ref}")
        expected_sources = {
            str(source_ref)
            for evidence_item in drafts
            if isinstance(evidence_item, dict)
            and str(evidence_item.get("id") or evidence_item.get("evidence_id")) in expression_evidence
            for source_ref in (evidence_item.get("source_ids") or evidence_item.get("source_refs") or [])
        }
        if expected_sources != {str(ref) for ref in item.get("source_ids") or []}:
            errors.append(f"expression {cid}.source_ids 未由 evidence_draft_ids 唯一派生")
        ma_refs = item.get("method_application_ids") or item.get("source_method_application_refs") or []
        if not ma_refs:
            errors.append(f"expression {cid} 缺少 MethodApplication 追溯")
        else:
            allowed_methods = {
                str(ref)
                for value in referenced_judgments
                for ref in value.get("method_application_ids") or []
            }
            for ref in ma_refs:
                application = app_maps[2].get(str(ref))
                if not application or (application.get("status") != "executed" and not (only_indeterminate and application.get("status") in {"blocked", "degraded", "rejected"})):
                    errors.append(f"expression {cid} 引用了不可表达的 MethodApplication {ref}")
                elif str(ref) not in allowed_methods:
                    errors.append(f"expression {cid} 引用了来源 Judgment 未使用的 MethodApplication {ref}")
            if only_indeterminate:
                expression_ma_refs = {str(ref) for ref in ma_refs}
                for value in referenced_judgments:
                    jid = str(value.get("judgment_id") or value.get("id") or "")
                    if not (_terminal_adjudication_refs(value, app_maps[2]) & expression_ma_refs):
                        errors.append(f"expression {cid} 未保留 J0 Judgment {jid} 的终态 adjudication MethodApplication")

    stages = manifest.get("stages") or {}
    for stage in STAGE_KEYS:
        entry = stages.get(stage)
        if not isinstance(entry, dict):
            errors.append(f"run_manifest.stages.{stage} 缺失")
            continue
        artifacts = entry.get("artifact") or []
        if not artifacts:
            errors.append(f"run_manifest.stages.{stage}.artifact 为空")

    stage03_binding = artifact_bindings.get("stage_03") or {}
    stage04_binding = artifact_bindings.get("stage_04") or {}
    stage05_binding = artifact_bindings.get("stage_05") or {}
    if baseline.get("frozen_stage03_artifact_id") != stage03_binding.get("artifact_id") or baseline.get("frozen_stage03_artifact_hash") != stage03_binding.get("content_hash"):
        errors.append("baseline 不对应导出的当前 stage_03 冻结证据")
    if review.get("reviewed_stage04_artifact_id") != stage04_binding.get("artifact_id") or review.get("reviewed_stage04_artifact_hash") != stage04_binding.get("content_hash"):
        errors.append("independent_review 不对应导出的当前 stage_04")
    if review.get("verdict") != "pass" or review.get("issues"):
        errors.append("independent_review 未形成无阻断项的 pass")
    independent_model = (
        review.get("independence_level") == "independent_model"
        and review.get("reviewer_type", "model") == "model"
        and review.get("reviewer_model")
        and review.get("reviewer_model") != review.get("producer_model")
    )
    independent_human = (
        review.get("independence_level") == "independent_human"
        and review.get("reviewer_type") == "human"
        and str(review.get("reviewer_model") or "").startswith("human:")
        and review.get("reviewer_model") != review.get("producer_model")
        and len(str(review.get("reviewer_attestation") or "").strip()) >= 20
    )
    if not independent_model and not independent_human:
        errors.append("independent_review 的审阅者身份或独立性声明不可验证")
    if review_wrapper.get("model_name") != review.get("reviewer_model"):
        errors.append("independent_review 的 reviewer_model 与产物元数据不一致")
    if evaluation.get("baseline_artifact_id") != baseline_wrapper.get("artifact_id") or evaluation.get("runtime_report_artifact_id") != stage05_binding.get("artifact_id"):
        errors.append("evaluation 不对应当前 baseline/stage_05")
    if evaluation.get("frozen_stage03_artifact_id") != stage03_binding.get("artifact_id") or evaluation.get("frozen_stage03_artifact_hash") != stage03_binding.get("content_hash"):
        errors.append("evaluation 不对应当前冻结证据")
    expected_score_keys = {f"{side}:{criterion}" for side in ("A", "B") for criterion in (
        "事实与来源可核验性", "无来源主张控制", "反证与竞争解释", "结论边界", "可复盘性", "研究决策帮助",
    )}
    if set((evaluation.get("scores") or {}).keys()) != expected_score_keys:
        errors.append("evaluation 评分准则不完整或被替换")
    if evaluation.get("revealed") is not True or evaluation.get("side_a") not in {"baseline", "runtime"}:
        errors.append("evaluation 未完成盲评揭示")

    non_gap_drafts = [item for item in drafts if isinstance(item, dict) and item.get("kind") != "gap"]
    if non_gap_drafts and not any(
        set(item.get("source_keys") or item.get("source_ids") or item.get("source_refs") or [])
        for item in non_gap_drafts
        if isinstance(item, dict)
    ):
        # Facts cannot exist without source lineage. A pure-gap J0 package is
        # intentionally source-free and remains valid.
        if all(
            not (item.get("source_keys") or item.get("source_ids") or item.get("source_refs"))
            for item in non_gap_drafts
            if isinstance(item, dict)
        ):
            errors.append("03_evidence 非 gap 草稿均未绑定来源")

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="校验工作台导出包")
    parser.add_argument("run_dir", type=Path, help="导出目录")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    args = parser.parse_args(argv)
    errors = validate_workbench_package(args.run_dir)
    ok = not errors
    payload = {
        "ok": ok,
        "package_kind": KIND_WORKBENCH,
        "error_count": len(errors),
        "errors": errors,
        "publishable": False,
        "publish_status": "workbench_validate_passed" if ok else "workbench_validate_failed",
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        if errors:
            for error in errors:
                print(f"ERROR: {error}")
            print(f"WORKBENCH_PACKAGE_RETURN_REQUIRED: {len(errors)} error(s)")
        else:
            print("WORKBENCH_PACKAGE_PASS: compact layout + MethodApplication/judgment/expression trace ok; publishable=false")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
