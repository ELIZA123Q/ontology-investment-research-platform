from __future__ import annotations

from collections import deque
from datetime import datetime
from typing import Any, Callable
from uuid import uuid4

from .models import RuleEvaluationRecord, RuntimeEntity
from .repository import ResearchGraphRepository


class EvidenceLineageService:
    def __init__(self, repository: ResearchGraphRepository) -> None:
        self.repository = repository

    def trace(self, target_id: str) -> dict[str, Any]:
        entities = {item.id: item for item in self.repository.list_entities()}
        relations = self.repository.list_relations()
        incoming: dict[str, list[Any]] = {}
        for relation in relations:
            incoming.setdefault(relation.target_id, []).append(relation)
        visited: set[str] = set()
        relation_ids: set[str] = set()
        queue = deque([target_id])
        while queue:
            current = queue.popleft()
            if current in visited:
                continue
            visited.add(current)
            for relation in incoming.get(current, []):
                relation_ids.add(relation.id)
                queue.append(relation.source_id)
        return {
            "target_id": target_id,
            "entities": [entities[item].model_dump(mode="json") for item in sorted(visited) if item in entities],
            "relations": [
                relation.model_dump(mode="json")
                for relation in relations
                if relation.id in relation_ids
            ],
        }


class ResearchStateService:
    def __init__(self, repository: ResearchGraphRepository) -> None:
        self.repository = repository

    def state_at(
        self,
        *,
        valid_at: datetime | None = None,
        recorded_at: datetime | None = None,
        bundle_id: str | None = None,
    ):
        return self.repository.state_at(
            valid_at=valid_at,
            recorded_at=recorded_at,
            bundle_id=bundle_id,
        )


class RuleExecutionService:
    """执行确定性领域规则，并把结果作为运行记录和 provenance 保存。"""

    def __init__(self, repository: ResearchGraphRepository) -> None:
        self.repository = repository

    def evaluate(
        self,
        *,
        bundle_id: str,
        rule_id: str,
        rule_version: str,
        inputs: dict[str, Any],
        evaluator: Callable[[dict[str, Any]], tuple[bool, dict[str, Any]]],
        input_refs: list[str] | None = None,
        evidence_refs: list[str] | None = None,
    ) -> RuntimeEntity:
        matched, result = evaluator(inputs)
        record = RuleEvaluationRecord(
            rule_id=rule_id,
            rule_version=rule_version,
            matched=matched,
            status="matched" if matched else "not_matched",
            input_refs=input_refs or [],
            evidence_refs=evidence_refs or [],
            result=result,
        )
        entity = RuntimeEntity(
            id=f"rule-evaluation:{uuid4()}",
            type="RuleEvaluation",
            properties=record.model_dump(mode="json"),
            recorded_at=record.evaluated_at,
            bundle_id=bundle_id,
        )
        self.repository.add_entity(entity)
        self.repository.record_provenance(
            entity,
            activity_id=f"evaluate:{rule_id}:{rule_version}",
            source=f"rule:{rule_id}@{rule_version}",
            used_entities=(input_refs or []) + (evidence_refs or []),
        )
        return entity
