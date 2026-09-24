#!/usr/bin/env python3
"""Validate non-semiconductor draft domain seed pressure cases."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
import sys

import yaml


ROOT = Path(__file__).resolve().parents[2]
DOMAIN_ROOT = ROOT / "ontology" / "02_领域"
CASE_FILE = ROOT / "evaluation" / "06_第二领域压力测试" / "行业压力测试样例.yaml"
SOURCE_ROUTES_FILE = ROOT / "methods" / "03_取证" / "source_routes.yaml"

DOMAIN_DIRS = [
    "innovative_drug",
    "securities",
    "banking",
    "insurance",
    "real_estate_chain",
    "consumer_retail",
    "internet_platform",
    "new_energy_power_equipment",
    "utilities_power",
    "defense_industry",
]

FORBIDDEN_MATURE_PHRASES = [
    "成熟行业框架",
    "正式行业框架",
    "产品就绪",
    "可直接生成投资建议",
    "给出目标价",
    "给出仓位建议",
]


def fail(message: str) -> None:
    print(f"DOMAIN_SEED_CASES_FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_yaml(path: Path) -> dict:
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - defensive reporting
        fail(f"{path} YAML parse failed: {exc}")


def validate_case_set() -> dict[str, set[str]]:
    data = load_yaml(CASE_FILE)
    cases = data.get("cases") or []
    if not isinstance(cases, list):
        fail("cases must be a list")

    counts: Counter[str] = Counter()
    seen_ids: set[str] = set()
    required_profiles_by_domain: dict[str, set[str]] = {domain: set() for domain in DOMAIN_DIRS}
    for case in cases:
        case_id = case.get("case_id")
        domain = case.get("domain_label")
        if not case_id or not domain:
            fail(f"case missing case_id/domain_label: {case}")
        if case_id in seen_ids:
            fail(f"duplicate case_id: {case_id}")
        seen_ids.add(case_id)
        if domain not in DOMAIN_DIRS:
            fail(f"unexpected domain_label {domain} in {case_id}")
        for field in ["required_evidence_profiles", "must_block_if_missing", "success_criteria"]:
            value = case.get(field)
            if not isinstance(value, list) or not value:
                fail(f"{case_id} missing non-empty {field}")
        required_profiles_by_domain[domain].update(case.get("required_evidence_profiles") or [])
        counts[domain] += 1

    missing = [domain for domain in DOMAIN_DIRS if counts[domain] < 3]
    if missing:
        fail(f"domains with fewer than 3 cases: {missing}")
    return required_profiles_by_domain


def validate_domain_packages(required_profiles_by_domain: dict[str, set[str]]) -> None:
    source_routes = load_yaml(SOURCE_ROUTES_FILE).get("routes") or []
    if not isinstance(source_routes, list):
        fail("source_routes.yaml routes must be a list")
    domains_with_routes = {
        domain
        for route in source_routes
        for domain in (route.get("domains") or [])
        if isinstance(route, dict)
    }
    for domain in DOMAIN_DIRS:
        if domain not in domains_with_routes:
            fail(f"{domain} missing source route coverage")
        pkg = DOMAIN_ROOT / domain
        business = load_yaml(pkg / "business_instances.yaml")
        if business.get("status") != "draft_domain_seed":
            fail(f"{domain} status must be draft_domain_seed")
        scenarios = business.get("business_instance_graph", {}).get("second_round_scenarios") or []
        if len(scenarios) < 2:
            fail(f"{domain} must have at least 2 second_round_scenarios")
        evidence_profiles = {
            item.get("id")
            for item in business.get("business_instance_graph", {}).get("objects", [])
            if isinstance(item, dict) and item.get("type") == "EvidenceProfile"
        }
        for scenario in scenarios:
            for field in ["id", "name", "required_profiles", "stop_if_missing", "non_inference_rules"]:
                if not scenario.get(field):
                    fail(f"{domain} scenario missing {field}: {scenario}")
            missing_profiles = sorted(set(scenario.get("required_profiles") or []) - evidence_profiles)
            if missing_profiles:
                fail(f"{domain} scenario {scenario.get('id')} references missing profiles: {missing_profiles}")

        route_profiles = {
            profile
            for route in source_routes
            if isinstance(route, dict) and domain in (route.get("domains") or [])
            for profile in (route.get("evidence_profile_ids") or [])
        }
        if not evidence_profiles <= route_profiles:
            fail(f"{domain} source routes miss evidence profiles: {sorted(evidence_profiles - route_profiles)}")
        case_missing_profiles = sorted(required_profiles_by_domain[domain] - evidence_profiles)
        if case_missing_profiles:
            fail(f"{domain} pressure cases reference missing profiles: {case_missing_profiles}")
        case_missing_routes = sorted(required_profiles_by_domain[domain] - route_profiles)
        if case_missing_routes:
            fail(f"{domain} pressure case profiles missing route coverage: {case_missing_routes}")

        for doc in pkg.glob("0[23]_*说明.md"):
            text = doc.read_text(encoding="utf-8")
            for phrase in FORBIDDEN_MATURE_PHRASES:
                if phrase in text:
                    fail(f"{doc} contains forbidden mature phrase: {phrase}")
            if "二轮" not in text:
                fail(f"{doc} missing second-round readable projection")


def main() -> None:
    required_profiles_by_domain = validate_case_set()
    validate_domain_packages(required_profiles_by_domain)
    print("DOMAIN_SEED_CASES_PASS: 10 domains, 30 pressure cases, readable projections, source routes and draft seed boundaries valid.")


if __name__ == "__main__":
    main()
