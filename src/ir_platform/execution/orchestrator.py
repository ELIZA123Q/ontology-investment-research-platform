from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import uuid4

from ir_platform.causal import (
    contains_direct_causal_language,
    validate_causal_assessment,
    validate_causal_design,
    validate_causal_judgment,
    validate_claim_language,
)
from ir_platform.decision_comparison import validate_decision_comparison
from ir_platform.evidence_handoff import validate_evidence_handoff
from ir_platform.final_validation import validate_final_artifact_validation
from ir_platform.methodology import ResearchMethodRegistry
from ir_platform.planning.models import ExecutionNode, ExecutionPlan
from ir_platform.research_design import render_equity_report, validate_equity_report, validate_research_design
from ir_platform.rules import RuleEvaluator, RuleRegistry
from ir_platform.runtime.models import GraphBundle, RuntimeEntity, RuntimeRelation
from ir_platform.runtime.repository import ResearchGraphRepository

from .capabilities import CapabilityCall, CapabilityRegistry


class PipelineAdapter(Protocol):
    def execute_layer(self, calls: list[tuple[ExecutionNode, Any]]) -> dict[str, Any]: ...


class LocalPipelineAdapter:
    def execute_layer(self, calls: list[tuple[ExecutionNode, Any]]) -> dict[str, Any]:
        return {node.id: handler() for node, handler in calls}


@dataclass(frozen=True)
class ExecutionSummary:
    plan_id: str
    status: str
    completed_nodes: list[str]
    waiting_for_types: list[str]
    failed_nodes: list[str]


class ResearchOrchestrator:
    def __init__(
        self,
        repository: ResearchGraphRepository,
        capabilities: CapabilityRegistry | None = None,
        rules: RuleRegistry | None = None,
        pipeline_adapter: PipelineAdapter | None = None,
    ) -> None:
        self.repository = repository
        self.capabilities = capabilities or CapabilityRegistry()
        self.rules = rules or RuleRegistry()
        self.rule_evaluator = RuleEvaluator()
        self.pipeline_adapter = pipeline_adapter or LocalPipelineAdapter()

    def start(
        self,
        plan: ExecutionPlan,
        *,
        bundle_id: str,
        seed_entities: list[RuntimeEntity],
        runtime_context: dict[str, Any] | None = None,
    ) -> ExecutionSummary:
        self.persist_plan(plan, bundle_id=bundle_id, seed_entities=seed_entities)
        return self.resume(plan, bundle_id=bundle_id, runtime_context=runtime_context)

    def persist_plan(
        self,
        plan: ExecutionPlan,
        *,
        bundle_id: str,
        seed_entities: list[RuntimeEntity],
    ) -> None:
        if self.repository.get_entity(plan.id) is None:
            self._persist_plan(plan, bundle_id, seed_entities)

    def resume(
        self,
        plan: ExecutionPlan,
        *,
        bundle_id: str,
        runtime_context: dict[str, Any] | None = None,
    ) -> ExecutionSummary:
        context = dict(runtime_context or {})
        while True:
            entities = self.repository.list_entities(bundle_id)
            completed, failed, attempt_counts = self._attempt_state(entities, plan.id)
            rule_context = self._rule_context(plan, entities, bundle_id, context)
            self._evaluate_runtime_triggers(plan, bundle_id, entities, rule_context)
            requires_new_equity_run = bool((plan.planning_context.get("methodology") or {}).get("research_design_required"))
            equity_required_capabilities = {"form_research_design", "publish_report"}
            if (plan.planning_context.get("methodology") or {}).get("macro_context_required"):
                equity_required_capabilities.add("form_macro_context")
            if (plan.planning_context.get("methodology") or {}).get("final_artifact_validation_required"):
                equity_required_capabilities.update({"package_evidence_handoff", "validate_final_artifact"})
            required_current_nodes = {
                node.id for node in plan.nodes
                if node.capability_ref in equity_required_capabilities
            }
            current_run_complete = not requires_new_equity_run or required_current_nodes.issubset(completed)
            if (
                current_run_complete
                and any(entity.type in plan.goal_types for entity in entities)
                and self._completion_rules_match(plan, bundle_id, rule_context)
            ):
                return ExecutionSummary(plan.id, "completed", sorted(completed), [], sorted(failed))
            node_map = {node.id: node for node in plan.nodes}
            pending = [node for node in plan.nodes if node.id not in completed]
            ready = [node for node in pending if set(node.dependencies).issubset(completed)]
            if not ready:
                status = "failed" if failed else "blocked"
                return ExecutionSummary(plan.id, status, sorted(completed), [], sorted(failed))
            available_types = {entity.type for entity in entities}
            runnable: list[ExecutionNode] = []
            waiting: set[str] = set()
            blocked_missing: set[str] = set()
            for node in ready:
                missing = set(node.input_types) - available_types
                waiting.update(missing & set(plan.awaitable_types))
                blocked_missing.update(missing - set(plan.awaitable_types))
                if missing:
                    continue
                if not self._runtime_activation_rules_match(plan, node, bundle_id, rule_context):
                    blocked_missing.add(f"activation_rule:{node.id}")
                else:
                    runnable.append(node)
            if not runnable:
                for node in ready:
                    missing = sorted(set(node.input_types) - available_types)
                    reason = "missing_input" if missing else "activation_rule_not_matched"
                    self._record_block(plan, node, bundle_id, reason, missing)
                return ExecutionSummary(
                    plan.id,
                    "awaiting_input" if waiting and not blocked_missing else "blocked",
                    sorted(completed),
                    sorted(waiting | blocked_missing),
                    sorted(failed),
                )
            calls = []
            for node in runnable:
                definition, handler = self.capabilities.resolve(node.capability_ref)
                node_inputs = [entity for entity in entities if entity.type in node.input_types]
                call = CapabilityCall(bundle_id, plan.id, node, definition, node_inputs, context)
                calls.append((node, lambda handler=handler, call=call: handler(call)))
            try:
                results = self.pipeline_adapter.execute_layer(calls)
            except Exception as exc:
                node = runnable[0]
                self._record_failure(plan, node, bundle_id, attempt_counts.get(node.id, 0) + 1, exc)
                if not node.idempotent or attempt_counts.get(node.id, 0) >= node.max_retries:
                    return ExecutionSummary(plan.id, "failed", sorted(completed), [], sorted({*failed, node.id}))
                continue
            for node in runnable:
                try:
                    self._record_success(
                        plan,
                        node,
                        bundle_id,
                        attempt_counts.get(node.id, 0) + 1,
                        results[node.id],
                    )
                except Exception as exc:
                    sequence = attempt_counts.get(node.id, 0) + 1
                    self._record_failure(plan, node, bundle_id, sequence, exc)
                    if not node.idempotent or attempt_counts.get(node.id, 0) >= node.max_retries:
                        return ExecutionSummary(
                            plan.id, "failed", sorted(completed), [], sorted({*failed, node.id})
                        )

    def _persist_plan(self, plan: ExecutionPlan, bundle_id: str, seeds: list[RuntimeEntity]) -> None:
        now = plan.compiled_at
        plan_entity = RuntimeEntity(
            id=plan.id,
            type="PlanRevision" if plan.supersedes else "ExecutionPlan",
            properties=plan.model_dump(mode="json"),
            recorded_at=now,
            supersedes=plan.supersedes,
            bundle_id=bundle_id,
        )
        node_entities = [
            RuntimeEntity(
                id=f"{plan.id}:node:{node.id}",
                type="ExecutionNode",
                properties=node.model_dump(mode="json"),
                recorded_at=now,
                bundle_id=bundle_id,
            )
            for node in plan.nodes
        ]
        relations = [
            RuntimeRelation(
                id=f"{plan.id}:contains:{node.id}",
                type="planContainsNode",
                source_id=plan.id,
                target_id=f"{plan.id}:node:{node.id}",
                recorded_at=now,
                bundle_id=bundle_id,
            )
            for node in plan.nodes
        ]
        for node in plan.nodes:
            for dependency in node.dependencies:
                relations.append(
                    RuntimeRelation(
                        id=f"{plan.id}:depends:{dependency}:{node.id}",
                        type="executionDependsOn",
                        source_id=f"{plan.id}:node:{dependency}",
                        target_id=f"{plan.id}:node:{node.id}",
                        recorded_at=now,
                        bundle_id=bundle_id,
                    )
                )
        self.repository.add_bundle(
            GraphBundle(
                bundle_id=bundle_id,
                entities=[plan_entity, *node_entities, *seeds],
                relations=relations,
            )
        )
        self.repository.record_provenance(
            plan_entity,
            activity_id=f"compile:{plan.id}",
            source=f"proposal:{plan.proposal_id}",
        )
        planning_context = self._rule_context(plan, [*seeds], bundle_id, {})
        for rule_ref in plan.selection_rule_refs:
            self._evaluate_and_record_rule(
                plan,
                rule_ref,
                bundle_id,
                planning_context,
                target_id=plan.id,
                purpose="selected-plan",
            )
        for node in plan.nodes:
            for rule_ref in node.selection_rule_refs:
                rule = self.rules.resolve(rule_ref)
                if rule.evaluation_phase != "runtime":
                    self._evaluate_and_record_rule(
                        plan,
                        rule_ref,
                        bundle_id,
                        planning_context,
                        target_id=f"{plan.id}:node:{node.id}",
                        purpose="selected-node",
                    )

    @staticmethod
    def _attempt_state(
        entities: list[RuntimeEntity], plan_id: str
    ) -> tuple[set[str], set[str], dict[str, int]]:
        completed: set[str] = set()
        failed: set[str] = set()
        counts: dict[str, int] = {}
        attempts = [
            entity for entity in entities
            if entity.type == "ExecutionAttempt" and entity.properties.get("plan_id") == plan_id
        ]
        for attempt in attempts:
            node_id = str(attempt.properties["node_id"])
            counts[node_id] = counts.get(node_id, 0) + 1
            if attempt.properties.get("status") == "completed":
                completed.add(node_id)
                failed.discard(node_id)
            elif node_id not in completed:
                failed.add(node_id)
        return completed, failed, counts

    def _record_success(
        self,
        plan: ExecutionPlan,
        node: ExecutionNode,
        bundle_id: str,
        sequence: int,
        outputs: Any,
    ) -> None:
        if not isinstance(outputs, list) or not all(isinstance(item, RuntimeEntity) for item in outputs):
            raise ValueError(f"能力 {node.capability_ref} 必须返回 RuntimeEntity 列表")
        output_types = {item.type for item in outputs}
        if not output_types.issubset(set(node.output_types)) or not output_types.issubset(set(node.writes)):
            raise ValueError(f"能力 {node.capability_ref} 返回了未授权类型: {sorted(output_types)}")
        self._validate_formal_outputs(node, outputs, bundle_id, plan.id)
        if node.capability_ref == "render_report" and node.parameters.get("equity_report_contract"):
            draft = next(item for item in outputs if item.type == "DraftReport")
            request = plan.planning_context.get("request") or {}
            draft.properties.setdefault("plan_id", plan.id)
            draft.properties.setdefault(
                "content_markdown",
                render_equity_report(draft.properties, title=str(request.get("title") or "A股权益研究")),
            )
        publication_approval: RuntimeEntity | None = None
        if node.capability_ref == "publish_report":
            approvals = [item for item in self.repository.list_entities(bundle_id) if item.type == "ApprovalRecord"]
            approved = [
                item
                for item in approvals
                if item.properties.get("status") == "approved"
                and item.properties.get("approver_type") == "human"
            ]
            if not approved:
                raise ValueError("正式发布缺少人工批准")
            publication_approval = max(approved, key=lambda item: item.recorded_at)
        now = datetime.now(timezone.utc)
        attempt = RuntimeEntity(
            id=f"attempt:{plan.id}:{node.id}:{sequence}:{uuid4()}",
            type="ExecutionAttempt",
            properties={"plan_id": plan.id, "node_id": node.id, "status": "completed", "sequence": sequence},
            recorded_at=now,
            bundle_id=bundle_id,
        )
        node_entity = self.repository.get_entity(f"{plan.id}:node:{node.id}")
        assert node_entity is not None
        relations = [
            RuntimeRelation(
                id=f"attempt-edge:{attempt.id}",
                type="nodeHasAttempt",
                source_id=node_entity.id,
                target_id=attempt.id,
                recorded_at=now,
                bundle_id=bundle_id,
            )
        ]
        causal_lineage_entities: list[RuntimeEntity] = []
        for output in outputs:
            relations.append(
                RuntimeRelation(
                    id=f"result-edge:{attempt.id}:{output.id}",
                    type="attemptProduced",
                    source_id=attempt.id,
                    target_id=output.id,
                    recorded_at=now,
                    bundle_id=bundle_id,
                )
            )
            if output.type == "CausalAssessment" and output.properties.get("design_ref"):
                causal_design = self.repository.get_entity(str(output.properties["design_ref"]))
                if causal_design is not None:
                    causal_lineage_entities.append(causal_design)
                relations.append(
                    RuntimeRelation(
                        id=f"causal-design-edge:{output.properties['design_ref']}:{output.id}",
                        type="causalDesignGuidesAssessment",
                        source_id=str(output.properties["design_ref"]),
                        target_id=output.id,
                        recorded_at=now,
                        bundle_id=bundle_id,
                    )
                )
                causal_evidence_refs = {
                    str(ref)
                    for diagnostic in output.properties.get("diagnostics", [])
                    for ref in diagnostic.get("evidence_refs", [])
                } | {
                    str(ref) for ref in output.properties.get("decisive_evidence_refs", [])
                } | {
                    str(ref)
                    for path in output.properties.get("directional_paths", [])
                    for key in ("lag_evidence_refs", "mediator_evidence_refs")
                    for ref in path.get(key, [])
                }
                for evidence_ref in sorted(causal_evidence_refs):
                    evidence = self.repository.get_entity(evidence_ref)
                    if evidence is not None:
                        causal_lineage_entities.append(evidence)
                    relations.append(
                        RuntimeRelation(
                            id=f"causal-evidence-edge:{evidence_ref}:{output.id}",
                            type="evidenceGroundsCausalAssessment",
                            source_id=evidence_ref,
                            target_id=output.id,
                            recorded_at=now,
                            bundle_id=bundle_id,
                        )
                    )
            if output.type == "Judgment" and output.properties.get("causal_assessment_ref"):
                causal_assessment = self.repository.get_entity(
                    str(output.properties["causal_assessment_ref"])
                )
                if causal_assessment is not None:
                    causal_lineage_entities.append(causal_assessment)
                relations.append(
                    RuntimeRelation(
                        id=f"causal-assessment-edge:{output.properties['causal_assessment_ref']}:{output.id}",
                        type="causalAssessmentSupportsJudgment",
                        source_id=str(output.properties["causal_assessment_ref"]),
                        target_id=output.id,
                        recorded_at=now,
                        bundle_id=bundle_id,
                    )
                )
            if output.type == "DecisionComparison" and output.properties.get("a10_thesis_ref"):
                thesis_ref = str(output.properties["a10_thesis_ref"])
                thesis = self.repository.get_entity(thesis_ref)
                if thesis is not None:
                    causal_lineage_entities.append(thesis)
                relations.append(
                    RuntimeRelation(
                        id=f"decision-comparison-edge:{thesis_ref}:{output.id}",
                        type="judgmentGuidesDecisionComparison",
                        source_id=thesis_ref,
                        target_id=output.id,
                        recorded_at=now,
                        bundle_id=bundle_id,
                    )
                )
            if publication_approval is not None and output.type == "PublishedReport":
                relations.append(
                    RuntimeRelation(
                        id=f"approval-edge:{publication_approval.id}:{output.id}",
                        type="reportApprovedBy",
                        source_id=publication_approval.id,
                        target_id=output.id,
                        recorded_at=now,
                        bundle_id=bundle_id,
                    )
                )
        self.repository.add_bundle(
            GraphBundle(
                bundle_id=bundle_id,
                entities=[
                    node_entity,
                    attempt,
                    *causal_lineage_entities,
                    *([publication_approval] if publication_approval is not None else []),
                    *outputs,
                ],
                relations=relations,
            )
        )
        for output in outputs:
            self.repository.record_provenance(
                output,
                activity_id=f"capability:{plan.id}:{node.id}:{sequence}",
                source=f"capability:{node.capability_ref}@{node.capability_version}",
                used_entities=[item.id for item in self.repository.list_entities(bundle_id) if item.type in node.input_types],
            )

    def _record_failure(
        self,
        plan: ExecutionPlan,
        node: ExecutionNode,
        bundle_id: str,
        sequence: int,
        error: Exception,
    ) -> None:
        now = datetime.now(timezone.utc)
        attempt = RuntimeEntity(
            id=f"attempt:{plan.id}:{node.id}:{sequence}:{uuid4()}",
            type="ExecutionAttempt",
            properties={
                "plan_id": plan.id,
                "node_id": node.id,
                "status": "failed",
                "sequence": sequence,
                "error": str(error),
            },
            recorded_at=now,
            bundle_id=bundle_id,
        )
        node_entity = self.repository.get_entity(f"{plan.id}:node:{node.id}")
        assert node_entity is not None
        relation = RuntimeRelation(
            id=f"attempt-edge:{attempt.id}",
            type="nodeHasAttempt",
            source_id=node_entity.id,
            target_id=attempt.id,
            recorded_at=now,
            bundle_id=bundle_id,
        )
        self.repository.add_bundle(
            GraphBundle(bundle_id=bundle_id, entities=[node_entity, attempt], relations=[relation])
        )

    def _record_block(
        self,
        plan: ExecutionPlan,
        node: ExecutionNode,
        bundle_id: str,
        reason: str,
        missing_types: list[str],
    ) -> None:
        suffix = hashlib.sha256(
            json.dumps({"reason": reason, "missing": missing_types}, sort_keys=True).encode("utf-8")
        ).hexdigest()[:12]
        block_id = f"execution-block:{plan.id}:{node.id}:{suffix}"
        if self.repository.get_entity(block_id) is not None:
            return
        now = datetime.now(timezone.utc)
        block = RuntimeEntity(
            id=block_id,
            type="ExecutionBlock",
            properties={
                "plan_id": plan.id,
                "node_id": node.id,
                "reason": reason,
                "missing_types": missing_types,
                "activation_rule_refs": node.activate_rule_refs,
            },
            recorded_at=now,
            bundle_id=bundle_id,
        )
        node_entity = self.repository.get_entity(f"{plan.id}:node:{node.id}")
        assert node_entity is not None
        relation = RuntimeRelation(
            id=f"block-edge:{block.id}",
            type="nodeBlockedBy",
            source_id=node_entity.id,
            target_id=block.id,
            recorded_at=now,
            bundle_id=bundle_id,
        )
        self.repository.add_bundle(
            GraphBundle(bundle_id=bundle_id, entities=[node_entity, block], relations=[relation])
        )

    def _runtime_activation_rules_match(
        self,
        plan: ExecutionPlan,
        node: ExecutionNode,
        bundle_id: str,
        context: dict[str, Any],
    ) -> bool:
        matches: list[bool] = []
        for rule_ref in node.activate_rule_refs:
            rule = self.rules.resolve(rule_ref)
            if rule.evaluation_phase == "planning":
                continue
            matches.append(
                self._evaluate_and_record_rule(
                    plan,
                    rule_ref,
                    bundle_id,
                    context,
                    target_id=f"{plan.id}:node:{node.id}",
                    purpose="activated-node",
                )
            )
        return all(matches)

    def _completion_rules_match(
        self,
        plan: ExecutionPlan,
        bundle_id: str,
        context: dict[str, Any],
    ) -> bool:
        if not plan.completion_rule_refs:
            return False
        return all(
            self._evaluate_and_record_rule(
                plan,
                rule_ref,
                bundle_id,
                context,
                target_id=plan.id,
                purpose="completed-plan",
            )
            for rule_ref in plan.completion_rule_refs
        )

    def _evaluate_runtime_triggers(
        self,
        plan: ExecutionPlan,
        bundle_id: str,
        entities: list[RuntimeEntity],
        context: dict[str, Any],
    ) -> None:
        available_types = {entity.type for entity in entities}
        for kind in ("validation", "blocking", "scoring"):
            for rule in self.rules.by_kind(kind):
                if rule.evaluation_phase == "planning" or not set(rule.input_types).issubset(available_types):
                    continue
                relevant = [
                    {
                        "id": entity.id,
                        "type": entity.type,
                        "properties": entity.properties,
                    }
                    for entity in entities
                    if entity.type in rule.input_types
                ]
                state_signature = hashlib.sha256(
                    json.dumps(
                        {
                            "inputs": relevant,
                            "evidence": context.get("evidence"),
                            "reasoning": context.get("reasoning"),
                            "approval": context.get("approval"),
                            "state": context.get("state"),
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                        default=str,
                    ).encode("utf-8")
                ).hexdigest()[:16]
                self._evaluate_and_record_rule(
                    plan,
                    rule.id,
                    bundle_id,
                    context,
                    target_id=plan.id,
                    purpose="runtime-trigger",
                    evaluation_key=state_signature,
                )

    def _evaluate_and_record_rule(
        self,
        plan: ExecutionPlan,
        rule_ref: str,
        bundle_id: str,
        context: dict[str, Any],
        *,
        target_id: str,
        purpose: str,
        evaluation_key: str | None = None,
    ) -> bool:
        evaluation_id = f"rule-evaluation:{plan.id}:{purpose}:{target_id}:{rule_ref}"
        if evaluation_key:
            evaluation_id += f":{evaluation_key}"
        existing = self.repository.get_entity(evaluation_id)
        if existing is not None:
            return bool(existing.properties.get("matched"))
        rule = self.rules.resolve(rule_ref)
        result = self.rule_evaluator.evaluate(rule, context)
        now = datetime.now(timezone.utc)
        evaluation = RuntimeEntity(
            id=evaluation_id,
            type="RuleEvaluation",
            properties={
                "rule_id": rule.id,
                "rule_version": rule.version,
                "purpose": purpose,
                "matched": result.matched,
                "actions": result.actions,
                "failure_handling": result.failure_handling,
                "target_id": target_id,
            },
            recorded_at=now,
            bundle_id=bundle_id,
        )
        target = self.repository.get_entity(target_id)
        if target is None:
            raise ValueError(f"规则评价的目标不存在: {target_id}")
        relation = RuntimeRelation(
            id=f"rule-edge:{evaluation_id}",
            type="ruleEvaluatedFor",
            source_id=evaluation.id,
            target_id=target_id,
            recorded_at=now,
            bundle_id=bundle_id,
        )
        self.repository.add_bundle(
            GraphBundle(bundle_id=bundle_id, entities=[evaluation, target], relations=[relation])
        )
        self.repository.record_provenance(
            evaluation,
            activity_id=f"evaluate:{plan.id}:{rule.id}:{purpose}",
            source=f"rule:{rule.id}@{rule.version}",
            used_entities=[target_id],
        )
        return result.matched

    def _validate_formal_outputs(
        self,
        node: ExecutionNode,
        outputs: list[RuntimeEntity],
        bundle_id: str,
        plan_id: str,
    ) -> None:
        if node.capability_ref == "form_research_design":
            designs = [item for item in outputs if item.type == "ResearchDesign"]
            if len(designs) != 1:
                raise ValueError("研究设计节点必须产生一条 ResearchDesign")
            validate_research_design(designs[0].properties, node.parameters["research_design_contract"])
            causal_designs = [item for item in outputs if item.type == "CausalDesign"]
            causal_required = node.parameters.get("causal_design_contract") is not None
            if causal_required:
                if len(causal_designs) != 1:
                    raise ValueError("因果研究设计节点必须同时产生一条 CausalDesign")
                validate_causal_design(causal_designs[0].properties)
                if designs[0].properties.get("causal_design_refs") != [causal_designs[0].id]:
                    raise ValueError("ResearchDesign 必须准确引用本节点的 CausalDesign")
            elif causal_designs:
                raise ValueError("非因果研究设计节点不得产生 CausalDesign")
        if node.capability_ref == "form_macro_context":
            macro_contexts = [item for item in outputs if item.type == "MacroContext"]
            if len(macro_contexts) != 1:
                raise ValueError("宏观研判节点必须产生一条 MacroContext")
            validated = ResearchMethodRegistry().validate_macro_context(macro_contexts[0].properties)
            expected_mode = (node.parameters.get("macro_context_contract") or {}).get("expected_mode")
            if expected_mode and validated.get("mode") != expected_mode:
                raise ValueError("MacroContext.mode 与研究请求的 macro_mode 不一致")
        if node.capability_ref == "package_evidence_handoff":
            handoffs = [item for item in outputs if item.type == "EvidenceHandoff"]
            if len(handoffs) != 1:
                raise ValueError("证据交接节点必须产生一条 EvidenceHandoff")
            validate_evidence_handoff({"evidence_handoff": handoffs[0].properties})
            expected_cutoff = (node.parameters.get("evidence_handoff_contract") or {}).get("information_cutoff")
            if expected_cutoff is not None and str(handoffs[0].properties.get("information_cutoff", ""))[:10] != str(expected_cutoff)[:10]:
                raise ValueError("EvidenceHandoff.information_cutoff 与研究设计信息截面不一致")
        if node.capability_ref == "evaluate_causality":
            assessments = [item for item in outputs if item.type == "CausalAssessment"]
            if len(assessments) != 1:
                raise ValueError("因果评价节点必须产生一条 CausalAssessment")
            design_ref = str(assessments[0].properties.get("design_ref") or "")
            design_entity = self.repository.get_entity(design_ref)
            if (
                design_entity is None
                or design_entity.bundle_id != bundle_id
                or design_entity.type != "CausalDesign"
            ):
                raise ValueError("CausalAssessment 引用的 CausalDesign 不在本研究包")
            validate_causal_assessment(
                assessments[0].properties,
                design=validate_causal_design(design_entity.properties),
            )
            causal_evidence_refs = {
                str(ref)
                for diagnostic in assessments[0].properties.get("diagnostics", [])
                for ref in diagnostic.get("evidence_refs", [])
            } | {
                str(ref) for ref in assessments[0].properties.get("decisive_evidence_refs", [])
            } | {
                str(ref)
                for path in assessments[0].properties.get("directional_paths", [])
                for key in ("lag_evidence_refs", "mediator_evidence_refs")
                for ref in path.get(key, [])
            }
            for evidence_ref in causal_evidence_refs:
                evidence = self.repository.get_entity(evidence_ref)
                if (
                    evidence is None
                    or evidence.bundle_id != bundle_id
                    or evidence.type != "EvidenceFact"
                ):
                    raise ValueError(f"CausalAssessment 正式事实引用无效: {evidence_ref}")
        if node.capability_ref == "render_report" and node.parameters.get("equity_report_contract"):
            drafts = [item for item in outputs if item.type == "DraftReport"]
            if len(drafts) != 1:
                raise ValueError("A股完整权益研究须产生一条 DraftReport")
            validate_equity_report(drafts[0].properties, node.parameters["equity_report_contract"])
            if drafts[0].properties.get("plan_id", plan_id) != plan_id:
                raise ValueError("A股权益草稿不属于本轮计划")
            for evidence_ref in drafts[0].properties["shortest_evidence_chain"]:
                evidence = self.repository.get_entity(evidence_ref)
                if evidence is None or evidence.bundle_id != bundle_id or evidence.type not in {
                    "SourceDocument", "EvidenceFact", "EvidenceAssessment", "Judgment",
                }:
                    raise ValueError(f"A股权益报告证据链引用无效: {evidence_ref}")
            if node.parameters["equity_report_contract"].get("causal_identification_required"):
                report_assessments = []
                for assessment_ref in drafts[0].properties["causal_assessment_refs"]:
                    assessment = self.repository.get_entity(assessment_ref)
                    if (
                        assessment is None
                        or assessment.bundle_id != bundle_id
                        or assessment.type != "CausalAssessment"
                    ):
                        raise ValueError(f"A股权益报告因果评估引用无效: {assessment_ref}")
                    design = self.repository.get_entity(str(assessment.properties.get("design_ref") or ""))
                    if design is None or design.bundle_id != bundle_id or design.type != "CausalDesign":
                        raise ValueError(f"A股权益报告因果设计引用无效: {assessment_ref}")
                    causal_design = validate_causal_design(design.properties)
                    report_assessments.append(
                        (
                            validate_causal_assessment(
                                assessment.properties,
                                design=causal_design,
                            ),
                            causal_design,
                        )
                    )
                causal_summary = str(drafts[0].properties["causal_summary"])
                if len(report_assessments) == 1:
                    causal_assessment, causal_design = report_assessments[0]
                    validate_claim_language(
                        causal_summary,
                        causal_status=causal_assessment.causal_status,
                        cause_a=causal_design.cause_a,
                        outcome_b=causal_design.outcome_b,
                    )
                elif contains_direct_causal_language(causal_summary) and not all(
                    item.causal_status == "identified" for item, _ in report_assessments
                ):
                    raise ValueError("报告汇总含直接因果表达，但并非所有引用评估均为 identified")
        if node.capability_ref == "validate_final_artifact":
            validations = [item for item in outputs if item.type == "FinalArtifactValidation"]
            if len(validations) != 1:
                raise ValueError("独立成品验证节点必须产生一条 FinalArtifactValidation")
            validation = validate_final_artifact_validation(validations[0].properties)
            artifact = self.repository.get_entity(validation.artifact_ref)
            if artifact is None or artifact.bundle_id != bundle_id or artifact.type != "DraftReport":
                raise ValueError("FinalArtifactValidation 引用的 DraftReport 不在本研究包")
            if validation.verdict != (node.parameters.get("final_artifact_validation_contract") or {}).get(
                "required_for_approval", "pass"
            ):
                raise ValueError("独立成品验证未达到发布审批门槛")
        if node.capability_ref == "form_decision_comparison":
            comparisons = [item for item in outputs if item.type == "DecisionComparison"]
            if len(comparisons) != 1:
                raise ValueError("决策比较节点必须产生一条 DecisionComparison")
            comparison = validate_decision_comparison(comparisons[0].properties)
            thesis = self.repository.get_entity(comparison.a10_thesis_ref)
            if thesis is None or thesis.bundle_id != bundle_id or thesis.type != "Judgment":
                raise ValueError("DecisionComparison 引用的 A10 Judgment 不在本研究包")
            if thesis.properties.get("thesis_status") and thesis.properties["thesis_status"] != comparison.a10_thesis_status:
                raise ValueError("DecisionComparison 的 A10 状态与引用 Judgment 不一致")
        if node.capability_ref in {"request_publication_approval", "publish_report"}:
            plan_entity = self.repository.get_entity(plan_id)
            plan_context = (plan_entity.properties if plan_entity is not None else {}).get(
                "planning_context", {}
            )
            if (plan_context.get("methodology") or {}).get("final_artifact_validation_required"):
                passed_validations = [
                    item for item in self.repository.list_entities(bundle_id)
                    if item.type == "FinalArtifactValidation"
                    and item.properties.get("verdict") == "pass"
                    and item.properties.get("independent_from_production") is True
                ]
                if not passed_validations:
                    raise ValueError("发布审批前缺少通过的独立成品验证")
        if node.capability_ref == "publish_report" and node.parameters.get("equity_report_contract"):
            published = [item for item in outputs if item.type == "PublishedReport"]
            if len(published) != 1 or not published[0].properties.get("content_markdown"):
                raise ValueError("A股权益正式报告缺少可追溯正文")
            drafts = [
                item for item in self.repository.list_entities(bundle_id)
                if item.type == "DraftReport" and item.properties.get("plan_id") == plan_id
            ]
            if len(drafts) != 1 or published[0].properties.get("content_markdown") != drafts[0].properties.get("content_markdown"):
                raise ValueError("A股权益正式报告与本轮已审草稿不一致")
        evaluations = [
            item for item in self.repository.list_entities(bundle_id)
            if item.type == "RuleEvaluation" and item.properties.get("matched") is True
        ]
        if "EvidenceFact" in {item.type for item in outputs}:
            if not any(item.properties.get("rule_id") == "formal_fact_gate" for item in evaluations):
                raise ValueError("正式 EvidenceFact 未通过 formal_fact_gate")
        if "Judgment" in {item.type for item in outputs}:
            if not any(item.properties.get("rule_id") == "formal_judgment_gate" for item in evaluations):
                raise ValueError("正式 Judgment 未通过 formal_judgment_gate")
            caps = [
                action["cap_judgment_level"]
                for evaluation in evaluations
                for action in evaluation.properties.get("actions", [])
                if "cap_judgment_level" in action
            ]
            if caps:
                order = {f"J{level}": level for level in range(5)}
                maximum = min(caps, key=lambda level: order[level])
                for output in outputs:
                    level = output.properties.get("judgment_level")
                    if output.type == "Judgment" and level in order and order[level] > order[maximum]:
                        raise ValueError(f"Judgment 等级 {level} 超过规则上限 {maximum}")
            plan_entity = self.repository.get_entity(plan_id)
            plan_context = (plan_entity.properties if plan_entity is not None else {}).get(
                "planning_context", {}
            )
            causal_required = bool(
                (plan_context.get("methodology") or {}).get("causal_identification_required")
            )
            if causal_required and not any(
                item.properties.get("rule_id") == "formal_causal_judgment_gate"
                for item in evaluations
            ):
                raise ValueError("正式因果 Judgment 未通过 formal_causal_judgment_gate")
            for output in outputs:
                if output.type != "Judgment":
                    continue
                if not causal_required:
                    validate_causal_judgment(output.properties, causal_required=False)
                    continue
                assessment_ref = str(output.properties.get("causal_assessment_ref") or "")
                assessment_entity = self.repository.get_entity(assessment_ref)
                if (
                    assessment_entity is None
                    or assessment_entity.bundle_id != bundle_id
                    or assessment_entity.type != "CausalAssessment"
                ):
                    raise ValueError("因果 Judgment 引用的 CausalAssessment 不在本研究包")
                design_ref = str(assessment_entity.properties.get("design_ref") or "")
                design_entity = self.repository.get_entity(design_ref)
                if design_entity is None or design_entity.bundle_id != bundle_id:
                    raise ValueError("因果 Judgment 的设计谱系不完整")
                causal_assessment = validate_causal_assessment(
                    assessment_entity.properties,
                    design=validate_causal_design(design_entity.properties),
                )
                validate_causal_judgment(
                    output.properties,
                    causal_required=True,
                    assessment=causal_assessment,
                )

    def _rule_context(
        self,
        plan: ExecutionPlan,
        entities: list[RuntimeEntity],
        bundle_id: str,
        runtime_context: dict[str, Any],
    ) -> dict[str, Any]:
        context = dict(plan.planning_context)
        for key, value in runtime_context.items():
            if key not in {"node_outputs", "recorded_at"}:
                context[key] = value
        type_counts: dict[str, int] = {}
        for entity in entities:
            type_counts[entity.type] = type_counts.get(entity.type, 0) + 1
        context["graph"] = {
            "type_counts": type_counts,
            "entities": [
                {"id": entity.id, "type": entity.type, "properties": entity.properties}
                for entity in entities
            ],
            "relations": [
                relation.model_dump(mode="json")
                for relation in self.repository.list_relations(bundle_id)
            ],
        }
        approvals = [entity for entity in entities if entity.type == "ApprovalRecord"]
        if approvals:
            latest = max(approvals, key=lambda item: item.recorded_at)
            context["approval"] = dict(latest.properties)
        sources = [entity for entity in entities if entity.type == "SourceDocument"]
        claims = [entity for entity in entities if entity.type == "EvidenceClaim"]
        facts = [entity for entity in entities if entity.type == "EvidenceFact"]
        assessments = [entity for entity in entities if entity.type == "EvidenceAssessment"]
        evidence = dict(context.get("evidence") or {})
        evidence.setdefault("source_document_count", len(sources))
        evidence.setdefault("claim_count", len(claims))
        evidence.setdefault(
            "locators_complete",
            bool(claims) and all(bool(item.properties.get("locator")) for item in claims),
        )
        evidence.setdefault(
            "conflict_detected",
            any(bool(item.properties.get("conflict_detected")) for item in facts),
        )
        evidence.setdefault(
            "lineage_complete",
            bool(assessments) and all(bool(item.properties.get("lineage_complete")) for item in assessments),
        )
        evidence.setdefault(
            "assessment_complete",
            bool(assessments)
            and all(item.properties.get("assessment_status") == "complete" for item in assessments),
        )
        evidence.setdefault(
            "ready_for_directional_judgment",
            bool(assessments)
            and all(bool(item.properties.get("ready_for_directional_judgment")) for item in assessments),
        )
        context["evidence"] = evidence
        reasoning = dict(context.get("reasoning") or {})
        reasoning.setdefault(
            "rule_evaluation_count",
            sum(
                entity.type == "RuleEvaluation" and entity.properties.get("purpose") is None
                for entity in entities
            ),
        )
        context["reasoning"] = reasoning
        return context
