#!/usr/bin/env python3
"""Regression: 05 high-visibility prose must not paste 04 audit-register voice."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "governance/03_校验"))
from repo_paths import ensure_all_validator_paths  # noqa: E402

ensure_all_validator_paths()

from quality_gate_utils import (  # noqa: E402
    assert_caveat_is_semantic_label,
    assert_no_audit_register_voice,
)


class AuditRegisterVoiceTests(unittest.TestCase):
    def test_high_visibility_audit_voice_is_blocked(self) -> None:
        with self.assertRaises(Exception) as ctx:
            assert_no_audit_register_voice(
                "2027H2—2028 是供给验证窗口，不是确定结束日",
                "section_heading",
            )
        self.assertIn("审计登记腔", str(ctx.exception))

    def test_research_language_is_allowed(self) -> None:
        assert_no_audit_register_voice(
            "2027 下半年至 2028：先看新增供给能否真正放量",
            "section_heading",
        )

    def test_caveat_rejects_draft_prose(self) -> None:
        with self.assertRaises(Exception):
            assert_caveat_is_semantic_label(
                "只能作为条件式缓解窗口，不得写成确定结束日",
                "caveat",
            )
        assert_caveat_is_semantic_label("内部高位分化", "caveat")


if __name__ == "__main__":
    raise SystemExit(unittest.main())
