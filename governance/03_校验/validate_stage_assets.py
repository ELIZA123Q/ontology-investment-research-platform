#!/usr/bin/env python3
"""Validate that 02—05 specifications/templates implement the Ontology 3.0 chain."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = {
    "02": (ROOT / "methods/templates/02_任务本体视图模板.yaml", "3.0.0"),
    "03": (ROOT / "methods/templates/03_语义域与证据域实例清单模板.yaml", "3.0.0"),
    "04": (ROOT / "methods/templates/04_推理审计模板.yaml", "5.0.0"),
    "05": (ROOT / "methods/05_表达/templates/05_表达审计模板.yaml", "3.0.0"),
}
SPECS = {
    "02": ROOT / "tasks/workflows/deep_research/stages/02_structure.md",
    "03": ROOT / "tasks/workflows/deep_research/stages/03_evidence.md",
    "04": ROOT / "tasks/workflows/deep_research/stages/04_judgment.md",
    "05": ROOT / "tasks/workflows/deep_research/stages/05_delivery.md",
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
    if stage in {"02", "03", "04"} and "method_applications:" not in text:
        errors.append(f"stage {stage} template lacks canonical method_applications")
    if stage == "04":
        for field in ("condition_id", "expression", "input_refs", "outcome", "rationale"):
            if field not in text:
                errors.append(f"stage 04 RuleEvaluation template lacks {field}")
        if "condition_results: [matched]" in text or "matched: true" in text:
            errors.append("stage 04 template permits matched-only RuleEvaluation")
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
        text = path.read_text(encoding="utf-8")
        document = yaml.safe_load(text)
        if not isinstance(document, dict):
            errors.append(f"stage {stage} template root must be mapping")
            continue
        errors.extend(validate_template(stage, document, text, expected_schema))

    required_spec_markers = {
        "02": ("method_applications", "竞争解释", "不存在只列"),
        "03": ("EvidenceFact", "证据缺口", "不得用整个 EvidenceBasket"),
        "04": ("condition_result", "仅写 `matched` 不合格", "MethodApplication"),
        "05": ("EX → C", "递归拒绝", "只读子集"),
    }
    for stage, path in SPECS.items():
        text = path.read_text(encoding="utf-8")
        for marker in required_spec_markers[stage]:
            if marker not in text:
                errors.append(f"stage {stage} spec lacks required boundary marker {marker}")

    runtime_manifest = yaml.safe_load((ROOT / "runtime/workflow/templates/run_manifest.template.yaml").read_text(encoding="utf-8"))
    expected_runtime_versions = {
        "contract": "1.3.0", "ontology": "3.0.0", "stage_02_view_schema": "3.0.0",
        "stage_03_schema": "3.0.0", "stage_04_audit_schema": "5.0.0", "stage_05_audit_schema": "3.0.0",
    }
    versions = runtime_manifest.get("versions") or {}
    for field, expected in expected_runtime_versions.items():
        if str(versions.get(field)) != expected:
            errors.append(f"runtime manifest {field} must be {expected}")

    package_kinds = yaml.safe_load((ROOT / "governance/02_合同/package_kinds.yaml").read_text(encoding="utf-8"))
    for kind in (
        "formal_pack", "formal_delivery_pack", "research_audit_pack",
        "knowledge_baseline", "knowledge_task_slice", "semantic_fixture", "workbench_export",
    ):
        if kind not in (package_kinds.get("kinds") or {}):
            errors.append(f"package_kinds.yaml missing kind {kind}")

    contract = yaml.safe_load((ROOT / "governance/02_合同/public_contract.yaml").read_text(encoding="utf-8"))
    required_ma_fields = (contract.get("method_application_contract") or {}).get("required_fields") or []
    zod_text = (ROOT / "runtime/schemas/schemas.ts").read_text(encoding="utf-8")
    for field in required_ma_fields:
        if f"{field}:" not in zod_text:
            errors.append(f"runtime Zod schemas.ts missing MethodApplication field {field}")
    return errors


def main() -> int:
    errors = validate_repository()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"STAGE_ASSETS_RETURN_REQUIRED: {len(errors)} error(s)")
        return 1
    print("STAGE_ASSETS_PASS: 02—05 specs/templates use current schemas and structural MethodApplication/EvidenceFact projection")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
