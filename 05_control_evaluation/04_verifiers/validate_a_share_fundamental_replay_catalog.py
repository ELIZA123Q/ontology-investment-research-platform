#!/usr/bin/env python3
"""Ensure the A-share forward-test catalog resolves to executable frozen Runtime fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "05_control_evaluation/05_evals/cases/a-share-fundamental-v1/catalog.yaml"
FIXTURES = ROOT / "05_control_evaluation/05_evals/fixtures/research-value-fixtures.json"
MATERIALIZER = ROOT / "06_runtime/src/evaluation/research-value-evaluator.ts"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    catalog = yaml.safe_load(CATALOG.read_text(encoding="utf-8"))
    fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
    require(isinstance(catalog, dict) and catalog.get("status") == "engineering_replayable", "A-share catalog must be engineering_replayable")
    require(catalog.get("runtime_fixture_catalog") == str(FIXTURES.relative_to(ROOT)), "catalog must name the authoritative runtime fixture catalog")
    require(catalog.get("runtime_materializer") == str(MATERIALIZER.relative_to(ROOT)) and MATERIALIZER.is_file(), "catalog must name the executable materializer")
    cases = catalog.get("cases")
    require(isinstance(cases, list) and len(cases) == 15, "exactly 15 A-share forward-test cases are required")
    fixture_ids = {item.get("id") for item in fixtures.get("cases", []) if isinstance(item, dict)}
    mapped: list[str] = []
    for case in cases:
        require(isinstance(case, dict) and str(case.get("id", "")).strip(), "every A-share case needs an ID")
        bindings = case.get("fixture_ids")
        require(isinstance(bindings, list) and len(bindings) == 1, f"{case.get('id')} must bind exactly one runtime fixture")
        require(isinstance(bindings[0], str) and bindings[0] in fixture_ids, f"{case.get('id')} references unknown runtime fixture")
        mapped.extend(bindings)
    require(len(mapped) == len(set(mapped)), "each A-share case requires a distinct frozen fixture")
    required_scenarios = {"sufficient", "missing_vintage", "one_off", "unit_mismatch", "basis_mismatch", "future_fact", "dilution_missing", "three_statement_break", "missing_counter"}
    scenarios = {item.get("scenario") for item in fixtures.get("cases", []) if item.get("id") in mapped}
    require(required_scenarios <= scenarios, "A-share replay mapping omits a required risk scenario")
    print(f"A_SHARE_FUNDAMENTAL_REPLAY_CATALOG_PASS: cases={len(cases)}, mapped_fixtures={len(mapped)}, scenarios={len(scenarios)}.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, yaml.YAMLError, json.JSONDecodeError) as error:
        print(f"A_SHARE_FUNDAMENTAL_REPLAY_CATALOG_RETURN_REQUIRED: {error}")
        raise SystemExit(1)
