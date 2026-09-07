from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .models import RuleDefinition


@dataclass(frozen=True)
class RuleEvaluationResult:
    rule_id: str
    rule_version: str
    matched: bool
    actions: list[dict[str, Any]]
    failure_handling: str


class RuleEvaluator:
    """受限、确定性的规则 DSL；不执行 eval、代码字符串或动态导入。"""

    OPERATORS = {"all", "any", "not", "exists", "equals", "in", "compare", "count", "graph_pattern"}

    def evaluate(self, rule: RuleDefinition, context: dict[str, Any]) -> RuleEvaluationResult:
        matched = self._expression(rule.when, context)
        return RuleEvaluationResult(
            rule_id=rule.id,
            rule_version=rule.version,
            matched=matched,
            actions=list(rule.then) if matched else [],
            failure_handling=rule.failure_handling,
        )

    def _expression(self, expression: Any, context: dict[str, Any]) -> bool:
        if not isinstance(expression, dict) or len(expression) != 1:
            raise ValueError("规则表达式必须是只含一个操作符的对象")
        operator, payload = next(iter(expression.items()))
        if operator not in self.OPERATORS:
            raise ValueError(f"不允许的规则操作符: {operator}")
        if operator == "all":
            return all(self._expression(item, context) for item in self._sequence(payload, operator))
        if operator == "any":
            return any(self._expression(item, context) for item in self._sequence(payload, operator))
        if operator == "not":
            return not self._expression(payload, context)
        if operator == "exists":
            return self._resolve(context, str(payload), missing=None) is not None
        if not isinstance(payload, dict):
            raise ValueError(f"{operator} 的参数必须是对象")
        if operator == "equals":
            return self._resolve(context, str(payload["path"]), missing=None) == payload.get("value")
        if operator == "in":
            return self._resolve(context, str(payload["path"]), missing=None) in payload.get("values", [])
        if operator in {"compare", "count"}:
            value = self._resolve(context, str(payload["path"]), missing=None)
            if operator == "count":
                value = len(value) if value is not None else 0
            return self._compare(value, payload.get("operator", "eq"), payload.get("value"))
        return self._graph_pattern(context, payload)

    @staticmethod
    def _sequence(value: Any, label: str) -> list[Any]:
        if not isinstance(value, list) or not value:
            raise ValueError(f"{label} 必须是非空列表")
        return value

    @staticmethod
    def _resolve(context: dict[str, Any], path: str, *, missing: Any) -> Any:
        value: Any = context
        for part in path.split("."):
            if isinstance(value, dict) and part in value:
                value = value[part]
            else:
                return missing
        return value

    @staticmethod
    def _compare(left: Any, operator: str, right: Any) -> bool:
        if left is None:
            return False
        operations = {
            "eq": lambda: left == right,
            "ne": lambda: left != right,
            "gt": lambda: left > right,
            "gte": lambda: left >= right,
            "lt": lambda: left < right,
            "lte": lambda: left <= right,
        }
        if operator not in operations:
            raise ValueError(f"不允许的比较操作符: {operator}")
        return bool(operations[operator]())

    @staticmethod
    def _graph_pattern(context: dict[str, Any], payload: dict[str, Any]) -> bool:
        graph = context.get("graph", {})
        entities = graph.get("entities", [])
        relations = graph.get("relations", [])
        if payload.get("entity_type"):
            return any(item.get("type") == payload["entity_type"] for item in entities)
        if payload.get("relation_type"):
            return any(item.get("type") == payload["relation_type"] for item in relations)
        raise ValueError("graph_pattern 必须声明 entity_type 或 relation_type")

