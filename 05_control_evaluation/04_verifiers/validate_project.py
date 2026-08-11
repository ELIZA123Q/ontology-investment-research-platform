#!/usr/bin/env python3
"""运行项目当前正式验收链路。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

CHECKS = (
    ("研究问题图合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_scenario_task_graph.py"]),
    ("Ontology 统一校验", [sys.executable, "05_control_evaluation/04_verifiers/ontology/validate_ontology.py"]),
    ("Ontology Runtime 投影防漂移", ["npm", "--prefix", "06_runtime", "run", "ontology:check"]),
    ("本体禁止双写", [sys.executable, "05_control_evaluation/04_verifiers/validate_no_semantic_ontology_double_write.py"]),
    ("规则唯一权威", [sys.executable, "05_control_evaluation/04_verifiers/validate_rule_authority.py"]),
    ("规则归属负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_rule_authority.py"]),
    ("统一方法资产", [sys.executable, "05_control_evaluation/04_verifiers/validate_method_assets.py"]),
    ("方法资产负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_method_assets.py"]),
    ("知识沉淀合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_knowledge_learning_contract.py"]),
    ("连接器与本体映射合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_connector_mapping_contract.py"]),
    ("vNext 全量切换审计", ["npm", "--prefix", "06_runtime", "run", "audit:cutover"]),
    ("代表性研究任务合同回归", ["npm", "--prefix", "06_runtime", "run", "eval:gold"]),
    ("30 个研究价值冻结夹具", ["npm", "--prefix", "06_runtime", "run", "eval:research:fixtures"]),
    ("正式评测候选证据门", ["npm", "--prefix", "06_runtime", "run", "eval:formal:candidates"]),
    ("Runtime TypeScript 类型检查", ["npm", "--prefix", "06_runtime", "run", "typecheck"]),
    ("Runtime TypeScript 回归", ["npm", "--prefix", "06_runtime", "test"]),
    ("Runtime 生产构建", ["npm", "--prefix", "06_runtime", "run", "build"]),
)


def main() -> int:
    failures: list[str] = []
    for label, command in CHECKS:
        print(f"\n[校验] {label}", flush=True)
        completed = subprocess.run(command, cwd=ROOT, check=False)
        if completed.returncode:
            failures.append(label)

    if failures:
        print("\nPROJECT_RETURN_REQUIRED: " + "、".join(failures))
        return 1

    print(
        "\nPROJECT_ENGINEERING_PASS: Ontology、规则权威、方法资产、知识闭环、"
        "vNext Runtime 回归与生产构建全部通过。"
    )
    print(
        "FORMAL_RESEARCH_VALUE_NOT_ASSERTED: 本结果不代表真实模型的 R/U/delta/S/C、"
        "研究可靠率或正式研究增益已经通过。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
