#!/usr/bin/env python3
"""将历史运行包中的仓库路径映射到当前分层；不改变任何业务字段。"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Mapping

import yaml


ROOT = Path(__file__).resolve().parents[2]
MIGRATION_REGISTRY = ROOT / "governance/01_架构/asset_migration.yaml"


def compatibility_mappings() -> dict[str, str]:
    registry = yaml.safe_load(MIGRATION_REGISTRY.read_text(encoding="utf-8"))
    mappings = registry.get("compatibility_prefix_mappings", {}) if isinstance(registry, dict) else {}
    if not isinstance(mappings, dict) or not mappings:
        raise ValueError("迁移注册表缺少 compatibility_prefix_mappings")
    return {str(old).rstrip("/"): str(new).rstrip("/") for old, new in mappings.items()}


def remap_repository_path(value: str, mappings: Mapping[str, str] | None = None) -> str:
    """按最长旧前缀映射；URL、绝对路径和普通业务文本保持不变。"""
    if not value or value.startswith(("http://", "https://", "/")):
        return value
    normalized = value.replace("\\", "/")
    routes = mappings or compatibility_mappings()
    for old in sorted(routes, key=len, reverse=True):
        if normalized == old or normalized.startswith(old + "/"):
            return str(routes[old]) + normalized[len(old):]
    return value


def migrate_manifest_paths(value: Any, mappings: Mapping[str, str] | None = None) -> Any:
    """递归迁移历史 YAML/JSON 中的路径字符串，保留结构、ID、状态和版本。"""
    routes = mappings or compatibility_mappings()
    if isinstance(value, dict):
        return {key: migrate_manifest_paths(item, routes) for key, item in value.items()}
    if isinstance(value, list):
        return [migrate_manifest_paths(item, routes) for item in value]
    if isinstance(value, str):
        return remap_repository_path(value, routes)
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="历史 YAML 运行清单")
    parser.add_argument("--output", type=Path, help="输出路径；省略时写到标准输出")
    args = parser.parse_args()
    payload = yaml.safe_load(args.manifest.read_text(encoding="utf-8"))
    migrated = migrate_manifest_paths(payload)
    rendered = yaml.safe_dump(migrated, allow_unicode=True, sort_keys=False, width=120)
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
