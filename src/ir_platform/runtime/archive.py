from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

from rdflib import Dataset, Literal, RDF, URIRef

from .models import GraphBundle, RuntimeEntity, RuntimeRelation
from .repository import ResearchGraphRepository


RUNTIME = "ir://invest-ontology/runtime#"
PROV = "http://www.w3.org/ns/prov#"


def _entity_iri(identifier: str) -> URIRef:
    return URIRef(f"{RUNTIME}entity/{quote(identifier, safe='')}")


def _relation_iri(identifier: str) -> URIRef:
    return URIRef(f"{RUNTIME}relation/{quote(identifier, safe='')}")


def _bundle_iri(identifier: str) -> URIRef:
    return URIRef(f"urn:ir:research-bundle:{quote(identifier, safe='')}")


class ResearchGraphArchiveService:
    """以确定性 TriG 作为可移植图归档；装载后 Oxigraph 仍是运行权威。"""

    def __init__(self, repository: ResearchGraphRepository) -> None:
        self.repository = repository

    def export_bundle(self, bundle_id: str, path: str | Path) -> Path:
        graph = _bundle_iri(bundle_id)
        triples: list[tuple[str, str, str]] = [
            (graph.n3(), RDF.type.n3(), URIRef(f"{PROV}Bundle").n3()),
            (graph.n3(), URIRef(f"{RUNTIME}identifier").n3(), Literal(bundle_id).n3()),
        ]
        for entity in self.repository.list_entities(bundle_id):
            subject = _entity_iri(entity.id)
            payload = json.dumps(entity.model_dump(mode="json"), ensure_ascii=False, sort_keys=True)
            triples.extend(
                [
                    (subject.n3(), RDF.type.n3(), URIRef(f"{RUNTIME}RuntimeEntity").n3()),
                    (subject.n3(), RDF.type.n3(), URIRef(f"{PROV}Entity").n3()),
                    (subject.n3(), URIRef(f"{RUNTIME}payload").n3(), Literal(payload).n3()),
                ]
            )
        for relation in self.repository.list_relations(bundle_id):
            subject = _relation_iri(relation.id)
            payload = json.dumps(relation.model_dump(mode="json"), ensure_ascii=False, sort_keys=True)
            triples.extend(
                [
                    (subject.n3(), RDF.type.n3(), URIRef(f"{RUNTIME}RuntimeRelation").n3()),
                    (subject.n3(), URIRef(f"{RUNTIME}payload").n3(), Literal(payload).n3()),
                    (
                        _entity_iri(relation.source_id).n3(),
                        URIRef(f"{RUNTIME}predicate/{quote(relation.type, safe='')}").n3(),
                        _entity_iri(relation.target_id).n3(),
                    ),
                ]
            )
        lines = [
            "@prefix prov: <http://www.w3.org/ns/prov#> .",
            "@prefix runtime: <ir://invest-ontology/runtime#> .",
            "",
            f"{graph.n3()} {{",
        ]
        lines.extend(f"  {subject} {predicate} {obj} ." for subject, predicate, obj in sorted(set(triples)))
        lines.extend(["}", ""])
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text("\n".join(lines), encoding="utf-8")
        return destination

    def import_bundle(self, path: str | Path) -> GraphBundle:
        dataset = Dataset()
        dataset.parse(Path(path), format="trig")
        entities: list[RuntimeEntity] = []
        relations: list[RuntimeRelation] = []
        entity_class = URIRef(f"{RUNTIME}RuntimeEntity")
        relation_class = URIRef(f"{RUNTIME}RuntimeRelation")
        payload_predicate = URIRef(f"{RUNTIME}payload")
        for graph in dataset.graphs():
            for subject in graph.subjects(RDF.type, entity_class):
                payload = graph.value(subject, payload_predicate)
                if payload is not None:
                    entities.append(RuntimeEntity.model_validate_json(str(payload)))
            for subject in graph.subjects(RDF.type, relation_class):
                payload = graph.value(subject, payload_predicate)
                if payload is not None:
                    relations.append(RuntimeRelation.model_validate_json(str(payload)))
        bundle_ids = {item.bundle_id for item in [*entities, *relations]}
        if len(bundle_ids) != 1:
            raise ValueError(f"TriG 必须且只能包含一个运行 bundle，实际为 {sorted(bundle_ids)}")
        bundle = GraphBundle(
            bundle_id=next(iter(bundle_ids)),
            entities=sorted(entities, key=lambda item: item.id),
            relations=sorted(relations, key=lambda item: item.id),
            metadata={"archive_format": "trig", "source": str(path)},
        )
        self.repository.add_bundle(bundle)
        return bundle

