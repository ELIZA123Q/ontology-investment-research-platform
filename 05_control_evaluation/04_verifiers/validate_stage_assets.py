#!/usr/bin/env python3
"""Validate remaining active delivery template assets (expression layer).

Deep Research 01–04 stage specs/templates have been retired with 90_legacy.
Stage 05 expression templates remain in the method library.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = {
    "05": (ROOT / "03_agent_capability/02_skills/research_delivery/templates/05_表达审计模板.yaml", "3.0.0"),
}
DEPRECATED_METHOD_FIELDS = {
    "method_application_candidates", "method_input_bindings", "method_application_register",
}
DEPRECATED_05_SELF_CHECKS = {
    "no_new_fact_created", "no_new_judgment_created", "no_method_status_changed",
}


def validate_template(stage: str, document: dict[str, Any], text: str, expected_schema: str) -> list[str]:
    errors: list[str] = []
    if str(document.get("schema_version")) != expected_schema:
        errors.append(f"stage {stage} template schema must be {expected_schema}")
    leaked = sorted(field for field in DEPRECATED_METHOD_FIELDS if f"{field}:" in text)
    if leaked:
        errors.append(f"stage {stage} template uses deprecated MethodApplication fields {leaked}")
    if stage == "05":
        leaked_checks = sorted(field for field in DEPRECATED_05_SELF_CHECKS if field in text)
        if leaked_checks:
            errors.append(f"stage 05 template uses deprecated self-certification {leaked_checks}")
        for field in ("source_rcs", "source_method_application_refs", "source_evidence_refs"):
            if field not in text:
                errors.append(f"stage 05 template lacks structural projection field {field}")
    return errors


def validate_repository() -> list[str]:
    errors: list[str] = []
    for stage, (path, expected_schema) in TEMPLATES.items():
        if not path.is_file():
            errors.append(f"missing template: {path.relative_to(ROOT)}")
            continue
        text = path.read_text(encoding="utf-8")
        document = yaml.safe_load(text)
        if not isinstance(document, dict):
            errors.append(f"stage {stage} template root must be mapping")
            continue
        errors.extend(validate_template(stage, document, text, expected_schema))

    package_kinds = yaml.safe_load((ROOT / "05_control_evaluation/01_rules/contracts/package_kinds.yaml").read_text(encoding="utf-8"))
    if not isinstance(package_kinds, dict):
        errors.append("package_kinds.yaml must be mapping")
    return errors


def main() -> int:
    errors = validate_repository()
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"FAIL: {len(errors)} errors")
        return 1
    print("PASS: active delivery template assets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
