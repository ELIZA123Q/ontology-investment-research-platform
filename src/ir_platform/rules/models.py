from __future__ import annotations

from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CapabilityDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    version: str
    input_types: list[str]
    output_types: list[str]
    handler_ref: str
    reads: list[str]
    writes: list[str]
    idempotent: bool
    max_retries: int = Field(ge=0)
    side_effects: bool
    parallel_safe: bool = False
    lifecycle_view: Literal["request", "design", "evidence", "reasoning", "publication"]

    @model_validator(mode="after")
    def validate_retry_policy(self) -> "CapabilityDefinition":
        if not self.idempotent and self.max_retries:
            raise ValueError("非幂等能力不得自动重试")
        if not set(self.output_types).issubset(self.writes):
            raise ValueError("Capability.output_types 必须全部位于 writes")
        return self


class LogicNodeDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    capability_ref: str
    dependencies: list[str] = Field(default_factory=list)
    activate_rule_refs: list[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)


class LogicDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    version: str
    goal_types: list[str]
    input_types: list[str]
    nodes: list[LogicNodeDefinition]
    completion_rule_refs: list[str]
    fallback_logic_refs: list[str]


class RuleDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    version: str
    kind: Literal["routing", "activation", "validation", "blocking", "scoring", "completion"]
    input_types: list[str]
    priority: int
    evaluation_phase: Literal["planning", "runtime", "both"] = "both"
    when: dict[str, Any]
    then: list[dict[str, Any]]
    failure_handling: str
    description: str | None = None

    RESULT_OPERATORS: ClassVar[set[str]] = {
        "invoke_logic",
        "invoke_capability",
        "block",
        "cap_judgment_level",
        "require_approval",
        "mark_goal_satisfied",
    }

    @model_validator(mode="after")
    def validate_machine_actions(self) -> "RuleDefinition":
        if not self.input_types:
            raise ValueError("Rule.input_types 不得为空")
        if not self.then:
            raise ValueError("Rule.then 不得为空")
        for action in self.then:
            if len(action) != 1:
                raise ValueError("每个规则结果必须只有一个操作符")
            operator = next(iter(action))
            if operator not in self.RESULT_OPERATORS:
                raise ValueError(f"不允许的规则结果: {operator}")
        return self
