from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, time, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

import yaml

from ir_platform.runtime.models import GraphBundle, RuntimeEntity, RuntimeRelation
from ir_platform.runtime.repository import ResearchGraphRepository


SUPPORTED_SUFFIXES = {".yaml", ".yml", ".json", ".csv", ".md", ".txt"}
SUPPORTED_LEGACY_VERSIONS = {
    "task_ontology_view": {"2.2.0"},
    "data_evidence_instance_manifest": {"3.0.0"},
    "reasoning_audit": {"4.0.0"},
    "controlled_research_run_manifest": {"1.2.0"},
}
REFERENCE_KEYS = {
    "source_ref",
    "source_refs",
    "evidence_ref",
    "evidence_refs",
    "claim_ref",
    "claim_refs",
    "judgment_ref",
    "judgment_refs",
    "rule_evaluation_ref",
    "rule_evaluation_refs",
    "signal_ref",
    "signal_refs",
    "hypothesis_ref",
    "hypothesis_refs",
    "report_claim_ref",
    "report_claim_refs",
}


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _stable_id(run_id: str, legacy_id: str) -> str:
    return f"{run_id}:{legacy_id}"


def _parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    if isinstance(value, str):
        candidate = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(candidate)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            try:
                return datetime.combine(date.fromisoformat(candidate), time.min, tzinfo=timezone.utc)
            except ValueError:
                return None
    return None


def _first_datetime(values: Iterable[Any]) -> datetime | None:
    for value in values:
        parsed = _parse_datetime(value)
        if parsed:
            return parsed
    return None


def _split_refs(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    if isinstance(value, str):
        return [item.strip() for item in value.split("|") if item.strip()]
    return []


class ResearchRunImporter:
    """只读导入现有 01—05 目录；原文件内容作为可逆迁移载荷保留。"""

    def __init__(self, repository: ResearchGraphRepository) -> None:
        self.repository = repository

    def import_legacy_run(self, run_dir: str | Path) -> GraphBundle:
        root = Path(run_dir).resolve()
        if not root.is_dir():
            raise NotADirectoryError(root)
        manifest = self._load_yaml(root / "run_manifest.yaml")
        run_id = str((manifest or {}).get("run_id") or root.name)
        files = sorted(
            path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
        )
        artifact_entities: list[RuntimeEntity] = []
        object_candidates: dict[str, dict[str, Any]] = {}
        relation_candidates: dict[tuple[str, str, str, str], dict[str, Any]] = {}

        for path in files:
            relative = path.relative_to(root).as_posix()
            raw = path.read_bytes()
            text = raw.decode("utf-8")
            artifact_entities.append(
                RuntimeEntity(
                    id=_stable_id(run_id, f"artifact:{relative}"),
                    type="LegacyArtifact",
                    properties={
                        "legacy_path": relative,
                        "media_type": self._media_type(path),
                        "content": text,
                        "sha256": _digest(raw),
                        "legacy_schema_version": self._schema_version(path, text),
                    },
                    recorded_at=self._artifact_time(path, text),
                    bundle_id=run_id,
                )
            )
            if path.suffix.lower() not in {".yaml", ".yml", ".json"}:
                continue
            document = self._load_structured(path, text)
            if not isinstance(document, dict):
                continue
            self._assert_supported_version(document, relative)
            graph = document.get("business_instance_graph")
            if isinstance(graph, dict):
                self._collect_graph(graph, relative, object_candidates, relation_candidates)
            if document.get("schema_name") == "ontology_dependency_projection":
                self._collect_projection(document, relative, object_candidates, relation_candidates)

        runtime_entities = self._make_runtime_entities(run_id, object_candidates)
        entities_by_legacy = {
            str(entity.properties.get("legacy_id")): entity for entity in runtime_entities
        }
        reference_relations = self._reference_relations(run_id, runtime_entities, entities_by_legacy)
        lineage_relations = self._lineage_relations(relation_candidates.values())
        missing_ids: set[str] = set()
        for relation in [*relation_candidates.values(), *reference_relations, *lineage_relations]:
            for endpoint in (str(relation["sourceId"]), str(relation["targetId"])):
                if endpoint not in entities_by_legacy:
                    missing_ids.add(endpoint)
        stub_entities = [
            RuntimeEntity(
                id=_stable_id(run_id, legacy_id),
                type="ReferenceStub",
                properties={"legacy_id": legacy_id, "migration_note": "引用目标不在旧业务图中"},
                recorded_at=datetime(1970, 1, 1, tzinfo=timezone.utc),
                bundle_id=run_id,
            )
            for legacy_id in sorted(missing_ids)
        ]
        relations = self._make_relations(
            run_id,
            [*relation_candidates.values(), *reference_relations, *lineage_relations],
        )
        bundle = GraphBundle(
            bundle_id=run_id,
            entities=[*artifact_entities, *runtime_entities, *stub_entities],
            relations=relations,
            metadata={
                "source_format": "legacy-01-05",
                "source_path": str(root),
                "artifact_count": len(artifact_entities),
                "legacy_schema_versions": {"02": "2.2.0", "03": "3.0.0", "04": "4.0.0"},
            },
        )
        self.repository.add_bundle(bundle)
        for entity in bundle.entities:
            source_path = entity.properties.get("legacy_path") or entity.properties.get("source_artifacts", [None])[-1]
            self.repository.record_provenance(
                entity,
                activity_id=f"legacy-import:{run_id}",
                source=f"legacy-run:{run_id}",
                source_location=str(source_path) if source_path else None,
            )
        return bundle

    @staticmethod
    def _collect_graph(
        graph: dict[str, Any],
        source: str,
        objects: dict[str, dict[str, Any]],
        relations: dict[tuple[str, str, str, str], dict[str, Any]],
    ) -> None:
        for item in graph.get("objects", []):
            if not isinstance(item, dict) or not item.get("id") or not item.get("type"):
                continue
            legacy_id = str(item["id"])
            candidate = dict(item)
            candidate["source_artifact"] = source
            if legacy_id in objects:
                previous = objects[legacy_id]
                merged_properties = dict(previous.get("properties") or {})
                merged_properties.update(candidate.get("properties") or {})
                candidate["properties"] = merged_properties
                candidate["source_artifacts"] = [
                    *previous.get("source_artifacts", [previous.get("source_artifact")]),
                    source,
                ]
            objects[legacy_id] = candidate
        for item in graph.get("relations", []):
            if not isinstance(item, dict) or not all(item.get(key) for key in ("type", "sourceId", "targetId")):
                continue
            relation_id = str(item.get("id") or f"{item['type']}:{item['sourceId']}:{item['targetId']}")
            key = (relation_id, str(item["type"]), str(item["sourceId"]), str(item["targetId"]))
            candidate = dict(item)
            candidate["source_artifact"] = source
            relations[key] = candidate

    @staticmethod
    def _collect_projection(
        document: dict[str, Any],
        source: str,
        objects: dict[str, dict[str, Any]],
        relations: dict[tuple[str, str, str, str], dict[str, Any]],
    ) -> None:
        for node in document.get("nodes", []):
            if not isinstance(node, dict) or not node.get("object_ref"):
                continue
            legacy_id = str(node["object_ref"])
            candidate = {
                "id": legacy_id,
                "type": str(node.get("object_type_ref") or "RuntimeRecord"),
                "properties": {key: value for key, value in node.items() if key not in {"object_ref", "object_type_ref"}},
                "source_artifact": source,
            }
            if legacy_id in objects:
                previous = objects[legacy_id]
                previous_props = dict(previous.get("properties") or {})
                previous_props["dependency_projection"] = candidate["properties"]
                previous["properties"] = previous_props
                previous["source_artifacts"] = [
                    *previous.get("source_artifacts", [previous.get("source_artifact")]),
                    source,
                ]
            else:
                objects[legacy_id] = candidate
        for index, edge in enumerate(document.get("edges", [])):
            if not isinstance(edge, dict):
                continue
            source_id = edge.get("upstream_ref") or edge.get("source_ref") or edge.get("source")
            target_id = edge.get("downstream_ref") or edge.get("target_ref") or edge.get("target")
            if not source_id or not target_id:
                continue
            relation_type = str(
                edge.get("basis_relation_ref")
                or edge.get("relation_type_ref")
                or edge.get("relation_type")
                or "researchDependsOn"
            )
            relation_id = str(edge.get("edge_id") or f"projection:{index}:{source_id}:{target_id}")
            key = (relation_id, relation_type, str(source_id), str(target_id))
            relations[key] = {
                "id": relation_id,
                "type": relation_type,
                "sourceId": str(source_id),
                "targetId": str(target_id),
                "properties": {key: value for key, value in edge.items() if key not in {"edge_id", "source_ref", "target_ref", "source", "target", "relation_type_ref", "relation_type"}},
                "source_artifact": source,
            }

    @staticmethod
    def _make_runtime_entities(run_id: str, candidates: dict[str, dict[str, Any]]) -> list[RuntimeEntity]:
        result = []
        for legacy_id, item in sorted(candidates.items()):
            props = dict(item.get("properties") or {})
            sources = [value for value in item.get("source_artifacts", [item.get("source_artifact")]) if value]
            props.update({"legacy_id": legacy_id, "source_artifacts": sources, "legacy_projection": item.get("projection")})
            result.append(
                RuntimeEntity(
                    id=_stable_id(run_id, legacy_id),
                    type=str(item["type"]),
                    properties=props,
                    valid_from=_first_datetime([item.get("validFrom"), props.get("valid_from"), props.get("business_time_start"), props.get("observed_at")]),
                    valid_until=_first_datetime([item.get("validTo"), props.get("valid_to"), props.get("business_time_end")]),
                    recorded_at=_first_datetime([props.get("recorded_time"), props.get("recorded_at"), props.get("generated_at"), props.get("evaluated_at")]) or datetime(1970, 1, 1, tzinfo=timezone.utc),
                    invalidated_at=_first_datetime([props.get("invalidated_time"), props.get("invalidated_at")]),
                    supersedes=_stable_id(run_id, str(props["supersedes"])) if props.get("supersedes") else None,
                    bundle_id=run_id,
                )
            )
        return result

    @staticmethod
    def _reference_relations(
        run_id: str,
        entities: list[RuntimeEntity],
        entities_by_legacy: dict[str, RuntimeEntity],
    ) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        sequence = 0
        for entity in entities:
            source_legacy_id = str(entity.properties["legacy_id"])
            for key, value in entity.properties.items():
                normalized_key = key.lower()
                if key not in REFERENCE_KEYS and not normalized_key.endswith(("_ref", "_refs")):
                    continue
                for target in _split_refs(value):
                    if not target or target == source_legacy_id or "/" in target or target.endswith((".yaml", ".md", ".csv")):
                        continue
                    sequence += 1
                    result.append(
                        {
                            "id": f"inferred:{sequence}:{source_legacy_id}:{target}",
                            "type": "runtimeReferences",
                            "sourceId": target,
                            "targetId": source_legacy_id,
                            "properties": {"inferred_from": key},
                            "source_artifact": "inferred-reference",
                        }
                    )
        return result

    @staticmethod
    def _lineage_relations(candidates: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        """把旧图的语义方向投影为统一的“上游证据 -> 下游结论”方向。"""
        inverse_types = {
            "claimCitesSource",
            "factSupportedByClaim",
            "assessmentEvaluatesEvidence",
        }
        result: list[dict[str, Any]] = []
        for item in candidates:
            if str(item.get("type")) not in inverse_types:
                continue
            source_id = str(item["sourceId"])
            target_id = str(item["targetId"])
            result.append(
                {
                    "id": f"lineage:{item.get('id') or f'{source_id}:{target_id}'}",
                    "type": "runtimeLineage",
                    "sourceId": target_id,
                    "targetId": source_id,
                    "properties": {
                        "derived_from_relation": item.get("id"),
                        "derived_from_type": item.get("type"),
                    },
                    "source_artifact": "legacy-lineage-normalization",
                }
            )
        return result

    @staticmethod
    def _make_relations(run_id: str, candidates: list[dict[str, Any]]) -> list[RuntimeRelation]:
        result = []
        used_ids: set[str] = set()
        for index, item in enumerate(candidates):
            base_id = str(item.get("id") or f"relation:{index}")
            relation_id = _stable_id(run_id, base_id)
            if relation_id in used_ids:
                relation_id = f"{relation_id}:{index}"
            used_ids.add(relation_id)
            props = dict(item.get("properties") or {})
            props["source_artifact"] = item.get("source_artifact")
            result.append(
                RuntimeRelation(
                    id=relation_id,
                    type=str(item["type"]),
                    source_id=_stable_id(run_id, str(item["sourceId"])),
                    target_id=_stable_id(run_id, str(item["targetId"])),
                    properties=props,
                    valid_from=_first_datetime([item.get("validFrom"), props.get("valid_from")]),
                    valid_until=_first_datetime([item.get("validTo"), props.get("valid_to")]),
                    recorded_at=_first_datetime([props.get("recorded_at"), props.get("generated_at")]) or datetime(1970, 1, 1, tzinfo=timezone.utc),
                    invalidated_at=_first_datetime([props.get("invalidated_at")]),
                    bundle_id=run_id,
                )
            )
        return result

    @staticmethod
    def _load_yaml(path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None

    @staticmethod
    def _load_structured(path: Path, text: str) -> Any:
        return json.loads(text) if path.suffix.lower() == ".json" else yaml.safe_load(text)

    @staticmethod
    def _assert_supported_version(document: dict[str, Any], source: str) -> None:
        schema = str(document.get("schema_name") or document.get("document_type") or "")
        if schema not in SUPPORTED_LEGACY_VERSIONS:
            return
        version = str(document.get("schema_version") or "")
        if version not in SUPPORTED_LEGACY_VERSIONS[schema]:
            raise ValueError(f"{source}: 不支持的旧格式 {schema}/{version}")

    @staticmethod
    def _media_type(path: Path) -> str:
        return {
            ".yaml": "application/yaml",
            ".yml": "application/yaml",
            ".json": "application/json",
            ".csv": "text/csv",
            ".md": "text/markdown",
            ".txt": "text/plain",
        }[path.suffix.lower()]

    @staticmethod
    def _schema_version(path: Path, text: str) -> str | None:
        if path.suffix.lower() in {".yaml", ".yml", ".json"}:
            try:
                parsed = json.loads(text) if path.suffix.lower() == ".json" else yaml.safe_load(text)
                if isinstance(parsed, dict) and parsed.get("schema_version") is not None:
                    return str(parsed["schema_version"])
            except (ValueError, yaml.YAMLError):
                pass
        return None

    @staticmethod
    def _artifact_time(path: Path, text: str) -> datetime:
        if path.suffix.lower() in {".yaml", ".yml", ".json"}:
            try:
                parsed = json.loads(text) if path.suffix.lower() == ".json" else yaml.safe_load(text)
                if isinstance(parsed, dict):
                    metadata = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
                    value = _first_datetime(
                        [
                            parsed.get("generated_at"),
                            parsed.get("reviewed_at"),
                            metadata.get("judgment_as_of"),
                            metadata.get("data_cutoff"),
                        ]
                    )
                    if value:
                        return value
            except (ValueError, yaml.YAMLError):
                pass
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


class ResearchRunExporter:
    """从图中的 LegacyArtifact 生成现有人工审阅格式。"""

    def __init__(self, repository: ResearchGraphRepository) -> None:
        self.repository = repository

    def export_legacy_run(self, bundle_id: str, output_dir: str | Path) -> list[Path]:
        target = Path(output_dir).resolve()
        target.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []
        artifacts = [
            entity
            for entity in self.repository.list_entities(bundle_id)
            if entity.type == "LegacyArtifact"
        ]
        for artifact in artifacts:
            relative = PurePosixPath(str(artifact.properties["legacy_path"]))
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"非法旧产物路径: {relative}")
            destination = target.joinpath(*relative.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(str(artifact.properties["content"]), encoding="utf-8")
            actual = _digest(destination.read_bytes())
            if actual != artifact.properties["sha256"]:
                raise ValueError(f"导出哈希不一致: {relative}")
            written.append(destination)
        return sorted(written)
