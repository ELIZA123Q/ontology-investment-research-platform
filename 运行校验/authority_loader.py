#!/usr/bin/env python3
"""读取 v2 权威或 v1 只读转发文件。"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml


def _merge(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(left)
    for key, value in right.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def load_authority_yaml(path: str | Path) -> dict[str, Any]:
    source = Path(path)
    document = yaml.safe_load(source.read_text(encoding="utf-8-sig"))
    if not isinstance(document, dict):
        raise ValueError(f"{source} 必须是 YAML 对象")
    targets = document.get("authority_targets")
    if not targets:
        return document
    merged: dict[str, Any] = {}
    for target in targets:
        merged = _merge(merged, load_authority_yaml((source.parent / str(target)).resolve()))
    if document.get("compatibility_shape") == "v1_business_instance_graph":
        merged = _legacy_business_instances(document, merged)
    elif document.get("compatibility_shape") == "v1_common":
        merged["common_enums"] = _merge(
            merged.get("common_enums", {}), merged.pop("runtime_enums", {})
        )
    overlay = {
        key: value
        for key, value in document.items()
        if key not in {"authority_targets", "compatibility_shape"}
    }
    return _merge(merged, overlay)


def _legacy_business_instances(stub: dict[str, Any], sources: dict[str, Any]) -> dict[str, Any]:
    bindings = {
        str(item["metric_ref"]): dict(item.get("properties") or {})
        for item in sources.get("metric_runtime_bindings", [])
    }
    objects: list[dict[str, Any]] = []
    for index, metric in enumerate(sources.get("semantic_instances", [])):
        props = dict(metric.get("properties") or {})
        metric_id = str(metric["id"])
        legacy_props = {
            "name": props.get("name"),
            "category": props.get("category"),
            "definition": props.get("definition"),
            "variable_kind": props.get("variableKind"),
            "anchors": props.get("anchorTypes", []),
            **bindings.get(metric_id, {}),
        }
        objects.append({
            "id": metric_id,
            "type": "StateVariable",
            "properties": legacy_props,
            "projection": {"section": "state_variables", "index": index},
        })
    objects.extend(deepcopy(sources.get("runtime_objects", [])))
    return {
        "schema_name": stub.get("schema_name", "semiconductor_business_instances"),
        "schema_version": stub.get("schema_version", "1.0.0"),
        "depends_on": stub.get("depends_on", []),
        "business_instance_graph": {
            "schema_name": "ontology_business_instance_graph",
            "schema_version": "1.0.0",
            "authority": "business_parameters",
            "objects": objects,
            "relations": deepcopy(sources.get("runtime_relations", [])),
        },
    }
