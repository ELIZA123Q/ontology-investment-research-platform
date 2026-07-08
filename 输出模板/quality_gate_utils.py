#!/usr/bin/env python3
"""Quality-gate helpers shared by the output-template validators."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from validator_utils import fail


QUALITY_STATUSES = {
    "draft",
    "minimum_pass",
    "high_quality_pass",
    "return_required",
    "stop_with_gap_report",
}


ADMISSIONS = {
    "normal_pass",
    "restricted_pass",
    "incomplete_pass",
    "failed",
}


ALLOWED_04_OUTPUTS = {
    "full_reasoning_ready",
    "directional_only",
    "conditional_only",
    "insufficient",
    "blocked",
    "contested",
}


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def validate_quality_status(value: Any, label: str) -> None:
    if str(value) not in QUALITY_STATUSES:
        fail(f"{label}.quality_status 非法: {value}")


def validate_admission(value: Any, label: str) -> None:
    if str(value) not in ADMISSIONS:
        fail(f"{label}.admission 非法: {value}")


def validate_allowed_04_output(value: Any, label: str) -> None:
    if str(value) not in ALLOWED_04_OUTPUTS:
        fail(f"{label}.allowed_04_output 非法: {value}")


def output_rank(value: str) -> int:
    return {
        "blocked": 0,
        "insufficient": 1,
        "contested": 1,
        "conditional_only": 2,
        "directional_only": 3,
        "full_reasoning_ready": 4,
    }.get(value, -1)
