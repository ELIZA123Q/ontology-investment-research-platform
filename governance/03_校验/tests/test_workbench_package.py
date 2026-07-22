#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "governance/03_校验/validate_workbench_package.py"
spec = importlib.util.spec_from_file_location("validate_workbench_package", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
# ensure sibling imports resolve
import sys

sys.path.insert(0, str(ROOT / "governance/03_校验"))
spec.loader.exec_module(validator)


def _write_minimal_package(run_dir: Path) -> None:
    cutoff = "2026-07-18T08:00:00+08:00"
    rule_names = [
        "evidence_scope_time_alignment", "no_direct_evidence_to_judgment", "judgment_reference_integrity",
        "judgment_evidence_threshold", "judgment_status_consistency", "state_time_consistency",
        "semiconductor_proxy_disclosure", "semiconductor_qualification_stage_alignment",
        "semiconductor_capacity_yield_scope_alignment",
    ]
    ma = {
        "application_id": "MA-01",
        "method_id": "kb03:A02",
        "method_version": "3.2.0",
        "capability_type": "evidence",
        "target_question_refs": ["Q-01"],
        "target_judgment_unit_refs": ["JU-01"],
        "target_ontology_object_refs": [],
        "status": "executed",
        "precondition_checks": [{"precondition_id": "evidence_ready", "result": "pass", "evidence_refs": ["EV-01"], "reason": "verified"}],
        "input_evidence_refs": ["EV-01"],
        "output_signal_refs": ["SIG-01"],
        "output_judgment_refs": ["C-01"],
        "execution_summary": "ok",
        "applicability_boundary": "test",
        "limitations": [],
        "counter_example_refs": [],
        "provenance": {
            "stage": "stage_04",
            "source_application_id": "MA-01",
            "actor": "test",
            "recorded_at": "2026-07-18T00:00:00+08:00",
        },
        "alternatives": [],
    }
    (run_dir / "package_kind.yaml").write_text(
        yaml.safe_dump({"package_kind": "workbench_export"}),
        encoding="utf-8",
    )
    structure = {
        "stage": "02", "research_scope": {"id": "SCOPE-01", "label": "测试范围", "dimensions": {"domain": "semiconductor"}},
        "judgment_units": [{"judgment_unit_id": "JU-01", "id": "JU-01", "statement": "库存是否下降", "title": "库存", "question": "库存是否下降", "judgment_type": "state_measurement", "scope_ref": "SCOPE-01"}],
        "method_applications": [{**ma, "status": "candidate", "precondition_checks": [], "input_evidence_refs": [], "output_signal_refs": [], "output_judgment_refs": [], "execution_summary": "", "provenance": {**ma["provenance"], "stage": "stage_02", "source_application_id": None, "recorded_at": None}}],
    }
    evidence = {
        "stage": "03", "method_applications": [{**ma, "status": "selected", "output_signal_refs": [], "output_judgment_refs": [], "execution_summary": "", "provenance": {**ma["provenance"], "stage": "stage_03", "recorded_at": None}}],
        "evidence_drafts": [{
            "id": "EV-01", "kind": "fact_draft", "statement": "可比口径库存下降", "subject_ref": "SV-01", "time_basis": "observation_time",
            "scope_ref": "SCOPE-01", "observed_at": "2026-07-17T00:00:00+08:00", "valid_from": "2026-07-17T00:00:00+08:00",
            "published_at": "2026-07-18T00:00:00+08:00", "cutoff_at": cutoff, "directness": "direct", "limitations": [],
            "source_keys": ["src-1"], "source_ids": ["SRC-DB-01"], "judgment_unit_ids": ["JU-01"],
        }],
    }
    rules = [{
        "id": f"RE-{index}", "rule_ref": name, "input_refs": ["EV-01"],
        "condition_results": [{"condition_id": "runtime", "expression": "verified", "input_refs": ["EV-01"], "outcome": "pass", "rationale": "verified"}],
        "result": "pass", "deterministic_result": {"engine_version": "runtime-semantic-rules-3.0.0", "result": "pass", "rationale": "verified", "evaluated_at": cutoff},
    } for index, name in enumerate(rule_names, 1)]
    judgment = {
        "stage": "04", "method_applications": [ma],
        "signals": [{"id": "SIG-01", "statement": "库存下降构成支持信号", "role": "support", "evidence_draft_ids": ["EV-01"], "judgment_unit_ids": ["JU-01"], "target_hypothesis_ids": ["H-01"]}],
        "hypotheses": [{"id": "H-01", "statement": "库存处于下降阶段", "signal_ids": ["SIG-01"], "falsification_conditions": ["库存回升"], "time_horizon": "未来一季度"}],
        "competing_explanations": [{"id": "CE-01", "statement": "季节性波动", "signal_ids": ["SIG-01"], "discriminating_evidence": ["跨季数据"], "status": "weakened", "elimination_rationale": "直接证据部分削弱"}],
        "rule_evaluations": rules,
        "judgments": [{
            "id": "C-01", "judgment_id": "C-01", "judgment_unit_id": "JU-01", "title": "库存观察", "conclusion": "库存存在下降迹象", "rationale": "仅一组直接来源，限定为 J1",
            "strength": "J1", "confidence": "low", "decision_status": "supported", "conflict_status": "none", "scope_ref": "SCOPE-01", "cutoff_at": cutoff, "conditions": [],
            "supporting_evidence_draft_ids": ["EV-01"], "counter_evidence_draft_ids": [], "hypothesis_ids": ["H-01"],
            "rule_evaluation_ids": [rule["id"] for rule in rules], "method_application_ids": ["MA-01"], "ontology_node_ids": ["SV-01"],
            "uncertainties": ["样本期较短"], "invalidation_conditions": ["库存回升"], "tracking_signals": ["库存"],
        }],
        "reasoning_traces": [{"id": "RT-01", "judgment_id": "C-01", "node_ids": ["SCOPE-01", "JU-01", "EV-01", "SIG-01", "H-01", *[rule["id"] for rule in rules], "MA-01", "C-01"], "created_at": cutoff}],
    }
    expression = {"stage": "05", "report_claims": [{"id": "EX-01", "statement": "库存存在下降迹象", "judgment_ids": ["C-01"], "method_application_ids": ["MA-01"], "evidence_draft_ids": ["EV-01"], "source_ids": ["SRC-DB-01"]}]}
    stages = {"stage_02": structure, "stage_03": evidence, "stage_04": judgment, "stage_05": expression}
    bindings = {
        stage: {"artifact_id": f"ART-{stage}", "content_hash": __import__("hashlib").sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()}
        for stage, value in stages.items()
    }
    task = {"stage": "01", "question": "测试问题是否可判断？"}
    bindings["stage_01"] = {"artifact_id": "ART-stage_01", "content_hash": __import__("hashlib").sha256(json.dumps(task, ensure_ascii=False, sort_keys=True).encode()).hexdigest()}
    (run_dir / "run_manifest.yaml").write_text(
        yaml.safe_dump({
            "schema_name": "controlled_research_run_manifest_workbench",
            "schema_version": "1.0.0",
            "package_kind": "workbench_export",
            "run_mode": "workbench",
            "contract_ref": {
                "schema_name": "controlled_research_run_manifest",
                "schema_version": "1.3.0",
            },
            "validation_summary": {"publishable": False},
            "export_meta": {"artifact_bindings": bindings},
            "stages": {
                "stage_01": {"artifact": ["01_task.yaml"]},
                "stage_02": {"artifact": ["02_structure.yaml"]},
                "stage_03": {"artifact": ["03_evidence.yaml"]},
                "stage_04": {"artifact": ["04_judgment.yaml"]},
                "stage_05": {"artifact": ["05_expression.yaml", "05_report.md"]},
            },
        }),
        encoding="utf-8",
    )
    (run_dir / "01_task.yaml").write_text(yaml.safe_dump(task), encoding="utf-8")
    (run_dir / "02_structure.yaml").write_text(yaml.safe_dump(structure), encoding="utf-8")
    (run_dir / "03_evidence.yaml").write_text(yaml.safe_dump(evidence), encoding="utf-8")
    (run_dir / "04_judgment.yaml").write_text(yaml.safe_dump(judgment), encoding="utf-8")
    (run_dir / "05_expression.yaml").write_text(yaml.safe_dump(expression), encoding="utf-8")
    (run_dir / "05_report.md").write_text(
        "# 测试报告\n\n当前判断、主要依据与适用范围均继承自阶段 04。\n",
        encoding="utf-8",
    )
    (run_dir / "business_instance_graph.yaml").write_text(
        yaml.safe_dump({
            "business_instance_graph": {
                "schema_name": "ontology_business_instance_graph",
                "schema_version": "1.0.0",
                "authority": "business_parameters",
                "objects": [
                    {"id": "SCOPE-01", "type": "ResearchScope", "properties": {"label": "测试范围", "dimensions": {"domain": "semiconductor"}}, "projection": {"section": "research_scope", "index": 0}},
                    {"id": "JU-01", "type": "JudgmentUnit", "properties": {"statement": "库存是否下降", "judgment_type": "state_measurement", "scope_ref": "SCOPE-01"}, "projection": {"section": "judgment_units", "index": 0}},
                    {"id": "SD-01", "type": "SourceDocument", "properties": {"title": "公告", "uri": "https://example.com", "published_at": "2026-07-18T00:00:00+08:00", "source_tier": "S2"}, "projection": {"section": "sources", "index": 0}},
                    {"id": "CL-01", "type": "EvidenceClaim", "properties": {"statement": "库存下降", "locator": "p1", "extracted_at": cutoff, "cutoff_at": cutoff}, "projection": {"section": "claims", "index": 0}},
                    {"id": "EV-01", "type": "EvidenceFact", "properties": {"statement": "库存下降", "subject_ref": "SV-01", "time_basis": "observation_time", "scope_ref": "SCOPE-01", "observed_at": "2026-07-17T00:00:00+08:00", "valid_from": "2026-07-17T00:00:00+08:00", "published_at": "2026-07-18T00:00:00+08:00", "cutoff_at": cutoff}, "projection": {"section": "evidence_drafts", "index": 0}},
                    {"id": "SIG-01", "type": "Signal", "properties": {"statement": "支持信号", "role": "support"}, "projection": {"section": "signals", "index": 0}},
                    {"id": "H-01", "type": "Hypothesis", "properties": {"statement": "库存下降", "falsification_conditions": ["库存回升"], "time_horizon": "一季度"}, "projection": {"section": "hypotheses", "index": 0}},
                    *[{"id": rule["id"], "type": "RuleEvaluation", "properties": {key: value for key, value in rule.items() if key != "id"}, "projection": {"section": "rule_evaluations", "index": index}} for index, rule in enumerate(rules)],
                    {"id": "C-01", "type": "Judgment", "properties": {"statement": "库存存在下降迹象", "level": "J1", "confidence": "low", "decision_status": "supported", "conflict_status": "none", "scope_ref": "SCOPE-01", "cutoff_at": cutoff, "conditions": [], "invalidation_conditions": ["库存回升"]}, "projection": {"section": "judgments", "index": 0}},
                    {"id": "RT-01", "type": "ReasoningTrace", "properties": {"judgment_ref": "C-01", "node_refs": ["SCOPE-01", "JU-01", "EV-01", "SIG-01", "H-01", *[rule["id"] for rule in rules], "MA-01", "C-01"], "created_at": cutoff}, "projection": {"section": "reasoning_traces", "index": 0}},
                    {"id": "MA-01", "type": "MethodApplication", "properties": ma, "projection": {"section": "method_applications", "index": 0}},
                ],
                "relations": [
                    {"id": "R-JU-SCOPE", "type": "unitUsesScope", "sourceId": "JU-01", "targetId": "SCOPE-01", "properties": {}},
                    {"id": "R-CL-SD", "type": "claimCitesSource", "sourceId": "CL-01", "targetId": "SD-01", "properties": {}},
                    {"id": "R-EV-CL", "type": "factDerivedFromClaim", "sourceId": "EV-01", "targetId": "CL-01", "properties": {}},
                    {"id": "R-SIG-EV", "type": "signalGroundedByFact", "sourceId": "SIG-01", "targetId": "EV-01", "properties": {"role": "support"}},
                    {"id": "R-SIG-H", "type": "signalEvaluatesHypothesis", "sourceId": "SIG-01", "targetId": "H-01", "properties": {}},
                    {"id": "R-JU-H", "type": "unitHasHypothesis", "sourceId": "JU-01", "targetId": "H-01", "properties": {"role": "primary"}},
                    {"id": "R-J-H", "type": "judgmentBasedOnHypothesis", "sourceId": "C-01", "targetId": "H-01", "properties": {}},
                    *[{"id": f"R-J-{rule['id']}", "type": "judgmentHasRuleEvaluation", "sourceId": "C-01", "targetId": rule["id"], "properties": {}} for rule in rules],
                    {"id": "R-J-JU", "type": "judgmentResolvesUnit", "sourceId": "C-01", "targetId": "JU-01", "properties": {}},
                    {"id": "R-MA-JU", "type": "runtimeMethodApplicationTargets", "sourceId": "MA-01", "targetId": "JU-01", "properties": {}},
                    {"id": "R-J-MA", "type": "runtimeJudgmentUsesMethodApplication", "sourceId": "C-01", "targetId": "MA-01", "properties": {}},
                    {"id": "R-RT-J", "type": "reasoningTraceForJudgment", "sourceId": "RT-01", "targetId": "C-01", "properties": {}},
                    *[{"id": f"R-RT-{index}", "type": "traceIncludesNode", "sourceId": "RT-01", "targetId": node, "properties": {"sequence": index}} for index, node in enumerate(["SCOPE-01", "JU-01", "EV-01", "SIG-01", "H-01", *[rule["id"] for rule in rules]], 1)],
                ],
            }
        }),
        encoding="utf-8",
    )
    (run_dir / "sources.json").write_text(
        json.dumps([{
            "id": "SRC-DB-01",
            "content_hash": "a" * 64,
            "captured_at": "2026-07-18T00:00:00+08:00",
            "locator": "quote:事实",
            "published_at": "2026-07-18T00:00:00+08:00",
            "source_tier": "S2",
            "source_group": "example.com",
            "source_quote": "事实",
            "retrieval_status": "captured",
            "usability_status": "usable",
            "quote_verified": True,
        }], ensure_ascii=False),
        encoding="utf-8",
    )
    baseline = {"frozen_stage03_artifact_id": bindings["stage_03"]["artifact_id"], "frozen_stage03_artifact_hash": bindings["stage_03"]["content_hash"]}
    review = {"reviewed_stage04_artifact_id": bindings["stage_04"]["artifact_id"], "reviewed_stage04_artifact_hash": bindings["stage_04"]["content_hash"], "verdict": "pass", "issues": [], "reviewer_model": "reviewer-model", "producer_model": "producer-model", "independence_level": "independent_model"}
    criteria = ["事实与来源可核验性", "无来源主张控制", "反证与竞争解释", "结论边界", "可复盘性", "研究决策帮助"]
    evaluation = {"baseline_artifact_id": "BASE-01", "runtime_report_artifact_id": bindings["stage_05"]["artifact_id"], "frozen_stage03_artifact_id": bindings["stage_03"]["artifact_id"], "frozen_stage03_artifact_hash": bindings["stage_03"]["content_hash"], "scores": {f"{side}:{criterion}": 4 for side in ("A", "B") for criterion in criteria}, "revealed": True, "side_a": "baseline"}
    for name, artifact_id, model_name, content in (("baseline.yaml", "BASE-01", "producer-model", baseline), ("independent_review.yaml", "REV-01", "reviewer-model", review), ("evaluation.yaml", "EVAL-01", None, evaluation)):
        raw = json.dumps(content, ensure_ascii=False, sort_keys=True)
        (run_dir / name).write_text(yaml.safe_dump({"artifact_id": artifact_id, "model_name": model_name, "content_hash": __import__("hashlib").sha256(raw.encode()).hexdigest(), "json_content": raw, "content": content}, allow_unicode=True), encoding="utf-8")


def _convert_to_strict_j0_package(run_dir: Path) -> None:
    structure = yaml.safe_load((run_dir / "02_structure.yaml").read_text(encoding="utf-8"))
    evidence = yaml.safe_load((run_dir / "03_evidence.yaml").read_text(encoding="utf-8"))
    judgment = yaml.safe_load((run_dir / "04_judgment.yaml").read_text(encoding="utf-8"))
    expression = yaml.safe_load((run_dir / "05_expression.yaml").read_text(encoding="utf-8"))

    for application in structure["method_applications"]:
        application["capability_type"] = "adjudication"
    for application in evidence["method_applications"]:
        application["capability_type"] = "adjudication"
    for application in judgment["method_applications"]:
        application["capability_type"] = "adjudication"
        application["status"] = "blocked"

    hypothesis = judgment["hypotheses"][0]
    hypothesis["signal_ids"] = []
    result = judgment["judgments"][0]
    result.update({
        "strength": "J0",
        "decision_status": "indeterminate",
        "not_judgeable_reason": "缺少第二个独立来源，不能形成方向判断",
        "supporting_evidence_draft_ids": [],
        "counter_evidence_draft_ids": [],
    })
    expression["report_claims"][0]["statement"] = "现有证据不足，暂不可判断"
    expression["report_claims"][0]["evidence_draft_ids"] = []
    expression["report_claims"][0]["source_ids"] = []

    (run_dir / "02_structure.yaml").write_text(yaml.safe_dump(structure, allow_unicode=True), encoding="utf-8")
    (run_dir / "03_evidence.yaml").write_text(yaml.safe_dump(evidence, allow_unicode=True), encoding="utf-8")
    (run_dir / "04_judgment.yaml").write_text(yaml.safe_dump(judgment, allow_unicode=True), encoding="utf-8")
    (run_dir / "05_expression.yaml").write_text(yaml.safe_dump(expression, allow_unicode=True), encoding="utf-8")


class WorkbenchPackageTests(unittest.TestCase):
    def test_minimal_package_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            _write_minimal_package(run_dir)
            self.assertEqual(validator.validate_workbench_package(run_dir), [])

    def test_attested_human_independent_review_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            _write_minimal_package(run_dir)
            path = run_dir / "independent_review.yaml"
            wrapper = yaml.safe_load(path.read_text(encoding="utf-8"))
            review = dict(wrapper["content"])
            review.update({
                "reviewer_model": "human:reviewer-zhang",
                "reviewer_type": "human",
                "reviewer_attestation": "本人未参与该判断生产，并确认不存在影响独立判断的利益冲突。",
                "independence_level": "independent_human",
            })
            raw = json.dumps(review, ensure_ascii=False, sort_keys=True)
            wrapper.update({
                "model_name": "human:reviewer-zhang",
                "json_content": raw,
                "content": review,
                "content_hash": __import__("hashlib").sha256(raw.encode()).hexdigest(),
            })
            path.write_text(yaml.safe_dump(wrapper, allow_unicode=True), encoding="utf-8")
            self.assertEqual(validator.validate_workbench_package(run_dir), [])

    def test_rejects_v3_sample_directory(self) -> None:
        sample = ROOT / "instances/02_V3样例/01_memory-cycle-run-002"
        errors = validator.validate_workbench_package(sample)
        self.assertTrue(errors)
        self.assertTrue(any("semantic_fixture" in error or "validate_v3_samples" in error for error in errors))

    def test_publishable_true_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            _write_minimal_package(run_dir)
            manifest = yaml.safe_load((run_dir / "run_manifest.yaml").read_text(encoding="utf-8"))
            manifest["validation_summary"]["publishable"] = True
            (run_dir / "run_manifest.yaml").write_text(yaml.safe_dump(manifest), encoding="utf-8")
            errors = validator.validate_workbench_package(run_dir)
            self.assertTrue(any("publishable" in error for error in errors))

    def test_strict_j0_allows_empty_signal_evidence_and_source_lineage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            _write_minimal_package(run_dir)
            _convert_to_strict_j0_package(run_dir)
            self.assertEqual(validator.validate_workbench_package(run_dir), [])

    def test_j0_without_reason_cannot_use_empty_lineage_exception(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            _write_minimal_package(run_dir)
            _convert_to_strict_j0_package(run_dir)
            judgment = yaml.safe_load((run_dir / "04_judgment.yaml").read_text(encoding="utf-8"))
            judgment["judgments"][0]["not_judgeable_reason"] = ""
            (run_dir / "04_judgment.yaml").write_text(yaml.safe_dump(judgment, allow_unicode=True), encoding="utf-8")
            errors = validator.validate_workbench_package(run_dir)
            self.assertTrue(any("hypothesis H-01 缺少实质字段 signal_ids" in error for error in errors))
            self.assertTrue(any("expression EX-01 缺少实质字段 evidence_draft_ids" in error for error in errors))
            self.assertTrue(any("expression EX-01 缺少实质字段 source_ids" in error for error in errors))

    def test_j0_cannot_impersonate_adjudication_with_other_capability(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            _write_minimal_package(run_dir)
            _convert_to_strict_j0_package(run_dir)
            for name in ("02_structure.yaml", "03_evidence.yaml", "04_judgment.yaml"):
                document = yaml.safe_load((run_dir / name).read_text(encoding="utf-8"))
                document["method_applications"][0]["capability_type"] = "evidence"
                (run_dir / name).write_text(yaml.safe_dump(document, allow_unicode=True), encoding="utf-8")
            errors = validator.validate_workbench_package(run_dir)
            self.assertTrue(any("hypothesis H-01 缺少实质字段 signal_ids" in error for error in errors))
            self.assertTrue(any("expression EX-01 缺少实质字段 evidence_draft_ids" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
