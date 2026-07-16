#!/usr/bin/env python3
"""本体驱动证据波次闭环的分类、失效传播、attempt 与收敛回归。"""

from __future__ import annotations

import copy
import sys
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "运行校验"))
from research_loop import (  # noqa: E402
    ResearchLoopError,
    archive_current_attempts,
    begin_manifest_attempts,
    build_iteration_plan,
    classify_evidence_wave,
    commit_manifest_attempts,
    convergence_status,
    evidence_wave_hash,
    propagate_object_staleness,
    stage_artifact_hash,
)
from research_contract import task_view_hash  # noqa: E402
from ontology_instance_graph import (  # noqa: E402
    compact_task_view,
    materialize_document,
    validate_instance_graph,
)

sys.path.insert(0, str(ROOT / "02_判断结构"))
from validate_02_outputs import _validate_iteration_contract  # noqa: E402
sys.path.insert(0, str(ROOT / "04_推理"))
from validate_04_outputs import _validate_iteration_audit  # noqa: E402
from validator_utils import artifact_sha256  # noqa: E402
from validate_publish import discover_artifacts  # noqa: E402
from validate_run import _manifest_validation, build_manifest  # noqa: E402


def _view() -> dict:
    path = next((ROOT / "示例1").glob("02-*本体视图-*.yaml"))
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _current_view_hash() -> str:
    return materialize_document(_view())["task_context"]["view_hash"]


def _wave(*, ontology_deltas: list[dict] | None = None, task_deltas: list[dict] | None = None,
          presentation_deltas: list[dict] | None = None, evidence_refs: list[str] | None = None) -> dict:
    return {
        "schema_name": "ontology_evidence_wave",
        "schema_version": "1.0.0",
        "wave_id": "WAVE-20260715-01",
        "wave_hash": "",
        "task_id": "JTASK-MEM-CYCLE-001",
        "run_id": "EXEC-MEM-CYCLE-20260715-1",
        "wave_status": "frozen",
        "frozen_at": "2026-07-15T18:00:00+08:00",
        "source_02_view_hash": _current_view_hash(),
        "evidence_refs": evidence_refs or [],
        "ontology_deltas": ontology_deltas or [],
        "task_contract_deltas": task_deltas or [],
        "presentation_deltas": presentation_deltas or [],
    }


def _bindings(**overrides: list[str]) -> dict[str, list[str]]:
    result = {
        "state_variable_refs": [],
        "hypothesis_refs": [],
        "path_refs": [],
        "judgment_unit_refs": [],
        "evidence_requirement_refs": [],
        "scope_refs": [],
        "competing_explanation_refs": [],
        "relation_type_refs": [],
        "object_type_refs": [],
    }
    result.update(overrides)
    return result


def _evidence_delta() -> dict:
    return {
        "delta_id": "DELTA-OBS-01",
        "operation": "instantiate",
        "resource_kind": "object",
        "ontology_ref": "Observation",
        "object_ref": "OBS-WAVE-01",
        "prior_object_ref": None,
        "evidence_refs": ["EV-WAVE-01"],
        "affects_refs": ["EV-01"],
        "bindings": _bindings(
            state_variable_refs=["end_market_demand_strength"],
            hypothesis_refs=["HS-01"],
            path_refs=["P-01"],
            judgment_unit_refs=["JU-02"],
            evidence_requirement_refs=["ER-01"],
            scope_refs=["SCOPE-HBM"],
        ),
    }


def _projection() -> dict:
    return {
        "schema_name": "ontology_dependency_projection",
        "schema_version": "1.0.0",
        "task_id": "JTASK-MEM-CYCLE-001",
        "run_id": "EXEC-MEM-CYCLE-20260715-1",
        "source_02_view_hash": _current_view_hash(),
        "nodes": [
            {"object_ref": "EV-01", "object_type_ref": "EvidenceClaim", "stage": "stage_03", "content_hash": "sha256:" + "1" * 64, "validity_status": "current", "critical": False},
            {"object_ref": "OBS-01", "object_type_ref": "Observation", "stage": "stage_03", "content_hash": "sha256:" + "2" * 64, "validity_status": "current", "critical": True},
            {"object_ref": "H-01", "object_type_ref": "Hypothesis", "stage": "stage_04", "content_hash": "sha256:" + "3" * 64, "validity_status": "current", "critical": True},
            {"object_ref": "RE-01", "object_type_ref": "RuleEvaluation", "stage": "stage_04", "content_hash": "sha256:" + "4" * 64, "validity_status": "current", "critical": True},
            {"object_ref": "J-01", "object_type_ref": "Judgment", "stage": "stage_04", "content_hash": "sha256:" + "5" * 64, "validity_status": "current", "critical": True},
            {"object_ref": "GAP-01", "object_type_ref": "ExpectationGap", "stage": "stage_04", "content_hash": "sha256:" + "6" * 64, "validity_status": "current", "critical": False},
            {"object_ref": "C-01", "object_type_ref": "ReportClaim", "stage": "stage_05", "content_hash": "sha256:" + "7" * 64, "validity_status": "current", "critical": True},
        ],
        "edges": [
            {"dependency_ref": "DEP-01", "upstream_ref": "EV-01", "downstream_ref": "OBS-01", "basis_relation_ref": "evidenceGroundsReasoning"},
            {"dependency_ref": "DEP-02", "upstream_ref": "OBS-01", "downstream_ref": "H-01", "basis_relation_ref": "hypothesisBasedOn"},
            {"dependency_ref": "DEP-03", "upstream_ref": "H-01", "downstream_ref": "RE-01", "basis_relation_ref": "ruleEvaluationTargets"},
            {"dependency_ref": "DEP-04", "upstream_ref": "RE-01", "downstream_ref": "J-01", "basis_relation_ref": "ruleEvaluationTargets"},
            {"dependency_ref": "DEP-05", "upstream_ref": "J-01", "downstream_ref": "GAP-01", "basis_relation_ref": "gapComparesJudgment"},
            {"dependency_ref": "DEP-06", "upstream_ref": "GAP-01", "downstream_ref": "C-01", "basis_relation_ref": "stageProjection"},
        ],
    }


class ResearchLoopTests(unittest.TestCase):
    def test_current_02_contract_survives_instance_graph_projection(self) -> None:
        view_source = next((ROOT / "示例1").glob("02-*本体视图-*.yaml"))
        raw_view = yaml.safe_load(view_source.read_text(encoding="utf-8"))
        view = materialize_document(raw_view)
        view["schema_version"] = "2.2.0"
        view["task_context"].update({
            "view_version": 2,
            "view_hash": "",
            "frozen_at": "2026-07-15T18:00:00+08:00",
        })
        view["reasoning_plan"]["relation_type_refs"] = [
            "hypothesisBasedOn",
            "ruleEvaluationTargets",
            "judgmentBasedOn",
        ]
        view["iteration_contract"] = {
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
        view["task_context"]["view_hash"] = task_view_hash(view)

        compacted_view = compact_task_view(view)
        validate_instance_graph(compacted_view["business_instance_graph"])
        projected_view = materialize_document(compacted_view)
        self.assertEqual(
            projected_view["task_context"]["view_hash"],
            task_view_hash(projected_view),
        )
        _validate_iteration_contract(projected_view)

        changed = copy.deepcopy(projected_view)
        changed["task_context"]["normalized_question"] += "范围变化"
        self.assertNotEqual(
            changed["task_context"]["view_hash"],
            task_view_hash(changed),
        )

    def test_current_04_audit_requires_ontology_revision_semantics(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audit_path = root / "04-audit.yaml"
            view = materialize_document(_view())
            view["schema_version"] = "2.2.0"
            view["task_context"]["view_hash"] = ""
            view["task_context"]["view_hash"] = task_view_hash(view)
            view_path = root / "02-view.yaml"
            view_path.write_text(
                yaml.safe_dump(compact_task_view(view), allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )
            wave = _wave(evidence_refs=["EV-WAVE-01"])
            wave["source_02_view_hash"] = view["task_context"]["view_hash"]
            wave_path = root / "evidence_wave.yaml"
            wave_path.write_text(yaml.safe_dump(wave, allow_unicode=True), encoding="utf-8")
            projection = _projection()
            projection["source_02_view_hash"] = view["task_context"]["view_hash"]
            for node in projection["nodes"]:
                if node["object_ref"] == "J-01":
                    node["validity_status"] = "stale"
            projection_path = root / "dependency_projection.yaml"
            projection_path.write_text(
                yaml.safe_dump(projection, allow_unicode=True), encoding="utf-8"
            )
            audit = {
                "metadata": {
                    "task_id": "JTASK-MEM-CYCLE-001",
                    "execution_id": "EXEC-MEM-CYCLE-20260715-1",
                    "source_02_view_ref": "02-view.yaml",
                },
                "iteration_context": {
                "evidence_wave_refs": ["evidence_wave.yaml"],
                "evidence_wave_hashes": [evidence_wave_hash(wave)],
                "dependency_projection_ref": "dependency_projection.yaml",
                "dependency_projection_hash": artifact_sha256(projection_path),
                "source_stage_attempts": {"stage_02": 2, "stage_03": 2},
                "current_stage_attempt": 2,
                "supersedes_stage_attempt": 1,
                "critical_stale_refs_at_start": ["J-01"],
                "critical_stale_refs_at_completion": [],
                "structural_checkpoint_ref": None,
                },
                "reasoning_revision_register": [{
                "revision_id": "REV-J-01",
                "new_object_ref": "JUDGMENT-NEW",
                "superseded_object_ref": "JUDGMENT-OLD",
                "object_type_ref": "Judgment",
                "relation_type_ref": "reasoningSupersedes",
                "action_ref": "ReviseReasoningObject",
                "revision_type": "evidence_update",
                "revision_reason": "新证据改变了既有判断的支持结构",
                "trigger_refs": ["EV-WAVE-01"],
                "revised_at": "2026-07-15T18:10:00+08:00",
                "new_reasoning_trace_ref": "TRACE-NEW",
                "new_scope_ref": "SCOPE-ROOT",
                "superseded_scope_ref": "SCOPE-ROOT",
                }],
            }
            _validate_iteration_audit(audit, audit_path)

            audit["reasoning_revision_register"][0]["relation_type_ref"] = "supersedes"
            with self.assertRaisesRegex(Exception, "reasoningSupersedes"):
                _validate_iteration_audit(audit, audit_path)

    def test_existing_ontology_mapping_updates_03_and_affected_04(self) -> None:
        wave = _wave(ontology_deltas=[_evidence_delta()], evidence_refs=["EV-WAVE-01"])
        result = classify_evidence_wave(_view(), wave)
        self.assertEqual(result["classification"], "evidence_update")
        self.assertEqual(result["return_to_stage"], "stage_03")
        self.assertEqual(result["rerun_stages"], ["stage_03", "stage_04", "stage_05"])

    def test_wave_identity_must_match_current_02_task(self) -> None:
        wave = _wave(evidence_refs=["EV-WAVE-01"])
        wave["task_id"] = "WRONG-TASK"
        with self.assertRaisesRegex(ResearchLoopError, "task_id"):
            classify_evidence_wave(_view(), wave)

    def test_projection_requires_full_hash_and_valid_object_stage(self) -> None:
        projection = _projection()
        projection["nodes"][0]["content_hash"] = "sha256:short"
        with self.assertRaisesRegex(ResearchLoopError, "content_hash"):
            propagate_object_staleness(projection, ["EV-01"])
        projection = _projection()
        projection["nodes"][0]["stage"] = "stage_05"
        with self.assertRaisesRegex(ResearchLoopError, "阶段归属"):
            propagate_object_staleness(projection, ["EV-01"])

    def test_unreachable_stage_05_does_not_create_blanket_attempt(self) -> None:
        projection = _projection()
        projection["nodes"] = [
            node for node in projection["nodes"] if node["object_ref"] != "C-01"
        ]
        projection["edges"] = [
            edge for edge in projection["edges"] if edge["downstream_ref"] != "C-01"
        ]
        plan = build_iteration_plan(
            _view(),
            _wave(ontology_deltas=[_evidence_delta()], evidence_refs=["EV-WAVE-01"]),
            dependency_projection=projection,
        )
        self.assertEqual(plan["required_stage_attempts"], ["stage_03", "stage_04"])

    def test_manifest_false_convergence_blocks_release(self) -> None:
        artifacts = discover_artifacts(ROOT / "示例1")
        manifest = build_manifest(artifacts, run_mode="fixture", producer_id="test")
        manifest["reasoning_loop"]["converged"] = False
        statuses, issues, _ = _manifest_validation(manifest, artifacts)
        self.assertEqual(statuses["stage_05"], "revalidation_required")
        self.assertTrue(any(item["issue_id"] == "LOOP-NOT-CONVERGED" for item in issues))

    def test_new_state_variable_forces_complete_02_attempt(self) -> None:
        delta = _evidence_delta()
        delta.update({
            "delta_id": "DELTA-SV-NEW",
            "ontology_ref": "StateVariable",
            "object_ref": "new_margin_bridge_variable",
            "affects_refs": ["H-01"],
            "bindings": _bindings(
                state_variable_refs=["new_margin_bridge_variable"],
                path_refs=["P-01"],
                judgment_unit_refs=["JU-02"],
                scope_refs=["SCOPE-HBM"],
            ),
        })
        plan = build_iteration_plan(_view(), _wave(ontology_deltas=[delta]), dependency_projection=_projection())
        self.assertEqual(plan["classification"], "reasoning_structure_revision")
        self.assertEqual(plan["return_to_stage"], "stage_02")
        self.assertEqual(plan["stage_02_checkpoint"], "full_quality_gate_required")
        self.assertIn("stage_02", plan["required_stage_attempts"])

    def test_root_scope_change_returns_to_01(self) -> None:
        wave = _wave(task_deltas=[{
            "change_id": "TASK-01",
            "field_ref": "task_context.scope.geography",
            "prior_value_hash": "sha256:old",
            "proposed_value": "中国大陆",
        }])
        result = classify_evidence_wave(_view(), wave)
        self.assertEqual(result["classification"], "task_contract_revision")
        self.assertEqual(result["return_to_stage"], "stage_01")

    def test_presentation_only_change_returns_to_05(self) -> None:
        wave = _wave(presentation_deltas=[{
            "change_id": "PRES-01",
            "field_ref": "presentation.chart_order",
            "prior_value_hash": "sha256:old",
            "proposed_value": ["chart-02", "chart-01"],
        }])
        result = classify_evidence_wave(_view(), wave)
        self.assertEqual(result["classification"], "presentation_revision")
        self.assertEqual(result["rerun_stages"], ["stage_05"])

    def test_same_frozen_wave_is_idempotent(self) -> None:
        wave = _wave(ontology_deltas=[_evidence_delta()], evidence_refs=["EV-WAVE-01"])
        digest = evidence_wave_hash(wave)
        result = classify_evidence_wave(_view(), wave, seen_wave_hashes=[digest])
        self.assertEqual(result["classification"], "no_semantic_delta")
        self.assertEqual(result["rerun_stages"], [])

    def test_stale_propagates_by_object_dependency_not_blanket_stage(self) -> None:
        result = propagate_object_staleness(_projection(), ["EV-01"])
        self.assertEqual(
            result["stale_object_refs"],
            ["EV-01", "OBS-01", "H-01", "RE-01", "J-01", "GAP-01", "C-01"],
        )
        self.assertIn("C-01", result["critical_stale_refs"])
        self.assertEqual(result["affected_stages"], ["stage_03", "stage_04", "stage_05"])

    def test_manifest_creates_pending_attempt_without_overwriting_current(self) -> None:
        wave = _wave(ontology_deltas=[_evidence_delta()], evidence_refs=["EV-WAVE-01"])
        plan = build_iteration_plan(_view(), wave, dependency_projection=_projection())
        manifest = yaml.safe_load((ROOT / "示例1" / "run_manifest.yaml").read_text(encoding="utf-8"))
        updated = begin_manifest_attempts(manifest, plan)
        self.assertEqual(updated["schema_version"], "1.2.0")
        self.assertEqual(updated["stages"]["stage_03"]["attempt"], 1)
        self.assertEqual(updated["stages"]["stage_03"]["pending_attempt"]["attempt"], 2)
        self.assertIsNone(updated["stages"]["stage_02"].get("pending_attempt"))

    def test_archived_attempt_is_immutable_and_new_attempt_can_commit(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            stages: dict[str, dict] = {}
            for index, stage in enumerate(("stage_01", "stage_02", "stage_03", "stage_04", "stage_05"), 1):
                artifact = root / f"{stage}.txt"
                artifact.write_text(f"old-{stage}", encoding="utf-8")
                stages[stage] = {
                    "artifact": [artifact.name],
                    "hash": stage_artifact_hash(root, [artifact.name]),
                    "source_hashes": {},
                    "stage_status": "complete",
                    "validity_status": "current",
                    "attempt": 1,
                    "supersedes_attempt": None,
                }
            manifest = {
                "schema_name": "controlled_research_run_manifest",
                "schema_version": "1.2.0",
                "task_id": "JTASK-MEM-CYCLE-001",
                "run_id": "EXEC-MEM-CYCLE-20260715-1",
                "stages": stages,
            }
            plan = {
                "task_id": manifest["task_id"],
                "run_id": manifest["run_id"],
                "wave_id": "WAVE-01",
                "wave_hash": "sha256:wave",
                "plan_hash": "sha256:plan",
                "classification": "evidence_update",
                "required_stage_attempts": ["stage_03"],
                "stage_02_checkpoint": "not_required",
                "stale_propagation": {"stale_object_refs": [], "stale_objects": []},
            }
            archives = archive_current_attempts(manifest, root, ["stage_03"])
            pending = begin_manifest_attempts(manifest, plan, archive_records=archives)
            (root / "stage_03.txt").write_text("new-stage_03", encoding="utf-8")
            committed = commit_manifest_attempts(
                pending, root, stages_to_commit=["stage_03"]
            )
            stage = committed["stages"]["stage_03"]
            self.assertEqual(stage["attempt"], 2)
            self.assertEqual(stage["supersedes_attempt"], 1)
            self.assertEqual(stage["attempt_history"][0]["attempt_state"], "superseded")
            archive_ref = stage["attempt_history"][0]["archived_artifacts"][0]["archive_ref"]
            self.assertEqual((root / archive_ref).read_text(encoding="utf-8"), "old-stage_03")
            self.assertNotEqual(stage["hash"], stage["attempt_history"][0]["hash"])

    def test_convergence_is_semantic_and_accepts_contested_conflict(self) -> None:
        state = {
            "pending_structural_trigger_refs": [],
            "critical_stale_refs": [],
            "pending_stage_attempts": [],
            "attempt_hashes": {"stage_04": {"declared_hash": "sha256:a", "actual_hash": "sha256:a"}},
            "conflicts": [{"conflict_ref": "CONFLICT-01", "resolution_status": "contested"}],
            "latest_wave": {"key_judgment_changed": False, "key_path_changed": False},
            "structural_impact_scope_unresolved": False,
        }
        self.assertTrue(convergence_status(state)["converged"])

        open_state = copy.deepcopy(state)
        open_state["conflicts"][0]["resolution_status"] = "open"
        self.assertFalse(convergence_status(open_state)["converged"])

    def test_iteration_count_cannot_define_convergence(self) -> None:
        with self.assertRaisesRegex(ResearchLoopError, "循环次数"):
            convergence_status({"max_iterations": 3})


if __name__ == "__main__":
    unittest.main()
