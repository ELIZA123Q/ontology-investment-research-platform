from __future__ import annotations

import csv
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = ROOT / "输出模板"
sys.path.insert(0, str(TEMPLATES))

from quality_gate_utils import validate_target_claim_level  # noqa: E402
from validate_03_outputs import validate as validate_03  # noqa: E402
from validate_04_outputs import validate as validate_04  # noqa: E402
from validate_05_outputs import validate as validate_05  # noqa: E402
from validate_publish import validate_publish  # noqa: E402


class JudgmentStrengthContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.run = Path(self.temp.name) / "示例2"
        shutil.copytree(ROOT / "示例2", self.run)
        self.snapshot = next(path for path in self.run.glob("*数据与证据快照-*") if path.is_dir())
        self.prep = next(self.run.glob("*数据与证据准备-*.md"))
        self.report = next(self.run.glob("*推理报告-*.md"))
        self.audit = next(self.run.glob("*推理审计-*.yaml"))
        self.delivery = next(self.run.glob("05-*主题深度研究-*.md"))
        self.expression_audit = next(self.run.glob("05-*表达审计-*.yaml"))

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def load_yaml(path: Path) -> dict:
        return yaml.safe_load(path.read_text(encoding="utf-8-sig"))

    @staticmethod
    def save_yaml(path: Path, value: dict) -> None:
        path.write_text(yaml.safe_dump(value, allow_unicode=True, sort_keys=False), encoding="utf-8")

    @staticmethod
    def mutate_csv(path: Path, mutate) -> None:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            fields = list(reader.fieldnames or [])
            rows = list(reader)
        mutate(rows)
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    def test_full_v2_chain_passes(self) -> None:
        result = validate_publish(self.run, through="05", require_high_quality=False)
        self.assertEqual(result["publish_status"], "PUBLISHABLE")

    def test_prediction_cannot_reach_j4(self) -> None:
        with self.assertRaisesRegex(ValueError, "不得达到 J4"):
            validate_target_claim_level("forecast", "J4", "test")

    def test_j3_requires_two_independent_source_groups(self) -> None:
        evidence_path = self.snapshot / "02_assets/evidence_records.csv"
        readiness_path = self.snapshot / "03_gate/judgment_unit_readiness.csv"

        def collapse_groups(rows):
            for row in rows:
                if "JU-04" in row["linked_judgment_unit_ids"].split("|"):
                    row["independence_group_id"] = "ONE-GROUP"

        def update_count(rows):
            for row in rows:
                row["independent_source_group_count"] = "1"

        self.mutate_csv(evidence_path, collapse_groups)
        self.mutate_csv(readiness_path, update_count)
        with self.assertRaisesRegex(ValueError, "J3.*要求|J3 未满足"):
            validate_03(self.prep, self.snapshot)

    def test_j2_requires_direct_support(self) -> None:
        evidence_path = self.snapshot / "02_assets/evidence_records.csv"

        def remove_direct_support(rows):
            for row in rows:
                if "JU-02" in row["linked_judgment_unit_ids"].split("|"):
                    row["directness"] = "indirect"

        self.mutate_csv(evidence_path, remove_direct_support)
        with self.assertRaisesRegex(ValueError, "J2 至少需要"):
            validate_03(self.prep, self.snapshot)

    def test_contested_is_capped_at_j1(self) -> None:
        readiness_path = self.snapshot / "03_gate/judgment_unit_readiness.csv"

        def contest_j2(rows):
            for row in rows:
                if row["judgment_unit_id"] == "JU-02":
                    row["judgment_status"] = "contested"

        self.mutate_csv(readiness_path, contest_j2)
        with self.assertRaisesRegex(ValueError, "contested"):
            validate_03(self.prep, self.snapshot)

    def test_04_cannot_exceed_03(self) -> None:
        audit = self.load_yaml(self.audit)
        claim = next(item for item in audit["claim_register"] if item["claim_id"] == "C-02")
        claim["actual_judgment_level"] = "J3"
        self.save_yaml(self.audit, audit)
        with self.assertRaisesRegex(ValueError, "超过 03 判断上限"):
            validate_04(self.report, self.audit, self.snapshot)

    def test_04_downgrade_requires_reason(self) -> None:
        audit = self.load_yaml(self.audit)
        claim = next(item for item in audit["claim_register"] if item["claim_id"] == "C-02")
        claim["actual_judgment_level"] = "J1"
        claim["downgrade_reason"] = ""
        self.save_yaml(self.audit, audit)
        with self.assertRaisesRegex(ValueError, "主动降级"):
            validate_04(self.report, self.audit, self.snapshot)

    @staticmethod
    def investment_thesis_verdict() -> dict:
        return {
            "applicable": True,
            "applicability_reason": "01 要求形成投资观点",
            "source_claim_refs": ["C-02", "C-03"],
            "source_a08_claim_refs": ["C-02"],
            "source_a09_claim_refs": ["C-03"],
            "target_asset": "半导体设备上市公司组合",
            "time_window": "未来 2—4 个季度",
            "gate_results": {
                "research_validity": "pass",
                "expectation_comparability": "pass",
                "pricing_not_fully_reflected": "pass",
                "payoff_risk_asymmetry": "pass",
                "validation_window": "pass",
            },
            "priced_in_assessment": "partially_priced",
            "base_case": "基准情景",
            "upside_case": "上行情景",
            "downside_case": "下行情景",
            "catalyst_or_validation_signals": ["订单和收入验证"],
            "strongest_counterevidence": "国产验证周期长于预期",
            "verdict": "formed",
            "judgment_level": "J3",
            "confidence": "medium",
            "verdict_reason": "五道裁决门通过",
            "invalidation_conditions": ["订单连续两季度不达基线"],
            "handoff_to_05": "investment_spine_allowed",
        }

    def test_a10_cannot_reach_j4(self) -> None:
        audit = self.load_yaml(self.audit)
        audit["investment_thesis_verdict"] = self.investment_thesis_verdict()
        audit["investment_thesis_verdict"]["judgment_level"] = "J4"
        self.save_yaml(self.audit, audit)
        with self.assertRaisesRegex(ValueError, "A10.*J4"):
            validate_04(self.report, self.audit, self.snapshot)

    def test_a10_formed_requires_all_five_gates(self) -> None:
        audit = self.load_yaml(self.audit)
        audit["investment_thesis_verdict"] = self.investment_thesis_verdict()
        audit["investment_thesis_verdict"]["gate_results"]["payoff_risk_asymmetry"] = "conditional"
        self.save_yaml(self.audit, audit)
        with self.assertRaisesRegex(ValueError, "五道裁决门"):
            validate_04(self.report, self.audit, self.snapshot)

    def test_judgment_update_must_match_current_claim_level(self) -> None:
        audit = self.load_yaml(self.audit)
        audit["judgment_update_register"] = [{
            "update_id": "UPDATE-01",
            "claim_id": "C-02",
            "prior_judgment_level": "J1",
            "prior_confidence": "low",
            "evidence_changes": ["新增直接证据"],
            "affected_structure": ["决定性前提"],
            "current_judgment_level": "J3",
            "current_confidence": "medium",
            "update_action": "enhance",
            "update_reason": "关键前提得到独立验证",
            "source_03_maximum_judgment_level": "J3",
            "next_upgrade_signals": [],
            "next_downgrade_or_block_signals": ["订单不达基线"],
        }]
        self.save_yaml(self.audit, audit)
        with self.assertRaisesRegex(ValueError, "当前等级.*C-02"):
            validate_04(self.report, self.audit, self.snapshot)

    def test_05_cannot_upgrade_expression(self) -> None:
        audit = self.load_yaml(self.expression_audit)
        expression = next(item for item in audit["claim_expression_register"] if item["expression_id"] == "EX-05")
        expression["expression_judgment_level"] = "J3"
        self.save_yaml(self.expression_audit, audit)
        with self.assertRaisesRegex(ValueError, "05 表达等级"):
            validate_05(self.delivery, "主题深度研究", self.expression_audit, self.audit)

    def test_05_must_preserve_conditions_and_scope(self) -> None:
        expression_audit = self.load_yaml(self.expression_audit)
        expression = next(item for item in expression_audit["claim_expression_register"] if item["expression_id"] == "EX-06")
        expression["scope_relation"] = "broader"
        expression["conditions_preserved"] = False
        self.save_yaml(self.expression_audit, expression_audit)
        with self.assertRaisesRegex(ValueError, "conditions_preserved|scope_relation"):
            validate_05(self.delivery, "主题深度研究", self.expression_audit, self.audit)

    def test_title_cannot_claim_j4_over_j3_source(self) -> None:
        audit = self.load_yaml(self.expression_audit)
        title = next(item for item in audit["claim_expression_register"] if item["location_kind"] == "report_title")
        title["expression_judgment_level"] = "J4"
        self.save_yaml(self.expression_audit, audit)
        with self.assertRaisesRegex(ValueError, "05 表达等级"):
            validate_05(self.delivery, "主题深度研究", self.expression_audit, self.audit)

    def test_05_must_register_every_investment_point(self) -> None:
        audit = self.load_yaml(self.expression_audit)
        audit["claim_expression_register"] = [
            item
            for item in audit["claim_expression_register"]
            if item["expression_id"] != "EX-15"
        ]
        self.save_yaml(self.expression_audit, audit)
        with self.assertRaisesRegex(ValueError, "投资要点.*未逐条登记"):
            validate_05(self.delivery, "主题深度研究", self.expression_audit, self.audit)


if __name__ == "__main__":
    unittest.main()
