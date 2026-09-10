from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[2]


class ResearchMethodRegistry:
    """加载研究方法索引，并把显式方法声明解析为可审计计划上下文。"""

    DEFAULT_ROOT = ROOT / "研究方法"

    def __init__(self, root: str | Path = DEFAULT_ROOT) -> None:
        self.root = Path(root)
        self.evidence_registry_path = self.root / "取证" / "method-registry.yaml"
        self.reasoning_registry_path = self.root / "推理" / "method-registry.yaml"
        self.framework_registry_path = self.root / "框架" / "00_framework_dependency_registry.yaml"
        self.evidence_registry = self._load(self.evidence_registry_path)
        self.reasoning_registry = self._load(self.reasoning_registry_path)
        self.framework_registry = self._load(self.framework_registry_path)
        self.methods = dict(self.evidence_registry.get("methods") or {})
        self.judgment_types = dict(self.evidence_registry.get("judgment_types") or {})
        self.reasoning_methods = dict(self.reasoning_registry.get("methods") or {})
        self.reasoning_type_mapping = dict(self.reasoning_registry.get("judgment_type_mapping") or {})
        self.frameworks = {
            **dict(self.framework_registry.get("frameworks") or {}),
            **dict(self.framework_registry.get("industry_overlays") or {}),
        }
        self.framework_files = self._framework_files()
        self.catalogs = self._catalogs()
        self.validate()

    @staticmethod
    def _load(path: Path) -> dict[str, Any]:
        if not path.is_file():
            raise ValueError(f"缺少研究方法权威: {path}")
        document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(document, dict):
            raise ValueError(f"{path}: 必须是 YAML 对象")
        return document

    def _framework_files(self) -> dict[str, Path]:
        result: dict[str, Path] = {}
        for path in sorted((self.root / "框架").rglob("*.md")):
            text = path.read_text(encoding="utf-8")
            if not text.startswith("---\n"):
                continue
            end = text.find("\n---\n", 4)
            if end < 0:
                continue
            header = yaml.safe_load(text[4:end]) or {}
            framework_id = header.get("framework_id") if isinstance(header, dict) else None
            if not framework_id:
                continue
            framework_id = str(framework_id)
            if framework_id in result:
                raise ValueError(f"框架 {framework_id} 存在重复正文")
            result[framework_id] = path
        return result

    def _catalogs(self) -> dict[str, Path]:
        result: dict[str, Path] = {}
        for path in sorted(self.root.rglob("*.yaml")):
            if path in {self.evidence_registry_path, self.reasoning_registry_path, self.framework_registry_path}:
                continue
            document = self._load(path)
            if document.get("schema_name") == "semiconductor_research_method_catalog":
                result["semiconductor"] = path
        return result

    def validate(self) -> None:
        if not self.methods or not self.judgment_types or not self.reasoning_methods or not self.frameworks:
            raise ValueError("取证方法、推理方法、判断类型和框架登记均不得为空")

        for method_id, definition in sorted(self.methods.items()):
            path = self.root / "取证" / str(definition.get("file", ""))
            if not path.is_file():
                raise ValueError(f"取证方法 {method_id} 缺少正文: {path}")
            for dependency in definition.get("requires_methods", []):
                if dependency not in self.methods:
                    raise ValueError(f"取证方法 {method_id} 引用未知依赖 {dependency}")

        for judgment_type, definition in sorted(self.judgment_types.items()):
            method_id = definition.get("method")
            if method_id not in self.methods:
                raise ValueError(f"判断类型 {judgment_type} 引用未知取证方法 {method_id}")
            if judgment_type not in self.reasoning_type_mapping:
                raise ValueError(f"判断类型 {judgment_type} 缺少推理方法映射")

        for method_id, definition in sorted(self.reasoning_methods.items()):
            path = self.root / "推理" / str(definition.get("file", ""))
            if not path.is_file():
                raise ValueError(f"推理方法 {method_id} 缺少正文: {path}")
        for judgment_type, method_refs in sorted(self.reasoning_type_mapping.items()):
            for method_ref in method_refs:
                if method_ref not in self.reasoning_methods:
                    raise ValueError(f"判断类型 {judgment_type} 引用未知推理方法 {method_ref}")
        for method_ref in self.reasoning_registry.get("common_refs", []):
            if method_ref not in self.reasoning_methods:
                raise ValueError(f"推理共同方法引用未知定义 {method_ref}")

        missing_frameworks = set(self.frameworks) - set(self.framework_files)
        if missing_frameworks:
            raise ValueError(f"框架登记缺少正文: {sorted(missing_frameworks)}")

        for source_file in (self.evidence_registry.get("source_guides") or {}).values():
            path = self.root / "取证" / str(source_file)
            if not path.is_file():
                raise ValueError(f"来源手册不存在: {path}")

        for reference in (self.evidence_registry.get("authority_refs") or {}).values():
            raw_path = str(reference).split("#", 1)[0]
            path = self.root.parent / raw_path
            if not path.is_file():
                raise ValueError(f"方法登记引用的权威不存在: {path}")

    def resolve_for_request(self, request: dict[str, Any]) -> dict[str, Any]:
        """解析任务显式声明；未声明时记录为空，不以关键词擅自选择框架。"""

        specification = request.get("methodology") or {}
        if not isinstance(specification, dict):
            raise ValueError("request.methodology 必须是对象")

        judgment_types = self._unique(specification.get("judgment_types", []))
        framework_refs = self._unique(specification.get("framework_refs", []))
        explicit_methods = self._unique(specification.get("evidence_method_refs", []))
        domain = specification.get("domain")

        method_refs = list(explicit_methods)
        reasoning_method_refs = list(self.reasoning_registry.get("common_refs", [])) if judgment_types else []
        for judgment_type in judgment_types:
            definition = self.judgment_types.get(judgment_type)
            if definition is None:
                raise ValueError(f"未知判断类型: {judgment_type}")
            method_refs.append(str(definition["method"]))
            method_refs.extend(str(item) for item in definition.get("requires_methods", []))
            if definition.get("formal_a08"):
                method_refs.append("A08")
            reasoning_method_refs.extend(str(item) for item in self.reasoning_type_mapping[judgment_type])

        method_refs = self._expand_method_dependencies(self._unique(method_refs))
        reasoning_method_refs = self._unique(reasoning_method_refs)
        for framework_ref in framework_refs:
            if framework_ref not in self.frameworks:
                raise ValueError(f"未知研究框架: {framework_ref}")
        for method_ref in method_refs:
            if method_ref not in self.methods:
                raise ValueError(f"未知取证方法: {method_ref}")
        if domain is not None and str(domain) not in self.catalogs:
            raise ValueError(f"未知领域方法目录: {domain}")

        relative = lambda path: str(path.relative_to(self.root.parent))
        return {
            "declared": bool(specification),
            "judgment_types": judgment_types,
            "evidence_method_refs": method_refs,
            "evidence_method_files": [
                relative(self.root / "取证" / str(self.methods[item]["file"])) for item in method_refs
            ],
            "reasoning_method_refs": reasoning_method_refs,
            "reasoning_method_files": [
                relative(self.root / "推理" / str(self.reasoning_methods[item]["file"]))
                for item in reasoning_method_refs
            ],
            "framework_refs": framework_refs,
            "framework_files": [relative(self.framework_files[item]) for item in framework_refs],
            "domain": domain,
            "domain_catalog": relative(self.catalogs[str(domain)]) if domain is not None else None,
            "authority": {
                "method_registry": relative(self.evidence_registry_path),
                "reasoning_registry": relative(self.reasoning_registry_path),
                "framework_registry": relative(self.framework_registry_path),
            },
        }

    def _expand_method_dependencies(self, method_refs: list[str]) -> list[str]:
        result: list[str] = []

        def visit(method_ref: str, visiting: set[str]) -> None:
            if method_ref in result:
                return
            if method_ref in visiting:
                raise ValueError(f"取证方法依赖形成循环: {method_ref}")
            definition = self.methods.get(method_ref)
            if definition is None:
                raise ValueError(f"未知取证方法: {method_ref}")
            visiting.add(method_ref)
            for dependency in definition.get("requires_methods", []):
                visit(str(dependency), visiting)
            visiting.remove(method_ref)
            result.append(method_ref)

        for method_ref in method_refs:
            visit(method_ref, set())
        return result

    @staticmethod
    def _unique(values: Any) -> list[str]:
        if values is None:
            return []
        if not isinstance(values, list):
            raise ValueError("方法引用必须是列表")
        return list(dict.fromkeys(str(item) for item in values))
