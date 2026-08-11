#!/usr/bin/env python3
"""Validate the 02_scenario_task Research Problem Graph catalogs and motifs."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
DOMAIN = ROOT / "02_scenario_task"


def load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path.relative_to(ROOT)} must contain a YAML object")
    return data


def nonempty_strings(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(isinstance(item, str) and item.strip() for item in value)


def has_cycle(nodes: set[str], edges: list[tuple[str, str]]) -> bool:
    outgoing: dict[str, list[str]] = {node: [] for node in nodes}
    for source, target in edges:
        outgoing[source].append(target)
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> bool:
        if node in visiting:
            return True
        if node in visited:
            return False
        visiting.add(node)
        if any(visit(target) for target in outgoing[node]):
            return True
        visiting.remove(node)
        visited.add(node)
        return False

    return any(visit(node) for node in nodes)


def validate_task_motifs(contract: dict[str, Any]) -> tuple[list[str], set[str]]:
    errors: list[str] = []
    registry = load_yaml(DOMAIN / "03_tasks" / "registry.yaml")
    motif_contract = contract.get("motif_contract") or {}
    required_task_fields = set((registry.get("contract_fields") or {}).get("required") or [])
    required_motif_fields = set(motif_contract.get("required_fields") or [])
    relation_values = set(motif_contract.get("relation_values") or [])
    task_ids: set[str] = set()

    for item in registry.get("task_definitions") or []:
        relative = item.get("path") if isinstance(item, dict) else None
        if not isinstance(relative, str) or not relative:
            errors.append("03_tasks/registry.yaml contains invalid task path")
            continue
        path = DOMAIN / "03_tasks" / relative
        task = load_yaml(path)
        label = str(path.relative_to(ROOT))
        missing = sorted(required_task_fields - set(task))
        if missing:
            errors.append(f"{label} missing required fields {missing}")
        task_id = task.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            errors.append(f"{label} task_id must be a non-empty string")
            continue
        if task_id in task_ids:
            errors.append(f"duplicate task_id {task_id}")
        task_ids.add(task_id)

        motif = task.get("graph_motif")
        if not isinstance(motif, dict):
            errors.append(f"{label} graph_motif must be an object")
            continue
        missing_motif = sorted(required_motif_fields - set(motif))
        if missing_motif:
            errors.append(f"{label} graph_motif missing {missing_motif}")
        root = motif.get("root_question")
        if not isinstance(root, str) or not root:
            errors.append(f"{label} graph_motif.root_question must be a non-empty string")
            continue
        roles = motif.get("judgment_unit_roles") or []
        if not isinstance(roles, list) or not roles:
            errors.append(f"{label} judgment_unit_roles must be non-empty")
            continue
        role_ids: list[str] = []
        for role in roles:
            if not isinstance(role, dict):
                errors.append(f"{label} judgment_unit_roles entries must be objects")
                continue
            role_id = role.get("id")
            if not isinstance(role_id, str) or not role_id:
                errors.append(f"{label} judgment unit role id must be non-empty")
                continue
            role_ids.append(role_id)
            if not isinstance(role.get("purpose"), str) or not role.get("purpose"):
                errors.append(f"{label} role {role_id} purpose must be non-empty")
            if not isinstance(role.get("required"), bool):
                errors.append(f"{label} role {role_id} required must be boolean")
        if len(role_ids) != len(set(role_ids)):
            errors.append(f"{label} judgment unit role ids must be unique")
        if root in role_ids:
            errors.append(f"{label} root_question must not duplicate a judgment unit role")

        endpoints = set(role_ids) | {root}
        dependency_edges: list[tuple[str, str]] = []
        edges = motif.get("edges") or []
        if not isinstance(edges, list) or not edges:
            errors.append(f"{label} graph_motif.edges must be non-empty")
        for edge in edges:
            if not isinstance(edge, dict):
                errors.append(f"{label} graph edges must be objects")
                continue
            source, target, relation = edge.get("from"), edge.get("to"), edge.get("relation")
            if source not in endpoints or target not in endpoints:
                errors.append(f"{label} edge {source}->{target} has unknown endpoint")
            if relation not in relation_values:
                errors.append(f"{label} edge {source}->{target} has unknown relation {relation}")
            if source == target:
                errors.append(f"{label} edge {source}->{target} must not self-reference")
            if relation in {"requires", "aggregates"} and source in endpoints and target in endpoints:
                dependency_edges.append((source, target))
        if has_cycle(endpoints, dependency_edges):
            errors.append(f"{label} requires/aggregates projection must be acyclic")

        policy = motif.get("competing_explanation_policy") or {}
        required_for = policy.get("required_for") or []
        if not isinstance(required_for, list) or any(item not in role_ids for item in required_for):
            errors.append(f"{label} competing_explanation_policy.required_for must reference role ids")
        if not isinstance(policy.get("minimum"), int) or policy.get("minimum", -1) < 0:
            errors.append(f"{label} competing_explanation_policy.minimum must be a non-negative integer")

        aggregation = motif.get("aggregation") or {}
        required_units = aggregation.get("required_units") or []
        expected_required = {role["id"] for role in roles if isinstance(role, dict) and role.get("required") is True and isinstance(role.get("id"), str)}
        if set(required_units) != expected_required:
            errors.append(f"{label} aggregation.required_units must equal required role ids")

    return errors, task_ids


def validate_scenarios(task_ids: set[str]) -> list[str]:
    errors: list[str] = []
    path = DOMAIN / "02_scenarios" / "types.yaml"
    catalog = load_yaml(path)
    for scenario_id, scenario in (catalog.get("scenario_types") or {}).items():
        label = f"02_scenarios/types.yaml:{scenario_id}"
        if not isinstance(scenario, dict):
            errors.append(f"{label} must be an object")
            continue
        if "candidate_tasks" in scenario:
            errors.append(f"{label} must use task_affordances instead of candidate_tasks")
        affordances = scenario.get("task_affordances")
        if not isinstance(affordances, list) or not affordances:
            errors.append(f"{label} task_affordances must be non-empty")
            continue
        primary_count = 0
        for item in affordances:
            if not isinstance(item, dict):
                errors.append(f"{label} affordances must be objects")
                continue
            task_ref = item.get("task_ref")
            mode = item.get("mode")
            if task_ref not in task_ids:
                errors.append(f"{label} unresolved task_ref {task_ref}")
            if mode not in {"primary", "supporting", "conditional"}:
                errors.append(f"{label} invalid affordance mode {mode}")
            if mode == "primary":
                primary_count += 1
            if not nonempty_strings(item.get("activate_when")):
                errors.append(f"{label}:{task_ref} activate_when must be non-empty string list")
            if not isinstance(item.get("contributes"), str) or not item.get("contributes"):
                errors.append(f"{label}:{task_ref} contributes must be non-empty")
        if primary_count != 1:
            errors.append(f"{label} must define exactly one primary affordance")
    return errors


def validate_graph_policies() -> list[str]:
    errors: list[str] = []
    intents = load_yaml(DOMAIN / "01_intents" / "types.yaml")
    for intent_id, intent in (intents.get("intent_types") or {}).items():
        policy = intent.get("graph_policy") if isinstance(intent, dict) else None
        if not isinstance(policy, dict):
            errors.append(f"01_intents/types.yaml:{intent_id} missing graph_policy")
            continue
        for key in ("activation", "allow_multiple_tasks", "initial_frontier", "stop_basis"):
            if key not in policy:
                errors.append(f"01_intents/types.yaml:{intent_id}.graph_policy missing {key}")

    workflow_registry = load_yaml(DOMAIN / "05_workflow_patterns" / "registry.yaml")
    for item in workflow_registry.get("patterns") or []:
        relative = item.get("path") if isinstance(item, dict) else None
        if not isinstance(relative, str):
            errors.append("05_workflow_patterns/registry.yaml contains invalid path")
            continue
        pattern = load_yaml(DOMAIN / "05_workflow_patterns" / relative)
        prior = pattern.get("graph_prior")
        if not isinstance(prior, dict):
            errors.append(f"05_workflow_patterns/{relative} missing graph_prior")
            continue
        for key in ("motif_activation", "frontier_strategy", "reuse_resolved_subgraphs", "replan_on", "convergence"):
            if key not in prior:
                errors.append(f"05_workflow_patterns/{relative}.graph_prior missing {key}")
    return errors


def main() -> int:
    contract = load_yaml(DOMAIN / "00_problem_graph" / "contract.yaml")
    errors, task_ids = validate_task_motifs(contract)
    errors.extend(validate_scenarios(task_ids))
    errors.extend(validate_graph_policies())
    if errors:
        print("SCENARIO_TASK_GRAPH_RETURN_REQUIRED")
        for error in errors:
            print(f"- {error}")
        return 1
    print(
        "SCENARIO_TASK_GRAPH_PASS: problem-graph contract、Task motifs、Scenario affordances、"
        "Intent policies 与 Workflow frontier priors 一致。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
