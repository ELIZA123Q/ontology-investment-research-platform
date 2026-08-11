#!/usr/bin/env python3
"""运行项目当前正式验收链路。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

CHECKS = (
    ("Ontology 统一校验", [sys.executable, "05_control_evaluation/04_verifiers/ontology/validate_ontology.py"]),
    ("Ontology 4.0 Runtime 投影防漂移", ["npm", "--prefix", "06_runtime", "run", "ontology:check"]),
    ("本体元治理控制面", [sys.executable, "05_control_evaluation/04_verifiers/validate_governance_control_plane.py"]),
    ("本体元治理控制面负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_governance_control_plane.py"]),
    ("规则唯一权威", [sys.executable, "05_control_evaluation/04_verifiers/validate_rule_authority.py"]),
    ("规则归属负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_rule_authority.py"]),
    ("统一方法资产", [sys.executable, "05_control_evaluation/04_verifiers/validate_method_assets.py"]),
    ("方法资产负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_method_assets.py"]),
    ("方法应用跨阶段合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_method_application_contract.py"]),
    ("方法应用合同负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_method_application_contract.py"]),
    ("02—05 当前规范与模板", [sys.executable, "05_control_evaluation/04_verifiers/validate_stage_assets.py"]),
    ("工作台导出包负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_workbench_package.py"]),
    ("正式包语义基线负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_semantic_baseline.py"]),
    ("推理追溯合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_reasoning_trace_contract.py"]),
    ("推理追溯负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_reasoning_trace_contract.py"]),
    ("增量更新合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_incremental_update_contract.py"]),
    ("增量更新合同负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_incremental_update_contract.py"]),
    ("唯一状态派生矩阵", [sys.executable, "05_control_evaluation/04_verifiers/status_derivation.py"]),
    ("vNext 全量切换审计", ["npm", "--prefix", "06_runtime", "run", "audit:cutover"]),
    ("Runtime TypeScript 类型检查", ["npm", "--prefix", "06_runtime", "run", "typecheck"]),
    ("Runtime TypeScript 回归", ["npm", "--prefix", "06_runtime", "test"]),
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
        "\nPROJECT_ENGINEERING_PASS: Ontology 统一校验、当前合同、知识库、运行回归与"
        "工作台导出包负向校验全部通过。"
    )
    print(
        "FORMAL_RESEARCH_VALUE_NOT_ASSERTED: 本结果不代表真实模型的 R/U/delta/S/C、"
        "研究可靠率或正式研究增益已经通过。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
