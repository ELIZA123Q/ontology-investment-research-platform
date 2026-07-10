"""Canonical relative paths for 03 snapshot CSV files (schema 1.2.0)."""

from __future__ import annotations

from pathlib import Path

SCHEMA_VERSION_03 = "1.2.0"

SNAPSHOT_CSV_LAYOUT: dict[str, str] = {
    "manifest.csv": "manifest.csv",
    "evidence_requirements.csv": "01_plan/evidence_requirements.csv",
    "evidence_recipe_matches.csv": "01_plan/evidence_recipe_matches.csv",
    "evidence_baskets.csv": "01_plan/evidence_baskets.csv",
    "source_profiles.csv": "01_plan/source_profiles.csv",
    "acquisition_channels.csv": "01_plan/acquisition_channels.csv",
    "proxy_indicators.csv": "01_plan/proxy_indicators.csv",
    "source_snapshot.csv": "02_assets/source_snapshot.csv",
    "source_documents.csv": "02_assets/source_documents.csv",
    "acquisition_log.csv": "02_assets/acquisition_log.csv",
    "semantic_instances.csv": "02_assets/semantic_instances.csv",
    "semantic_relations.csv": "02_assets/semantic_relations.csv",
    "reasoning_inputs.csv": "02_assets/reasoning_inputs.csv",
    "evidence_records.csv": "02_assets/evidence_records.csv",
    "evidence_claims.csv": "02_assets/evidence_claims.csv",
    "evidence_facts.csv": "02_assets/evidence_facts.csv",
    "evidence_relations.csv": "02_assets/evidence_relations.csv",
    "evidence_assessments.csv": "02_assets/evidence_assessments.csv",
    "evidence_readiness_assessments.csv": "03_gate/evidence_readiness_assessments.csv",
    "judgment_unit_readiness.csv": "03_gate/judgment_unit_readiness.csv",
    "state_variable_coverage.csv": "03_gate/state_variable_coverage.csv",
    "path_readiness.csv": "03_gate/path_readiness.csv",
    "gaps_and_risks.csv": "03_gate/gaps_and_risks.csv",
    "display_data_candidates.csv": "04_05_materials/display_data_candidates.csv",
    "chart_data_package.csv": "04_05_materials/chart_data_package.csv",
    "table_material_package.csv": "04_05_materials/table_material_package.csv",
    "source_annotation_package.csv": "04_05_materials/source_annotation_package.csv",
    "05_material_readiness.csv": "04_05_materials/05_material_readiness.csv",
}

REQUIRED_SNAPSHOT_CSV_FILES = list(SNAPSHOT_CSV_LAYOUT.keys())

LEGACY_SNAPSHOT_NAMES = {
    "judgment_unit_readiness.csv": "judgment_unit_readiness.csv",
}


def snapshot_csv_path(snapshot_dir: Path, logical_name: str) -> Path:
    """Resolve the canonical 1.2 path, with a read-only fallback for 1.0/1.1 runs."""
    # evidence_records 是为 04/05 和历史运行保留的兼容投影；
    # judgment_unit_readiness 是 J0—J4 判断强度门。它们仍以快照根目录为运行位置。
    if logical_name in {"evidence_records.csv", "judgment_unit_readiness.csv"}:
        runtime = snapshot_dir / logical_name
        if runtime.is_file():
            return runtime
    canonical = snapshot_dir / SNAPSHOT_CSV_LAYOUT[logical_name]
    if canonical.exists():
        return canonical
    legacy = snapshot_dir / logical_name
    if legacy.exists():
        return legacy
    legacy_alias = snapshot_dir / LEGACY_SNAPSHOT_NAMES.get(logical_name, "")
    return legacy_alias if legacy_alias.is_file() else canonical
