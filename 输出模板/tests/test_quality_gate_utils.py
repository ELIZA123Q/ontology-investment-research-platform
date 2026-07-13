"""质量门槛公共函数的最小回归测试。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


TEMPLATE_ROOT = Path(__file__).resolve().parents[1]
if str(TEMPLATE_ROOT) not in sys.path:
    sys.path.insert(0, str(TEMPLATE_ROOT))

from quality_gate_utils import (  # noqa: E402
    is_nullish,
    judgment_level_rank,
    output_rank,
    validate_allowed_04_output,
)


class QualityGateUtilsTest(unittest.TestCase):
    def test_nullish_values(self) -> None:
        self.assertTrue(is_nullish(None))
        self.assertTrue(is_nullish("  "))
        self.assertTrue(is_nullish("~"))
        self.assertFalse(is_nullish(0))
        self.assertFalse(is_nullish("J0"))

    def test_output_and_judgment_orders(self) -> None:
        self.assertLess(output_rank("blocked"), output_rank("conditional_only"))
        self.assertLess(output_rank("conditional_only"), output_rank("full_reasoning_ready"))
        self.assertLess(judgment_level_rank("J1"), judgment_level_rank("J3"))

    def test_allowed_04_output_validation(self) -> None:
        validate_allowed_04_output("directional_only", "test")
        with self.assertRaises(ValueError):
            validate_allowed_04_output("unsupported_output", "test")


if __name__ == "__main__":
    unittest.main()
