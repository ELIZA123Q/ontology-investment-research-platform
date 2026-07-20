#!/usr/bin/env python3
"""运行项目当前正式验收链路。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

CHECKS = (
    ("Markdown 用语", [sys.executable, "governance/03_校验/validate_markdown_language.py"]),
    ("规范覆盖矩阵", [sys.executable, "governance/03_校验/validate_requirements_coverage.py"]),
    ("Ontology 3.0 冻结门", [sys.executable, "ontology/01_通用/validate_v3.py"]),
    ("Ontology 3.0 负向回归", [sys.executable, "governance/03_校验/tests/test_ontology_v3.py"]),
    ("直接迁移台账负向回归", [sys.executable, "governance/03_校验/tests/test_migration_ledger.py"]),
    ("规则唯一权威", [sys.executable, "governance/03_校验/validate_rule_authority.py"]),
    ("规则归属负向回归", [sys.executable, "governance/03_校验/tests/test_rule_authority.py"]),
    ("统一方法资产", [sys.executable, "governance/03_校验/validate_method_assets.py"]),
    ("方法资产负向回归", [sys.executable, "governance/03_校验/tests/test_method_assets.py"]),
    ("方法应用跨阶段合同", [sys.executable, "governance/03_校验/validate_method_application_contract.py"]),
    ("方法应用合同负向回归", [sys.executable, "governance/03_校验/tests/test_method_application_contract.py"]),
    ("02—05 当前规范与模板", [sys.executable, "governance/03_校验/validate_stage_assets.py"]),
    ("02—05 规范模板负向回归", [sys.executable, "governance/03_校验/tests/test_stage_assets.py"]),
    ("包类型识别负向回归", [sys.executable, "governance/03_校验/tests/test_package_kind.py"]),
    ("工作台导出包负向回归", [sys.executable, "governance/03_校验/tests/test_workbench_package.py"]),
    (
        "真实工作台链冻结回归",
        [
            sys.executable,
            "governance/03_校验/validate_workbench_package.py",
            "instances/03_回归/01_tsmc-revenue-workbench",
        ],
    ),
    ("推理追溯合同", [sys.executable, "governance/03_校验/validate_reasoning_trace_contract.py"]),
    ("推理追溯负向回归", [sys.executable, "governance/03_校验/tests/test_reasoning_trace_contract.py"]),
    ("增量更新合同", [sys.executable, "governance/03_校验/validate_incremental_update_contract.py"]),
    ("增量更新合同负向回归", [sys.executable, "governance/03_校验/tests/test_incremental_update_contract.py"]),
    ("业务参数单一权威", [sys.executable, "governance/03_校验/validate_parameter_authority.py"]),
    ("业务实例图回归", [sys.executable, "runtime/engine/tests/test_ontology_instance_graph.py"]),
    ("投研框架库", [sys.executable, "methods/02_判断结构/validate_frameworks.py"]),
    ("取证策略库", [sys.executable, "methods/03_取证/validate_03.py"]),
    ("唯一状态派生矩阵", [sys.executable, "governance/03_校验/status_derivation.py"]),
    ("判断裁决方法库", [sys.executable, "methods/04_裁决/validate_methods.py"]),
    ("研究价值评测契约", [sys.executable, "evaluation/03_执行/validate_eval_set.py"]),
    ("研究价值评测协议烟测（mock，不代表研究质量）", [sys.executable, "evaluation/03_执行/tests/test_eval_runtime.py"]),
    ("Ontology 3.0 双样例", [sys.executable, "governance/03_校验/validate_v3_samples.py"]),
    ("Ontology 3.0 样例负向回归", [sys.executable, "governance/03_校验/tests/test_v3_samples.py"]),
    ("Runtime TypeScript 类型检查", ["npm", "--prefix", "runtime", "run", "typecheck"]),
    ("Runtime TypeScript 回归", ["npm", "--prefix", "runtime", "test"]),
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
        "\nPROJECT_ENGINEERING_PASS: Ontology 3.0、公共合同 1.3、知识库、运行回归、"
        "两个 run-002 样例、真实工作台链冻结回归及 mock 评测协议烟测全部通过。"
    )
    print(
        "FORMAL_RESEARCH_VALUE_NOT_ASSERTED: 本结果不代表真实模型的 R/U/delta/S/C、"
        "研究可靠率或正式研究增益已经通过。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
