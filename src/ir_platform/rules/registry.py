from __future__ import annotations

from pathlib import Path
from typing import Any, Generic, TypeVar

import yaml
from pydantic import BaseModel

from .models import CapabilityDefinition, LogicDefinition, RuleDefinition


ROOT = Path(__file__).resolve().parents[3]
T = TypeVar("T", bound=BaseModel)


class _YamlRegistry(Generic[T]):
    section: str
    model: type[T]

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        document = yaml.safe_load(self.path.read_text(encoding="utf-8")) or {}
        raw = document.get(self.section)
        if not isinstance(raw, dict) or not raw:
            raise ValueError(f"{self.path}: {self.section} 必须是非空对象")
        self._items: dict[str, T] = {}
        for identifier, value in raw.items():
            payload = dict(value or {})
            payload["id"] = str(identifier)
            item = self.model.model_validate(payload)
            self._items[item.id] = item

    def resolve(self, identifier: str) -> T:
        try:
            return self._items[identifier]
        except KeyError as exc:
            raise KeyError(f"未知 {self.model.__name__}: {identifier}") from exc

    def all(self) -> list[T]:
        return [self._items[key] for key in sorted(self._items)]


class CapabilityDefinitionRegistry(_YamlRegistry[CapabilityDefinition]):
    section = "capabilities"
    model = CapabilityDefinition

    def __init__(self, path: str | Path = ROOT / "研究能力" / "capabilities.yaml") -> None:
        super().__init__(path)


class LogicRegistry(_YamlRegistry[LogicDefinition]):
    section = "logics"
    model = LogicDefinition

    def __init__(self, path: str | Path = ROOT / "研究能力" / "logics.yaml") -> None:
        super().__init__(path)

    def validate_references(
        self,
        capabilities: CapabilityDefinitionRegistry,
        rules: "RuleRegistry",
    ) -> None:
        for logic in self.all():
            node_ids = [node.id for node in logic.nodes]
            if len(node_ids) != len(set(node_ids)):
                raise ValueError(f"Logic {logic.id} 节点 ID 重复")
            for node in logic.nodes:
                capabilities.resolve(node.capability_ref)
                unknown_deps = set(node.dependencies) - set(node_ids)
                if unknown_deps:
                    raise ValueError(f"Logic {logic.id}/{node.id} 含未知依赖: {sorted(unknown_deps)}")
                for rule_ref in node.activate_rule_refs:
                    rules.resolve(rule_ref)
            for rule_ref in logic.completion_rule_refs:
                rules.resolve(rule_ref)
            for fallback in logic.fallback_logic_refs:
                self.resolve(fallback)


class RuleRegistry(_YamlRegistry[RuleDefinition]):
    section = "rules"
    model = RuleDefinition

    def __init__(self, path: str | Path = ROOT / "研究规则" / "rules.yaml") -> None:
        super().__init__(path)

    def by_kind(self, kind: str) -> list[RuleDefinition]:
        return sorted(
            (item for item in self._items.values() if item.kind == kind),
            key=lambda item: (-item.priority, item.id),
        )

