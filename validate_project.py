#!/usr/bin/env python3
"""运行项目当前正式验收链路。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent

CHECKS = (
    ("一级通用本体", [sys.executable, "一级通用本体规范/validate_schema.py"]),
    ("投研框架库", [sys.executable, "02框架库/validate_frameworks.py"]),
    (
        "校验器单元测试",
        [sys.executable, "-m", "unittest", "discover", "-s", "输出模板/tests", "-q"],
    ),
    ("存储芯片周期验收样例", [sys.executable, "输出模板/validate_publish.py", "示例1"]),
    ("国产设备替代验收样例", [sys.executable, "输出模板/validate_publish.py", "示例2"]),
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

    print("\nPROJECT_PASS: 本体、框架、校验器与两个 01—05 验收样例全部通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
