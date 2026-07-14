#!/usr/bin/env python3
"""运行项目当前正式验收链路。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent

CHECKS = (
    ("Markdown 用语", [sys.executable, "validate_markdown_language.py"]),
    ("一级通用本体", [sys.executable, "一级通用本体规范/validate_schema.py"]),
    ("投研框架库", [sys.executable, "知识库_02框架/validate_frameworks.py"]),
    ("取证策略库", [sys.executable, "知识库_03取证/validate_strategies.py"]),
    ("唯一状态派生矩阵", [sys.executable, "运行校验/status_derivation.py"]),
    ("推理方法库", [sys.executable, "知识库_04推理/validate_methods.py"]),
    ("最小评测集覆盖", [sys.executable, "评测集/validate_eval_set.py"]),
    ("存储芯片周期验收样例", [sys.executable, "运行校验/validate_publish.py", "示例1"]),
    ("国产设备替代验收样例", [sys.executable, "运行校验/validate_publish.py", "示例2"]),
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

    print("\nPROJECT_PASS: Markdown 用语、本体、知识库_02框架、知识库_03取证、知识库_04推理、最小评测集覆盖、校验器与两个 01—05 验收样例全部通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
