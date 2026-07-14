#!/usr/bin/env python3
"""Ensure stage packages and 运行校验 are importable after the directory split."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN_DIR = Path(__file__).resolve().parent
STAGE_DIRS = (
    ROOT / "01_任务受理",
    ROOT / "02_判断结构",
    ROOT / "03_数据与证据",
    ROOT / "04_推理",
    ROOT / "05_表达交付",
)


def _insert(path: Path) -> None:
    text = str(path)
    if text not in sys.path:
        sys.path.insert(0, text)


def ensure_run_path() -> Path:
    _insert(RUN_DIR)
    return RUN_DIR


def ensure_stage_path(stage_dir: Path) -> Path:
    ensure_run_path()
    _insert(stage_dir)
    return stage_dir


def ensure_all_validator_paths() -> Path:
    ensure_run_path()
    for stage_dir in STAGE_DIRS:
        _insert(stage_dir)
    return ROOT
