#!/usr/bin/env python3
"""Freeze a validated local workbench export as a compact regression fixture."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


FILES = (
    "package_kind.yaml",
    "run_manifest.yaml",
    "01_task.yaml",
    "02_structure.yaml",
    "03_evidence.yaml",
    "04_judgment.yaml",
    "05_expression.yaml",
    "05_report.md",
    "business_instance_graph.yaml",
    "baseline.yaml",
    "independent_review.yaml",
    "evaluation.yaml",
)


def snapshot(source: Path, destination: Path) -> None:
    missing = [name for name in (*FILES, "sources.json") if not (source / name).is_file()]
    if missing:
        raise SystemExit(f"来源导出缺少文件: {', '.join(missing)}")
    destination.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(source / name, destination / name)

    sources = json.loads((source / "sources.json").read_text(encoding="utf-8"))
    for item in sources:
        # 正文可能很大，回归只保留可核验 hash、逐字引文、定位和来源元数据。
        item.pop("snapshot_text", None)
    (destination / "sources.json").write_text(
        json.dumps(sources, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (destination / "README.md").write_text(
        "\n".join(
            (
                "# 真实工作台链回归夹具",
                "",
                f"来源运行：`{source.name}`。",
                "",
                "该目录冻结一条已通过校验的真实 `workbench_export`，用于持续回归来源血缘、",
                "确定性规则、独立审阅、同证据基线和 A/B 绑定。`sources.json` 删除了大段",
                "正文快照，只保留正文 hash、逐字引文和定位；它不是 `formal_pack`，也不证明研究增益。",
                "",
            )
        ),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    snapshot(args.source.resolve(), args.destination.resolve())
    print(f"WORKBENCH_REGRESSION_SNAPSHOT_WRITTEN: {args.destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
