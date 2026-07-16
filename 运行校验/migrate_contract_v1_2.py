#!/usr/bin/env python3
"""Upgrade current example runs to the 2.2/3.3/manifest 1.2 loop contract."""

from __future__ import annotations

import csv
import sys
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "运行校验"))

from ontology_instance_graph import compact_task_view, materialize_document  # noqa: E402
from research_contract import canonical_sha256, task_view_hash  # noqa: E402
from validate_publish import discover_artifacts  # noqa: E402
from validate_run import build_manifest  # noqa: E402
from validator_utils import artifact_sha256, load_yaml_file  # noqa: E402


ITERATION_CONTRACT = {
    "evidence_wave_unit": "frozen_batch",
    "evidence_wave_schema_ref": "运行校验/模板/evidence_wave.template.yaml",
    "dependency_projection_schema_ref": "运行校验/模板/dependency_projection.template.yaml",
    "ontology_authority": "formal_ontology",
    "stage_attempt_policy": "immutable_superseding",
    "structural_revision_relation_ref": "reasoningSupersedes",
    "structural_revision_action_ref": "ReviseReasoningObject",
    "routes": {
        "task_contract_revision": "stage_01",
        "reasoning_structure_revision": "stage_02",
        "evidence_update": "stage_03",
        "presentation_revision": "stage_05",
        "no_semantic_delta": None,
    },
    "convergence_contract_ref": "00_全局/contracts/public_contract.yaml#iteration_semantics",
}

REASONING_RELATIONS = [
    "observationOf",
    "evidenceGroundsReasoning",
    "hypothesisAbout",
    "hypothesisBasedOn",
    "signalEvaluates",
    "ruleEvaluationTargets",
    "judgmentBasedOn",
    "traceIncludesRuleEvaluation",
    "traceForJudgment",
]


def write_yaml(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        yaml.safe_dump(value, allow_unicode=True, sort_keys=False, width=160),
        encoding="utf-8",
    )


def first_csv_value(path: Path, field: str) -> str:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        row = next(csv.DictReader(handle), None)
    value = str((row or {}).get(field, "")).strip()
    if not value:
        raise ValueError(f"{path} 缺少 {field}")
    return value


def upgrade_view(view_path: Path) -> dict[str, Any]:
    raw = yaml.safe_load(view_path.read_text(encoding="utf-8-sig"))
    view = materialize_document(raw)
    view["schema_version"] = "2.2.0"
    view["iteration_contract"] = ITERATION_CONTRACT
    context = view["task_context"]
    context["view_version"] = 2
    context.setdefault("frozen_at", context.get("generated_at"))
    plan = view["reasoning_plan"]
    plan["relation_type_refs"] = list(REASONING_RELATIONS)
    context["view_hash"] = ""
    context["view_hash"] = task_view_hash(view)
    write_yaml(view_path, compact_task_view(view))
    return materialize_document(yaml.safe_load(view_path.read_text(encoding="utf-8")))


def build_reasoning_instances(
    audit: dict[str, Any],
    view: dict[str, Any],
    snapshot_dir: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    input_ref = first_csv_value(snapshot_dir / "02_assets" / "reasoning_inputs.csv", "input_id")
    evidence_ref = first_csv_value(snapshot_dir / "02_assets" / "evidence_facts.csv", "fact_id")
    slots = view["reasoning_plan"].get("hypothesis_slots", [])
    rules = view["reasoning_plan"].get("inference_rule_refs", [])
    variables = view["reasoning_plan"].get("state_variable_refs", [])
    if not slots or not rules or not variables:
        raise ValueError("2.2 reasoning_plan 缺少假设槽位、规则或状态变量")
    hypotheses: list[dict[str, Any]] = []
    signals: list[dict[str, Any]] = []
    evaluations: list[dict[str, Any]] = []
    judgments: list[dict[str, Any]] = []
    traces: list[dict[str, Any]] = []
    projection_nodes: list[dict[str, Any]] = []
    projection_edges: list[dict[str, Any]] = []
    as_of = str(audit["metadata"].get("judgment_as_of", ""))
    fact_node = {
        "object_ref": evidence_ref,
        "object_type_ref": "EvidenceFact",
        "stage": "stage_03",
        "content_hash": canonical_sha256({"evidence_fact_ref": evidence_ref}),
        "validity_status": "current",
        "critical": False,
    }
    projection_nodes.append(fact_node)
    for index, claim in enumerate(audit["claim_register"], 1):
        claim_id = str(claim["claim_id"])
        suffix = f"{index:02d}"
        hypothesis_id = f"HYP-RUN-{suffix}"
        signal_id = f"SIG-RUN-{suffix}"
        evaluation_id = f"RE-RUN-{suffix}"
        judgment_id = f"J-RUN-{suffix}"
        trace_id = f"RT-RUN-{suffix}"
        slot = slots[(index - 1) % len(slots)]
        slot_variables = slot.get("state_variable_refs") or variables[:1]
        hypotheses.append({
            "hypothesis_id": hypothesis_id,
            "source_slot_ref": slot["hypothesis_slot_id"],
            "statement": claim["statement"],
            "state_variable_refs": slot_variables,
            "direction": "conditional",
            "time_horizon": claim.get("time_horizon") or as_of,
            "falsification_conditions": slot.get("falsification_conditions") or ["见改判条件"],
            "signal_refs": [signal_id],
            "evaluation_status": "evaluated",
        })
        signals.append({
            "signal_id": signal_id,
            "statement": claim["statement"],
            "role": "support",
            "strength": "moderate",
            "observed_at": as_of,
            "target_hypothesis_refs": [hypothesis_id],
            "input_refs": [input_ref],
            "evidence_refs": [evidence_ref],
        })
        evaluations.append({
            "rule_evaluation_id": evaluation_id,
            "rule_ref": rules[(index - 1) % len(rules)],
            "rule_version": "1.0.0",
            "evaluated_at": as_of,
            "input_refs": [input_ref],
            "evidence_refs": [evidence_ref],
            "target_refs": [hypothesis_id],
            "condition_results": ["matched"],
            "status": "matched",
            "result_summary": claim["statement"],
            "output_refs": [judgment_id],
        })
        judgments.append({
            "judgment_id": judgment_id,
            "claim_id": claim_id,
            "statement": claim["statement"],
            "hypothesis_refs": [hypothesis_id],
            "rule_evaluation_refs": [evaluation_id],
            "target_claim_type": claim["target_claim_type"],
            "judgment_level": claim["judgment_level"],
            "conditions": claim.get("conditions", []),
            "scope": claim.get("scope", claim.get("scope_ref", "")),
            "time_horizon": claim.get("time_horizon") or as_of,
            "confidence": claim.get("confidence", "medium"),
            "uncertainty_refs": [],
        })
        traces.append({
            "trace_id": trace_id,
            "judgment_ref": judgment_id,
            "evaluated_at": as_of,
            "input_refs": [input_ref],
            "rule_evaluation_refs": [evaluation_id],
            "steps": ["证据输入", "假设评价", "形成判断"],
            "rule_refs": [rules[(index - 1) % len(rules)]],
            "output_refs": [claim_id],
            "status": "complete",
        })
        typed_nodes = [
            (signal_id, "Signal", "stage_03", signals[-1]),
            (hypothesis_id, "Hypothesis", "stage_04", hypotheses[-1]),
            (evaluation_id, "RuleEvaluation", "stage_04", evaluations[-1]),
            (judgment_id, "Judgment", "stage_04", judgments[-1]),
            (claim_id, "ReportClaim", "stage_05", claim),
        ]
        projection_nodes.extend({
            "object_ref": ref,
            "object_type_ref": object_type,
            "stage": stage,
            "content_hash": canonical_sha256(payload),
            "validity_status": "current",
            "critical": object_type in {"Hypothesis", "RuleEvaluation", "Judgment", "ReportClaim"},
        } for ref, object_type, stage, payload in typed_nodes)
        for code, upstream, downstream, relation in [
            ("FACT-SIGNAL", evidence_ref, signal_id, "evidenceGroundsReasoning"),
            ("SIGNAL-HYP", signal_id, hypothesis_id, "signalEvaluates"),
            ("HYP-EVAL", hypothesis_id, evaluation_id, "ruleEvaluationTargets"),
            ("EVAL-J", evaluation_id, judgment_id, "ruleEvaluationTargets"),
            ("J-CLAIM", judgment_id, claim_id, "stageProjection"),
        ]:
            projection_edges.append({
                "dependency_ref": f"DEP-{suffix}-{code}",
                "upstream_ref": upstream,
                "downstream_ref": downstream,
                "basis_relation_ref": relation,
            })
    audit["hypotheses"] = hypotheses
    audit["signals"] = signals
    audit["rule_evaluations"] = evaluations
    audit["judgments"] = judgments
    audit["reasoning_traces"] = traces
    return projection_nodes, projection_edges


def upgrade_run(run_name: str, parent_name: str | None) -> None:
    run_dir = ROOT / run_name
    artifacts = discover_artifacts(run_dir)
    if artifacts.view is None or artifacts.audit is None or artifacts.snapshot_dir is None:
        raise ValueError(f"{run_name} 缺少 02/03/04 产物")
    view = upgrade_view(artifacts.view)
    audit = load_yaml_file(artifacts.audit)
    audit["schema_version"] = "4.0.0"
    nodes, edges = build_reasoning_instances(audit, view, artifacts.snapshot_dir)
    projection_path = run_dir / "ontology_dependency_projection.yaml"
    projection = {
        "schema_name": "ontology_dependency_projection",
        "schema_version": "1.0.0",
        "task_id": audit["metadata"]["task_id"],
        "run_id": audit["metadata"]["execution_id"],
        "source_02_view_hash": view["task_context"]["view_hash"],
        "nodes": nodes,
        "edges": edges,
    }
    write_yaml(projection_path, projection)
    audit["iteration_context"] = {
        "evidence_wave_refs": [],
        "evidence_wave_hashes": [],
        "dependency_projection_ref": projection_path.name,
        "dependency_projection_hash": artifact_sha256(projection_path),
        "source_stage_attempts": {"stage_02": 1, "stage_03": 1},
        "current_stage_attempt": 1,
        "supersedes_stage_attempt": None,
        "critical_stale_refs_at_start": [],
        "critical_stale_refs_at_completion": [],
        "structural_checkpoint_ref": None,
    }
    audit["reasoning_revision_register"] = []
    write_yaml(artifacts.audit, audit)

    if artifacts.expression_audit is None:
        raise ValueError(f"{run_name} 缺少 05 表达审计")
    expression_audit = load_yaml_file(artifacts.expression_audit)
    expression_audit["metadata"]["source_04_audit_hash"] = artifact_sha256(artifacts.audit)
    write_yaml(artifacts.expression_audit, expression_audit)

    refreshed = discover_artifacts(run_dir)
    manifest = build_manifest(
        refreshed,
        parent_manifest_path=(ROOT / parent_name / "run_manifest.yaml") if parent_name else None,
        run_mode="fixture",
        producer_id=str(load_yaml_file(run_dir / "run_manifest.yaml").get("producer_id", "fixture-producer")),
    )
    semantic_review = load_yaml_file(refreshed.semantic_review)
    semantic_review["inputs"]["public_contract_version"] = "1.2.0"
    semantic_review["inputs"]["stage_hashes"] = {
        stage: manifest["stages"][stage]["hash"]
        for stage in ("stage_02", "stage_03", "stage_04", "stage_05")
    }
    write_yaml(refreshed.semantic_review, semantic_review)
    write_yaml(run_dir / "run_manifest.yaml", manifest)


def main() -> int:
    upgrade_run("示例1", "示例1-基线-20260713-1")
    upgrade_run("示例2", None)
    print("MIGRATE_CONTRACT_V1_2_PASS: 当前两个样例已升级，历史基线保持旧版。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
