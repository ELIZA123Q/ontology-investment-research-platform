from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from ir_platform.planning.models import ExecutionNode
from ir_platform.rules import CapabilityDefinition, CapabilityDefinitionRegistry
from ir_platform.runtime.models import RuntimeEntity


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

