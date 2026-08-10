#!/usr/bin/env python3
"""Ensure stage packages and 05_control_evaluation/03_校验 are importable after the directory split.

Also provides five-domain path resolution: prefer new write/read entries, fall back to
compat/legacy paths so validators do not fail solely because an old path moved.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = Path(__file__).resolve().parent
STAGE_DIRS = (
    # SSOT: stages/; stage_validators/ must stay hash-identical (see validate_stage_validator_mirrors.py)
    RUN_DIR / "stages" / "stage_01",
    RUN_DIR / "stages" / "stage_02",
    RUN_DIR / "stages" / "stage_03",
    RUN_DIR / "stages" / "stage_04",
    RUN_DIR / "stages" / "stage_05",
    RUN_DIR / "stage_validators" / "stage_01",
    RUN_DIR / "stage_validators" / "stage_02",
    RUN_DIR / "stage_validators" / "stage_03",
    RUN_DIR / "stage_validators" / "stage_04",
    RUN_DIR / "stage_validators" / "stage_05",
    ROOT / "05_control_evaluation" / "03_校验" / "knowledge_graph",
    ROOT / "05_control_evaluation" / "03_校验" / "legacy_compat",
    ROOT / "05_control_evaluation" / "03_校验",
)

# Stage YAML templates: 02_scenario_task/04_workflows/deep_research/templates is the sole write/read primary.
STAGE_YAML_TEMPLATES = {
    "02": (
        ROOT / "02_scenario_task/04_workflows/deep_research/templates/02_任务本体视图模板.yaml",
    ),
    "03": (
        ROOT / "02_scenario_task/04_workflows/deep_research/templates/03_语义域与证据域实例清单模板.yaml",
    ),
    "04": (
        ROOT / "02_scenario_task/04_workflows/deep_research/templates/04_推理审计模板.yaml",
    ),
}

STAGE_SPEC_SCAN_ROOTS = (
    ROOT / "02_scenario_task/04_workflows/deep_research",
    ROOT / "02_scenario_task/04_workflows/deep_research/templates",
)


def _insert(path: Path) -> None:
    text = str(path)
    if text not in sys.path:
        sys.path.insert(0, text)


def ensure_run_path() -> Path:
    _insert(RUN_DIR)
    for stage_dir in STAGE_DIRS:
        _insert(stage_dir)
    return RUN_DIR


def ensure_stage_path(stage_dir: Path) -> Path:
    ensure_run_path()
    _insert(stage_dir)
    return stage_dir


def ensure_all_validator_paths() -> Path:
    ensure_run_path()
    return ROOT


def resolve_existing(*candidates: Path) -> Path | None:
    """Return the first existing path among candidates (new → compat order)."""
    for path in candidates:
        if path.is_file() or path.is_dir():
            return path
    return None


def require_existing(*candidates: Path) -> Path:
    found = resolve_existing(*candidates)
    if found is None:
        joined = ", ".join(str(path.relative_to(ROOT)) if path.is_absolute() and ROOT in path.parents else str(path) for path in candidates)
        raise FileNotFoundError(f"asset not found in any candidate path: {joined}")
    return found


def stage_yaml_template(stage: str) -> Path:
    candidates = STAGE_YAML_TEMPLATES.get(stage)
    if not candidates:
        raise KeyError(f"unknown stage yaml template key: {stage}")
    return require_existing(*candidates)


def resolve_asset_rel(*relative_candidates: str) -> tuple[Path, str] | None:
    """Resolve first existing repo-relative candidate.

    Returns (absolute_path, relative_hit) or None.
    """
    for rel in relative_candidates:
        path = ROOT / rel
        if path.is_file() or path.is_dir():
            return path, rel.replace("\\", "/")
    return None


def require_asset_rel(*relative_candidates: str) -> tuple[Path, str]:
    found = resolve_asset_rel(*relative_candidates)
    if found is None:
        joined = ", ".join(relative_candidates)
        raise FileNotFoundError(f"asset not found in any candidate path: {joined}")
    return found


# Ontology human-readable entry (no parallel 00–03 prose specs).
ONTOLOGY_PROSE_ASSET_CANDIDATES: dict[str, tuple[str, ...]] = {
    "README.md": (
        "01_semantic_knowledge/01_ontology/README.md",
    ),
}

# Backward-compatible alias; dictionary no longer hosts ontology prose.
DICTIONARY_ASSET_CANDIDATES = ONTOLOGY_PROSE_ASSET_CANDIDATES

# Ontology machine YAML: 01_semantic_knowledge/01_ontology is write/read truth.
ONTOLOGY_MODEL_CANDIDATES = (
    "01_semantic_knowledge/01_ontology/models",
    "01_semantic_knowledge/01_ontology/models",
)
