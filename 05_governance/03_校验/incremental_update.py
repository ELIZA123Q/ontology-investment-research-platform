#!/usr/bin/env python3
"""Build and validate object-level incremental invalidation closures."""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any, Iterable


Edge = tuple[str, str, str]


def build_dependency_graph(run: dict[str, dict[str, Any]]) -> tuple[dict[str, set[str]], set[Edge], dict[str, str]]:
    evidence = run["evidence"]
    judgment = run["judgment"]
    expression = run["expression"]
    graph: dict[str, set[str]] = defaultdict(set)
    edges: set[Edge] = set()
    stages: dict[str, str] = {}

    def node(ref: Any, stage: str) -> str:
        value = str(ref)
        if value:
            stages[value] = stage
        return value

    def edge(source: Any, target: Any, dependency_type: str) -> None:
        source_ref, target_ref = str(source), str(target)
        if not source_ref or not target_ref:
            return
        graph[source_ref].add(target_ref)
        edges.add((source_ref, target_ref, dependency_type))

    for item in evidence.get("facts") or []:
        node(item.get("evidence_id"), "03")
    for item in evidence.get("assessments") or []:
        assessment_id = node(item.get("assessment_id"), "03")
        edge(item.get("evidence_ref"), assessment_id, "rule_input")
    for item in evidence.get("baskets") or []:
        basket_id = node(item.get("basket_id"), "03")
        for ref in item.get("evidence_refs") or []:
            edge(ref, basket_id, "basket_membership")

    for item in judgment.get("method_applications") or []:
        stage = "03" if item.get("capability_type") == "evidence" else "04"
        application_id = node(item.get("application_id"), stage)
        for ref in item.get("input_evidence_refs") or []:
            edge(ref, application_id, "method_input")
    for item in judgment.get("signals") or []:
        signal_id = node(item.get("signal_id"), "04")
        for ref in item.get("evidence_refs") or []:
            edge(ref, signal_id, "signal_input")
    for item in judgment.get("hypotheses") or []:
        hypothesis_id = node(item.get("hypothesis_id"), "04")
        for ref in item.get("signal_refs") or []:
            edge(ref, hypothesis_id, "hypothesis_input")
    for item in judgment.get("rule_evaluations") or []:
        evaluation_id = node(item.get("rule_evaluation_id"), "04")
        for ref in item.get("input_refs") or []:
            if str(ref) in stages:
                edge(ref, evaluation_id, "rule_input")
    for item in judgment.get("judgments") or []:
        judgment_id = node(item.get("judgment_id"), "04")
        for field in ("evidence_refs", "signal_refs", "hypothesis_refs", "rule_evaluation_refs"):
            for ref in item.get(field) or []:
                edge(ref, judgment_id, "judgment_dependency")
        for ref in item.get("method_application_refs") or []:
            edge(ref, judgment_id, "method_support")
    for item in judgment.get("reasoning_traces") or []:
        trace_id = node(item.get("trace_id"), "04")
        edge(item.get("judgment_ref"), trace_id, "trace_projection")
    for item in expression.get("expressions") or []:
        expression_id = node(item.get("expression_id"), "05")
        edge(item.get("source_claim_id"), expression_id, "expression_projection")
        for ref in item.get("source_evidence_refs") or []:
            edge(ref, expression_id, "expression_projection")
        for ref in item.get("source_method_application_refs") or []:
            edge(ref, expression_id, "expression_projection")
    return graph, edges, stages


def reachable_closure(graph: dict[str, set[str]], roots: Iterable[str]) -> set[str]:
    output = {str(ref) for ref in roots}
    queue = deque(output)
    while queue:
        current = queue.popleft()
        for target in graph.get(current, set()):
            if target not in output:
                output.add(target)
                queue.append(target)
    return output


def validate_incremental_update(run: dict[str, dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    update = run["update"]
    required_fields = {
        "update_id", "new_evidence", "changed_roots", "direct_impacts",
        "propagation_edges", "affected_graph", "recompute_stages",
        "structural_checkpoint_required", "full_rerun_required", "expected_judgment_change",
    }
    if str(update.get("schema_version")) != "1.1.0":
        errors.append("incremental update instance version must be 1.1.0")
    missing_fields = sorted(required_fields - set(update))
    if missing_fields:
        errors.append(f"incremental update missing required fields: {missing_fields}")
    changed_roots = {str(ref) for ref in update.get("changed_roots") or []}
    new_evidence_id = str((update.get("new_evidence") or {}).get("evidence_id", ""))
    if not new_evidence_id or new_evidence_id not in changed_roots:
        errors.append("new evidence must be declared as a changed root")
    graph, known_edges, stages = build_dependency_graph(run)
    direct = {str(ref) for ref in update.get("direct_impacts") or []}
    stale = {str(ref) for ref in (update.get("affected_graph") or {}).get("stale", [])}
    current = {str(ref) for ref in (update.get("affected_graph") or {}).get("remains_current", [])}
    if not direct:
        errors.append("incremental update must declare direct_impacts")
    unknown_direct = direct - set(stages)
    if unknown_direct:
        errors.append(f"direct_impacts contain unknown objects: {sorted(unknown_direct)}")
    expected_stale = reachable_closure(graph, direct)
    missing = expected_stale - stale
    extra = stale - expected_stale
    if missing:
        errors.append(f"stale closure misses reachable objects: {sorted(missing)}")
    if extra:
        errors.append(f"stale closure contains unreachable objects: {sorted(extra)}")
    if stale & current:
        errors.append("stale and remains_current overlap")
    if new_evidence_id in stale:
        errors.append("new EvidenceFact is current and must not be marked stale")
    wrongly_current = current & expected_stale
    if wrongly_current:
        errors.append(f"reachable stale objects incorrectly remain current: {sorted(wrongly_current)}")

    declared_edges: set[Edge] = set()
    for item in update.get("propagation_edges") or []:
        if not isinstance(item, dict):
            errors.append("propagation_edges entries must be mappings")
            continue
        if not {"source_ref", "target_ref", "dependency_type"} <= set(item):
            errors.append("propagation edge missing required fields")
            continue
        candidate = (
            str(item.get("source_ref", "")),
            str(item.get("target_ref", "")),
            str(item.get("dependency_type", "")),
        )
        declared_edges.add(candidate)
        if candidate not in known_edges:
            errors.append(f"propagation edge is not in actual dependency graph: {candidate}")
    declared_graph: dict[str, set[str]] = defaultdict(set)
    for source, target, _ in declared_edges:
        declared_graph[source].add(target)
    explained = reachable_closure(declared_graph, direct)
    if explained != stale:
        errors.append("propagation_edges do not explain the complete stale closure")

    expected_stages = sorted({stages[ref] for ref in stale if ref in stages})
    actual_stages = [str(stage) for stage in update.get("recompute_stages") or []]
    if actual_stages != expected_stages:
        errors.append(f"recompute_stages must be derived from stale objects: expected {expected_stages}")
    structural = update.get("structural_checkpoint_required") is True
    full = update.get("full_rerun_required") is True
    if full and not structural:
        errors.append("full rerun requires a structural checkpoint")
    if not structural and "02" in actual_stages:
        errors.append("local evidence update must not recompute stage 02")
    return errors
