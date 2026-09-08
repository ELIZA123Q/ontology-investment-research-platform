from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

import yaml

from ir_platform.adapters import SemanticaResearchGraphRepository
from ir_platform.ontology import SemanticOntologyCompiler, SemanticOntologyRegistry
from ir_platform.rules import CapabilityDefinitionRegistry, LogicRegistry, RuleRegistry
from ir_platform.runtime import ResearchGraphArchiveService


ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN_SOURCE_TOKENS = (
    "stage_" + "01",
    "stage_" + "02",
    "stage_" + "03",
    "stage_" + "04",
    "stage_" + "05",
    "return_to_" + "stage",
    "task_ontology_" + "view",
    "ontology_dependency_" + "projection",
    "ResearchRun" + "Importer",
    "ResearchRun" + "Exporter",
)


def validate_project(root: str | Path = ROOT) -> dict[str, Any]:
    project = Path(root)
    registry = SemanticOntologyRegistry(project / "语义本体")
    capabilities = CapabilityDefinitionRegistry(project / "研究能力" / "capabilities.yaml")
    logics = LogicRegistry(project / "研究能力" / "logics.yaml")
    rules = RuleRegistry(project / "研究规则" / "rules.yaml")
    logics.validate_references(capabilities, rules)

    violations = _architecture_violations(project)
    if violations:
        raise ValueError("架构扫描失败:\n" + "\n".join(violations))

    examples: dict[str, dict[str, Any]] = {}
    with tempfile.TemporaryDirectory() as temporary:
        compile_result = SemanticOntologyCompiler(registry).compile(Path(temporary) / "ontology")
        for example_dir in sorted((project / "examples").iterdir()):
            archive = example_dir / "research-bundle.trig"
            expected_path = example_dir / "expected.yaml"
            if not archive.exists() or not expected_path.exists():
                continue
            repository = SemanticaResearchGraphRepository(Path(temporary) / example_dir.name)
            bundle = ResearchGraphArchiveService(repository).import_bundle(archive)
            expected = yaml.safe_load(expected_path.read_text(encoding="utf-8"))
            entities = repository.list_entities(bundle.bundle_id)
            judgments = {item.id: item for item in entities if item.type == "Judgment"}
            for item in expected["judgments"]:
                actual = judgments.get(item["id"])
                if actual is None:
                    raise ValueError(f"{example_dir.name}: 缺少判断 {item['id']}")
                if actual.properties.get("judgment_level") != item["judgment_level"]:
                    raise ValueError(f"{example_dir.name}: 判断等级发生变化 {item['id']}")
                if actual.properties.get("statement") != item["statement"]:
                    raise ValueError(f"{example_dir.name}: 判断内容发生变化 {item['id']}")
            types = {item.type for item in entities}
            if not {"ExecutionPlan", "ApprovalRecord", "PublishedReport"}.issubset(types):
                raise ValueError(f"{example_dir.name}: 缺少计划、审批或发布记录")
            reports = [item for item in entities if item.type == "PublishedReport"]
            if not any(
                item.properties.get("publish_status") == expected["publish_status"]
                and item.properties.get("overall_judgment_level") == expected["overall_judgment_level"]
                for item in reports
            ):
                raise ValueError(f"{example_dir.name}: 发布状态不一致")
            boundaries = [
                {
                    "id": item.id,
                    **{
                        key: item.properties.get(key)
                        for key in ("conditions", "scope", "time_horizon", "uncertainty_refs")
                    },
                }
                for item in entities
                if item.type == "Judgment"
            ]
            gaps = [
                {
                    "id": item.id,
                    **{
                        key: item.properties.get(key)
                        for key in (
                            "linked_gap_ids",
                            "gap_action",
                            "scope_limit",
                            "downgrade_reason",
                            "forbidden_outputs",
                        )
                    },
                }
                for item in entities
                if item.type == "EvidenceReadinessAssessment"
            ]
            if len(boundaries) != expected["judgment_boundary_count"]:
                raise ValueError(f"{example_dir.name}: 判断边界数量发生变化")
            if len(gaps) != expected["evidence_gap_count"]:
                raise ValueError(f"{example_dir.name}: 证据缺口数量发生变化")
            if _digest(boundaries) != expected["judgment_boundary_sha256"]:
                raise ValueError(f"{example_dir.name}: 判断边界发生变化")
            if _digest(gaps) != expected["evidence_gap_sha256"]:
                raise ValueError(f"{example_dir.name}: 证据缺口或限制条件发生变化")
            examples[example_dir.name] = {
                "bundle_id": bundle.bundle_id,
                "entities": len(entities),
                "relations": len(repository.list_relations(bundle.bundle_id)),
            }
            repository.close()
    return {
        "ontology_digest": compile_result.digest,
        "semantic_types": len(registry.object_types),
        "semantic_relations": len(registry.relation_types),
        "metrics": len(registry.semantic_instances),
        "capabilities": len(capabilities.all()),
        "logics": len(logics.all()),
        "rules": len(rules.all()),
        "examples": examples,
    }


def _architecture_violations(root: Path) -> list[str]:
    violations: list[str] = []
    scan_roots = [
        root / "src",
        root / "语义本体",
        root / "研究运行合同",
        root / "研究规则",
        root / "研究能力",
        root / "研究方法",
    ]
    for scan_root in scan_roots:
        for path in sorted(item for item in scan_root.rglob("*") if item.suffix in {".py", ".yaml", ".yml"}):
            content = path.read_text(encoding="utf-8")
            for token in FORBIDDEN_SOURCE_TOKENS:
                if token in content:
                    violations.append(f"{path.relative_to(root)}: 禁止依赖 {token}")
            if "import " + "semantica" in content or "from " + "semantica" in content:
                if path != root / "src" / "ir_platform" / "adapters" / "semantica.py":
                    violations.append(f"{path.relative_to(root)}: Semantica 只能由适配层导入")
    return violations


def _digest(items: list[dict[str, Any]]) -> str:
    payload = json.dumps(
        sorted(items, key=lambda item: item["id"]),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
