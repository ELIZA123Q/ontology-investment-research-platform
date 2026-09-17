from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from ir_platform.source_index import PublicSourceIndex


ROOT = Path(__file__).resolve().parents[2]
EQUITY_MACRO_FRAMEWORK_REFS = ("BF-MF-01", "BF-PI-01", "BF-EF-01")
A_SHARE_COMPLETE_FRAMEWORK_REFS = (
    "BF-IC-01",
    "BF-SD-01",
    "BF-BM-01",
    "BF-FQ-01",
    "BF-EE-01",
    "BF-FS-01",
    "BF-EG-01",
    "BF-RS-01",
    "BF-VA-01",
)
A_SHARE_COMPLETE_JUDGMENT_TYPES = (
    "state_measurement",
    "trend_direction",
    "cycle_phase",
    "object_differentiation",
    "expectation_gap",
    "valuation_impact",
)
MACRO_MODES = {"screen", "deep"}
CONFIDENCE_VALUES = {"high", "medium", "low"}
ANALYST_LENS_HORIZONS = {"short", "medium", "long"}
ANALYST_LENS_EFFECTS = {
    "changes_main_explanation",
    "adds_competing_explanation",
    "changes_monitoring",
    "none",
}
EQUITY_RESEARCH_MODES = {"full_research", "research_update"}
STRATEGIC_RESEARCH_MODES = {"strategic_research"}
PERSONAL_PRINCIPLE_STATUSES = {"candidate", "confirmed", "retired"}
CAUSAL_JUDGMENT_TYPES = {
    "mechanism_validation",
    "causal_attribution",
    "transmission_path",
    "impact_realization",
}
CAUSAL_CONTRACT_VERSION = "1.0.0"


class ResearchMethodRegistry:
    """加载研究方法索引，并把显式方法声明解析为可审计计划上下文。"""

    DEFAULT_ROOT = ROOT / "研究方法"

    def __init__(self, root: str | Path = DEFAULT_ROOT) -> None:
        self.root = Path(root)
        self.evidence_registry_path = self.root / "取证" / "method-registry.yaml"
        self.reasoning_registry_path = self.root / "推理" / "method-registry.yaml"
        self.framework_registry_path = self.root / "框架" / "00_framework_dependency_registry.yaml"
        self.analyst_lens_registry_path = self.root / "分析师视角" / "analyst-lenses.yaml"
        self.personal_principle_registry_path = self.root / "个人方法论" / "principles.yaml"
        self.personal_case_ledger_path = self.root / "个人方法论" / "case-ledger.yaml"
        self.public_source_index_path = self.root / "取证" / "source-index.yaml"
        self.evidence_registry = self._load(self.evidence_registry_path)
        self.reasoning_registry = self._load(self.reasoning_registry_path)
        self.framework_registry = self._load(self.framework_registry_path)
        self.analyst_lens_registry = self._load(self.analyst_lens_registry_path)
        self.personal_principle_registry = self._load(self.personal_principle_registry_path)
        self.personal_case_ledger = self._load(self.personal_case_ledger_path)
        self.public_source_index = PublicSourceIndex(self.public_source_index_path)
        self.methods = dict(self.evidence_registry.get("methods") or {})
        self.judgment_types = dict(self.evidence_registry.get("judgment_types") or {})
        self.reasoning_methods = dict(self.reasoning_registry.get("methods") or {})
        self.reasoning_type_mapping = dict(self.reasoning_registry.get("judgment_type_mapping") or {})
        self.frameworks = {
            **dict(self.framework_registry.get("frameworks") or {}),
            **dict(self.framework_registry.get("industry_overlays") or {}),
        }
        self.analyst_lenses = dict(self.analyst_lens_registry.get("lenses") or {})
        self.personal_principles = dict(self.personal_principle_registry.get("principles") or {})
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
            if document.get("schema_name") == "bank_research_method_catalog":
                result["bank"] = path
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

        self._validate_analyst_lenses()
        self._validate_personal_methodology()

    def _validate_personal_methodology(self) -> None:
        if self.personal_principle_registry.get("schema_name") != "personal_research_principle_registry":
            raise ValueError("个人原则档案 schema_name 无效")
        if self.personal_case_ledger.get("schema_name") != "personal_research_case_ledger":
            raise ValueError("个人复盘台账 schema_name 无效")
        cases = self.personal_case_ledger.get("cases")
        if not isinstance(cases, dict):
            raise ValueError("个人复盘台账 cases 必须是对象")
        confirmed_lineages: set[str] = set()
        lineage_versions: set[tuple[str, int]] = set()
        for principle_ref, card in sorted(self.personal_principles.items()):
            if not isinstance(card, dict) or card.get("status") not in PERSONAL_PRINCIPLE_STATUSES:
                raise ValueError(f"个人原则 {principle_ref} 状态无效")
            if not isinstance(card.get("version"), int) or card["version"] < 1:
                raise ValueError(f"个人原则 {principle_ref} 版本无效")
            lineage_id = str(card.get("lineage_id", "")).strip()
            if not lineage_id:
                raise ValueError(f"个人原则 {principle_ref} 缺少版本谱系")
            lineage_version = (lineage_id, card["version"])
            if lineage_version in lineage_versions:
                raise ValueError(f"个人原则谱系 {lineage_id} 版本重复")
            lineage_versions.add(lineage_version)
            supersedes = card.get("supersedes")
            if supersedes is None:
                if card["version"] != 1:
                    raise ValueError(f"个人原则 {principle_ref} 新谱系版本必须从1开始")
            else:
                previous = self.personal_principles.get(str(supersedes))
                if not isinstance(previous, dict) or previous.get("lineage_id") != lineage_id:
                    raise ValueError(f"个人原则 {principle_ref} 前版引用无效")
                if previous.get("version") != card["version"] - 1:
                    raise ValueError(f"个人原则 {principle_ref} 版本必须连续递增")
            for field in ("proposition", "applicability", "market_scope"):
                if not str(card.get(field, "")).strip():
                    raise ValueError(f"个人原则 {principle_ref} 缺少 {field}")
            if not self._unique_nonempty(card.get("modes")) or not set(card["modes"]).issubset(EQUITY_RESEARCH_MODES):
                raise ValueError(f"个人原则 {principle_ref} 模式无效")
            if not self._unique_nonempty(card.get("falsifiers")):
                raise ValueError(f"个人原则 {principle_ref} 缺少反证")
            sources = card.get("source_refs")
            if not isinstance(sources, list) or not sources:
                raise ValueError(f"个人原则 {principle_ref} 缺少来源")
            for source in sources:
                if not isinstance(source, dict) or source.get("kind") not in {"file", "user_instruction"}:
                    raise ValueError(f"个人原则 {principle_ref} 来源类型无效")
                ref = str(source.get("ref", "")).strip()
                if not ref:
                    raise ValueError(f"个人原则 {principle_ref} 来源为空")
                if source["kind"] == "file" and not (self.root.parent / ref).is_file():
                    raise ValueError(f"个人原则 {principle_ref} 来源文件不存在: {ref}")
            confirmation = card.get("confirmation")
            if card["status"] == "confirmed":
                if lineage_id in confirmed_lineages:
                    raise ValueError(f"个人原则谱系 {lineage_id} 存在多个已确认版本")
                confirmed_lineages.add(lineage_id)
                if not isinstance(confirmation, dict) or any(
                    not str(confirmation.get(field, "")).strip()
                    for field in ("confirmed_by", "confirmed_on", "record")
                ):
                    raise ValueError(f"个人原则 {principle_ref} 未记录用户确认")
                try:
                    date.fromisoformat(str(confirmation["confirmed_on"]))
                except ValueError as exc:
                    raise ValueError(f"个人原则 {principle_ref} 确认日期无效") from exc
            elif confirmation is not None and card["status"] == "candidate":
                raise ValueError(f"候选个人原则 {principle_ref} 不得冒用确认记录")
        for case_ref, case in sorted(cases.items()):
            if not isinstance(case, dict):
                raise ValueError(f"复盘案例 {case_ref} 必须是对象")
            for field in (
                "request_ref", "design_ref", "information_cutoff", "verification_window",
                "original_thesis", "observed_outcome", "outcome_hit", "ex_ante_reasoning_quality",
                "error_type", "evidence_refs", "method_change_proposal", "reviewed_on",
            ):
                if field not in case or case[field] is None:
                    raise ValueError(f"复盘案例 {case_ref} 缺少 {field}")
            for field in ("request_ref", "design_ref"):
                if not (self.root.parent / str(case[field])).is_file():
                    raise ValueError(f"复盘案例 {case_ref} 引用文件不存在: {case[field]}")
            for field in (
                "information_cutoff", "verification_window", "original_thesis", "observed_outcome",
                "ex_ante_reasoning_quality", "error_type", "method_change_proposal",
            ):
                if not str(case[field]).strip():
                    raise ValueError(f"复盘案例 {case_ref} 的 {field} 为空")
            if not isinstance(case["outcome_hit"], bool) or not self._unique_nonempty(case["evidence_refs"]):
                raise ValueError(f"复盘案例 {case_ref} 缺少结果核验或证据引用")
            for field in ("information_cutoff", "reviewed_on"):
                try:
                    date.fromisoformat(str(case[field])[:10])
                except ValueError as exc:
                    raise ValueError(f"复盘案例 {case_ref} 的 {field} 日期无效") from exc

    def _validate_analyst_lenses(self) -> None:
        if self.analyst_lens_registry.get("role") != "candidate_explanations_only":
            raise ValueError("分析师视角库只能提供候选解释")
        if not self.analyst_lenses:
            raise ValueError("分析师视角库不得为空")
        for lens_ref, card in sorted(self.analyst_lenses.items()):
            if not isinstance(card, dict) or not str(card.get("author", "")).strip():
                raise ValueError(f"分析师视角 {lens_ref} 缺少作者")
            related_sources = card.get("related_primary_sources")
            if not isinstance(related_sources, list) or not related_sources:
                raise ValueError(f"分析师视角 {lens_ref} 缺少交叉核对的原始材料")
            source_ids: set[str] = set()
            for source in [card.get("source"), *related_sources]:
                if not isinstance(source, dict) or any(
                    not str(source.get(field, "")).strip()
                    for field in ("id", "title", "publisher", "published_on", "locator", "url")
                ):
                    raise ValueError(f"分析师视角 {lens_ref} 缺少可回溯原文")
                source_id = str(source["id"])
                if source_id in source_ids:
                    raise ValueError(f"分析师视角 {lens_ref} 原文标识重复")
                source_ids.add(source_id)
                if not str(source["url"]).startswith("https://"):
                    raise ValueError(f"分析师视角 {lens_ref} 原文必须有 HTTPS 地址")
                published_on = str(source["published_on"])
                if not re.fullmatch(r"\d{4}-\d{2}(?:-\d{2})?", published_on):
                    raise ValueError(f"分析师视角 {lens_ref} 原文日期格式无效")
                try:
                    date.fromisoformat(published_on if len(published_on) == 10 else published_on + "-01")
                except ValueError as exc:
                    raise ValueError(f"分析师视角 {lens_ref} 原文日期无效") from exc
            if any(not str(source.get("contribution", "")).strip() for source in related_sources):
                raise ValueError(f"分析师视角 {lens_ref} 缺少交叉材料的作用说明")
            if not str(card.get("proposition", "")).strip() or not str(card.get("applicability", "")).strip():
                raise ValueError(f"分析师视角 {lens_ref} 缺少命题或适用边界")
            structure = card.get("theoretical_structure")
            if not isinstance(structure, list) or not structure or any(
                not str(card.get(field, "")).strip()
                for field in ("research_operationalization", "attribution_boundary")
            ):
                raise ValueError(f"分析师视角 {lens_ref} 缺少理论层次或作者/项目边界")
            for component in structure:
                if not isinstance(component, dict) or not str(component.get("claim", "")).strip():
                    raise ValueError(f"分析师视角 {lens_ref} 理论层次缺少命题")
                refs = self._unique(component.get("source_refs"))
                if not refs or set(refs) - source_ids:
                    raise ValueError(f"分析师视角 {lens_ref} 理论层次引用未知原文")
            if not card.get("applicable_markets") or not set(card.get("applicable_horizons") or []).issubset(
                ANALYST_LENS_HORIZONS
            ) or not card.get("applicable_horizons"):
                raise ValueError(f"分析师视角 {lens_ref} 缺少有效市场或期限边界")
            for field in ("observable_predictions", "falsifiers", "invalidation_conditions"):
                if not self._unique_nonempty(card.get(field)):
                    raise ValueError(f"分析师视角 {lens_ref} 缺少可证伪字段 {field}")
            framework_refs = self._unique(card.get("framework_refs"))
            if not framework_refs or set(framework_refs) - set(self.frameworks):
                raise ValueError(f"分析师视角 {lens_ref} 引用未知或空研究框架")

    def resolve_for_request(self, request: dict[str, Any]) -> dict[str, Any]:
        """解析任务显式声明；未声明时记录为空，不以关键词擅自选择框架。"""

        specification = request.get("methodology") or {}
        if not isinstance(specification, dict):
            raise ValueError("request.methodology 必须是对象")

        asset_class = request.get("asset_class")
        market_scope = request.get("market_scope")
        equity_research_design_required = (
            asset_class == "equity"
            and market_scope == "A_share"
            and request.get("mode") in EQUITY_RESEARCH_MODES
        )
        strategic_research_design_required = request.get("mode") in STRATEGIC_RESEARCH_MODES
        requested_macro_mode = specification.get("macro_mode")
        macro_mode: str | None = None
        if asset_class == "equity" and market_scope == "A_share":
            macro_mode = "screen" if requested_macro_mode is None else str(requested_macro_mode)
            if macro_mode not in MACRO_MODES:
                raise ValueError("methodology.macro_mode 必须是 screen 或 deep")
        elif requested_macro_mode is not None:
            raise ValueError("methodology.macro_mode 只适用于 asset_class=equity 的A股任务")

        judgment_types = self._unique(specification.get("judgment_types", []))
        judgment_types_defaulted = False
        if equity_research_design_required and not judgment_types:
            judgment_types = list(A_SHARE_COMPLETE_JUDGMENT_TYPES)
            judgment_types_defaulted = True
        causal_identification_required = bool(set(judgment_types) & CAUSAL_JUDGMENT_TYPES)
        causal_runtime_required = (
            causal_identification_required and request.get("mode") in EQUITY_RESEARCH_MODES
        )
        research_design_required = (
            equity_research_design_required
            or strategic_research_design_required
            or causal_runtime_required
        )
        framework_refs = self._unique(specification.get("framework_refs", []))
        if macro_mode is not None:
            framework_refs = self._unique([*framework_refs, *EQUITY_MACRO_FRAMEWORK_REFS])
        if equity_research_design_required:
            framework_refs = self._unique([*framework_refs, *A_SHARE_COMPLETE_FRAMEWORK_REFS])
        explicit_methods = self._unique(specification.get("evidence_method_refs", []))
        domain = specification.get("domain")

        method_refs = list(explicit_methods)
        reasoning_method_refs = (
            list(self.reasoning_registry.get("common_refs", []))
            if judgment_types or research_design_required else []
        )
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
        if equity_research_design_required:
            reasoning_method_refs.extend(["R09", "R10"])
        reasoning_method_refs = self._unique(reasoning_method_refs)
        for framework_ref in framework_refs:
            if framework_ref not in self.frameworks:
                raise ValueError(f"未知研究框架: {framework_ref}")
        for method_ref in method_refs:
            if method_ref not in self.methods:
                raise ValueError(f"未知取证方法: {method_ref}")
        if domain is not None and str(domain) not in self.catalogs:
            raise ValueError(f"未知领域方法目录: {domain}")

        lens_refs = self._unique(specification.get("analyst_lens_refs", []))
        lens_horizon = specification.get("analyst_lens_horizon")
        lens_reasons = specification.get("analyst_lens_selection_reasons") or {}
        window = request.get("forecast_window") or {}
        information_cutoff = request.get("information_cutoff") or request.get("as_of")
        if information_cutoff is None and isinstance(window, dict):
            information_cutoff = window.get("information_cutoff")
        if lens_refs:
            if market_scope is None or lens_horizon not in ANALYST_LENS_HORIZONS:
                raise ValueError("选择分析师视角须显式声明 market_scope 和 analyst_lens_horizon")
            if not isinstance(lens_reasons, dict):
                raise ValueError("analyst_lens_selection_reasons 必须是对象")
            for lens_ref in lens_refs:
                card = self.analyst_lenses.get(lens_ref)
                if card is None:
                    raise ValueError(f"未知分析师视角: {lens_ref}")
                if market_scope not in card["applicable_markets"] or lens_horizon not in card["applicable_horizons"]:
                    raise ValueError(f"分析师视角 {lens_ref} 不适用于所声明市场或期限")
                if not str(lens_reasons.get(lens_ref, "")).strip():
                    raise ValueError(f"分析师视角 {lens_ref} 缺少按问题相关性选择的理由")
                if not set(card["framework_refs"]).intersection(framework_refs):
                    raise ValueError(f"分析师视角 {lens_ref} 缺少对应的已选研究框架")
                if information_cutoff is not None:
                    try:
                        cutoff_date = date.fromisoformat(str(information_cutoff)[:10])
                    except ValueError as exc:
                        raise ValueError("information_cutoff 日期无效") from exc
                    for source in [card["source"], *card["related_primary_sources"]]:
                        published_on = str(source["published_on"])
                        if (len(published_on) == 7 and published_on >= cutoff_date.strftime("%Y-%m")) or (
                            len(published_on) == 10 and published_on > cutoff_date.isoformat()
                        ):
                            raise ValueError(f"分析师视角 {lens_ref} 的原文晚于或无法确认早于信息截面")
        elif lens_horizon is not None or lens_reasons:
            raise ValueError("未选择分析师视角时不得声明视角期限或选择理由")

        relative = lambda path: str(path.relative_to(self.root.parent))
        confirmed_principle_refs = [
            ref for ref, card in sorted(self.personal_principles.items())
            if equity_research_design_required
            and card["status"] == "confirmed"
            and card["market_scope"] == market_scope
            and request.get("mode") in card["modes"]
        ]
        explicit_framework_refs = set(self._unique(specification.get("framework_refs", [])))
        framework_selection_reasons = {
            ref: (
                "研究请求显式指定；研究设计仍须核验问题相关性"
                if ref in explicit_framework_refs else (
                "A股权益宏观三问筛查的已登记框架依赖"
                if ref in EQUITY_MACRO_FRAMEWORK_REFS else
                "A股完整权益研究默认核心框架，用于组织宏观、产业、公司、预期与估值传导"
                )
            )
            for ref in framework_refs
        }
        personal_principle_selection_reasons = {
            ref: "用户已确认，且适用于本请求的A股市场与研究模式"
            for ref in confirmed_principle_refs
        }
        research_design_contract = None
        equity_report_contract = None
        if research_design_required:
            required_design_fields = [
                "information_cutoff", "horizon", "decision_use", "primary_question",
                "main_contradiction", "hypotheses", "evidence_plan", "framework_refs",
                "framework_selection_reasons", "stop_conditions", "monitoring_triggers",
            ]
            if causal_identification_required:
                required_design_fields.append("causal_design_refs")
            research_design_contract = {
                "information_cutoff": information_cutoff,
                "decision_use": request.get("decision_use"),
                "primary_question": request.get("question"),
                "required_fields": required_design_fields,
                "framework_refs": framework_refs,
                "personal_principle_refs": confirmed_principle_refs,
                "analyst_lens_refs": lens_refs,
                "causal_identification_required": causal_identification_required,
                "judgment_types": judgment_types,
                "judgment_types_defaulted": judgment_types_defaulted,
            }
        if equity_research_design_required:
            equity_report_contract = {
                "template_ref": "研究能力/报告模板/a_share_equity_thesis.md",
                "information_cutoff": information_cutoff,
                "required_fields": [
                    "information_cutoff", "research_scope", "market_implied_view",
                    "research_difference", "shortest_evidence_chain", "decisive_falsifier",
                    "verification_window", "thesis_status", "macro_context_ref",
                    "evidence_handoff_ref", "judgment_refs", "fundamental_judgment",
                    "expectation_and_valuation", "industry_style_mapping",
                    "weakest_link", "monitoring_triggers",
                ],
                "forbidden_fields": ["trade_action", "position_size", "target_price", "timing_signal"],
                "causal_identification_required": causal_identification_required,
            }
        final_artifact_validation_contract = None
        if equity_research_design_required:
            final_artifact_validation_contract = {
                "required": True,
                "validator_role": "independent_final_artifact_validator",
                "independent_from_production": True,
                "allowed_verdicts": ["pass", "needs_revision", "block"],
                "required_for_approval": "pass",
                "required_categories": [
                    "numbers_and_calculations",
                    "evidence_boundary",
                    "logic_and_counterevidence",
                    "report_boundary",
                    "language_quality",
                    "question_coverage",
                ],
            }
        causal_design_contract = None
        causal_assessment_contract = None
        if causal_identification_required:
            causal_design_contract = {
                "version": CAUSAL_CONTRACT_VERSION,
                "required_candidate_structures": [
                    "forward_a_to_b", "reverse_b_to_a", "common_cause",
                ],
                "required_diagnostics": [
                    "temporality", "mechanism", "exposure_contrast",
                    "reverse_direction", "common_cause",
                ],
            }
            causal_assessment_contract = {
                "version": CAUSAL_CONTRACT_VERSION,
                "relationship_conclusions": [
                    "forward_a_to_b", "reverse_b_to_a", "common_cause", "bidirectional",
                    "multiple_causes", "association_only", "unresolved",
                ],
                "causal_statuses": [
                    "identified", "strongly_supported", "partially_supported",
                    "consistent_only", "not_identified", "contradicted",
                ],
            }
        return {
            "declared": bool(specification),
            "asset_class": asset_class,
            "market_scope": market_scope,
            "macro_mode": macro_mode,
            "macro_context_required": macro_mode is not None,
            "macro_context_contract": self._macro_context_contract() if macro_mode is not None else None,
            "research_design_required": research_design_required,
            "research_design_contract": research_design_contract,
            "equity_report_contract": equity_report_contract,
            "final_artifact_validation_required": final_artifact_validation_contract is not None,
            "final_artifact_validation_contract": final_artifact_validation_contract,
            "causal_identification_required": causal_identification_required,
            "causal_runtime_required": causal_runtime_required,
            "causal_contract_version": (
                CAUSAL_CONTRACT_VERSION if causal_identification_required else None
            ),
            "causal_design_contract": causal_design_contract,
            "causal_assessment_contract": causal_assessment_contract,
            "personal_principle_refs": confirmed_principle_refs,
            "personal_principles": {ref: self.personal_principles[ref] for ref in confirmed_principle_refs},
            "personal_principle_selection_reasons": personal_principle_selection_reasons,
            "judgment_types": judgment_types,
            "judgment_types_defaulted": judgment_types_defaulted,
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
            "framework_selection_reasons": framework_selection_reasons,
            "framework_files": [relative(self.framework_files[item]) for item in framework_refs],
            "domain": domain,
            "domain_catalog": relative(self.catalogs[str(domain)]) if domain is not None else None,
            "analyst_lens_refs": lens_refs,
            "analyst_lens_horizon": lens_horizon,
            "analyst_lens_selection_reasons": {ref: str(lens_reasons[ref]) for ref in lens_refs},
            "analyst_lens_cards": {ref: self.analyst_lenses[ref] for ref in lens_refs},
            "authority": {
                "method_registry": relative(self.evidence_registry_path),
                "reasoning_registry": relative(self.reasoning_registry_path),
                "framework_registry": relative(self.framework_registry_path),
                "analyst_lens_registry": relative(self.analyst_lens_registry_path),
                "personal_principle_registry": relative(self.personal_principle_registry_path),
                "personal_case_ledger": relative(self.personal_case_ledger_path),
                "public_source_index": relative(self.public_source_index_path),
            },
        }

    def prepare_analyst_lens_disclosures(
        self, assessments: list[dict[str, Any]], selected_refs: list[str]
    ) -> dict[str, Any]:
        """仅披露实质改变解释或监测的视角；证据按唯一引用汇总，不给视角计票。"""

        if not isinstance(assessments, list):
            raise ValueError("分析师视角评估必须是列表")
        selected = set(selected_refs)
        disclosures: list[dict[str, Any]] = []
        unique_evidence_refs: set[str] = set()
        for assessment in assessments:
            if not isinstance(assessment, dict):
                raise ValueError("分析师视角评估条目必须是对象")
            lens_ref = assessment.get("lens_ref")
            if lens_ref not in selected or lens_ref not in self.analyst_lenses:
                raise ValueError(f"分析师视角 {lens_ref} 未在研究设计中选择")
            if set(assessment).intersection({"vote", "votes", "weight", "score"}):
                raise ValueError("分析师视角不得投票或加权")
            effect = assessment.get("material_effect")
            if effect not in ANALYST_LENS_EFFECTS:
                raise ValueError("分析师视角 material_effect 无效")
            if effect == "none":
                continue
            card = self.analyst_lenses[lens_ref]
            available_sources = {
                source["id"]: source for source in [card["source"], *card["related_primary_sources"]]
            }
            source_refs = self._unique(assessment.get("source_refs"))
            if not source_refs or set(source_refs) - set(available_sources):
                raise ValueError("实质影响报告的视角须引用所用原文")
            support = self._unique_nonempty(assessment.get("support_evidence_refs"))
            counter = self._unique_nonempty(assessment.get("counter_evidence_refs"))
            if not support or not str(assessment.get("counterevidence", "")).strip() or not str(
                assessment.get("conclusion_effect", "")
            ).strip():
                raise ValueError("实质影响报告的视角须写明支持、反证和结论影响")
            disclosures.append(
                {
                    "lens_ref": lens_ref,
                    "author": card["author"],
                    "sources": [available_sources[ref] for ref in source_refs],
                    "material_effect": effect,
                    "support_evidence_refs": support,
                    "counter_evidence_refs": counter,
                    "counterevidence": str(assessment["counterevidence"]),
                    "conclusion_effect": str(assessment["conclusion_effect"]),
                }
            )
            unique_evidence_refs.update(support)
            unique_evidence_refs.update(counter)
        return {"disclosures": disclosures, "unique_evidence_refs": sorted(unique_evidence_refs)}

    @staticmethod
    def _macro_context_contract() -> dict[str, Any]:
        return {
            "required_fields": [
                "as_of",
                "horizon",
                "mode",
                "economic_direction",
                "policy_stance",
                "funding_conditions",
                "regime_synthesis",
                "stop_conditions",
                "monitoring_triggers",
                "downstream_handoffs",
            ],
            "economic_direction_values": ["improving", "stable", "weakening", "mixed", "unknown"],
            "policy_stance_values": ["supportive", "neutral", "restrictive", "mixed", "unknown"],
            "funding_condition_values": ["loose", "balanced", "tight", "mixed", "unknown"],
            "alignment_values": ["aligned", "divergent", "uncertain"],
            "materiality_values": ["high", "medium", "low"],
            "forbidden_outputs": ["single_macro_score", "stock_direction", "position", "market_timing"],
        }

    def validate_macro_context(self, context: dict[str, Any]) -> dict[str, Any]:
        """校验权益宏观三问输出，阻止单指标和跨层跳步形成强结论。"""

        if not isinstance(context, dict):
            raise ValueError("macro_context 必须是对象")
        contract = self._macro_context_contract()
        missing = [field for field in contract["required_fields"] if field not in context]
        if missing:
            raise ValueError(f"macro_context 缺少必填字段: {missing}")
        if context["mode"] not in MACRO_MODES:
            raise ValueError("macro_context.mode 必须是 screen 或 deep")

        economy = self._require_mapping(context, "economic_direction")
        self._validate_axis(economy, "economic_direction", set(contract["economic_direction_values"]))
        if economy["conclusion"] in {"improving", "stable", "weakening"}:
            axes = self._unique_nonempty(economy.get("state_axes"))
            if len(axes) < 2:
                raise ValueError("经济走向的方向性结论至少需要两个状态轴")

        policy = self._require_mapping(context, "policy_stance")
        self._validate_axis(policy, "policy_stance", set(contract["policy_stance_values"]))
        if policy["conclusion"] in {"supportive", "neutral", "restrictive"}:
            layers = set(self._unique_nonempty(policy.get("evidence_layers")))
            if not {"tool", "execution"}.issubset(layers):
                raise ValueError("有效政策立场至少需要工具和执行证据，政策表态不能单独定性")

        funding = self._require_mapping(context, "funding_conditions")
        entity = self._require_mapping(funding, "entity_financing", prefix="funding_conditions")
        market = self._require_mapping(funding, "equity_market", prefix="funding_conditions")
        funding_values = set(contract["funding_condition_values"])
        self._validate_axis(entity, "funding_conditions.entity_financing", funding_values)
        self._validate_axis(market, "funding_conditions.equity_market", funding_values)
        if entity["conclusion"] in {"loose", "balanced", "tight"}:
            if len(self._unique_nonempty(entity.get("evidence_dimensions"))) < 2:
                raise ValueError("实体融资结论至少需要价格、数量、可得性、主体或用途中的两个证据维度")
        if market["conclusion"] in {"loose", "balanced", "tight"}:
            if len(self._unique_nonempty(market.get("evidence_channels"))) < 2:
                raise ValueError("A股资金结论至少需要两个相互独立的资金渠道")
            if market.get("net_equity_supply_checked") is not True:
                raise ValueError("A股资金结论必须核对权益净供给")
            if market.get("balance_or_stock_checked") is not True:
                raise ValueError("A股资金结论不能只依赖成交或单期流量")

        synthesis = self._require_mapping(context, "regime_synthesis")
        if synthesis.get("alignment") not in set(contract["alignment_values"]):
            raise ValueError("regime_synthesis.alignment 取值无效")
        if synthesis.get("target_materiality") not in set(contract["materiality_values"]):
            raise ValueError("regime_synthesis.target_materiality 取值无效")
        if synthesis["alignment"] == "aligned" and any(
            axis["conclusion"] in {"mixed", "unknown"} for axis in (economy, policy, entity, market)
        ):
            raise ValueError("存在 mixed 或 unknown 轴时不能输出 aligned")

        forbidden = set(contract["forbidden_outputs"])
        found = self._find_forbidden_keys(context, forbidden)
        if found:
            raise ValueError(f"macro_context 包含禁止输出: {sorted(found)}")
        return context

    @staticmethod
    def _require_mapping(container: dict[str, Any], key: str, prefix: str = "macro_context") -> dict[str, Any]:
        value = container.get(key)
        if not isinstance(value, dict):
            raise ValueError(f"{prefix}.{key} 必须是对象")
        return value

    @staticmethod
    def _validate_axis(axis: dict[str, Any], name: str, conclusions: set[str]) -> None:
        if axis.get("conclusion") not in conclusions:
            raise ValueError(f"{name}.conclusion 取值无效")
        if axis.get("confidence") not in CONFIDENCE_VALUES:
            raise ValueError(f"{name}.confidence 取值无效")

    @staticmethod
    def _unique_nonempty(values: Any) -> list[str]:
        if not isinstance(values, list):
            return []
        return list(dict.fromkeys(str(value) for value in values if str(value).strip()))

    @classmethod
    def _find_forbidden_keys(cls, value: Any, forbidden: set[str]) -> set[str]:
        if isinstance(value, dict):
            found = set(value).intersection(forbidden)
            for nested in value.values():
                found.update(cls._find_forbidden_keys(nested, forbidden))
            return found
        if isinstance(value, list):
            found: set[str] = set()
            for nested in value:
                found.update(cls._find_forbidden_keys(nested, forbidden))
            return found
        return set()

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
