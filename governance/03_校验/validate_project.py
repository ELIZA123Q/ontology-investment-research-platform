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
    ("规则唯一权威", [sys.executable, "governance/03_校验/validate_rule_authority.py"]),
    ("规则归属负向回归", [sys.executable, "governance/03_校验/tests/test_rule_authority.py"]),
    ("业务参数单一权威", [sys.executable, "governance/03_校验/validate_parameter_authority.py"]),
    ("业务实例图回归", [sys.executable, "runtime/engine/tests/test_ontology_instance_graph.py"]),
    ("投研框架库", [sys.executable, "methods/02_判断结构/validate_frameworks.py"]),
    ("取证策略库", [sys.executable, "methods/03_取证/validate_03.py"]),
    ("唯一状态派生矩阵", [sys.executable, "governance/03_校验/status_derivation.py"]),
    ("判断裁决方法库", [sys.executable, "methods/04_裁决/validate_methods.py"]),
    ("研究价值评测契约", [sys.executable, "evaluation/03_执行/validate_eval_set.py"]),
    ("研究价值评测端到端", [sys.executable, "evaluation/03_执行/tests/test_eval_runtime.py"]),
    ("Ontology 3.0 双样例", [sys.executable, "governance/03_校验/validate_v3_samples.py"]),
    ("Ontology 3.0 样例负向回归", [sys.executable, "governance/03_校验/tests/test_v3_samples.py"]),
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

    print("\nPROJECT_PASS: Ontology 3.0、公共合同 1.3、知识库、运行回归及两个 run-002 样例全部通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
