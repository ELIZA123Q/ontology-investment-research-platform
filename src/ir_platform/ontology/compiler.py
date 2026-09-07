from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .registry import SemanticOntologyRegistry


XSD_TYPES = {
    "string": "xsd:string",
    "integer": "xsd:integer",
    "number": "xsd:decimal",
    "boolean": "xsd:boolean",
    "date": "xsd:date",
    "datetime": "xsd:dateTime",
    "enum": "xsd:string",
    "array": "rdf:JSON",
    "object": "rdf:JSON",
    "any": "xsd:string",
    "object_ref": "xsd:anyURI",
    "semantic_ref": "xsd:anyURI",
    "reasoning_ref": "xsd:anyURI",
    "evidence_ref": "xsd:anyURI",
}


def _literal(value: Any) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def _local(value: str) -> str:
    return value.replace(" ", "_").replace("/", "_").replace("#", "_")


@dataclass(frozen=True)
class CompilationResult:
    output_dir: Path
    ontology_path: Path
    shapes_path: Path
    vocabularies_path: Path
    mapping_path: Path
    digest: str


class SemanticOntologyCompiler:
    """把严格语义 YAML 确定性编译为 OWL、SHACL、SKOS 与映射报告。"""

    def __init__(self, registry: SemanticOntologyRegistry | None = None) -> None:
        self.registry = registry or SemanticOntologyRegistry()

    def compile(self, output_dir: str | Path = "build/semantic-ontology") -> CompilationResult:
        target = Path(output_dir)
        target.mkdir(parents=True, exist_ok=True)
        contents = {
            "ontology.ttl": self._owl(),
            "shapes.ttl": self._shacl(),
            "vocabularies.ttl": self._skos(),
            "mapping.json": self._mapping(),
        }
        digest = hashlib.sha256(
            "".join(f"{name}\0{contents[name]}" for name in sorted(contents)).encode("utf-8")
        ).hexdigest()
        for name, content in contents.items():
            (target / name).write_text(content, encoding="utf-8")
        return CompilationResult(
            output_dir=target,
            ontology_path=target / "ontology.ttl",
            shapes_path=target / "shapes.ttl",
            vocabularies_path=target / "vocabularies.ttl",
            mapping_path=target / "mapping.json",
            digest=digest,
        )

    @staticmethod
    def _prefixes() -> list[str]:
        return [
            "@prefix ir: <ir://invest-ontology#> .",
            "@prefix irsc: <ir://invest-ontology/semiconductor#> .",
            "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
            "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
            "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
            "@prefix sh: <http://www.w3.org/ns/shacl#> .",
            "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .",
            "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
            "",
        ]

    def _qname_for_type(self, name: str) -> str:
        return ("irsc:" if name in self.registry.domain.get("object_types", {}) else "ir:") + _local(name)

    def _qname_for_relation(self, name: str) -> str:
        return ("irsc:" if name in self.registry.domain.get("relation_types", {}) else "ir:") + _local(name)

    def _owl(self) -> str:
        lines = self._prefixes()
        lines += ["ir:Ontology a owl:Ontology ;", '  rdfs:label "投研严格语义本体"@zh .', ""]
        property_ranges: dict[str, set[str]] = {}
        for name, spec in sorted(self.registry.object_types.items()):
            subject = self._qname_for_type(name)
            statements = ["a owl:Class", f"rdfs:label {_literal(spec.get('name', name))}@zh"]
            if spec.get("description"):
                statements.append(f"rdfs:comment {_literal(spec['description'])}@zh")
            if spec.get("extends"):
                statements.append(f"rdfs:subClassOf {self._qname_for_type(str(spec['extends']))}")
            lines += self._statement(subject, statements)
            for prop_name, prop in sorted(self.registry.properties_for_type(name).items()):
                property_ranges.setdefault(prop_name, set()).add(
                    XSD_TYPES.get(str(prop.get("type")), "xsd:string")
                )
        # 属性会被多个类复用。为同一属性重复声明 rdfs:domain 会产生“定义域交集”语义，
        # 因此 OWL 只声明稳定的 range；适用类型和必填/基数由 SHACL 精确表达。
        for prop_name, ranges in sorted(property_ranges.items()):
            prop_statements = ["a owl:DatatypeProperty"]
            if len(ranges) == 1:
                prop_statements.append(f"rdfs:range {next(iter(ranges))}")
            lines += self._statement(f"ir:{_local(prop_name)}", prop_statements)
        for name, spec in sorted(self.registry.relation_types.items()):
            subject = self._qname_for_relation(name)
            statements = ["a owl:ObjectProperty", f"rdfs:label {_literal(spec.get('name', name))}@zh"]
            if len(spec.get("source_types", [])) == 1:
                statements.append(f"rdfs:domain {self._qname_for_type(spec['source_types'][0])}")
            if len(spec.get("target_types", [])) == 1:
                statements.append(f"rdfs:range {self._qname_for_type(spec['target_types'][0])}")
            lines += self._statement(subject, statements)
        return "\n".join(lines).rstrip() + "\n"

    def _shacl(self) -> str:
        lines = self._prefixes()
        for name, spec in sorted(self.registry.object_types.items()):
            qname = self._qname_for_type(name)
            shape = f"{qname}Shape"
            lines += [f"{shape} a sh:NodeShape ;", f"  sh:targetClass {qname} ;"]
            properties = sorted(self.registry.properties_for_type(name).items())
            for index, (prop_name, prop) in enumerate(properties):
                block = [f"    sh:path ir:{_local(prop_name)}"]
                if prop.get("required"):
                    block.append("    sh:minCount 1")
                prop_type = str(prop.get("type"))
                if prop_type in {"object_ref", "semantic_ref"}:
                    block.append("    sh:nodeKind sh:IRI")
                else:
                    block.append(f"    sh:datatype {XSD_TYPES.get(prop_type, 'xsd:string')}")
                allowed = prop.get("allowed_values")
                if allowed:
                    values = " ".join(_literal(value) for value in allowed)
                    block.append(f"    sh:in ( {values} )")
                separator = " ;\n".join(block)
                lines.append(f"  sh:property [\n{separator}\n  ] ;")
            if "validFrom" in dict(properties) and "validTo" in dict(properties):
                lines += [
                    "  sh:sparql [",
                    '    sh:message "validFrom 不得晚于 validTo"@zh ;',
                    '    sh:select """SELECT $this WHERE { $this ir:validFrom ?start ; ir:validTo ?end . FILTER (?start > ?end) }"""',
                    "  ] ;",
                ]
            lines[-1] = lines[-1][:-1] + "." if lines[-1].endswith(";") else lines[-1]
            lines.append("")
        for relation_name, relation in sorted(self.registry.relation_types.items()):
            max_count = relation.get("cardinality") in {"one_to_one", "many_to_one"}
            for source_type in sorted(relation.get("source_types", [])):
                shape = f"{self._qname_for_type(source_type)}-{_local(relation_name)}Shape"
                lines += [
                    f"{shape} a sh:NodeShape ;",
                    f"  sh:targetClass {self._qname_for_type(source_type)} ;",
                    "  sh:property [",
                    f"    sh:path {self._qname_for_relation(relation_name)} ;",
                ]
                targets = relation.get("target_types", [])
                if len(targets) == 1:
                    lines.append(f"    sh:class {self._qname_for_type(targets[0])} ;")
                elif targets:
                    alternatives = " ".join(
                        f"[ sh:class {self._qname_for_type(target)} ]" for target in sorted(targets)
                    )
                    lines.append(f"    sh:or ( {alternatives} ) ;")
                if max_count:
                    lines.append("    sh:maxCount 1 ;")
                lines[-1] = lines[-1][:-1]
                lines += ["  ] .", ""]
        return "\n".join(lines).rstrip() + "\n"

    def _skos(self) -> str:
        lines = self._prefixes()
        for vocabulary, raw in sorted(self.registry.controlled_vocabularies.items()):
            scheme = f"irsc:vocab-{_local(vocabulary)}"
            lines += self._statement(
                scheme,
                ["a skos:ConceptScheme", f"skos:prefLabel {_literal(vocabulary)}"],
            )
            values = raw.get("values", raw) if isinstance(raw, dict) else raw
            if isinstance(values, dict):
                values = [dict(value, id=key) if isinstance(value, dict) else {"id": key, "name": value} for key, value in values.items()]
            if not isinstance(values, list):
                continue
            for value in values:
                if isinstance(value, str):
                    value = {"id": value, "name": value}
                if not isinstance(value, dict) or not value.get("id"):
                    continue
                concept = f"irsc:vocab-{_local(vocabulary)}-{_local(str(value['id']))}"
                statements = [
                    "a skos:Concept",
                    f"skos:inScheme {scheme}",
                    f"skos:prefLabel {_literal(value.get('name', value['id']))}@zh",
                ]
                if value.get("description"):
                    statements.append(f"skos:definition {_literal(value['description'])}@zh")
                lines += self._statement(concept, statements)
        return "\n".join(lines).rstrip() + "\n"

    def _mapping(self) -> str:
        runtime_types: set[str] = set()
        runtime_root = self.registry.root.parent / "研究运行合同"
        for name in ("evidence.yaml", "reasoning.yaml"):
            path = runtime_root / name
            if path.is_file():
                document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
                runtime_types.update(str(item) for item in (document.get("object_types") or {}))
        legacy_type_mappings = {
            name: {
                "iri": self.registry.type_iri(name),
                "node_type": name,
                "layer": "semantic_ontology",
            }
            for name in sorted(self.registry.object_types)
        }
        legacy_type_mappings.update(
            {
                name: {
                    "iri": f"ir://invest-ontology/runtime#type/{name}",
                    "node_type": name,
                    "layer": "research_runtime",
                }
                for name in sorted(runtime_types)
            }
        )
        legacy_type_mappings["StateVariable"] = {
            "iri": self.registry.type_iri("ResearchMetric"),
            "node_type": "ResearchMetric",
            "layer": "semantic_ontology",
            "migration": "稳定定义迁为 ResearchMetric；读数、方向和判断迁为运行对象",
        }
        payload = {
            "schema_version": "1.0.0",
            "base_iri": self.registry.base_iri,
            "domain_base_iri": self.registry.domain_base_iri,
            "object_types": {
                name: {"iri": self.registry.type_iri(name), "node_type": name}
                for name in sorted(self.registry.object_types)
            },
            "legacy_type_mappings": legacy_type_mappings,
            "relation_types": {
                name: {
                    "iri": self.registry.relation_iri(name),
                    "source_types": spec.get("source_types", []),
                    "target_types": spec.get("target_types", []),
                    "cardinality": spec.get("cardinality"),
                }
                for name, spec in sorted(self.registry.relation_types.items())
            },
        }
        return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"

    @staticmethod
    def _statement(subject: str, statements: list[str]) -> list[str]:
        if not statements:
            return []
        result = [f"{subject} {statements[0]}" if statements[0].startswith("a ") else f"{subject} {statements[0]}"]
        for statement in statements[1:]:
            result[-1] += " ;"
            result.append(f"  {statement}")
        result[-1] += " ."
        result.append("")
        return result
