#!/usr/bin/env python3
"""Compile generated migration projections into an immutable, replayable knowledge bundle.

01-05 remain the only authoring authorities. The generated TypeScript projections are
read only during the migration; Runtime consumers use the JSON bundle emitted here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


RUNTIME = Path(__file__).resolve().parents[1]
DOMAIN_PROJECTION = RUNTIME / "src/generated/domain-catalog.ts"
ONTOLOGY_PROJECTION = RUNTIME / "src/ontology/generated.ts"
OUTPUT_ROOT = RUNTIME / ".data/knowledge-bundles"
CURRENT = OUTPUT_ROOT / "current.json"


def parse_projection(path: Path, export_name: str) -> dict[str, Any]:
    source = path.read_text(encoding="utf-8")
    marker = f"export const {export_name} = "
    start = source.find(marker)
    end = source.rfind(" as const;")
    if start < 0 or end < 0:
        raise ValueError(f"{path}: cannot locate {export_name}")
    value = json.loads(source[start + len(marker):end])
    if not isinstance(value, dict):
        raise ValueError(f"{path}: projection must be an object")
    return value


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical(value)).hexdigest()


def version_of(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("schema_version", "schemaVersion", "version"):
            if value.get(key) is not None:
                return str(value[key])
    return "1.0.0"


def build_index(domain: dict[str, Any], ontology: dict[str, Any]) -> dict[str, Any]:
    assets: dict[str, dict[str, str]] = {}
    references: dict[str, list[str]] = {}

    def add(asset_id: str, component: str, authority: str, value: Any, refs: list[str] | None = None) -> None:
        if asset_id in assets:
            raise ValueError(f"duplicate knowledge asset id: {asset_id}")
        assets[asset_id] = {"component": component, "authorityRef": authority, "version": version_of(value)}
        references[asset_id] = sorted(set(refs or []))

    skills = domain["capabilities"]["skills"]["skills"]
    skill_ids = {str(item["skill_id"]) for item in skills}
    for item in skills:
        skill_id = str(item["skill_id"])
        add(f"skill:{skill_id}", "capabilities", str(item["skill_md"]), item)

    declared_requirements = {
        str(raw).replace("_", "-")
        for item in domain["tasks"].values()
        for raw in (item.get("capability_requirements") or [])
        if str(raw).replace("_", "-") not in skill_ids
    }
    for requirement in sorted(declared_requirements):
        add(
            f"capability-requirement:{requirement}",
            "tasks",
            "02_scenario_task/03_tasks/registry.yaml",
            {"id": requirement, "schema_version": "1.0.0", "kind": "reasoning_requirement"},
        )

    for task_id, item in domain["tasks"].items():
        refs: list[str] = []
        for raw in item.get("capability_requirements") or []:
            normalized = str(raw).replace("_", "-")
            refs.append(f"skill:{normalized}" if normalized in skill_ids else f"capability-requirement:{normalized}")
        add(f"task:{task_id}", "tasks", f"02_scenario_task/03_tasks/{task_id}.yaml", item, refs)

    for workflow_id, item in domain["workflowPatterns"].items():
        add(f"workflow:{workflow_id}", "workflows", f"02_scenario_task/05_workflow_patterns/{workflow_id}.yaml", item)

    for group in ("agents", "candidates"):
        for item in domain["capabilities"]["agents"].get(group) or []:
            add(f"agent:{item['agent_id']}", "capabilities", "03_agent_capability/01_agents/registry.yaml", item)
    for item in domain["capabilities"]["tools"].get("tools") or []:
        add(f"tool:{item['tool_id']}", "capabilities", "03_agent_capability/03_tools/registry.yaml", item)

    for object_id, item in ontology.get("objects", {}).items():
        add(f"ontology-object:{object_id}", "ontology", "01_semantic_knowledge/01_ontology/platform_registry.yaml", item)
    for action_id, item in ontology.get("actions", {}).items():
        add(f"ontology-action:{action_id}", "ontology", "01_semantic_knowledge/01_ontology/kinetics/action_types.yaml", item)

    for asset_id, refs in references.items():
        missing = [ref for ref in refs if ref not in assets]
        if missing:
            raise ValueError(f"{asset_id} has dangling references: {missing}")
    return {"assetsById": dict(sorted(assets.items())), "referencesByAsset": dict(sorted(references.items()))}


def build() -> tuple[dict[str, Any], dict[str, Any]]:
    domain = parse_projection(DOMAIN_PROJECTION, "DOMAIN_CATALOG")
    ontology = parse_projection(ONTOLOGY_PROJECTION, "ONTOLOGY_CATALOG")
    index = build_index(domain, ontology)
    body = {
        "schemaName": "investment_knowledge_bundle",
        "schemaVersion": "1.0.0",
        "domain": domain,
        "ontology": ontology,
        "index": index,
    }
    bundle_id = digest(body)
    bundle = {**body, "bundleId": bundle_id}
    source_fingerprints = dict(sorted(domain.get("sourceFingerprints", {}).items()))
    source_fingerprints["01_semantic_knowledge/01_ontology/platform_registry.yaml"] = str(ontology["fingerprint"])
    component_values = {
        "semantic": {"dictionary": domain["dictionary"], "ontology": ontology},
        "tasks": {"tasks": domain["tasks"], "workflows": domain["workflowPatterns"]},
        "capabilities": domain["capabilities"],
        "contextState": domain["contextState"],
        "governance": domain["governance"],
        "evaluation": domain["evaluation"],
    }
    components = {
        name: {
            "fingerprint": digest(value),
            "assetCount": sum(1 for asset in index["assetsById"].values() if asset["component"] == name or (name == "semantic" and asset["component"] == "ontology")),
        }
        for name, value in component_values.items()
    }
    manifest = {
        "schemaName": "investment_knowledge_bundle_manifest",
        "schemaVersion": "1.0.0",
        "bundleId": bundle_id,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceFingerprint": digest(source_fingerprints),
        "compatibility": {"runtime": "1.x", "ontology": str(ontology["platformVersion"])},
        "components": components,
        "sourceFingerprints": source_fingerprints,
    }
    return bundle, manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    bundle, manifest = build()
    directory = OUTPUT_ROOT / bundle["bundleId"].removeprefix("sha256:")
    bundle_path = directory / "bundle.json"
    manifest_path = directory / "manifest.json"
    if args.check:
        if not bundle_path.is_file() or not manifest_path.is_file() or not CURRENT.is_file():
            print("knowledge bundle missing: run npm --prefix 06_runtime run knowledge:bundle")
            return 1
        current = json.loads(CURRENT.read_text(encoding="utf-8"))
        stored_bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        stored_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        comparable_manifest = {key: value for key, value in manifest.items() if key != "createdAt"}
        stored_comparable = {key: value for key, value in stored_manifest.items() if key != "createdAt"}
        if stored_bundle != bundle or comparable_manifest != stored_comparable or current.get("bundleId") != bundle["bundleId"]:
            print("knowledge bundle drift: run npm --prefix 06_runtime run knowledge:bundle")
            return 1
        print(f"checked immutable knowledge bundle {bundle['bundleId']} ({len(bundle['index']['assetsById'])} assets)")
        return 0
    directory.mkdir(parents=True, exist_ok=True)
    if not bundle_path.exists():
        bundle_path.write_text(json.dumps(bundle, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    CURRENT.write_text(json.dumps({"bundleId": bundle["bundleId"]}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"compiled immutable knowledge bundle {bundle['bundleId']} ({len(bundle['index']['assetsById'])} assets)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
