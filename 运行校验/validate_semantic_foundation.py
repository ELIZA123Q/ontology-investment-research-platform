#!/usr/bin/env python3
"""验证 v2 的本体—运行—规则边界及确定性语义编译。"""

from __future__ import annotations

import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml
from rdflib import Graph


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from ir_platform.ontology import OntologyBoundaryError, SemanticOntologyCompiler, SemanticOntologyRegistry  # noqa: E402


FORBIDDEN_SECTIONS = {"action_types", "functions", "logic_flows", "rules"}
LEGACY_REDIRECTS = (
    ROOT / "一级通用本体规范" / "common.yaml",
    ROOT / "一级通用本体规范" / "semantic.yaml",
    ROOT / "一级通用本体规范" / "evidence.yaml",
    ROOT / "一级通用本体规范" / "reasoning.yaml",
    ROOT / "二级半导体领域本体规范" / "common.yaml",
    ROOT / "二级半导体领域本体规范" / "semantic.yaml",
    ROOT / "二级半导体领域本体规范" / "evidence.yaml",
    ROOT / "二级半导体领域本体规范" / "reasoning.yaml",
    ROOT / "二级半导体领域本体规范" / "business_instances.yaml",
)


def main() -> int:
    errors: list[str] = []
    try:
        registry = SemanticOntologyRegistry(ROOT / "语义本体")
    except (FileNotFoundError, OntologyBoundaryError, KeyError) as exc:
        print(f"SEMANTIC_FOUNDATION_FAILED: {exc}")
        return 1

    for path in registry.iter_source_files():
        document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        illegal = FORBIDDEN_SECTIONS.intersection(document)
        if illegal:
            errors.append(f"{path.relative_to(ROOT)} 含运行资源 {sorted(illegal)}")

    if len(registry.semantic_instances) != 46:
        errors.append(f"ResearchMetric 应为 46 个，实际 {len(registry.semantic_instances)}")

    for path in LEGACY_REDIRECTS:
        document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if document.get("status") != "deprecated_read_only" or not document.get("authority_targets"):
            errors.append(f"{path.relative_to(ROOT)} 必须是弃用只读转发文件")
        duplicated = FORBIDDEN_SECTIONS.union({"object_types", "relation_types", "business_instance_graph"}).intersection(document)
        if duplicated:
            errors.append(f"{path.relative_to(ROOT)} 仍复制权威定义 {sorted(duplicated)}")

    lock = (ROOT / "uv.lock").read_text(encoding="utf-8")
    if 'name = "semantica"' not in lock or 'version = "0.6.8"' not in lock:
        errors.append("uv.lock 未固定 semantica==0.6.8")
    if not (ROOT / "THIRD_PARTY_NOTICES.md").is_file():
        errors.append("缺少第三方许可声明")

    with TemporaryDirectory() as first, TemporaryDirectory() as second:
        one = SemanticOntologyCompiler(registry).compile(first)
        two = SemanticOntologyCompiler(registry).compile(second)
        if one.digest != two.digest:
            errors.append("同一输入的编译摘要不一致")
        for name in ("ontology.ttl", "shapes.ttl", "vocabularies.ttl"):
            first_bytes = (Path(first) / name).read_bytes()
            second_bytes = (Path(second) / name).read_bytes()
            if first_bytes != second_bytes:
                errors.append(f"{name} 未达到字节级确定性")
            try:
                Graph().parse(Path(first) / name, format="turtle")
            except Exception as exc:
                errors.append(f"{name} 不是合法 Turtle: {exc}")

    if errors:
        print(f"SEMANTIC_FOUNDATION_FAILED: {len(errors)} error(s)")
        for error in errors:
            print(f"- {error}")
        return 1
    print(
        "SEMANTIC_FOUNDATION_PASS: "
        f"{len(registry.object_types)} 个语义类型、{len(registry.relation_types)} 个关系、"
        "46 个 ResearchMetric；旧权威已转为只读转发，OWL/SHACL/SKOS 编译可重复。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
