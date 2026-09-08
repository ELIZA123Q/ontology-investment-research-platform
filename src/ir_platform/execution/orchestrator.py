from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import uuid4

from ir_platform.planning.models import ExecutionNode, ExecutionPlan
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
            if (
                any(entity.type in plan.goal_types for entity in entities)
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
        self._validate_formal_outputs(node, outputs, bundle_id)
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
    ) -> None:
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
