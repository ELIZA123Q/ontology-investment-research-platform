from __future__ import annotations

from pathlib import Path
import json

import yaml
from pyshacl import validate
from rdflib import Graph

from ir_platform.ontology import SemanticOntologyCompiler, SemanticOntologyRegistry


ROOT = Path(__file__).resolve().parents[1]


def test_boundary_and_metric_catalog() -> None:
    registry = SemanticOntologyRegistry(ROOT / "语义本体")
    assert len(registry.semantic_instances) == 46
    forbidden = {"SourceDocument", "EvidenceClaim", "Judgment", "RuleEvaluation", "ResearchPlan"}
    assert forbidden.isdisjoint(registry.object_types)
    for source in registry.iter_source_files():
        document = yaml.safe_load(source.read_text(encoding="utf-8"))
        assert not ({"action_types", "functions", "logic_flows", "rules"} & set(document))


def test_compilation_is_byte_deterministic_and_valid_turtle(tmp_path: Path) -> None:
    compiler = SemanticOntologyCompiler(SemanticOntologyRegistry(ROOT / "语义本体"))
    first = compiler.compile(tmp_path / "first")
    second = compiler.compile(tmp_path / "second")
    assert first.digest == second.digest
    for name in ("ontology.ttl", "shapes.ttl", "vocabularies.ttl", "mapping.json"):
        assert (first.output_dir / name).read_bytes() == (second.output_dir / name).read_bytes()
    for path in (first.ontology_path, first.shapes_path, first.vocabularies_path):
        Graph().parse(path, format="turtle")
    mapping = json.loads(first.mapping_path.read_text(encoding="utf-8"))
    assert mapping["legacy_type_mappings"]["StateVariable"]["node_type"] == "ResearchMetric"
    assert mapping["legacy_type_mappings"]["Judgment"]["layer"] == "research_runtime"


def test_shacl_rejects_missing_required_fields(tmp_path: Path) -> None:
    result = SemanticOntologyCompiler().compile(tmp_path)
    data = Graph().parse(
        data="""
        @prefix ir: <ir://invest-ontology#> .
        <ir://example/company/1> a ir:Company .
        """,
        format="turtle",
    )
    shapes = Graph().parse(result.shapes_path, format="turtle")
    ontology = Graph().parse(result.ontology_path, format="turtle")
    conforms, _, _ = validate(data, shacl_graph=shapes, ont_graph=ontology, inference="rdfs")
    assert not conforms


def test_every_type_and_relation_has_stable_iri() -> None:
    registry = SemanticOntologyRegistry()
    assert len({registry.type_iri(name) for name in registry.object_types}) == len(registry.object_types)
    assert len({registry.relation_iri(name) for name in registry.relation_types}) == len(registry.relation_types)
    assert all(registry.type_iri(name).startswith("ir://invest-ontology") for name in registry.object_types)
