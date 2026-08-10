#!/usr/bin/env python3
"""Assemble semiconductor business_instances.yaml from parameters/*.yaml sources."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import yaml

DOMAIN = Path(__file__).resolve().parent
ROOT = DOMAIN.parents[1]
PARAMS = DOMAIN / "parameters"
OUTPUT = DOMAIN / "business_instances.yaml"

SOURCES = (
    "state_variables.yaml",
    "evidence_parameters.yaml",
    "reasoning_parameters.yaml",
    "scenario_parameters.yaml",
)


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: root must be a mapping")
    return value


def assemble() -> dict[str, Any]:
    objects: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    for name in SOURCES:
        doc = load(PARAMS / name)
        objects.extend(doc.get("objects") or [])
        relations.extend(doc.get("relations") or [])
    return {
        "schema_name": "semiconductor_domain_business_instances",
        "schema_version": "1.2.0",
        "status": "active",
        "generated": True,
        "generator": "01_semantic_knowledge/01_ontology/domains/semiconductor/build_business_instances.py",
        "source_of_truth": [f"domains/semiconductor/parameters/{name}" for name in SOURCES],
        "description": (
            "由 parameters/*.yaml 汇总生成的 Runtime 只读 Bundle。"
            "人工编辑请改 parameters/ 源文件后重新生成；不要直接改本文件。"
        ),
        "shadow_type_contract": (
            "EvidenceProfile / PropagationTemplate / ProxyIndicator / ScenarioTemplate / "
            "SourceProfile / EvidenceRecipe / JudgmentLevelCriterionTemplate / BusinessScenarioTag "
            "仅作为业务参数图节点/模板；不得当作正式 Ontology Object/Relation 物化进正式实例图。"
        ),
        "depends_on": [
            "../../models/semantic.yaml",
            "../../models/state_event.yaml",
            "../../models/evidence.yaml",
            "../../models/judgment.yaml",
            "../../models/operational.yaml",
            "./ontology_extension.yaml",
        ],
        "catalog_refs": {
            "scenario_catalog": {
                "path": "../../../../02_scenario_task/scenario_catalog.yaml",
                "role": "task_catalog_only",
                "note": "场景类型枚举属于 02_scenario_task，不是正式 Ontology Model dependency。",
            }
        },
        "business_instance_graph": {
            "schema_name": "ontology_business_instance_graph",
            "schema_version": "1.0.0",
            "authority": "business_parameters",
            "objects": objects,
            "relations": relations,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Fail if bundle is stale")
    args = parser.parse_args()
    payload = assemble()
    text = yaml.safe_dump(payload, allow_unicode=True, sort_keys=False)
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != text:
            print("business_instances.yaml is stale; run build_business_instances.py")
            return 1
        print("business_instances.yaml is up to date")
        return 0
    OUTPUT.write_text(text, encoding="utf-8")
    graph = payload["business_instance_graph"]
    print(f"generated {OUTPUT} ({len(graph['objects'])} objects, {len(graph['relations'])} relations)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
