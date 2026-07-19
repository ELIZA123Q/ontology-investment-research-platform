#!/usr/bin/env python3
"""Validate Ontology 3.0 / Public Contract 1.3 example runs."""

from __future__ import annotations

import importlib.util
import re
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_method_application_contract import validate_stage_applications


ROOT = Path(__file__).resolve().parents[2]
SAMPLE_ROOT = ROOT / "instances/02_V3样例"
DEFAULT_RUNS = (SAMPLE_ROOT / "01_memory-cycle-run-002", SAMPLE_ROOT / "02_us-controls-localization-run-002")

_incremental_spec = importlib.util.spec_from_file_location(
    "incremental_update_contract_runtime",
    ROOT / "governance/03_校验/incremental_update.py",
)
assert _incremental_spec and _incremental_spec.loader
_incremental_validator = importlib.util.module_from_spec(_incremental_spec)
_incremental_spec.loader.exec_module(_incremental_validator)


def load(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return value


def _ids(items: list[dict[str, Any]], field: str) -> set[str]:
    return {str(item.get(field, "")) for item in items if isinstance(item, dict) and item.get(field)}


@lru_cache(maxsize=1)
def method_catalog_and_routes() -> tuple[dict[str, dict[str, str]], dict[str, Any]]:
    assets = load(ROOT / "methods/00_登记/method_assets.yaml")
    structure_registry = load(ROOT / "methods/02_判断结构/00_framework_dependency_registry.yaml")
    evidence_registry = load(ROOT / "methods/03_取证/03_registry.yaml")
    routes = load(ROOT / "governance/02_合同/judgment_method_routes.yaml")
    groups = assets.get("groups") or {}
    catalog: dict[str, dict[str, str]] = {}
    structure_group = groups.get("judgment_structure") or {}
    for method_id in list((structure_registry.get("frameworks") or {})) + list((structure_registry.get("industry_overlays") or {})):
        catalog[method_id] = {
            "version": str(structure_group.get("version")),
            "capability": "judgment_structure",
        }
    evidence_group = groups.get("evidence") or {}
    for local_id in evidence_registry.get("methods") or {}:
        catalog[f"kb03:{local_id}"] = {
            "version": str(evidence_group.get("version")),
            "capability": "evidence",
        }
    adjudication_group = groups.get("adjudication") or {}
    for item in adjudication_group.get("methods") or []:
        catalog[str(item.get("id"))] = {
            "version": str(adjudication_group.get("version")),
            "capability": "adjudication",
        }
    return catalog, routes


@lru_cache(maxsize=1)
def ontology_catalog() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], set[str], set[str]]:
    objects: dict[str, dict[str, Any]] = {}
    relations: dict[str, dict[str, Any]] = {}
    domain_objects: set[str] = set()
    event_extensions: set[str] = set()
    for name in ("semantic", "state_event", "evidence", "judgment", "scenario", "semiconductor_extension"):
        document = load(ROOT / f"ontology/01_通用/models/{name}.yaml")
        objects.update(document.get("object_types") or {})
        relations.update(document.get("relation_types") or {})
        if name == "semiconductor_extension":
            domain_objects.update((document.get("object_types") or {}).keys())
            event_extensions.update((document.get("event_taxonomy") or {}).get("allowed_extensions") or [])
    return objects, relations, domain_objects, event_extensions


def validate_ontology_instances(structure: dict[str, Any], label: str) -> list[str]:
    errors: list[str] = []
    objects, relations, domain_objects, event_extensions = ontology_catalog()
    expected_refs = {
        f"ontology/01_通用/models/{name}.yaml"
        for name in ("semantic", "state_event", "evidence", "judgment", "scenario", "semiconductor_extension")
    }
    declared_refs = set(structure.get("ontology_refs") or [])
    if declared_refs != expected_refs:
        errors.append(f"{label}: ontology_refs must declare the complete frozen six-model bundle")
    for ref in declared_refs:
        if not (ROOT / ref).is_file():
            errors.append(f"{label}: unresolved ontology_ref {ref}")

    instances = structure.get("ontology_instances") or []
    instance_by_id: dict[str, dict[str, Any]] = {}
    for item in instances:
        instance_id = str(item.get("id", "")) if isinstance(item, dict) else ""
        if not instance_id:
            errors.append(f"{label}: ontology instance missing id")
        elif instance_id in instance_by_id:
            errors.append(f"{label}: duplicate ontology instance id {instance_id}")
        else:
            instance_by_id[instance_id] = item

    def ancestors(type_id: str) -> set[str]:
        found: set[str] = set()
        pending = [type_id]
        while pending:
            current = pending.pop()
            if current in found:
                continue
            found.add(current)
            contract = objects.get(current) or {}
            for field in ("extends", "projects_to"):
                parent = contract.get(field)
                if isinstance(parent, str):
                    pending.append(parent)
        return found

    def effective_attributes(type_id: str) -> dict[str, dict[str, Any]]:
        output: dict[str, dict[str, Any]] = {}
        lineage: list[str] = []
        current: str | None = type_id
        seen: set[str] = set()
        while current and current not in seen:
            seen.add(current)
            lineage.append(current)
            parent = (objects.get(current) or {}).get("extends")
            current = parent if isinstance(parent, str) else None
        for ancestor in reversed(lineage):
            output.update((objects.get(ancestor) or {}).get("attributes") or {})
        return output

    core_seen = False
    domain_seen = False
    proxy_required = {
        "name", "target_ref", "proxyLogic", "expectedTimeLag", "validConditions",
        "invalidConditions", "confidenceDiscount", "cannotReplace", "requiredDisclosure",
    }
    for instance_id, item in instance_by_id.items():
        type_id = str(item.get("type", ""))
        if type_id == "ProxyIndicator":
            missing = sorted(proxy_required - set(item))
            if missing:
                errors.append(f"{label}: ProxyIndicator {instance_id} missing {missing}")
            if item.get("target_ref") not in instance_by_id:
                errors.append(f"{label}: ProxyIndicator {instance_id} unresolved target_ref")
            continue
        contract = objects.get(type_id)
        if not contract:
            errors.append(f"{label}: ontology instance {instance_id} uses unknown formal type {type_id}")
            continue
        domain_seen = domain_seen or type_id in domain_objects
        core_seen = core_seen or type_id not in domain_objects
        attributes = effective_attributes(type_id)
        for attribute_id, attribute in attributes.items():
            if attribute.get("required") is True and attribute_id not in item:
                errors.append(f"{label}: ontology instance {instance_id} missing required attribute {attribute_id}")
            if attribute_id not in item:
                continue
            value = item.get(attribute_id)
            if attribute.get("type") == "enum":
                allowed = set(attribute.get("allowed_values") or [])
                if type_id == "Event" and attribute_id == "event_type":
                    allowed |= event_extensions
                if value not in allowed:
                    errors.append(f"{label}: ontology instance {instance_id}.{attribute_id} invalid enum {value}")
            if attribute.get("type") == "object_ref":
                target = instance_by_id.get(str(value))
                target_type = str((target or {}).get("type", ""))
                expected_type = str(attribute.get("reference_target", ""))
                if not target or expected_type not in ancestors(target_type):
                    errors.append(f"{label}: ontology instance {instance_id}.{attribute_id} unresolved/incompatible ref {value}")
        unknown = sorted(set(item) - {"id", "type"} - set(attributes))
        if unknown:
            errors.append(f"{label}: ontology instance {instance_id} has undeclared attributes {unknown}")
    if not core_seen or not domain_seen:
        errors.append(f"{label}: sample must instantiate both core and semiconductor formal object types")

    relation_ids: set[str] = set()
    for relation in structure.get("ontology_relations") or []:
        relation_id = str(relation.get("id", ""))
        relation_type = str(relation.get("type", ""))
        if not relation_id or relation_id in relation_ids:
            errors.append(f"{label}: ontology relation id missing or duplicate: {relation_id}")
        relation_ids.add(relation_id)
        contract = relations.get(relation_type)
        if not contract:
            errors.append(f"{label}: ontology relation {relation_id} uses unknown formal type {relation_type}")
            continue
        source = instance_by_id.get(str(relation.get("source_ref", "")))
        target = instance_by_id.get(str(relation.get("target_ref", "")))
        if not source or not target:
            errors.append(f"{label}: ontology relation {relation_id} has dangling endpoint")
            continue
        source_type = str(source.get("type"))
        target_type = str(target.get("type"))
        if not set(contract.get("source_types") or []) & ancestors(source_type):
            errors.append(f"{label}: ontology relation {relation_id} source endpoint incompatible")
        if not set(contract.get("target_types") or []) & ancestors(target_type):
            errors.append(f"{label}: ontology relation {relation_id} target endpoint incompatible")
        attributes = contract.get("attributes") or {}
        for attribute_id, attribute in attributes.items():
            if attribute.get("required") is True and attribute_id not in relation:
                errors.append(f"{label}: ontology relation {relation_id} missing required attribute {attribute_id}")
            if attribute_id in relation and attribute.get("type") == "enum" and relation[attribute_id] not in set(attribute.get("allowed_values") or []):
                errors.append(f"{label}: ontology relation {relation_id}.{attribute_id} invalid enum")
        unknown = sorted(set(relation) - {"id", "type", "source_ref", "target_ref"} - set(attributes))
        if unknown:
            errors.append(f"{label}: ontology relation {relation_id} has undeclared attributes {unknown}")
    return errors


def validate_run_data(run: dict[str, dict[str, Any]], contract: dict[str, Any], known_rules: set[str]) -> list[str]:
    errors: list[str] = []
    manifest = run["manifest"]
    structure = run["structure"]
    evidence = run["evidence"]
    judgment = run["judgment"]
    expression = run["expression"]
    update = run["update"]
    label = str(manifest.get("run_id", "<unknown-run>"))
    method_catalog, method_routes = method_catalog_and_routes()
    errors.extend(validate_ontology_instances(structure, label))

    questions = _ids(structure.get("questions") or [], "question_id")
    units = _ids(structure.get("judgment_units") or [], "judgment_unit_id")
    ontology_objects = _ids(structure.get("ontology_instances") or [], "id")
    facts = _ids(evidence.get("facts") or [], "evidence_id")
    requirement_ids = _ids(structure.get("evidence_requirements") or [], "evidence_requirement_id")
    gaps = evidence.get("evidence_gaps") or []
    if not gaps:
        errors.append(f"{label}: sample must demonstrate at least one explicit evidence gap")
    for gap in gaps:
        if gap.get("requirement_ref") not in requirement_ids or gap.get("target_judgment_unit_ref") not in units:
            errors.append(f"{label}: evidence gap {gap.get('gap_id')} has unresolved requirement/judgment unit")
        if gap.get("status") not in {"unmet", "partially_met"} or not str(gap.get("reason", "")).strip():
            errors.append(f"{label}: evidence gap {gap.get('gap_id')} lacks status/reason")
    signals_for_methods = _ids(judgment.get("signals") or [], "signal_id")
    judgments_for_methods = _ids(judgment.get("judgments") or [], "judgment_id")
    for message in validate_stage_applications(
        structure,
        "stage_02",
        required=True,
        known_questions=questions,
        known_judgment_units=units,
        known_objects=ontology_objects,
        known_evidence=set(),
        known_signals=set(),
        known_judgments=set(),
    ):
        errors.append(f"{label}: {message}")
    for message in validate_stage_applications(
        evidence,
        "stage_03",
        required=True,
        prior_items=structure.get("method_applications"),
        known_questions=questions,
        known_judgment_units=units,
        known_objects=ontology_objects,
        known_evidence=facts,
        known_signals=set(),
        known_judgments=set(),
    ):
        errors.append(f"{label}: {message}")
    for message in validate_stage_applications(
        judgment,
        "stage_04",
        required=True,
        prior_items=evidence.get("method_applications"),
        known_questions=questions,
        known_judgment_units=units,
        known_objects=ontology_objects,
        known_evidence=facts,
        known_signals=signals_for_methods,
        known_judgments=judgments_for_methods,
    ):
        errors.append(f"{label}: {message}")

    versions = manifest.get("versions") or {}
    expected_versions = {"contract": "1.3.0", "ontology_meta_schema": "1.0.0", "ontology": "3.0.0", "domain_ontology": "3.0.0", "kb03": "3.2.0", "kb04": "1.0.0"}
    for key, expected in expected_versions.items():
        if str(versions.get(key)) != expected:
            errors.append(f"{label}: version {key} must be {expected}")
    if manifest.get("legacy_compatibility", {}).get("legacy_run") is not False:
        errors.append(f"{label}: V3 sample must not be marked legacy")
    if str(manifest.get("schema_name")) != "controlled_research_run_manifest_v3":
        errors.append(f"{label}: schema_name must be controlled_research_run_manifest_v3")
    if str(manifest.get("schema_version")) != "1.0.0":
        errors.append(f"{label}: fixture schema_version must be 1.0.0")
    if str(manifest.get("package_kind", "semantic_fixture")) != "semantic_fixture":
        errors.append(f"{label}: package_kind must be semantic_fixture")
    contract_ref = manifest.get("contract_ref") or {}
    if contract_ref:
        if str(contract_ref.get("schema_name")) != "controlled_research_run_manifest":
            errors.append(f"{label}: contract_ref.schema_name must point to formal manifest")
        if str(contract_ref.get("schema_version")) != "1.3.0":
            errors.append(f"{label}: contract_ref.schema_version must be 1.3.0")

    required_fields = set(contract["method_application_contract"]["required_fields"])
    status_values = set(contract["method_application_contract"]["statuses"])
    deprecated_fields = {"method_application_candidates", "method_input_bindings", "method_application_register"}
    for stage_name, stage_data in (("02", structure), ("03", evidence), ("04", judgment)):
        found = sorted(deprecated_fields & set(stage_data))
        if found:
            errors.append(f"{label}: stage {stage_name} uses deprecated method fields {found}")
    candidates = structure.get("method_applications") or []
    candidate_by_id = {item.get("application_id"): item for item in candidates}
    for index, item in enumerate(candidates):
        missing = sorted(required_fields - set(item))
        if missing:
            errors.append(f"{label}: candidate[{index}] missing {missing}")
        if item.get("status") != "candidate":
            errors.append(f"{label}: candidate {item.get('application_id')} must start as candidate")
        registered = method_catalog.get(str(item.get("method_id")))
        if not registered:
            errors.append(f"{label}: candidate {item.get('application_id')} uses unregistered method {item.get('method_id')}")
        elif str(item.get("method_version")) != registered["version"]:
            errors.append(f"{label}: candidate {item.get('application_id')} method version drift")
        elif item.get("capability_type") != registered["capability"]:
            errors.append(f"{label}: candidate {item.get('application_id')} capability mismatch")

    assessments = _ids(evidence.get("assessments") or [], "assessment_id")
    evidence_refs = facts | assessments
    bindings = evidence.get("method_applications") or []
    if {item.get("application_id") for item in bindings} != set(candidate_by_id):
        errors.append(f"{label}: 03 must inherit every 02 MethodApplication without additions or drops")
    for binding in bindings:
        app_id = binding.get("application_id")
        missing = sorted(required_fields - set(binding))
        if missing:
            errors.append(f"{label}: 03 application {app_id} missing {missing}")
        if app_id not in candidate_by_id:
            errors.append(f"{label}: 03 binding {app_id} has no 02 candidate")
        elif (
            binding.get("method_id") != candidate_by_id[app_id].get("method_id")
            or str(binding.get("method_version")) != str(candidate_by_id[app_id].get("method_version"))
        ):
            errors.append(f"{label}: 03 binding {app_id} method identity drift")
        if binding.get("status") not in {"selected", "rejected", "blocked", "degraded"}:
            if binding.get("status") != "candidate":
                errors.append(f"{label}: 03 binding {app_id} has invalid status")
        if (binding.get("provenance") or {}).get("source_application_id") != app_id:
            errors.append(f"{label}: 03 application {app_id} has invalid provenance inheritance")
        for ref in binding.get("input_evidence_refs", []):
            if ref not in facts:
                errors.append(f"{label}: 03 binding {app_id} unresolved evidence {ref}")

    signal_items = judgment.get("signals") or []
    hypothesis_items = judgment.get("hypotheses") or []
    signals = _ids(signal_items, "signal_id")
    hypotheses = _ids(hypothesis_items, "hypothesis_id")
    signal_by_id = {item.get("signal_id"): item for item in signal_items}
    hypothesis_by_id = {item.get("hypothesis_id"): item for item in hypothesis_items}
    for item in signal_items:
        signal_id = item.get("signal_id")
        refs = set(item.get("evidence_refs") or [])
        if not refs or not refs <= facts:
            errors.append(f"{label}: signal {signal_id} must bind concrete EvidenceFact refs")
        target = item.get("target_hypothesis_ref")
        if target not in hypotheses:
            errors.append(f"{label}: signal {signal_id} has unresolved hypothesis {target}")
    for item in hypothesis_items:
        hypothesis_id = item.get("hypothesis_id")
        refs = set(item.get("signal_refs") or [])
        if not refs or not refs <= signals:
            errors.append(f"{label}: hypothesis {hypothesis_id} must bind existing signals")
        if not item.get("falsification_conditions"):
            errors.append(f"{label}: hypothesis {hypothesis_id} lacks falsification conditions")
        for signal_id in refs:
            if signal_by_id.get(signal_id, {}).get("target_hypothesis_ref") != hypothesis_id:
                errors.append(f"{label}: signal/hypothesis link is not reciprocal: {signal_id}/{hypothesis_id}")
    rule_evaluations = judgment.get("rule_evaluations") or []
    rule_eval_ids = _ids(rule_evaluations, "rule_evaluation_id")
    for evaluation in rule_evaluations:
        if evaluation.get("rule_ref") not in known_rules:
            errors.append(f"{label}: unknown or non-ontology rule {evaluation.get('rule_ref')}")
        conditions = evaluation.get("condition_results") or []
        if not conditions or conditions == ["matched"]:
            errors.append(f"{label}: {evaluation.get('rule_evaluation_id')} has aggregate matched-only result")
        evaluation_inputs = set(evaluation.get("input_refs") or [])
        condition_inputs: set[str] = set()
        for condition in conditions:
            if not isinstance(condition, dict) or not {"condition_id", "expression", "input_refs", "outcome", "rationale"} <= set(condition):
                errors.append(f"{label}: {evaluation.get('rule_evaluation_id')} has incomplete condition result")
                continue
            refs = set(condition.get("input_refs") or [])
            condition_inputs.update(refs)
            if not refs:
                errors.append(f"{label}: {evaluation.get('rule_evaluation_id')} condition has no concrete inputs")
            if not refs <= evaluation_inputs:
                errors.append(f"{label}: {evaluation.get('rule_evaluation_id')} condition input not declared by evaluation")
            if refs and all(ref.startswith("EB-") for ref in refs):
                errors.append(f"{label}: {evaluation.get('rule_evaluation_id')} condition uses basket-only inputs")
        if not condition_inputs & facts:
            errors.append(f"{label}: {evaluation.get('rule_evaluation_id')} has no fact-level condition input")

    applications = judgment.get("method_applications") or []
    app_by_id = {item.get("application_id"): item for item in applications}
    binding_by_id = {item.get("application_id"): item for item in bindings}
    if set(app_by_id) != set(binding_by_id):
        errors.append(f"{label}: 04 must inherit every 03 MethodApplication without additions or drops")
    for index, item in enumerate(applications):
        app_id = item.get("application_id")
        missing = sorted(required_fields - set(item))
        if missing:
            errors.append(f"{label}: application[{index}] missing {missing}")
        if item.get("status") not in status_values - {"candidate", "selected"}:
            errors.append(f"{label}: application {app_id} not finalized")
        candidate = candidate_by_id.get(app_id)
        if not candidate or candidate.get("method_id") != item.get("method_id"):
            errors.append(f"{label}: application {app_id} does not finalize matching 02 candidate")
        prior = binding_by_id.get(app_id) or {}
        for field in ("method_id", "method_version", "capability_type", "target_question_refs", "target_judgment_unit_refs"):
            if item.get(field) != prior.get(field):
                errors.append(f"{label}: application {app_id} immutable field drift: {field}")
        if not set(prior.get("target_ontology_object_refs") or []) <= set(item.get("target_ontology_object_refs") or []):
            errors.append(f"{label}: application {app_id} removed target ontology object")
        if (item.get("provenance") or {}).get("source_application_id") != app_id:
            errors.append(f"{label}: 04 application {app_id} has invalid provenance inheritance")
        method_id = str(item.get("method_id", ""))
        registered = method_catalog.get(method_id)
        if not registered:
            errors.append(f"{label}: application {app_id} uses unregistered method {method_id}")
        elif str(item.get("method_version")) != registered["version"]:
            errors.append(f"{label}: application {app_id} method version drift")
        elif item.get("capability_type") != registered["capability"]:
            errors.append(f"{label}: application {app_id} capability mismatch")
        if item.get("status") in {"executed", "degraded"}:
            units = {unit.get("judgment_unit_id"): unit for unit in structure.get("judgment_units") or []}
            for unit_ref in item.get("target_judgment_unit_refs") or []:
                unit = units.get(unit_ref)
                route = (method_routes.get("routes") or {}).get((unit or {}).get("judgment_type"))
                if not unit or not route:
                    errors.append(f"{label}: application {app_id} has unresolved method route for {unit_ref}")
                    continue
                allowed = (
                    route.get("allowed_kb03_methods") or []
                    if item.get("capability_type") == "evidence"
                    else (route.get("allowed_kb04_methods") or [])
                        + (route.get("optional_auxiliary_methods") or [])
                        + (method_routes.get("global_optional_reasoning_methods") or [])
                )
                if method_id not in allowed:
                    errors.append(f"{label}: application {app_id} method is not allowed for {unit_ref}")
        if item.get("status") == "executed":
            if not item.get("input_evidence_refs"):
                errors.append(f"{label}: executed application {app_id} missing evidence inputs")
            if not item.get("output_signal_refs") and not item.get("output_judgment_refs"):
                errors.append(f"{label}: executed application {app_id} missing outputs")
            for ref in item.get("input_evidence_refs", []):
                if ref not in facts:
                    errors.append(f"{label}: application {app_id} unresolved evidence {ref}")
            for ref in item.get("output_signal_refs", []):
                if ref not in signals:
                    errors.append(f"{label}: application {app_id} unresolved signal {ref}")
        if item.get("status") in {"rejected", "blocked", "degraded"}:
            failed = any(check.get("result") in {"fail", "partial"} for check in item.get("precondition_checks", []))
            if not failed or not item.get("alternatives"):
                errors.append(f"{label}: non-executed application {app_id} lacks failure reason/alternative")

    judgments = judgment.get("judgments") or []
    judgment_ids = _ids(judgments, "judgment_id")
    for item in judgments:
        judgment_id = item.get("judgment_id")
        executed_refs = [ref for ref in item.get("method_application_refs", []) if app_by_id.get(ref, {}).get("status") == "executed"]
        if not executed_refs:
            errors.append(f"{label}: judgment {judgment_id} lacks executed MethodApplication")
        if not item.get("signal_refs") or not item.get("hypothesis_refs"):
            errors.append(f"{label}: judgment {judgment_id} bypasses signal/hypothesis")
        judgment_evidence = set(item.get("evidence_refs") or [])
        if not judgment_evidence or not judgment_evidence <= facts:
            errors.append(f"{label}: judgment {judgment_id} lacks concrete EvidenceFact refs")
        signal_evidence = set()
        for signal_ref in item.get("signal_refs", []):
            signal_evidence.update(signal_by_id.get(signal_ref, {}).get("evidence_refs") or [])
        if not judgment_evidence <= signal_evidence:
            errors.append(f"{label}: judgment {judgment_id} has evidence bypassing signals")
        for ref in item.get("signal_refs", []):
            if ref not in signals:
                errors.append(f"{label}: judgment {judgment_id} unresolved signal {ref}")
        for ref in item.get("hypothesis_refs", []):
            if ref not in hypotheses:
                errors.append(f"{label}: judgment {judgment_id} unresolved hypothesis {ref}")
        for ref in item.get("rule_evaluation_refs", []):
            if ref not in rule_eval_ids:
                errors.append(f"{label}: judgment {judgment_id} unresolved RuleEvaluation {ref}")

    traces = judgment.get("reasoning_traces") or []
    traces_by_judgment: dict[str, list[dict[str, Any]]] = {}
    for trace in traces:
        traces_by_judgment.setdefault(str(trace.get("judgment_ref")), []).append(trace)
    for item in judgments:
        judgment_id = str(item.get("judgment_id"))
        required_nodes = {
            judgment_id,
            *(item.get("evidence_refs") or []),
            *(item.get("signal_refs") or []),
            *(item.get("hypothesis_refs") or []),
            *(item.get("rule_evaluation_refs") or []),
            *(item.get("method_application_refs") or []),
        }
        linked = traces_by_judgment.get(judgment_id) or []
        if not linked:
            errors.append(f"{label}: judgment {judgment_id} lacks ReasoningTrace")
        elif not any(required_nodes <= set(trace.get("node_refs") or []) for trace in linked):
            errors.append(f"{label}: judgment {judgment_id} ReasoningTrace is incomplete")

    expression_apps: set[str] = set()
    expression_ids: set[str] = set()
    forbidden_05_collections = {
        "facts", "evidence_facts", "signals", "hypotheses", "rule_evaluations",
        "method_applications", "judgments", "reasoning_traces",
    }
    injected = sorted(forbidden_05_collections & set(expression))
    if injected:
        errors.append(f"{label}: 05 creates forbidden semantic collections {injected}")
    for item in expression.get("expressions") or []:
        expression_ids.add(str(item.get("expression_id")))
        source_claim_id = item.get("source_claim_id")
        if source_claim_id not in judgment_ids:
            errors.append(f"{label}: expression unresolved judgment {item.get('source_claim_id')}")
        source_judgment = next((candidate for candidate in judgments if candidate.get("judgment_id") == source_claim_id), {})
        for ref in item.get("source_method_application_refs", []):
            expression_apps.add(ref)
            if app_by_id.get(ref, {}).get("status") != "executed":
                errors.append(f"{label}: expression references non-executed application {ref}")
        for ref in item.get("source_evidence_refs", []):
            if ref not in facts:
                errors.append(f"{label}: expression unresolved evidence {ref}")
            if ref not in set(source_judgment.get("evidence_refs") or []):
                errors.append(f"{label}: expression evidence {ref} not used by source judgment")
        if not item.get("source_evidence_refs"):
            errors.append(f"{label}: expression {item.get('expression_id')} lacks fact-level evidence trace")
        if not item.get("source_method_application_refs"):
            errors.append(f"{label}: expression {item.get('expression_id')} lacks executed MethodApplication trace")
        if not set(item.get("source_method_application_refs") or []) <= set(source_judgment.get("method_application_refs") or []):
            errors.append(f"{label}: expression method trace exceeds source judgment")
    checks = expression.get("overall_check") or {}
    deprecated_self_checks = {
        "no_new_fact_created", "no_new_judgment_created", "no_method_status_changed",
    }
    found_self_checks = sorted(deprecated_self_checks & set(checks))
    if found_self_checks:
        errors.append(f"{label}: 05 deprecated self-certification checks {found_self_checks}; structural projection is authoritative")
    for key in (
        "all_expressions_mapped_to_04_claims", "all_evidence_mapped_to_04_judgments",
        "all_methods_mapped_to_executed_04_applications", "no_expression_level_upgrade",
        "no_condition_loss", "no_scope_expansion",
    ):
        if checks.get(key) is not True:
            errors.append(f"{label}: 05 check {key} must be true")
    if checks.get("result") != "pass":
        errors.append(f"{label}: 05 overall_check.result must be pass")

    stale = set(update.get("affected_graph", {}).get("stale", []))
    current = set(update.get("affected_graph", {}).get("remains_current", []))
    if not stale or stale & current:
        errors.append(f"{label}: incremental stale/current sets invalid")
    if update.get("full_rerun_required") is not False or update.get("structural_checkpoint_required") is not False:
        errors.append(f"{label}: evidence-only exercise must be local-first")
    changed_judgment = update.get("expected_judgment_change", {}).get("judgment_ref")
    if changed_judgment not in judgment_ids or changed_judgment not in stale:
        errors.append(f"{label}: incremental judgment change not linked to stale graph")
    errors.extend(
        f"{label}: {error}"
        for error in _incremental_validator.validate_incremental_update(run)
    )
    return errors


def load_run(run_dir: Path) -> dict[str, dict[str, Any]]:
    return {
        "manifest": load(run_dir / "run_manifest.yaml"),
        "structure": load(run_dir / "02_structure.yaml"),
        "evidence": load(run_dir / "03_evidence.yaml"),
        "judgment": load(run_dir / "04_judgment.yaml"),
        "expression": load(run_dir / "05_expression.yaml"),
        "update": load(run_dir / "incremental_update.yaml"),
    }


def known_rule_ids() -> set[str]:
    output: set[str] = set()
    for path in (ROOT / "ontology/01_通用/models").glob("*.yaml"):
        output.update((load(path).get("rules") or {}).keys())
    output.update((load(ROOT / "ontology/01_通用/models/semiconductor_extension.yaml").get("evidence_constraints") or {}).keys())
    return output


def main(argv: list[str]) -> int:
    runs = tuple(Path(arg).resolve() for arg in argv) or DEFAULT_RUNS
    contract = load(ROOT / "governance/02_合同/public_contract.yaml")
    rules = known_rule_ids()
    errors: list[str] = []
    for run_dir in runs:
        errors.extend(validate_run_data(load_run(run_dir), contract, rules))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"V3_SAMPLES_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print(f"V3_SAMPLES_PASS: {len(runs)} run(s), contract=1.3.0, ontology=3.0.0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
