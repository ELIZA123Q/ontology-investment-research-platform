#!/usr/bin/env python3
"""Ensure stage packages and governance/03_校验 are importable after the directory split."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = Path(__file__).resolve().parent
STAGE_DIRS = (
    RUN_DIR / "stages" / "stage_01",
    RUN_DIR / "stages" / "stage_02",
    RUN_DIR / "stages" / "stage_03",
    RUN_DIR / "stages" / "stage_04",
    RUN_DIR / "stages" / "stage_05",
    ROOT / "runtime" / "engine",
    ROOT / "runtime" / "adapters",
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
