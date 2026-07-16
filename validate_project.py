#!/usr/bin/env python3
"""运行项目当前正式验收链路。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent

CHECKS = (
    ("Markdown 用语", [sys.executable, "validate_markdown_language.py"]),
    ("规范覆盖矩阵", [sys.executable, "运行校验/validate_requirements_coverage.py"]),
    ("一级通用本体", [sys.executable, "一级通用本体规范/validate_schema.py"]),
    ("业务参数单一权威", [sys.executable, "运行校验/validate_parameter_authority.py"]),
    ("业务实例图回归", [sys.executable, "运行校验/tests/test_ontology_instance_graph.py"]),
    ("运行实例图回归", [sys.executable, "运行校验/tests/test_runtime_instance_graph.py"]),
    ("投研框架库", [sys.executable, "知识库_02框架/validate_frameworks.py"]),
    ("取证策略库", [sys.executable, "知识库_03取证/validate_03.py"]),
    ("唯一状态派生矩阵", [sys.executable, "运行校验/status_derivation.py"]),
    ("本体证据闭环回归", [sys.executable, "运行校验/tests/test_research_loop.py"]),
    ("可控研究链对抗测试", [sys.executable, "运行校验/tests/test_controlled_chain.py"]),
    ("范围聚合发布门禁回归", [sys.executable, "运行校验/tests/test_scope_aggregation_release.py"]),
    ("推理方法库", [sys.executable, "知识库_04推理/validate_methods.py"]),
    ("研究价值评测契约", [sys.executable, "评测集/validate_eval_set.py"]),
    ("研究价值评测端到端", [sys.executable, "评测集/runtime/tests/test_eval_runtime.py"]),
    ("存储芯片周期基线验收样例", [sys.executable, "运行校验/validate_run.py", "示例1-基线-20260713-1", "--no-write"]),
    ("存储芯片周期增量验收样例", [sys.executable, "运行校验/validate_run.py", "示例1", "--no-write"]),
    ("国产设备替代基线验收样例", [sys.executable, "运行校验/validate_run.py", "示例2-基线-20260710-1", "--no-write"]),
    ("国产设备替代验收样例", [sys.executable, "运行校验/validate_run.py", "示例2", "--no-write"]),
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

    print("\nPROJECT_PASS: Markdown 用语、本体、知识库、研究价值评测契约与端到端测试、校验器及四个 01—05 验收样例全部通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
