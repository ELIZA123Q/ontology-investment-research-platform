#!/usr/bin/env python3
"""Compile 01-05 definition authorities into a read-only Runtime projection."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import yaml


RUNTIME = Path(__file__).resolve().parents[1]
ROOT = RUNTIME.parent
OUTPUT = RUNTIME / "src/generated/domain-catalog.ts"


def load_yaml(relative: str):
    return yaml.safe_load((ROOT / relative).read_text(encoding="utf-8"))


def fingerprint(relative: str) -> str:
    return "sha256:" + hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    sources = [
        "01_semantic_knowledge/02_dictionary/02_aliases.yaml",
        "01_semantic_knowledge/02_dictionary/04_ambiguity_rules.yaml",
        "01_semantic_knowledge/02_dictionary/05_deprecated_terms.yaml",
        "01_semantic_knowledge/03_knowledge_graph/contracts/trace_policy.yaml",
        "02_scenario_task/01_intents/types.yaml",
        "02_scenario_task/02_scenarios/types.yaml",
        "02_scenario_task/03_tasks/registry.yaml",
        "02_scenario_task/04_roles/roles.yaml",
        "02_scenario_task/05_workflow_patterns/registry.yaml",
        "03_agent_capability/01_agents/registry.yaml",
        "03_agent_capability/02_skills/registry.yaml",
        "03_agent_capability/03_tools/registry.yaml",
        "03_agent_capability/releases/current.json",
        "04_context_state/01_context/contract.yaml",
        "04_context_state/02_state/contract.yaml",
        "04_context_state/03_memory/contract.yaml",
        "04_context_state/04_workspace/contract.yaml",
        "05_control_evaluation/01_rules/policies/judgment_threshold_policy.yaml",
        "05_control_evaluation/01_rules/policies/judgment_method_routes.yaml",
        "05_control_evaluation/03_permissions/permission_matrix.yaml",
    ]

    task_registry = load_yaml("02_scenario_task/03_tasks/registry.yaml")
    task_paths = [f"02_scenario_task/03_tasks/{entry['path']}" for entry in task_registry["task_definitions"]]
    workflow_registry = load_yaml("02_scenario_task/05_workflow_patterns/registry.yaml")
    workflow_paths = [f"02_scenario_task/05_workflow_patterns/{entry['path']}" for entry in workflow_registry["patterns"]]
    sources.extend(task_paths)
    sources.extend(workflow_paths)

    release_path = ROOT / "03_agent_capability/releases/current.json"
    catalog = {
        "schemaName": "runtime_domain_catalog_projection",
        "schemaVersion": "1.0.0",
        "sourceFingerprints": {path: fingerprint(path) for path in sorted(set(sources))},
        "dictionary": {
            "aliases": load_yaml(sources[0])["entries"],
            "ambiguityRules": load_yaml(sources[1])["rules"],
            "deprecatedTerms": load_yaml(sources[2])["entries"],
        },
        "tracePolicy": load_yaml(sources[3]),
        "intentTypes": load_yaml(sources[4])["intent_types"],
        "scenarioTypes": load_yaml(sources[5])["scenario_types"],
        "tasks": {item["task_id"]: item for item in (load_yaml(path) for path in task_paths)},
        "roles": load_yaml("02_scenario_task/04_roles/roles.yaml")["roles"],
        "workflowPatterns": {item["workflow_id"]: item for item in (load_yaml(path) for path in workflow_paths)},
        "capabilities": {
            "agents": load_yaml("03_agent_capability/01_agents/registry.yaml"),
            "skills": load_yaml("03_agent_capability/02_skills/registry.yaml"),
            "tools": load_yaml("03_agent_capability/03_tools/registry.yaml"),
            "release": json.loads(release_path.read_text(encoding="utf-8")),
        },
        "contextState": {
            "context": load_yaml("04_context_state/01_context/contract.yaml"),
            "state": load_yaml("04_context_state/02_state/contract.yaml"),
            "memory": load_yaml("04_context_state/03_memory/contract.yaml"),
            "workspace": load_yaml("04_context_state/04_workspace/contract.yaml"),
        },
        "governance": {
            "judgmentThreshold": load_yaml("05_control_evaluation/01_rules/policies/judgment_threshold_policy.yaml"),
            "judgmentMethodRoutes": load_yaml("05_control_evaluation/01_rules/policies/judgment_method_routes.yaml"),
            "permissions": load_yaml("05_control_evaluation/03_permissions/permission_matrix.yaml"),
        },
    }
    payload = json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True)
    rendered = (
        "// Generated from 01-05 definition authorities by scripts/generate-domain-catalog.py.\n"
        "// Do not edit: update the owning 01-05 file and run npm run domain:sync.\n"
        f"export const DOMAIN_CATALOG = {payload} as const;\n"
    )

    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != rendered:
            print(f"domain catalog drift: run npm --prefix 06_runtime run domain:sync")
            return 1
        print(f"checked {OUTPUT.relative_to(ROOT)} ({len(catalog['tasks'])} tasks, {len(catalog['scenarioTypes'])} scenarios)")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"generated {OUTPUT.relative_to(ROOT)} ({len(catalog['tasks'])} tasks, {len(catalog['scenarioTypes'])} scenarios)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
