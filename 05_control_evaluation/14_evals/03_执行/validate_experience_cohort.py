#!/usr/bin/env python3
"""Validate the prospective researcher-experience baseline cohort."""

from __future__ import annotations

import argparse
from pathlib import Path

from experience_cohort import (
    DEFAULT_COHORT_PATH,
    ExperienceCohortError,
    load_cohort,
    validate_cohort,
    validate_database_bindings,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort", type=Path, default=DEFAULT_COHORT_PATH)
    parser.add_argument("--db", type=Path)
    parser.add_argument("--require-ready", action="store_true")
    args = parser.parse_args()
    try:
        cohort = load_cohort(args.cohort)
        summary = validate_cohort(cohort)
        db_summary = validate_database_bindings(cohort, args.db) if args.db else None
    except (OSError, ExperienceCohortError) as error:
        print(f"EXPERIENCE_COHORT_RETURN_REQUIRED: {error}")
        return 1

    print(
        "EXPERIENCE_COHORT_CONTRACT_PASS: "
        f"cases={summary['case_count']}, completed={summary['completed_count']}, "
        "prospective events + paired same-evidence baseline + quality guardrails locked."
    )
    if db_summary:
        print(
            "EXPERIENCE_COHORT_DB_PASS: "
            f"bound={db_summary['bound_count']}, completed={db_summary['completed_count']}"
        )
    completed_count = db_summary["completed_count"] if db_summary else summary["completed_count"]
    baseline_ready = completed_count >= summary["target_gate"]
    if not baseline_ready:
        print(
            "EXPERIENCE_BASELINE_NOT_READY: "
            f"completed={completed_count}/{summary['target_gate']}; "
            "不得设置目标或声称流程增益已验证。"
        )
        return 2 if args.require_ready else 0
    print("EXPERIENCE_BASELINE_READY: 已达到目标设置与配对分析的最低案例数。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
