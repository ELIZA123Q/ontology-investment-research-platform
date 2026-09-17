#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml


REQUIRED_DIMENSIONS = {
    "exposure_coverage",
    "fundamental_capture",
    "expectation_gap",
    "valuation",
    "downside_risk",
    "implementability",
}
STOPPED_STATUSES = {"not_formed", "blocked", "expired", "rewrite"}
PROHIBITED_KEYS = {
    "buy",
    "sell",
    "trade_action",
    "position_size",
    "allocation",
    "target_price",
    "timing_signal",
    "return_promise",
}


def _fail(message: str) -> None:
    raise SystemExit(f"decision_comparison invalid: {message}")


def _ids(items: Any, field: str = "id") -> list[str]:
    if not isinstance(items, list):
        _fail(f"{field} list expected")
    result = []
    for item in items:
        if not isinstance(item, dict) or not str(item.get(field, "")).strip():
            _fail(f"missing {field}")
        result.append(str(item[field]))
    if len(result) != len(set(result)):
        _fail(f"duplicate {field}")
    return result


def _scan_forbidden(value: Any, path: str = "") -> list[str]:
    if isinstance(value, dict):
        found = []
        for key, nested in value.items():
            key_path = f"{path}.{key}" if path else str(key)
            if str(key) in PROHIBITED_KEYS:
                found.append(key_path)
            found.extend(_scan_forbidden(nested, key_path))
        return found
    if isinstance(value, list):
        found = []
        for index, nested in enumerate(value):
            found.extend(_scan_forbidden(nested, f"{path}[{index}]"))
        return found
    return []


def validate(payload: dict[str, Any]) -> None:
    if set(payload) != {"decision_comparison"}:
        _fail("top level must contain only decision_comparison")
    item = payload["decision_comparison"]
    if not isinstance(item, dict):
        _fail("decision_comparison must be an object")
    forbidden = _scan_forbidden(item)
    if forbidden:
        _fail(f"prohibited output fields: {forbidden}")

    status = item.get("a10_thesis_status")
    preferred = item.get("preferred_vehicle")
    edge = item.get("selection_edge")
    confidence = item.get("confidence")
    if preferred not in {"etf", "stock_selection", "hybrid", "insufficient"}:
        _fail("preferred_vehicle invalid")
    if status in STOPPED_STATUSES and preferred != "insufficient":
        _fail("stopped A10 status must map to insufficient")
    if preferred == "insufficient" and (edge != "unknown" or confidence != "low"):
        _fail("insufficient requires unknown edge and low confidence")
    if preferred in {"stock_selection", "hybrid"} and edge not in {"strong", "moderate"}:
        _fail("stock or hybrid requires strong/moderate selection_edge")
    if preferred == "etf" and edge not in {"weak", "unknown"}:
        _fail("etf preference cannot claim strong stock-selection edge")

    dimensions = set(_ids((item.get("comparison_scope") or {}).get("common_dimensions"), "id"))
    if dimensions != REQUIRED_DIMENSIONS:
        _fail("common_dimensions must exactly match the required six dimensions")

    candidates = item.get("candidate_ranking") or []
    if preferred != "insufficient":
        if not any(candidate.get("object_type") == "etf" for candidate in candidates):
            _fail("non-insufficient comparison needs at least one ETF candidate")
        if not any(candidate.get("object_type") == "stock" for candidate in candidates):
            _fail("non-insufficient comparison needs at least one stock candidate")
    registered_etfs = {
        candidate.get("object_ref")
        for candidate in (item.get("etf_analysis") or {}).get("candidates", [])
        if isinstance(candidate, dict)
    }
    registered_categories = {
        category.get("category_ref")
        for category in item.get("stock_categories", [])
        if isinstance(category, dict)
    }
    for candidate in candidates:
        if candidate.get("object_type") == "etf" and candidate.get("object_ref") not in registered_etfs:
            _fail(f"ETF candidate not registered: {candidate.get('object_ref')}")
        if candidate.get("object_type") == "stock" and candidate.get("category_ref") not in registered_categories:
            _fail(f"stock candidate has unknown category: {candidate.get('object_ref')}")
        assessed = {
            assessment.get("dimension_ref")
            for assessment in candidate.get("dimension_assessments", [])
            if isinstance(assessment, dict)
        }
        if assessed != REQUIRED_DIMENSIONS:
            _fail(f"candidate dimension set mismatch: {candidate.get('object_ref')}")

    basis_dimensions = {
        basis.get("dimension")
        for basis in item.get("selection_edge_basis", [])
        if isinstance(basis, dict)
    }
    if edge in {"strong", "moderate"}:
        if len(basis_dimensions) < 2:
            _fail("strong/moderate edge needs at least two basis dimensions")
        if basis_dimensions <= {"price_performance", "turnover"}:
            _fail("strong/moderate edge cannot rely only on price or turnover")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_decision_comparison.py OUTPUT.yaml", file=sys.stderr)
        return 2
    payload = yaml.safe_load(Path(sys.argv[1]).read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict):
        _fail("YAML root must be an object")
    validate(payload)
    print("decision_comparison valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
