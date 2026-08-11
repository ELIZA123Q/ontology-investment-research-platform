#!/usr/bin/env python3
"""运行项目当前正式验收链路。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

CHECKS = (
    ("Markdown 用语", [sys.executable, "05_control_evaluation/04_verifiers/validate_markdown_language.py"]),
    ("规范覆盖矩阵", [sys.executable, "05_control_evaluation/04_verifiers/validate_requirements_coverage.py"]),
    ("Ontology 统一校验", [sys.executable, "05_control_evaluation/04_verifiers/ontology/validate_ontology.py"]),
    ("Ontology 4.0 Runtime 投影防漂移", ["npm", "--prefix", "06_runtime", "run", "ontology:check"]),
    ("Ontology 负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_ontology_v3.py"]),
    ("直接迁移台账负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_migration_ledger.py"]),
    ("废弃关系名守卫", [sys.executable, "05_control_evaluation/04_verifiers/validate_deprecated_terms.py"]),
    ("本体元治理控制面", [sys.executable, "05_control_evaluation/04_verifiers/validate_governance_control_plane.py"]),
    ("本体元治理控制面负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_governance_control_plane.py"]),
    ("规则唯一权威", [sys.executable, "05_control_evaluation/04_verifiers/validate_rule_authority.py"]),
    ("规则归属负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_rule_authority.py"]),
    ("知识沉淀闭环机器合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_knowledge_learning_contract.py"]),
    ("Semantic↔Ontology 双写守卫", [sys.executable, "05_control_evaluation/04_verifiers/validate_no_semantic_ontology_double_write.py"]),
    ("统一方法资产", [sys.executable, "05_control_evaluation/04_verifiers/validate_method_assets.py"]),
    ("方法资产负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_method_assets.py"]),
    ("方法应用跨阶段合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_method_application_contract.py"]),
    ("方法应用合同负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_method_application_contract.py"]),
    ("02—05 当前规范与模板", [sys.executable, "05_control_evaluation/04_verifiers/validate_stage_assets.py"]),
    ("02—05 规范模板负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_stage_assets.py"]),
    ("包类型识别负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_package_kind.py"]),
    ("工作台导出包负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_workbench_package.py"]),
    ("正式包语义基线负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_semantic_baseline.py"]),
    (
        "真实工作台链冻结回归",
        [
            sys.executable,
            "05_control_evaluation/04_verifiers/validate_workbench_package.py",
            "05_control_evaluation/04_verifiers/fixtures/regression/01_tsmc-revenue-workbench",
        ],
    ),
    (
        "正式发布包黄金回归",
        [
            sys.executable,
            "05_control_evaluation/04_verifiers/validate_run.py",
            "05_control_evaluation/04_verifiers/fixtures/regression/02_memory-cycle-formal-pack",
        ],
    ),
    ("推理追溯合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_reasoning_trace_contract.py"]),
    ("推理追溯负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_reasoning_trace_contract.py"]),
    ("增量更新合同", [sys.executable, "05_control_evaluation/04_verifiers/validate_incremental_update_contract.py"]),
    ("增量更新合同负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_incremental_update_contract.py"]),
    ("业务参数单一权威", [sys.executable, "05_control_evaluation/04_verifiers/validate_parameter_authority.py"]),
    ("投研框架库", [sys.executable, "03_agent_capability/02_skills/research_design/references/validate.py"]),
    ("取证策略库", [sys.executable, "03_agent_capability/02_skills/evidence_research/references/validate_03.py"]),
    ("唯一状态派生矩阵", [sys.executable, "05_control_evaluation/04_verifiers/status_derivation.py"]),
    ("判断裁决方法库", [sys.executable, "03_agent_capability/02_skills/judgment_reasoning/references/validate_methods.py"]),
    ("研究价值评测契约", [sys.executable, "05_control_evaluation/05_evals/runners/validate_eval_set.py"]),
    ("研究价值评测协议烟测（mock，不代表研究质量）", [sys.executable, "05_control_evaluation/05_evals/runners/tests/test_eval_runtime.py"]),
    ("研究员体验前瞻队列合同", [sys.executable, "05_control_evaluation/05_evals/runners/validate_experience_cohort.py"]),
    ("研究员体验前瞻队列负向回归", [sys.executable, "05_control_evaluation/05_evals/runners/tests/test_experience_cohort.py"]),
    ("Ontology 3.0 双样例", [sys.executable, "05_control_evaluation/04_verifiers/validate_v3_samples.py"]),
    ("Ontology 3.0 样例负向回归", [sys.executable, "05_control_evaluation/04_verifiers/tests/test_v3_samples.py"]),
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
        "\nPROJECT_ENGINEERING_PASS: Ontology 3.0 只读兼容、Ontology 统一校验（已合并）、公共合同 1.3、知识库、运行回归、"
        "两个 run-002 样例、真实工作台链冻结回归、正式发布包黄金回归、mock 评测协议烟测及"
        "研究员体验前瞻队列合同全部通过。"
    )
    print(
        "FORMAL_RESEARCH_VALUE_NOT_ASSERTED: 本结果不代表真实模型的 R/U/delta/S/C、"
        "研究可靠率或正式研究增益已经通过。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
