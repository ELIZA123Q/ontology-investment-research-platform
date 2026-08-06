#!/usr/bin/env python3
"""Ensure stage packages and governance/03_校验 are importable after the directory split.

Also provides five-domain path resolution: prefer new write/read entries, fall back to
compat/legacy paths so validators do not fail solely because an old path moved.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = Path(__file__).resolve().parent
STAGE_DIRS = (
    RUN_DIR / "stage_validators" / "stage_01",
    RUN_DIR / "stage_validators" / "stage_02",
    RUN_DIR / "stage_validators" / "stage_03",
    RUN_DIR / "stage_validators" / "stage_04",
    RUN_DIR / "stage_validators" / "stage_05",
    # New paths
    ROOT / "runtime" / "skills" / "ontology",
    ROOT / "runtime" / "skills" / "evidence_evaluation",
    ROOT / "runtime" / "skills" / "financial_data",
    ROOT / "runtime" / "skills" / "model_client",
    ROOT / "runtime" / "agents" / "shared",
    ROOT / "runtime" / "runner",
    ROOT / "runtime" / "schemas",
)

# Stage YAML templates: methods/templates is write/read primary; runtime stage_specs is compat.
STAGE_YAML_TEMPLATES = {
    "02": (
        ROOT / "methods/templates/02_任务本体视图模板.yaml",
        ROOT / "runtime/workflow/stage_specs/02_结构/模板/02_任务本体视图模板.yaml",
        ROOT / "tasks/workflows/deep_research/templates/02_任务本体视图模板.yaml",
    ),
    "03": (
        ROOT / "methods/templates/03_语义域与证据域实例清单模板.yaml",
        ROOT / "runtime/workflow/stage_specs/03_证据/模板/03_语义域与证据域实例清单模板.yaml",
        ROOT / "tasks/workflows/deep_research/templates/03_语义域与证据域实例清单模板.yaml",
    ),
    "04": (
        ROOT / "methods/templates/04_推理审计模板.yaml",
        ROOT / "runtime/workflow/stage_specs/04_判断/模板/04_推理审计模板.yaml",
        ROOT / "tasks/workflows/deep_research/templates/04_推理审计模板.yaml",
    ),
}

STAGE_SPEC_SCAN_ROOTS = (
    ROOT / "tasks/workflows/deep_research",
    ROOT / "methods/templates",
    ROOT / "runtime/workflow/stage_specs/02_结构",
    ROOT / "runtime/workflow/stage_specs/03_证据",
    ROOT / "runtime/workflow/stage_specs/04_判断",
    ROOT / "runtime/workflow/stage_specs/05_表达",
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
