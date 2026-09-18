#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "governance/03_校验/validate_ceo_strategy_report.py"
spec = importlib.util.spec_from_file_location("validate_ceo_strategy_report", VALIDATOR)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


GOOD_REPORT = """<!-- ceo_strategy_report: true -->
# 华泰资管的核心问题不是规模，而是收入质量能否穿越低费率周期

## 摘要
- **核心结论：** 华泰需要从规模导向转向收入质量导向。
- **战略优先级：** 投行资管、绝对收益和公募结构升级应排在前三位。

## 一、华泰资管的核心矛盾已经从规模增长转向收入质量
华泰资管的主要问题不是有没有增长，而是增长能否转化为稳定利润。ABS、REITs 和 ETF 规模能够带来市场地位，但低费率环境会压缩简单规模扩张的收益。

## 二、投行资管优势成立，因为华泰控制了资产端组织能力
华泰的优势来自投行项目源、结构设计和机构资金匹配。这个组合比单一产品发行更难复制。

| 优势来源 | 机制 | 证据 | 可持续性 | 失效条件 |
|---|---|---|---|---|
| 投行项目源 | 资产组织能力转化为产品供给 | 项目承揽和结构设计能力 | 需要持续项目储备 | 若优质资产不足则失效 |

## 三、公募端的短板在于产品结构对费率和申赎更敏感
华泰柏瑞需要降低单一 ETF 波动对收入的影响。红利、科技主题和主动能力需要形成更均衡的产品矩阵。

## 四、下一阶段胜负手是把客户入口转成配置关系
PB、托管和财富客户只有转化为持续配置关系，才能成为资管生态优势。否则它们只是服务规模，而不是战略壁垒。

## 五、未来十二个月应优先推进三项动作
第一项动作是把 ABS/REITs 从发行优势升级为资产运营能力。第二项动作是建立绝对收益产品线。第三项动作是修复公募产品结构。

## 附录：口径、过程与来源
- 研究对象为华泰证券集团大资管业务。
"""


class CeoStrategyReportTests(unittest.TestCase):
    def test_good_report_passes(self) -> None:
        self.assertEqual(validator.validate_text(GOOD_REPORT), [])

    def test_template_passes(self) -> None:
        template = (ROOT / "delivery/02_模板/05F_CEO战略报告模板.md").read_text(encoding="utf-8")
        self.assertEqual(validator.validate_text(template), [])

    def test_process_heading_is_rejected_in_body(self) -> None:
        bad = GOOD_REPORT.replace("## 一、华泰资管的核心矛盾已经从规模增长转向收入质量", "## 一、研究问题与结论边界")
        self.assertTrue(any("process/disclaimer" in error for error in validator.validate_text(bad)))

    def test_missing_template_marker_is_rejected(self) -> None:
        bad = GOOD_REPORT.replace("<!-- ceo_strategy_report: true -->\n", "")
        self.assertTrue(any("missing required marker" in error for error in validator.validate_text(bad)))

    def test_causal_clarity_marker_is_required(self) -> None:
        bad = GOOD_REPORT.replace(" | 失效条件 |", " | 风险边界 |").replace(" | 若优质资产不足则失效 |", " | 资产不足时削弱 |")
        self.assertTrue(any("causal clarity marker" in error for error in validator.validate_text(bad)))


if __name__ == "__main__":
    unittest.main()
