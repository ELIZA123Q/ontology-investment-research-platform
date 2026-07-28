#!/usr/bin/env python3
"""废弃关系名守卫：禁止旧关系名进入正式产物。

策略来源：``ontology/03_迁移/2026-07-20_evidence_relation_rename.md``
与 ``ontology/03_迁移/2x_to_3_ledger.yaml`` 的 retirement_policy
（``legacy_publish_compatible: false``——旧字段不得进入正式产物）。

只检查 git 跟踪的文件（自动排除被 .gitignore 忽略的本地导出，
如 ``instances/00_本机运行/exports``），并跳过迁移证据目录
``ontology/03_迁移/``（该目录正当保留旧名作为迁移记录）。
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# 旧名 → 新名，镜像 ontology/03_迁移/2026-07-20_evidence_relation_rename.md。
DEPRECATED_RELATIONS: dict[str, str] = {
    "factSupportedByClaim": "factDerivedFromClaim",
    "assessmentEvaluatesEvidence": "assessmentEvaluatesFact",
    "variableInfluencesVariable": "stateVariableInfluences",
}

# 仅检查数据/代码类文件，避免在散文 Markdown 上误报。
SCANNABLE_SUFFIXES = {".yaml", ".yml", ".csv", ".json", ".ts", ".tsx", ".js", ".py"}

# 正当保留旧名的路径前缀（迁移证据目录）。
ALLOWED_PREFIXES = ("ontology/03_迁移/",)

_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_])(" + "|".join(re.escape(name) for name in DEPRECATED_RELATIONS) + r")(?![A-Za-z0-9_])"
)


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return [line for line in result.stdout.splitlines() if line]


def is_scannable(rel: str) -> bool:
    return Path(rel).suffix.lower() in SCANNABLE_SUFFIXES and not rel.startswith(ALLOWED_PREFIXES)


def scan() -> list[str]:
    findings: list[str] = []
    for rel in tracked_files():
        if not is_scannable(rel):
            continue
        path = ROOT / rel
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for line_no, line in enumerate(text.splitlines(), start=1):
            for match in _TOKEN_RE.finditer(line):
                old = match.group(1)
                new = DEPRECATED_RELATIONS[old]
                findings.append(f"{rel}:{line_no}: 废弃关系名 `{old}`（应为 `{new}`）")
    return findings


def main() -> int:
    findings = scan()
    if findings:
        for item in findings:
            print(f"ERROR: {item}")
        print(f"DEPRECATED_TERMS_RETURN_REQUIRED: {len(findings)} 处旧名进入正式产物")
        return 1
    print(f"DEPRECATED_TERMS_PASS: 0 处旧名，{len(DEPRECATED_RELATIONS)} 个已登记废弃名均未泄漏")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
