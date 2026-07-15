#!/usr/bin/env python3
"""Validate the level-one ontology schemas and repository path references."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Iterable

try:
    import yaml
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit("PyYAML is required: python3 -m pip install pyyaml") from exc


SPEC_DIR = Path(__file__).resolve().parent
WORKSPACE = SPEC_DIR.parent
SCHEMA_FILES = ("common.yaml", "semantic.yaml", "evidence.yaml", "reasoning.yaml")
PSEUDO_RESOURCES = {
    "semantic_object",
    "semantic_relation",
    "evidence_object",
    "reasoning_object",
    "rule",
}


def load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: YAML root must be a mapping")
    return data


def iter_nodes(value: Any, path: tuple[str, ...] = ()) -> Iterable[tuple[tuple[str, ...], Any]]:
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from iter_nodes(child, path + (str(key),))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_nodes(child, path + (str(index),))


class Validator:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.schemas = {name: load_yaml(SPEC_DIR / name) for name in SCHEMA_FILES}

    def error(self, message: str) -> None:
        self.errors.append(message)

    def dependencies(self, name: str) -> list[str]:
        return list(self.schemas[name].get("depends_on", []))

    def dependency_closure(self, name: str) -> list[str]:
        result: list[str] = []
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(current: str) -> None:
            if current in visiting:
                self.error(f"dependency cycle detected at {current}")
                return
            if current in visited:
                return
            visiting.add(current)
            for dependency in self.dependencies(current):
                if dependency not in self.schemas:
                    self.error(f"{current}: dependency does not exist: {dependency}")
                    continue
                visit(dependency)
            visiting.remove(current)
            visited.add(current)
            result.append(current)

        visit(name)
        return result

    def resources(self, names: Iterable[str], section: str) -> set[str]:
        output: set[str] = set()
        for name in names:
            output.update(self.schemas[name].get(section, {}).keys())
        return output

    def validate_enums(self) -> None:
        for name, schema in self.schemas.items():
            for path, node in iter_nodes(schema):
                if isinstance(node, dict) and node.get("type") == "enum":
                    values = node.get("allowed_values")
                    if not isinstance(values, list) or not values:
                        self.error(f"{name}:{'.'.join(path)} enum missing non-empty allowed_values")
                    elif len(values) != len(set(values)):
                        self.error(f"{name}:{'.'.join(path)} enum has duplicate allowed_values")

    def validate_schema_references(self) -> None:
        for name, schema in self.schemas.items():
            closure = self.dependency_closure(name)
            objects = self.resources(closure, "object_types")
            relations = self.resources(closure, "relation_types")
            actions = self.resources(closure, "action_types")
            functions = self.resources(closure, "functions")
            logics = self.resources(closure, "logic_flows")
            rules = self.resources(closure, "rules")
            addressable = objects | relations | PSEUDO_RESOURCES

            for relation_id, relation in schema.get("relation_types", {}).items():
                for endpoint in (*relation.get("source_types", []), *relation.get("target_types", [])):
                    if endpoint not in objects:
                        self.error(f"{name}:{relation_id} unresolved endpoint type: {endpoint}")

            for action_id, action in schema.get("action_types", {}).items():
                for target in (*action.get("target_types", []), *action.get("write_scope", [])):
                    if target not in addressable:
                        self.error(f"{name}:{action_id} unresolved target/write resource: {target}")
                for rule_ref in action.get("rule_refs", []):
                    if rule_ref not in rules:
                        self.error(f"{name}:{action_id} unresolved rule_ref: {rule_ref}")
                function_ref = action.get("function_ref")
                if function_ref and function_ref not in functions:
                    self.error(f"{name}:{action_id} unresolved function_ref: {function_ref}")
                for logic_ref in action.get("logic_refs", []):
                    if logic_ref not in logics:
                        self.error(f"{name}:{action_id} unresolved logic_ref: {logic_ref}")

            accessible = objects | relations | actions | functions | logics | rules | PSEUDO_RESOURCES
            for logic_id, logic in schema.get("logic_flows", {}).items():
                for step in logic.get("steps", []):
                    for rule_ref in step.get("rule_refs", []):
                        if rule_ref not in rules:
                            self.error(f"{name}:{logic_id} unresolved step rule_ref: {rule_ref}")
                    function_ref = step.get("function_ref")
                    if function_ref and function_ref not in functions:
                        self.error(f"{name}:{logic_id} unresolved step function_ref: {function_ref}")
                    for used in step.get("uses", []):
                        if "." not in used and used not in accessible:
                            self.error(f"{name}:{logic_id} unresolved step uses: {used}")

    def validate_inheritance(self) -> None:
        objects = self.schemas["semantic.yaml"].get("object_types", {})
        for object_id, object_type in objects.items():
            parent = object_type.get("extends")
            if parent and parent not in objects:
                self.error(f"semantic.yaml:{object_id} extends missing object type: {parent}")

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(object_id: str) -> None:
            if object_id in visiting:
                self.error(f"object inheritance cycle detected at {object_id}")
                return
            if object_id in visited:
                return
            visiting.add(object_id)
            parent = objects[object_id].get("extends")
            if parent in objects:
                visit(parent)
            visiting.remove(object_id)
            visited.add(object_id)

        for object_id in objects:
            visit(object_id)

        company = objects.get("Company", {})
        if company.get("extends") != "Organization":
            self.error("Company must extend Organization")
        if company.get("properties"):
            self.error("Company must inherit Organization identity properties instead of duplicating them")

    def validate_layering(self) -> None:
        if self.dependencies("semantic.yaml") != ["common.yaml"]:
            self.error("semantic.yaml must depend only on common.yaml")
        if self.dependencies("evidence.yaml") != ["common.yaml", "semantic.yaml"]:
            self.error("evidence.yaml must depend on common.yaml and semantic.yaml")
        if self.dependencies("reasoning.yaml") != ["common.yaml", "semantic.yaml", "evidence.yaml"]:
            self.error("reasoning.yaml must explicitly depend on evidence.yaml")

        reasoning_objects = set(self.schemas["reasoning.yaml"].get("object_types", {}))
        evidence = self.schemas["evidence.yaml"]
        for relation_id, relation in evidence.get("relation_types", {}).items():
            endpoints = set(relation.get("source_types", [])) | set(relation.get("target_types", []))
            illegal = sorted(endpoints & reasoning_objects)
            if illegal:
                self.error(f"evidence.yaml:{relation_id} reverse-depends on reasoning types: {illegal}")

        if "evidenceGroundsReasoning" in evidence.get("relation_types", {}):
            self.error("evidenceGroundsReasoning must be owned by reasoning.yaml")
        if "evidenceGroundsReasoning" not in self.schemas["reasoning.yaml"].get("relation_types", {}):
            self.error("reasoning.yaml must own evidenceGroundsReasoning")

    def validate_contract_scenarios(self) -> None:
        semantic = self.schemas["semantic.yaml"]
        reasoning = self.schemas["reasoning.yaml"]
        evidence = self.schemas["evidence.yaml"]

        expected_versions = {
            "common.yaml": "2.1.0",
            "semantic.yaml": "1.1.0",
            "evidence.yaml": "2.0.0",
            "reasoning.yaml": "2.0.0",
        }
        for name, version in expected_versions.items():
            if self.schemas[name].get("schema_version") != version:
                self.error(f"{name} expected schema_version {version}")

        for object_id in (
            "Region",
            "Application",
            "Organization",
            "PolicyInstrument",
            "PolicyRequirement",
            "TechnicalConstraint",
            "FinancialInstrument",
            "Identifier",
            "IdentificationScheme",
            "TradingVenue",
            "Listing",
            "RoleAssignment",
        ):
            if object_id not in semantic.get("object_types", {}):
                self.error(f"semantic.yaml missing {object_id}")
        if "companyLinkedToAsset" in semantic.get("relation_types", {}):
            self.error("semantic.yaml must not retain companyLinkedToAsset")
        for object_id, forbidden_property in (
            ("Asset", "symbol"),
            ("TradingVenue", "marketIdentifier"),
            ("Listing", "listedSymbol"),
        ):
            properties = semantic.get("object_types", {}).get(object_id, {}).get("properties", {})
            if forbidden_property in properties:
                self.error(f"semantic.yaml:{object_id} must use Identifier instead of {forbidden_property}")
        for relation_id in (
            "subRegionOf",
            "companyOperatesInRegion",
            "subApplicationOf",
            "applicationBelongsToIndustry",
            "productUsedInApplication",
            "companyExposedToApplication",
            "organizationLocatedIn",
            "companyExposedToRegion",
            "companySuppliesCompany",
            "policyIssuedBy",
            "policyAdministeredBy",
            "policyAppliesIn",
            "policyAppliesTo",
            "policyHasRequirement",
            "requirementAppliesTo",
            "requirementSpecifiesCharacteristic",
            "requirementImposesConstraint",
            "requirementSupersededBy",
            "identifierIdentifiesObject",
            "identifierDefinedInScheme",
            "identifierIssuedBy",
            "schemeManagedBy",
            "assetIssuedBy",
            "assetRepresentsClaimOn",
            "assetHasUnderlier",
            "assetManagedBy",
            "assetGuaranteedBy",
            "financialInstrumentDenominatedIn",
            "assetListedVia",
            "listingListsAsset",
            "listingOnTradingVenue",
            "tradingVenueOperatedBy",
            "tradingVenueOperatesInRegion",
            "rolePlayedBy",
            "roleInContext",
            "roleAppliesToObject",
        ):
            if relation_id not in semantic.get("relation_types", {}):
                self.error(f"semantic.yaml missing {relation_id}")

        expected_reasoning_relations = (
            "hypothesisCompetesWith",
            "hypothesisContradicts",
            "judgmentUnderScenario",
            "impactUnderScenario",
            "validationOf",
            "validationUsesOutcome",
            "validationReferencesTrace",
        )
        for object_id in ("RuleEvaluation", "ValidationRecord"):
            if object_id not in reasoning.get("object_types", {}):
                self.error(f"reasoning.yaml missing {object_id}")
        if "EvidenceAssessment" not in evidence.get("object_types", {}):
            self.error("evidence.yaml missing EvidenceAssessment")
        for relation_id in expected_reasoning_relations:
            if relation_id not in reasoning.get("relation_types", {}):
                self.error(f"reasoning.yaml missing {relation_id}")

        hypothesis_action = reasoning.get("action_types", {}).get("FormHypothesis", {})
        if "evidence_grounding_required" in hypothesis_action.get("rule_refs", []):
            self.error("FormHypothesis must not require prior evidence")
        if "hypothesis_falsifiability_required" not in hypothesis_action.get("rule_refs", []):
            self.error("FormHypothesis must enforce falsifiability")
        for relation_id in ("claimAbout", "factAbout"):
            targets = evidence.get("relation_types", {}).get(relation_id, {}).get("target_types", [])
            if "StateVariable" in targets:
                self.error(f"evidence.yaml:{relation_id} must not target StateVariable")
            for required_target in (
                "Organization",
                "PolicyInstrument",
                "PolicyRequirement",
                "TechnicalConstraint",
                "FinancialInstrument",
                "Identifier",
                "TradingVenue",
                "Listing",
                "RoleAssignment",
            ):
                if required_target not in targets:
                    self.error(f"evidence.yaml:{relation_id} missing target: {required_target}")

        if "sourcePublishedBy" not in evidence.get("relation_types", {}):
            self.error("evidence.yaml missing sourcePublishedBy")
        register_source = evidence.get("action_types", {}).get("RegisterSource", {})
        if "publisherRef" not in register_source.get("parameters", []):
            self.error("RegisterSource must accept publisherRef")

        for relation_id, relation in semantic.get("relation_types", {}).items():
            if "PolicyInstrument" in relation.get("source_types", []) and "Asset" in relation.get("target_types", []):
                self.error(f"semantic.yaml:{relation_id} must not connect PolicyInstrument directly to Asset")

        for relation_id in ("variableAnchoredOn", "eventAnchoredOn", "expectationAbout"):
            targets = reasoning.get("relation_types", {}).get(relation_id, {}).get("target_types", [])
            for required_target in (
                "Organization",
                "PolicyInstrument",
                "PolicyRequirement",
                "TechnicalConstraint",
                "FinancialInstrument",
                "Identifier",
                "TradingVenue",
                "Listing",
                "RoleAssignment",
            ):
                if required_target not in targets:
                    self.error(f"reasoning.yaml:{relation_id} missing target: {required_target}")


    def validate_axiom_checks(self) -> None:
        common = self.schemas["common.yaml"]
        families = common.get("object_role_families", {})
        stable = set(families.get("stable_semantics", []))
        evidence_family = set(families.get("evidence", []))
        reasoning_families = (
            set(families.get("state_and_fact", []))
            | set(families.get("hypothesis_and_judgment", []))
            | set(families.get("pricing_comparison", []))
            | set(families.get("scenario_and_record", []))
        )
        for left_name, left, right_name, right in (
            ("stable_semantics", stable, "evidence", evidence_family),
            ("stable_semantics", stable, "reasoning_families", reasoning_families),
            ("evidence", evidence_family, "reasoning_families", reasoning_families),
        ):
            overlap = sorted(left & right)
            if overlap:
                self.error(f"object_role_families overlap between {left_name} and {right_name}: {overlap}")

        shared = common.get("shared_object_properties", {})
        for field in ("validFrom", "validTo"):
            if field not in shared:
                self.error(f"common.yaml missing shared_object_properties.{field}")
            elif shared[field].get("type") != "datetime":
                self.error(f"common.yaml shared_object_properties.{field} must be datetime")

        for schema_name in ("semantic.yaml", "evidence.yaml", "reasoning.yaml"):
            for object_id, object_type in self.schemas[schema_name].get("object_types", {}).items():
                properties = object_type.get("properties", {})
                for field in ("validFrom", "validTo"):
                    if field in properties and properties[field].get("type") not in (None, "datetime"):
                        self.error(f"{schema_name}:{object_id}.{field} must be datetime")

        allowed_cardinality = set(common.get("common_enums", {}).get("cardinality", []))
        for schema_name in ("semantic.yaml", "evidence.yaml", "reasoning.yaml"):
            for relation_id, relation in self.schemas[schema_name].get("relation_types", {}).items():
                cardinality = relation.get("cardinality")
                if cardinality not in allowed_cardinality:
                    self.error(f"{schema_name}:{relation_id} missing or invalid cardinality")

        policy = self.schemas["semantic.yaml"].get("object_types", {}).get("PolicyInstrument", {})
        if "canonicalIdentifier" not in policy.get("properties", {}):
            self.error("PolicyInstrument must retain canonicalIdentifier for uniqueness intent")

        claim = self.schemas["evidence.yaml"].get("object_types", {}).get("EvidenceClaim", {})
        locator = claim.get("properties", {}).get("locator")
        if not locator or not locator.get("required"):
            self.error("EvidenceClaim.locator must remain required")
        if "supersedes" not in self.schemas["evidence.yaml"].get("relation_types", {}):
            self.error("evidence.yaml must retain supersedes relation")

        if not common.get("namespace", {}).get("base_iri"):
            self.error("common.yaml must declare namespace.base_iri")
        declared = {item.get("id") for item in common.get("axiom_checks", []) if isinstance(item, dict)}
        for required_id in (
            "layer_object_family_disjoint",
            "temporal_validity_fields",
            "no_redefine_platform_types",
            "evidence_locator_required",
            "supersession_relation_present",
        ):
            if required_id not in declared:
                self.error(f"common.yaml axiom_checks missing {required_id}")

    def validate_semiconductor_v2(self) -> None:
        domain_dir = WORKSPACE / "二级半导体领域本体规范"
        domain_files = {
            "common.yaml": domain_dir / "common.yaml",
            "semantic.yaml": domain_dir / "semantic.yaml",
            "evidence.yaml": domain_dir / "evidence.yaml",
            "reasoning.yaml": domain_dir / "reasoning.yaml",
        }
        domain_schemas = {name: load_yaml(path) for name, path in domain_files.items()}

        for name, schema in domain_schemas.items():
            if schema.get("schema_version") != "1.0.0":
                self.error(f"semiconductor {name} expected schema_version 1.0.0")

        semantic = domain_schemas["semantic.yaml"]
        evidence = domain_schemas["evidence.yaml"]
        reasoning = domain_schemas["reasoning.yaml"]
        common = domain_schemas["common.yaml"]

        if evidence.get("depends_on", []) != [
            "common.yaml",
            "semantic.yaml",
            "../一级通用本体规范/evidence.yaml",
        ]:
            self.error("semiconductor evidence.yaml must depend on common, semantic, and platform evidence only")
        if "reasoning.yaml" in evidence.get("depends_on", []):
            self.error("semiconductor evidence.yaml must not depend on reasoning.yaml")
        if "evidence.yaml" not in reasoning.get("depends_on", []):
            self.error("semiconductor reasoning.yaml must depend on evidence.yaml")

        forbidden_tokens = (
            "DemandSource",
            "Jurisdiction",
            "companyHeadquarteredIn",
            "technologyRouteSubstitutesFor",
            "semiconductorProductCategories",
            "productServesDemandSource",
            "companyServesDemandSource",
            "customer_concentration_exposure",
            "silicon_content_intensity",
            "product_mix_quality",
            "policy_event_category",
            "business_scenario_prototypes",
        )
        conflict_props = ("segmentRole", "materialCategory", "processRole", "applicationCategory")
        for name, path in domain_files.items():
            if name == "common.yaml":
                continue
            raw = path.read_text(encoding="utf-8")
            for token in forbidden_tokens:
                if token in raw:
                    self.error(f"semiconductor {name} contains forbidden token: {token}")
        for prop in conflict_props:
            extensions = semantic.get("object_type_extensions", {})
            for object_id, extension in extensions.items():
                if prop in extension.get("properties", {}):
                    self.error(f"semiconductor semantic.yaml:{object_id} overrides level-one property: {prop}")

        platform_semantic = self.schemas["semantic.yaml"]
        platform_objects = set(platform_semantic.get("object_types", {}))
        platform_relations = set(platform_semantic.get("relation_types", {}))
        redefined_objects = sorted(platform_objects & set(semantic.get("object_types", {})))
        if redefined_objects:
            self.error(f"semiconductor semantic.yaml redefines platform object types: {redefined_objects}")
        redefined_relations = sorted(platform_relations & set(semantic.get("relation_types", {})))
        if redefined_relations:
            self.error(f"semiconductor semantic.yaml redefines platform relation types: {redefined_relations}")
        if not common.get("namespace", {}).get("base_iri"):
            self.error("semiconductor common.yaml must declare namespace.base_iri")
        governance = common.get("extension_governance", {})
        if not governance.get("must_not_redefine_platform_object_types"):
            self.error("semiconductor common.yaml must set extension_governance.must_not_redefine_platform_object_types")
        relation_extensions = semantic.get("relation_type_extensions", {})
        for relation_id in ("policyAppliesTo", "requirementAppliesTo"):
            targets = relation_extensions.get(relation_id, {}).get("add_target_types", [])
            for required_target in ("TechnologyRoute", "ManufacturingFacility"):
                if required_target not in targets:
                    self.error(f"semiconductor semantic.yaml:{relation_id} missing target extension: {required_target}")
        for required_object in ("PolicyRequirement", "TechnicalConstraint"):
            reused = set(common.get("inheritance", {}).get("platform_resources_reused", {}).get("semantic_objects", []))
            if required_object not in reused:
                self.error(f"semiconductor common.yaml missing reused platform object: {required_object}")
        object_closure = set(platform_semantic.get("object_types", {})) | set(semantic.get("object_types", {}))
        for relation_id, relation in semantic.get("relation_types", {}).items():
            for endpoint in (*relation.get("source_types", []), *relation.get("target_types", [])):
                if endpoint not in object_closure:
                    self.error(f"semiconductor semantic.yaml:{relation_id} unresolved endpoint: {endpoint}")

        profiles = set(evidence.get("evidence_profiles", {}))
        for profile in evidence.get("evidence_profiles", {}).values():
            if profile.get("applies_to"):
                self.error(f"semiconductor evidence profile {profile.get('id')} must not list applies_to state variables")

        variables = reasoning.get("state_variables", {})
        if len(variables) != 46:
            self.error(f"semiconductor reasoning.yaml expected 46 state variables, found {len(variables)}")
        templates = reasoning.get("propagation_templates", {})
        if len(templates) != 28:
            self.error(f"semiconductor reasoning.yaml expected 28 propagation templates, found {len(templates)}")
        if len(evidence.get("evidence_profiles", {})) != 12:
            self.error("semiconductor evidence.yaml expected 12 evidence profiles")
        if len(reasoning.get("scenario_templates", {})) != 4:
            self.error("semiconductor reasoning.yaml expected 4 scenario templates")
        if len(reasoning.get("business_scenario_tags", {})) != 9:
            self.error("semiconductor reasoning.yaml expected 9 business scenario tags")
        if "business_scenario_prototypes" in reasoning:
            self.error("semiconductor reasoning.yaml must use business_scenario_tags, not business_scenario_prototypes")

        referenced_variables: set[str] = set()
        for template in templates.values():
            for field in ("source_variables", "target_variables", "intermediate_variables"):
                for variable_id in template.get(field, []):
                    referenced_variables.add(variable_id)
                    if variable_id not in variables:
                        self.error(f"semiconductor template {template.get('id')} unresolved variable: {variable_id}")
            profile_ref = template.get("evidence_profile_ref")
            if profile_ref and profile_ref not in profiles:
                self.error(f"semiconductor template {template.get('id')} unresolved evidence profile: {profile_ref}")
            for required_field in (
                "anchor_alignment",
                "direction_logic",
                "evidence_profile_ref",
                "default_competing_explanation",
            ):
                if required_field not in template:
                    self.error(f"semiconductor template {template.get('id')} missing {required_field}")

        for scenario_group in (
            reasoning.get("scenario_templates", {}),
            reasoning.get("business_scenario_tags", {}),
        ):
            for scenario in scenario_group.values():
                for field in ("trigger_variables", "key_variable_conditions"):
                    for variable_id in scenario.get(field, {} if field == "key_variable_conditions" else []):
                        key = variable_id if field == "trigger_variables" else variable_id
                        referenced_variables.add(key)
                        if key not in variables:
                            self.error(f"semiconductor scenario {scenario.get('id')} unresolved variable: {key}")

        for variable_id, variable in variables.items():
            if not variable.get("variable_role"):
                self.error(f"semiconductor variable {variable_id} missing variable_role")
            profile_ref = variable.get("evidence_profile_ref")
            if not profile_ref:
                self.error(f"semiconductor variable {variable_id} missing evidence_profile_ref")
            elif profile_ref not in profiles:
                self.error(f"semiconductor variable {variable_id} unresolved evidence profile: {profile_ref}")
            referenced_variables.add(variable_id)

        orphan_variables = sorted(set(variables) - referenced_variables)
        if orphan_variables:
            self.error(f"semiconductor orphan state variables: {orphan_variables}")

        for retained in ("TechnologyRoute", "ManufacturingFacility"):
            if retained not in semantic.get("object_types", {}):
                self.error(f"semiconductor semantic schema lost retained object: {retained}")
        reused_semantic = set(common.get("inheritance", {}).get("platform_resources_reused", {}).get("semantic_objects", []))
        for required_object in (
            "FinancialInstrument",
            "Identifier",
            "IdentificationScheme",
            "TradingVenue",
            "Listing",
            "RoleAssignment",
        ):
            if required_object not in reused_semantic:
                self.error(f"semiconductor common.yaml missing reused platform object: {required_object}")
        for extension in ("Application", "Region"):
            if extension not in semantic.get("object_type_extensions", {}):
                self.error(f"semiconductor semantic schema missing platform extension: {extension}")
        for relation_id in ("technologyRouteCanSubstituteFor", "facilityProducesMaterial"):
            if relation_id not in semantic.get("relation_types", {}):
                self.error(f"semiconductor semantic schema missing relation: {relation_id}")
        relation_extensions = semantic.get("relation_type_extensions", {})
        for relation_id in ("identifierIdentifiesObject", "roleAppliesToObject"):
            targets = relation_extensions.get(relation_id, {}).get("add_target_types", [])
            for required_target in ("TechnologyRoute", "ManufacturingFacility"):
                if required_target not in targets:
                    self.error(f"semiconductor semantic.yaml:{relation_id} missing target extension: {required_target}")
        if "companyHeadquarteredIn" in semantic.get("relation_types", {}):
            self.error("semiconductor semantic schema must not retain companyHeadquarteredIn")

        facility_operated = semantic.get("relation_types", {}).get("facilityOperatedBy", {})
        if facility_operated.get("target_types") != ["Organization"]:
            self.error("semiconductor facilityOperatedBy must target Organization")

        counts = common.get("resource_counts", {})
        expected_counts = {
            "state_variables": 46,
            "propagation_templates": 28,
            "evidence_profiles": 12,
            "scenario_templates": 4,
            "business_scenario_tags": 9,
        }
        for key, value in expected_counts.items():
            if counts.get(key) != value:
                self.error(f"semiconductor common.yaml resource_counts.{key} expected {value}")

        acceptance_ids = {
            "memory",
            "hbm",
            "stacked_memory",
            "interposer_2_5d",
            "hybrid_bonding",
            "inp",
            "semiconductor_equipment_product",
            "inventory_destocking",
            "supply_constraint_to_price_delivery",
            "advanced_packaging_to_inputs",
            "export_control_to_supply",
            "regional_policy_exposure",
        }
        vocab_values: set[str] = set()
        for vocabulary in semantic.get("controlled_vocabularies", {}).values():
            vocab_values.update(vocabulary.get("values", {}).keys())
        missing_acceptance = sorted(acceptance_ids - vocab_values - set(variables) - set(templates))
        if missing_acceptance:
            self.error(f"semiconductor acceptance matrix unresolved ids: {missing_acceptance}")

    def validate_docs_and_paths(self) -> None:
        required_docs = {
            "00_投研本体框架概述.md": ("Organization", "PolicyInstrument", "PolicyRequirement", "TechnicalConstraint", "ValidationRecord", "FinancialInstrument", "Identifier"),
            "01_语义结构域规范.md": ("organizationLocatedIn", "policyIssuedBy", "policyHasRequirement", "requirementAppliesTo", "companySuppliesCompany", "assetIssuedBy", "identifierIdentifiesObject", "TradingVenue"),
            "02_判断推理域规范.md": ("PolicyInstrument", "ValidationRecord", "impactUnderScenario", "FinancialInstrument", "Listing"),
            "03_证据域规范.md": ("sourcePublishedBy", "evidenceGroundsReasoning", "推理域拥有", "FinancialInstrument", "Identifier"),
        }
        for filename, needles in required_docs.items():
            path = SPEC_DIR / filename
            if not path.exists():
                self.error(f"missing documentation: {filename}")
                continue
            text = path.read_text(encoding="utf-8")
            for needle in needles:
                if needle not in text:
                    self.error(f"{filename} missing documented term: {needle}")

        old_directory_name = "本体" + "建模规范"
        for path in WORKSPACE.rglob("*"):
            if not path.is_file() or path.name == ".DS_Store" or ".git" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if old_directory_name in text:
                self.error(f"stale old directory reference: {path.relative_to(WORKSPACE)}")

        for path in (WORKSPACE / "二级半导体领域本体规范").glob("*.yaml"):
            data = load_yaml(path)
            for dependency in data.get("depends_on", []):
                dependency_path = (path.parent / dependency).resolve()
                if not dependency_path.exists():
                    self.error(f"{path.relative_to(WORKSPACE)} missing dependency: {dependency}")

        template = load_yaml(WORKSPACE / "02_判断结构" / "模板" / "02_任务本体视图模板.yaml")
        domain = template.get("ontology_sources", {}).get("domain_ontology", {})
        if domain.get("version") != "1.0.0":
            self.error("output template domain_ontology.version expected 1.0.0")
        expected_domain_files = [
            "二级半导体领域本体规范/common.yaml",
            "二级半导体领域本体规范/semantic.yaml",
            "二级半导体领域本体规范/evidence.yaml",
            "二级半导体领域本体规范/reasoning.yaml",
        ]
        if domain.get("files") != expected_domain_files:
            self.error("output template domain_ontology.files must follow common→semantic→evidence→reasoning order")
        for source in template.get("ontology_sources", {}).values():
            if not isinstance(source, dict):
                continue
            for filename in source.get("files", []):
                if not (WORKSPACE / filename).exists():
                    self.error(f"output template missing ontology source: {filename}")

    def run(self) -> int:
        self.validate_enums()
        self.validate_schema_references()
        self.validate_inheritance()
        self.validate_layering()
        self.validate_contract_scenarios()
        self.validate_axiom_checks()
        self.validate_semiconductor_v2()
        self.validate_docs_and_paths()
        if self.errors:
            print(f"FAILED: {len(self.errors)} validation error(s)")
            for item in self.errors:
                print(f"- {item}")
            return 1
        counts = {
            section: sum(len(schema.get(section, {})) for schema in self.schemas.values())
            for section in ("object_types", "relation_types", "action_types", "functions", "logic_flows", "rules")
        }
        print("PASS: level-one ontology schemas and repository references are valid")
        print("Counts:", ", ".join(f"{key}={value}" for key, value in counts.items()))
        return 0


if __name__ == "__main__":
    sys.exit(Validator().run())
