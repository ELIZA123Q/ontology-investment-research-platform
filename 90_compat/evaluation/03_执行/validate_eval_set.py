#!/usr/bin/env python3
"""统一校验研究价值代理评测体系。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[2]


def main() -> int:
    completed = subprocess.run(
        [sys.executable, str(ROOT / "eval_cli.py"), "validate"],
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    print(completed.stdout.strip())
    if completed.returncode:
        return completed.returncode
    print("EVAL_SET_PASS: 评测契约、同证据基线、裁决支持频率与四题试点全部有效。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
