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
GENERATOR_VERSION = "2.0.0"


def load_yaml(relative: str):
    return yaml.safe_load((ROOT / relative).read_text(encoding="utf-8"))


def fingerprint(relative: str) -> str:
    return "sha256:" + hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


def load_skill_frontmatter(relative: str):
    body = (ROOT / relative).read_text(encoding="utf-8")
    if not body.startswith("---\n"):
        raise ValueError(f"Skill has no YAML frontmatter: {relative}")
    closing = body.find("\n---\n", 4)
    if closing < 0:
        raise ValueError(f"Skill frontmatter is not closed: {relative}")
    return yaml.safe_load(body[4:closing])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    sources = [
        "01_semantic_knowledge/02_dictionary/02_aliases.yaml",
        "01_semantic_knowledge/02_dictionary/04_ambiguity_rules.yaml",
        "01_semantic_knowledge/02_dictionary/05_deprecated_terms.yaml",
        "01_semantic_knowledge/03_knowledge_graph/contracts/trace_policy.yaml",
        "01_semantic_knowledge/01_ontology/research_requirement_profiles.yaml",
        "01_semantic_knowledge/01_ontology/contracts/company_fundamental_semantics.yaml",
        "02_scenario_task/01_intents/types.yaml",
        "02_scenario_task/02_scenarios/types.yaml",
        "02_scenario_task/03_tasks/registry.yaml",
        "02_scenario_task/04_roles/roles.yaml",
        "02_scenario_task/05_workflow_patterns/registry.yaml",
        "02_scenario_task/contracts/research_planning_contract.yaml",
        "02_scenario_task/contracts/report_generation_contract.yaml",
        "03_agent_capability/01_agents/registry.yaml",
        "03_agent_capability/02_skills/registry.yaml",
        "03_agent_capability/03_tools/registry.yaml",
        "03_agent_capability/releases/current.json",
        "04_context_state/01_context/contract.yaml",
        "04_context_state/02_state/contract.yaml",
        "04_context_state/02_state/lifecycle_contract.yaml",
        "04_context_state/02_state/event_catalog.yaml",
        "04_context_state/03_memory/contract.yaml",
        "04_context_state/04_workspace/contract.yaml",
        "05_control_evaluation/01_rules/policies/judgment_threshold_policy.yaml",
        "05_control_evaluation/01_rules/policies/judgment_method_routes.yaml",
        "05_control_evaluation/01_rules/policies/asset_authority_matrix.yaml",
        "05_control_evaluation/01_rules/policies/evidence_sufficiency_policy.yaml",
        "05_control_evaluation/01_rules/policies/artifact_editing_policy.yaml",
        "05_control_evaluation/01_rules/knowledge_promotion/knowledge_learning_contract.yaml",
        "05_control_evaluation/01_rules/policies/capability_activation_policy.yaml",
        "05_control_evaluation/03_permissions/permission_matrix.yaml",
        "05_control_evaluation/05_evals/registry.yaml",
        "05_control_evaluation/05_evals/cases/a-share-fundamental-v1/catalog.yaml",
        "05_control_evaluation/05_evals/fixtures/gold-tasks.json",
        "05_control_evaluation/05_evals/fixtures/live-canary-cases.json",
        "05_control_evaluation/05_evals/fixtures/research-value-fixtures.json",
        "05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json",
    ]

    task_registry = load_yaml("02_scenario_task/03_tasks/registry.yaml")
    task_paths = [f"02_scenario_task/03_tasks/{entry['path']}" for entry in task_registry["task_definitions"]]
    workflow_registry = load_yaml("02_scenario_task/05_workflow_patterns/registry.yaml")
    workflow_paths = [f"02_scenario_task/05_workflow_patterns/{entry['path']}" for entry in workflow_registry["patterns"]]
    skill_registry = load_yaml("03_agent_capability/02_skills/registry.yaml")
    skill_paths = [entry["skill_md"] for entry in skill_registry["skills"]]
    sources.extend(task_paths)
    sources.extend(workflow_paths)
    sources.extend(skill_paths)

    release_path = ROOT / "03_agent_capability/releases/current.json"
    catalog = {
        "schemaName": "runtime_domain_catalog_projection",
        "schemaVersion": "2.0.0",
        "generatorVersion": GENERATOR_VERSION,
        "sourceFingerprints": {path: fingerprint(path) for path in sorted(set(sources))},
        "dictionary": {
            "aliases": load_yaml(sources[0])["entries"],
            "ambiguityRules": load_yaml(sources[1])["rules"],
            "deprecatedTerms": load_yaml(sources[2])["entries"],
        },
        "tracePolicy": load_yaml(sources[3]),
        "semanticProfiles": load_yaml("01_semantic_knowledge/01_ontology/research_requirement_profiles.yaml"),
        "companyFundamentalSemantics": load_yaml("01_semantic_knowledge/01_ontology/contracts/company_fundamental_semantics.yaml"),
        "intentTypes": load_yaml("02_scenario_task/01_intents/types.yaml")["intent_types"],
        "scenarioTypes": load_yaml("02_scenario_task/02_scenarios/types.yaml")["scenario_types"],
        "tasks": {item["task_id"]: item for item in (load_yaml(path) for path in task_paths)},
        "roles": load_yaml("02_scenario_task/04_roles/roles.yaml")["roles"],
        "workflowPatterns": {item["workflow_id"]: item for item in (load_yaml(path) for path in workflow_paths)},
        "planningContract": load_yaml("02_scenario_task/contracts/research_planning_contract.yaml"),
        "reportGeneration": load_yaml("02_scenario_task/contracts/report_generation_contract.yaml"),
        "capabilities": {
            "agents": load_yaml("03_agent_capability/01_agents/registry.yaml"),
            "skills": load_yaml("03_agent_capability/02_skills/registry.yaml"),
            "skillContracts": {item["skill_id"]: item for item in (load_skill_frontmatter(path) for path in skill_paths)},
            "tools": load_yaml("03_agent_capability/03_tools/registry.yaml"),
            "release": json.loads(release_path.read_text(encoding="utf-8")),
        },
        "contextState": {
            "context": load_yaml("04_context_state/01_context/contract.yaml"),
            "state": load_yaml("04_context_state/02_state/contract.yaml"),
            "lifecycle": load_yaml("04_context_state/02_state/lifecycle_contract.yaml"),
            "events": load_yaml("04_context_state/02_state/event_catalog.yaml"),
            "memory": load_yaml("04_context_state/03_memory/contract.yaml"),
            "workspace": load_yaml("04_context_state/04_workspace/contract.yaml"),
        },
        "governance": {
            "judgmentThreshold": load_yaml("05_control_evaluation/01_rules/policies/judgment_threshold_policy.yaml"),
            "judgmentMethodRoutes": load_yaml("05_control_evaluation/01_rules/policies/judgment_method_routes.yaml"),
            "assetAuthority": load_yaml("05_control_evaluation/01_rules/policies/asset_authority_matrix.yaml"),
            "evidenceSufficiency": load_yaml("05_control_evaluation/01_rules/policies/evidence_sufficiency_policy.yaml"),
            "artifactEditing": load_yaml("05_control_evaluation/01_rules/policies/artifact_editing_policy.yaml"),
            "knowledgePromotion": load_yaml("05_control_evaluation/01_rules/knowledge_promotion/knowledge_learning_contract.yaml"),
            "capabilityActivation": load_yaml("05_control_evaluation/01_rules/policies/capability_activation_policy.yaml"),
            "permissions": load_yaml("05_control_evaluation/03_permissions/permission_matrix.yaml"),
        },
        "evaluation": {
            "registry": load_yaml("05_control_evaluation/05_evals/registry.yaml"),
            "companyFundamentalCases": load_yaml("05_control_evaluation/05_evals/cases/a-share-fundamental-v1/catalog.yaml"),
            "fixtures": {
                "engineeringGold": json.loads((ROOT / "05_control_evaluation/05_evals/fixtures/gold-tasks.json").read_text(encoding="utf-8")),
                "liveCanary": json.loads((ROOT / "05_control_evaluation/05_evals/fixtures/live-canary-cases.json").read_text(encoding="utf-8")),
                "researchValue": json.loads((ROOT / "05_control_evaluation/05_evals/fixtures/research-value-fixtures.json").read_text(encoding="utf-8")),
                "publicEarningsReplay": json.loads((ROOT / "05_control_evaluation/05_evals/fixtures/earnings-update-replay-dongwei.json").read_text(encoding="utf-8")),
            },
        },
    }
    payload = json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=True, default=str)
    rendered = (
        "// Generated from 01-05 definition authorities by scripts/generate-domain-catalog.py.\n"
        "// Do not edit: update the owning 01-05 file and run npm run domain:sync.\n"
        f"export const DOMAIN_CATALOG = {payload} as const;\n"
        "export const TASK_CATALOG = DOMAIN_CATALOG.tasks;\n"
        "export const CAPABILITY_CATALOG = DOMAIN_CATALOG.capabilities;\n"
        "export const STATE_MACHINE_CATALOG = DOMAIN_CATALOG.contextState.lifecycle;\n"
        "export const GOVERNANCE_POLICY_CATALOG = DOMAIN_CATALOG.governance;\n"
        "export const EVAL_CATALOG = DOMAIN_CATALOG.evaluation;\n"
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
