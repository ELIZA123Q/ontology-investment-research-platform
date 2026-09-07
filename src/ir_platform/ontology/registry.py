from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable

import yaml


class OntologyBoundaryError(ValueError):
    """语义本体包含运行资源或结构错误。"""


class SemanticOntologyRegistry:
    """加载并合并一级与领域语义本体，不读取研究运行合同。"""

    DEFAULT_ROOT = Path(__file__).resolve().parents[3] / "语义本体"

    def __init__(self, ontology_root: str | Path | None = None) -> None:
        self.root = Path(ontology_root) if ontology_root else self.DEFAULT_ROOT
        self.common = self._load(self.root / "一级通用" / "common.yaml")
        self.core = self._load(self.root / "一级通用" / "semantic.yaml")
        self.domain_common = self._load(self.root / "二级半导体" / "common.yaml")
        self.domain = self._load(self.root / "二级半导体" / "semantic.yaml")
        self.metrics = self._load(self.root / "二级半导体" / "research_metrics.yaml")
        self._validate_boundary()
        self._objects = self._merge_objects()
        self._relations = self._merge_relations()
        self._validate_structure()

    @staticmethod
    def _load(path: Path) -> dict[str, Any]:
        if not path.exists():
            raise FileNotFoundError(path)
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise OntologyBoundaryError(f"{path} 必须是 YAML 对象")
        return data

    @property
    def base_iri(self) -> str:
        return str(self.common["namespace"]["base_iri"])

    @property
    def domain_base_iri(self) -> str:
        return str(self.domain_common["namespace"]["base_iri"])

    @property
    def object_types(self) -> dict[str, dict[str, Any]]:
        return deepcopy(self._objects)

    @property
    def relation_types(self) -> dict[str, dict[str, Any]]:
        return deepcopy(self._relations)

    @property
    def controlled_vocabularies(self) -> dict[str, Any]:
        return deepcopy(self.domain.get("controlled_vocabularies", {}))

    @property
    def semantic_instances(self) -> list[dict[str, Any]]:
        return deepcopy(self.metrics.get("semantic_instances", []))

    def type_iri(self, type_name: str) -> str:
        if type_name not in self._objects:
            raise KeyError(f"未知语义类型: {type_name}")
        base = self.domain_base_iri if type_name in self.domain.get("object_types", {}) else self.base_iri
        return f"{base}{type_name}"

    def relation_iri(self, relation_name: str) -> str:
        if relation_name not in self._relations:
            raise KeyError(f"未知语义关系: {relation_name}")
        base = self.domain_base_iri if relation_name in self.domain.get("relation_types", {}) else self.base_iri
        return f"{base}{relation_name}"

    def validate_instance(self, item: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        type_name = str(item.get("type", ""))
        definition = self._objects.get(type_name)
        if not definition:
            return [f"未知语义类型: {type_name}"]
        props = item.get("properties") or {}
        if not isinstance(props, dict):
            return ["properties 必须是对象"]
        for name, spec in self.properties_for_type(type_name).items():
            if spec.get("required") and props.get(name) in (None, ""):
                errors.append(f"{item.get('id', '<unknown>')}.{name} 为必填字段")
            if name in props and spec.get("type") == "enum":
                allowed = spec.get("allowed_values")
                if allowed and props[name] not in allowed:
                    errors.append(f"{item.get('id', '<unknown>')}.{name} 不在允许枚举中")
        return errors

    def properties_for_type(self, type_name: str) -> dict[str, dict[str, Any]]:
        if type_name not in self._objects:
            raise KeyError(f"未知语义类型: {type_name}")
        lineage: list[str] = []
        current: str | None = type_name
        while current:
            lineage.append(current)
            parent = self._objects[current].get("extends")
            current = str(parent) if parent else None
        properties = deepcopy(self.common.get("shared_object_properties", {}))
        for item in reversed(lineage):
            properties.update(deepcopy(self._objects[item].get("properties", {})))
        return properties

    def is_type_or_subtype(self, type_name: str, expected: str) -> bool:
        current: str | None = type_name
        while current:
            if current == expected:
                return True
            spec = self._objects.get(current)
            current = str(spec.get("extends")) if spec and spec.get("extends") else None
        return False

    def validate_relation(self, item: dict[str, Any], endpoint_types: dict[str, str]) -> list[str]:
        relation_name = str(item.get("type", ""))
        definition = self._relations.get(relation_name)
        if not definition:
            return [f"未知语义关系: {relation_name}"]
        source_type = endpoint_types.get(str(item.get("sourceId")))
        target_type = endpoint_types.get(str(item.get("targetId")))
        errors = []
        if source_type and not any(
            self.is_type_or_subtype(source_type, allowed)
            for allowed in definition.get("source_types", [])
        ):
            errors.append(f"{relation_name} 不允许起点类型 {source_type}")
        if target_type and not any(
            self.is_type_or_subtype(target_type, allowed)
            for allowed in definition.get("target_types", [])
        ):
            errors.append(f"{relation_name} 不允许终点类型 {target_type}")
        return errors

    def _validate_boundary(self) -> None:
        forbidden_sections = set(
            self.common.get("ontology_boundary", {}).get("forbidden_resource_kinds", [])
        )
        forbidden_types = set(
            self.common.get("ontology_boundary", {}).get("forbidden_runtime_types", [])
        )
        for path, data in (
            ("一级通用/semantic.yaml", self.core),
            ("二级半导体/semantic.yaml", self.domain),
            ("二级半导体/research_metrics.yaml", self.metrics),
        ):
            illegal_sections = forbidden_sections.intersection(data)
            if illegal_sections:
                raise OntologyBoundaryError(f"{path} 含运行资源: {sorted(illegal_sections)}")
            object_types = set((data.get("object_types") or {}).keys())
            illegal_types = forbidden_types.intersection(object_types)
            if illegal_types:
                raise OntologyBoundaryError(f"{path} 含运行类型: {sorted(illegal_types)}")
        duplicated_objects = set(self.core.get("object_types", {})).intersection(
            self.domain.get("object_types", {})
        )
        duplicated_relations = set(self.core.get("relation_types", {})).intersection(
            self.domain.get("relation_types", {})
        )
        if duplicated_objects or duplicated_relations:
            raise OntologyBoundaryError(
                f"领域层重定义一级资源: objects={sorted(duplicated_objects)}, "
                f"relations={sorted(duplicated_relations)}"
            )

    def _merge_objects(self) -> dict[str, dict[str, Any]]:
        merged = deepcopy(self.core.get("object_types", {}))
        merged.update(deepcopy(self.domain.get("object_types", {})))
        for name, extension in self.domain.get("object_type_extensions", {}).items():
            if name not in merged:
                raise OntologyBoundaryError(f"扩展了不存在的对象类型: {name}")
            merged[name].setdefault("properties", {}).update(deepcopy(extension.get("properties", {})))
        return merged

    def _merge_relations(self) -> dict[str, dict[str, Any]]:
        merged = deepcopy(self.core.get("relation_types", {}))
        merged.update(deepcopy(self.domain.get("relation_types", {})))
        for name, extension in self.domain.get("relation_type_extensions", {}).items():
            if name not in merged:
                raise OntologyBoundaryError(f"扩展了不存在的关系类型: {name}")
            for field, target in (("add_source_types", "source_types"), ("add_target_types", "target_types")):
                values = list(merged[name].get(target, []))
                for value in extension.get(field, []):
                    if value not in values:
                        values.append(value)
                merged[name][target] = values
        return merged

    def _validate_structure(self) -> None:
        for type_name, spec in self._objects.items():
            parent = spec.get("extends")
            if parent and parent not in self._objects:
                raise OntologyBoundaryError(f"{type_name} 继承不存在的类型: {parent}")
        for type_name in self._objects:
            visited: set[str] = set()
            current: str | None = type_name
            while current:
                if current in visited:
                    raise OntologyBoundaryError(f"对象类型存在循环继承: {type_name}")
                visited.add(current)
                parent = self._objects[current].get("extends")
                current = str(parent) if parent else None
        for relation_name, relation in self._relations.items():
            for side in ("source_types", "target_types"):
                unknown = set(relation.get(side, [])) - set(self._objects)
                if unknown:
                    raise OntologyBoundaryError(
                        f"关系 {relation_name}.{side} 含未知端点: {sorted(unknown)}"
                    )
            cardinality = relation.get("cardinality")
            allowed = set(self.common.get("common_enums", {}).get("cardinality", []))
            if cardinality and cardinality not in allowed:
                raise OntologyBoundaryError(f"关系 {relation_name} 基数非法: {cardinality}")
        seen_metric_ids: set[str] = set()
        for metric in self.semantic_instances:
            if metric.get("type") != "ResearchMetric":
                raise OntologyBoundaryError(f"稳定指标目录包含非 ResearchMetric: {metric.get('type')}")
            metric_id = str(metric.get("id", ""))
            if not metric_id or metric_id in seen_metric_ids:
                raise OntologyBoundaryError(f"稳定指标 ID 缺失或重复: {metric_id}")
            seen_metric_ids.add(metric_id)
            unknown_anchors = set((metric.get("properties") or {}).get("anchorTypes", [])) - set(self._objects)
            if unknown_anchors:
                raise OntologyBoundaryError(
                    f"稳定指标 {metric_id} 含未知锚定类型: {sorted(unknown_anchors)}"
                )

    def iter_source_files(self) -> Iterable[Path]:
        yield self.root / "一级通用" / "common.yaml"
        yield self.root / "一级通用" / "semantic.yaml"
        yield self.root / "二级半导体" / "common.yaml"
        yield self.root / "二级半导体" / "semantic.yaml"
        yield self.root / "二级半导体" / "research_metrics.yaml"
