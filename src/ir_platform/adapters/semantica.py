from __future__ import annotations

import json
import gc
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

# Semantica 的可选向量依赖会加载 ONNX Runtime；离线运行关闭遥测，避免在仓库
# 根目录生成 `:memory:.ses` 临时会话文件。
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")

# 架构约束：整个项目只有本模块可以导入 semantica.*。
from semantica.context import ContextGraph
from semantica.pipeline import ExecutionEngine, PipelineBuilder
from semantica.provenance import ProvenanceManager
from semantica.semantic_extract import Triplet
from semantica.triplet_store import OxigraphStore

from ir_platform.runtime.models import GraphBundle, RuntimeEntity, RuntimeRelation
from ir_platform.runtime.repository import ResearchGraphRepository
from ir_platform.planning.models import ExecutionNode


RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
RDF_JSON = "http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON"
XSD_DATETIME = "http://www.w3.org/2001/XMLSchema#dateTime"
PROV = "http://www.w3.org/ns/prov#"
RUNTIME = "ir://invest-ontology/runtime#"


def _resource(iri: str) -> str:
    """Semantica 只自动识别常见 URI scheme，尖括号确保 ir:// 被当作资源。"""

    return f"<{iri}>"


def _entity_iri(entity_id: str) -> str:
    return f"{RUNTIME}entity/{quote(entity_id, safe='')}"


def _relation_iri(relation_id: str) -> str:
    return f"{RUNTIME}relation/{quote(relation_id, safe='')}"


def _bundle_graph(bundle_id: str) -> str:
    return f"urn:ir:research-bundle:{quote(bundle_id, safe='')}"


def _type_iri(type_name: str) -> str:
    return f"{RUNTIME}type/{quote(type_name, safe='')}"


def _predicate_iri(type_name: str) -> str:
    return f"{RUNTIME}predicate/{quote(type_name, safe='')}"


def _triplet(subject: str, predicate: str, obj: str, *, datatype: str | None = None) -> Triplet:
    metadata = {"datatype": datatype} if datatype else {}
    return Triplet(subject=subject, predicate=predicate, object=obj, metadata=metadata)


class SemanticaResearchGraphRepository(ResearchGraphRepository):
    """Oxigraph 权威图 + ContextGraph 只读模型 + SQLite provenance 账本。"""

    def __init__(self, storage_dir: str | Path) -> None:
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._store = OxigraphStore(path=str(self.storage_dir / "oxigraph"))
        self._provenance = ProvenanceManager(storage_path=str(self.storage_dir / "provenance.sqlite3"))
        self._context_graph = ContextGraph(advanced_analytics=False)
        self.refresh_read_model()

    @property
    def context_graph(self) -> ContextGraph:
        return self._context_graph

    def add_bundle(self, bundle: GraphBundle) -> None:
        bundle_iri = _bundle_graph(bundle.bundle_id)
        self._store.add_triplets(
            [
                _triplet(bundle_iri, RDF_TYPE, _resource(f"{PROV}Bundle")),
                _triplet(bundle_iri, f"{RUNTIME}identifier", bundle.bundle_id),
            ],
            graph=bundle_iri,
        )
        pending = {entity.id: entity for entity in bundle.entities}
        while pending:
            ready = [
                entity
                for entity in pending.values()
                if not entity.supersedes
                or entity.supersedes not in pending
                or self.get_entity(entity.supersedes) is not None
            ]
            if not ready:
                raise ValueError("bundle 内 supersedes 形成循环或引用不可解析")
            for entity in ready:
                self.add_entity(entity)
                pending.pop(entity.id)
        for relation in bundle.relations:
            self.add_relation(relation)
        self._store.flush()
        self.refresh_read_model()

    def add_entity(self, entity: RuntimeEntity) -> None:
        current = self.get_entity(entity.id)
        if current:
            if current == entity:
                return
            raise ValueError(f"实体 {entity.id} 已存在；修订必须生成新 ID 并填写 supersedes")
        if entity.supersedes and not self.get_entity(entity.supersedes):
            raise ValueError(f"实体 {entity.id} 的 supersedes 目标不存在: {entity.supersedes}")
        iri = _entity_iri(entity.id)
        graph = _bundle_graph(entity.bundle_id)
        payload = entity.model_dump(mode="json")
        triples = [
            _triplet(iri, RDF_TYPE, _resource(f"{RUNTIME}RuntimeEntity")),
            _triplet(iri, RDF_TYPE, _resource(f"{PROV}Entity")),
            _triplet(iri, f"{RUNTIME}runtimeType", entity.type),
            _triplet(iri, f"{RUNTIME}identifier", entity.id),
            _triplet(iri, f"{RUNTIME}bundleId", entity.bundle_id),
            _triplet(iri, f"{RUNTIME}payload", json.dumps(payload, ensure_ascii=False, sort_keys=True), datatype=RDF_JSON),
            _triplet(iri, f"{RUNTIME}recordedTime", entity.recorded_at.isoformat(), datatype=XSD_DATETIME),
        ]
        for predicate, value in (
            ("validFrom", entity.valid_from),
            ("validUntil", entity.valid_until),
            ("invalidatedTime", entity.invalidated_at),
        ):
            if value:
                triples.append(_triplet(iri, f"{RUNTIME}{predicate}", value.isoformat(), datatype=XSD_DATETIME))
        if entity.supersedes:
            triples.append(_triplet(iri, f"{RUNTIME}supersedes", _resource(_entity_iri(entity.supersedes))))
            triples.append(_triplet(iri, f"{PROV}wasRevisionOf", _resource(_entity_iri(entity.supersedes))))
        self._store.add_triplets(triples, graph=graph)

    def add_relation(self, relation: RuntimeRelation) -> None:
        current = self._get_relation(relation.id)
        if current == relation:
            return
        if current:
            raise ValueError(f"关系 {relation.id} 已存在")
        source_entity = self.get_entity(relation.source_id)
        target_entity = self.get_entity(relation.target_id)
        if source_entity is None or target_entity is None:
            raise ValueError(f"关系 {relation.id} 的端点不存在")
        if source_entity.bundle_id != relation.bundle_id or target_entity.bundle_id != relation.bundle_id:
            raise ValueError(f"关系 {relation.id} 的端点必须与关系属于同一 bundle")
        iri = _relation_iri(relation.id)
        source = _entity_iri(relation.source_id)
        target = _entity_iri(relation.target_id)
        graph = _bundle_graph(relation.bundle_id)
        payload = relation.model_dump(mode="json")
        triples = [
            _triplet(iri, RDF_TYPE, _resource(f"{RUNTIME}RuntimeRelation")),
            _triplet(iri, f"{RUNTIME}identifier", relation.id),
            _triplet(iri, f"{RUNTIME}runtimeType", relation.type),
            _triplet(iri, f"{RUNTIME}bundleId", relation.bundle_id),
            _triplet(iri, f"{RUNTIME}source", _resource(source)),
            _triplet(iri, f"{RUNTIME}target", _resource(target)),
            _triplet(iri, f"{RUNTIME}payload", json.dumps(payload, ensure_ascii=False, sort_keys=True), datatype=RDF_JSON),
            _triplet(source, _predicate_iri(relation.type), _resource(target)),
        ]
        self._store.add_triplets(triples, graph=graph)

    def get_entity(self, entity_id: str) -> RuntimeEntity | None:
        rows = self._payloads(f"<{_entity_iri(entity_id)}>", "RuntimeEntity")
        return RuntimeEntity.model_validate_json(rows[0]) if rows else None

    def list_entities(self, bundle_id: str | None = None) -> list[RuntimeEntity]:
        result = [RuntimeEntity.model_validate_json(row) for row in self._payloads("?resource", "RuntimeEntity")]
        if bundle_id is not None:
            result = [item for item in result if item.bundle_id == bundle_id]
        return sorted(result, key=lambda item: item.id)

    def list_relations(self, bundle_id: str | None = None) -> list[RuntimeRelation]:
        result = [RuntimeRelation.model_validate_json(row) for row in self._payloads("?resource", "RuntimeRelation")]
        if bundle_id is not None:
            result = [item for item in result if item.bundle_id == bundle_id]
        return sorted(result, key=lambda item: item.id)

    def state_at(
        self,
        *,
        valid_at: datetime | None = None,
        recorded_at: datetime | None = None,
        bundle_id: str | None = None,
    ) -> GraphBundle:
        visible = [item for item in self.list_entities(bundle_id) if item.visible_at(valid_at, recorded_at)]
        superseded = {item.supersedes for item in visible if item.supersedes}
        entities = [item for item in visible if item.id not in superseded]
        entity_ids = {item.id for item in entities}
        relations = [
            item
            for item in self.list_relations(bundle_id)
            if item.visible_at(valid_at, recorded_at)
            and item.source_id in entity_ids
            and item.target_id in entity_ids
        ]
        return GraphBundle(
            bundle_id=bundle_id or "all-visible-bundles",
            entities=entities,
            relations=relations,
            metadata={
                "valid_at": valid_at.isoformat() if valid_at else None,
                "recorded_at": recorded_at.isoformat() if recorded_at else None,
            },
        )

    def query_sparql(self, query: str) -> dict[str, Any]:
        result = self._store.execute_sparql(query)
        return result if isinstance(result, dict) else {"results": result}

    def record_provenance(
        self,
        entity: RuntimeEntity,
        *,
        activity_id: str,
        source: str,
        source_location: str | None = None,
        used_entities: list[str] | None = None,
        agent_id: str = "ir-platform",
    ) -> None:
        metadata = {
            "bundle_id": entity.bundle_id,
            "runtime_type": entity.type,
            "used_entities": sorted(used_entities or []),
        }
        self._provenance.track_entity(
            entity.id,
            source=source,
            activity_id=activity_id,
            agent_id=agent_id,
            source_location=source_location,
            metadata=metadata,
        )
        entity_iri = _entity_iri(entity.id)
        activity_iri = f"{RUNTIME}activity/{quote(activity_id, safe='')}"
        agent_iri = f"{RUNTIME}agent/{quote(agent_id, safe='')}"
        triples = [
            _triplet(activity_iri, RDF_TYPE, _resource(f"{PROV}Activity")),
            _triplet(agent_iri, RDF_TYPE, _resource(f"{PROV}Agent")),
            _triplet(activity_iri, f"{PROV}wasAssociatedWith", _resource(agent_iri)),
            _triplet(entity_iri, f"{PROV}wasGeneratedBy", _resource(activity_iri)),
            _triplet(entity_iri, f"{PROV}generatedAtTime", entity.recorded_at.isoformat(), datatype=XSD_DATETIME),
            _triplet(entity_iri, f"{PROV}hadPrimarySource", source),
        ]
        if source_location:
            triples.append(_triplet(entity_iri, f"{RUNTIME}sourceLocation", source_location))
        for used_id in sorted(used_entities or []):
            triples.append(_triplet(activity_iri, f"{PROV}used", _resource(_entity_iri(used_id))))
            triples.append(_triplet(entity_iri, f"{PROV}wasDerivedFrom", _resource(_entity_iri(used_id))))
        self._store.add_triplets(triples, graph=_bundle_graph(entity.bundle_id))

    def refresh_read_model(self) -> None:
        graph = ContextGraph(advanced_analytics=False)
        for entity in self.list_entities():
            graph.add_node(
                entity.id,
                node_type=entity.type,
                content=str(entity.properties.get("name") or entity.properties.get("title") or entity.id),
                runtime_properties=entity.properties,
                valid_from=entity.valid_from.isoformat() if entity.valid_from else None,
                valid_until=entity.valid_until.isoformat() if entity.valid_until else None,
            )
        for relation in self.list_relations():
            graph.add_edge(
                relation.source_id,
                relation.target_id,
                edge_type=relation.type,
                id=relation.id,
                runtime_properties=relation.properties,
                valid_from=relation.valid_from.isoformat() if relation.valid_from else None,
                valid_until=relation.valid_until.isoformat() if relation.valid_until else None,
            )
        self._context_graph = graph

    def close(self) -> None:
        self._store.flush()
        # OxigraphStore 0.6.8 没有公开 close()；释放底层 pyoxigraph.Store，
        # 使同一进程也能重新打开该持久化目录并验证重启恢复。
        self._store.store = None
        gc.collect()

    def _get_relation(self, relation_id: str) -> RuntimeRelation | None:
        rows = self._payloads(f"<{_relation_iri(relation_id)}>", "RuntimeRelation")
        return RuntimeRelation.model_validate_json(rows[0]) if rows else None

    def _payloads(self, subject: str, resource_class: str) -> list[str]:
        query = f"""
        SELECT ?payload WHERE {{
          GRAPH ?g {{
            {subject} <{RDF_TYPE}> <{RUNTIME}{resource_class}> ;
                       <{RUNTIME}payload> ?payload .
          }}
        }} ORDER BY ?payload
        """
        result = self._store.execute_sparql(query)
        values: list[str] = []
        for binding in self._bindings(result):
            value = binding.get("payload")
            if isinstance(value, dict):
                value = value.get("value")
            if value is not None:
                values.append(str(value))
        return values

    @staticmethod
    def _bindings(result: Any) -> Iterable[dict[str, Any]]:
        if isinstance(result, dict):
            nested = result.get("results", result)
            if isinstance(nested, dict):
                return nested.get("bindings", [])
            if isinstance(nested, list):
                return nested
        if isinstance(result, list):
            return result
        return []


class SemanticaPipelineAdapter:
    """把当前就绪节点映射为一次可丢弃的 Semantica Pipeline 执行层。"""

    def __init__(self, *, max_workers: int = 4) -> None:
        self.max_workers = max_workers

    def execute_layer(self, calls: list[tuple[ExecutionNode, Any]]) -> dict[str, Any]:
        if not calls:
            return {}
        builder = PipelineBuilder()
        for node, handler in calls:
            builder.add_step(
                node.id,
                node.capability_ref,
                handler=lambda _data, _handler=handler, _node_id=node.id, **_options: {
                    _node_id: _handler()
                },
                parallel_safe=node.parallel_safe,
            )
        builder.set_parallelism(min(self.max_workers, len(calls)))
        pipeline = builder.build(name=f"research-layer:{id(calls)}")
        result = ExecutionEngine({"max_workers": self.max_workers}).execute_pipeline(
            pipeline, data={}
        )
        if not result.success:
            raise RuntimeError("; ".join(result.errors) or "Semantica pipeline 执行失败")
        outputs: dict[str, Any] = {}
        for step in pipeline.steps:
            if not isinstance(step.result, dict) or step.name not in step.result:
                raise RuntimeError(f"Semantica 节点 {step.name} 未返回约定结果")
            outputs[step.name] = step.result[step.name]
        return outputs
