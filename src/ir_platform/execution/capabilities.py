from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from ir_platform.planning.models import ExecutionNode
from ir_platform.rules import CapabilityDefinition, CapabilityDefinitionRegistry
from ir_platform.runtime.models import RuntimeEntity
from ir_platform.source_index import PublicSourceIndex


@dataclass(frozen=True)
class CapabilityCall:
    bundle_id: str
    plan_id: str
    node: ExecutionNode
    definition: CapabilityDefinition
    inputs: list[RuntimeEntity]
    runtime_context: dict[str, Any]


CapabilityHandler = Callable[[CapabilityCall], list[RuntimeEntity]]


class CapabilityRegistry:
    """定义来自 YAML，处理器只能通过显式注册进入进程。"""

    def __init__(self, definitions: CapabilityDefinitionRegistry | None = None) -> None:
        self.definitions = definitions or CapabilityDefinitionRegistry()
        self._handlers: dict[str, CapabilityHandler] = {}
        for definition in self.definitions.all():
            if definition.handler_ref.startswith("builtin."):
                self._handlers[definition.handler_ref] = self._builtin_handler

    def register(self, handler_ref: str, handler: CapabilityHandler) -> None:
        if not handler_ref or handler_ref.startswith("builtin."):
            raise ValueError("自定义处理器必须使用非 builtin 的稳定 handler_ref")
        if handler_ref in self._handlers:
            raise ValueError(f"处理器已注册: {handler_ref}")
        self._handlers[handler_ref] = handler

    def resolve(self, capability_id: str) -> tuple[CapabilityDefinition, CapabilityHandler]:
        definition = self.definitions.resolve(capability_id)
        handler = self._handlers.get(definition.handler_ref)
        if handler is None:
            raise KeyError(f"能力 {capability_id} 的处理器未注册: {definition.handler_ref}")
        return definition, handler

    @staticmethod
    def _builtin_handler(call: CapabilityCall) -> list[RuntimeEntity]:
        supplied = (call.runtime_context.get("node_outputs") or {}).get(call.node.id)
        substantive_required = {
            "form_research_design": "ResearchDesign 必须提供有内容的设计输出，不得使用运行时占位对象",
            "form_macro_context": "MacroContext 必须提供宏观三问研判输出，不得使用运行时占位对象",
            "package_evidence_handoff": "EvidenceHandoff 必须提供结构化证据交接，不得使用运行时占位对象",
            "form_equity_hypotheses": "A股权益假设必须基于研究设计、宏观上下文和证据交接形成，不得使用运行时占位对象",
            "evaluate_causality": "CausalAssessment 必须由 Agent 按证据形成，不得使用运行时占位对象",
            "form_decision_comparison": "DecisionComparison 必须基于已裁决的 A10 判断形成，不得使用运行时占位对象",
            "validate_final_artifact": "FinalArtifactValidation 必须由独立成品验证形成，不得使用运行时占位对象",
        }
        if call.node.capability_ref in substantive_required and supplied is None:
            raise ValueError(substantive_required[call.node.capability_ref])
        if call.node.capability_ref == "resolve_semantic_context" and supplied is None:
            supplied = [
                {
                    "type": "SemanticContext",
                    "properties": {
                        "generated_by": call.node.capability_ref,
                        "methodology": call.node.parameters.get("methodology", {}),
                    },
                }
            ]
        if call.node.capability_ref == "acquire_evidence" and supplied is None:
            supplied = CapabilityRegistry._source_index_documents(call)
        if call.node.capability_ref == "publish_report" and call.node.parameters.get("equity_report_contract") and supplied is None:
            drafts = [
                item for item in call.inputs
                if item.type == "DraftReport" and item.properties.get("plan_id") == call.plan_id
            ]
            if len(drafts) != 1 or not drafts[0].properties.get("content_markdown"):
                raise ValueError("本轮A股权益研究缺少可发布的报告正文")
            supplied = [{
                "type": "PublishedReport",
                "properties": {
                    **drafts[0].properties,
                    "generated_by": call.node.capability_ref,
                },
            }]
        now = call.runtime_context.get("recorded_at") or datetime.now(timezone.utc)
        if isinstance(now, str):
            now = datetime.fromisoformat(now.replace("Z", "+00:00"))
        if supplied is None:
            supplied = [
                {
                    "id": f"{call.bundle_id}:{call.node.id}:{output_type}:1",
                    "type": output_type,
                    "properties": {"generated_by": call.node.capability_ref},
                }
                for output_type in call.definition.output_types
            ]
        if not isinstance(supplied, list):
            raise ValueError(f"节点 {call.node.id} 的 node_outputs 必须是列表")
        result: list[RuntimeEntity] = []
        for index, raw in enumerate(supplied):
            if not isinstance(raw, dict):
                raise ValueError(f"节点 {call.node.id} 输出 {index} 不是对象")
            payload = dict(raw)
            payload.setdefault("id", f"{call.bundle_id}:{call.node.id}:result:{index + 1}")
            payload.setdefault("recorded_at", now)
            payload.setdefault("bundle_id", call.bundle_id)
            result.append(RuntimeEntity.model_validate(payload))
        return result

    @staticmethod
    def _source_index_documents(call: CapabilityCall) -> list[dict[str, Any]]:
        methodology = {}
        for item in call.inputs:
            if item.type == "SemanticContext":
                methodology = item.properties.get("methodology") or {}
                break
        market = methodology.get("market_scope")
        if market == "A_share":
            market = "A股"
        domain = methodology.get("domain")
        selected = PublicSourceIndex().select(market=market, domain=domain)
        if domain:
            selected = sorted(
                selected,
                key=lambda family: (
                    domain not in family.domains,
                    "general" in family.domains,
                    family.id,
                ),
            )
        now = call.runtime_context.get("recorded_at") or datetime.now(timezone.utc)
        if isinstance(now, str):
            now = datetime.fromisoformat(now.replace("Z", "+00:00"))
        return [
            {
                "id": f"{call.bundle_id}:{call.node.id}:source-family:{family.id}",
                "type": "SourceDocument",
                "properties": {
                    "title": f"候选公开来源族：{family.producer}",
                    "source_type": "public_source_family",
                    "locator": str(family.official_entry_url),
                    "captured_at": now.isoformat(),
                    "producer": family.producer,
                    "source_family_id": family.id,
                    "official_entry_url": str(family.official_entry_url),
                    "query_playbook_ref": family.query_playbook_ref,
                    "source_roles": family.source_roles,
                    "independence_group": family.independence_group,
                    "required_locator_level": family.required_locator_level,
                    "known_limitations": family.known_limitations,
                    "formal_fact_policy": "candidate_source_only",
                },
            }
            for family in selected[:8]
        ]
