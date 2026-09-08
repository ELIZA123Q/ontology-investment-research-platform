from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProposedNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    capability_ref: str
    dependencies: list[str] = Field(default_factory=list)
    activate_rule_refs: list[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)
    requested_writes: list[str] = Field(default_factory=list)


class PlanProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    request_id: str
    logic_ref: str
    selection_rule_refs: list[str]
    nodes: list[ProposedNode]
    initial_types: list[str] = Field(default_factory=lambda: ["ResearchRequest"])
    awaitable_types: list[str] = Field(default_factory=list)
    goal_types: list[str]
    proposed_by: str = "deterministic-planner"
    context: dict[str, Any] = Field(default_factory=dict)


class ExecutionNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    capability_ref: str
    capability_version: str
    dependencies: list[str]
    activate_rule_refs: list[str]
    selection_rule_refs: list[str]
    parameters: dict[str, Any]
    input_types: list[str]
    output_types: list[str]
    reads: list[str]
    writes: list[str]
    idempotent: bool
    max_retries: int
    side_effects: bool
    parallel_safe: bool
    lifecycle_view: str


class ExecutionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    request_id: str
    logic_ref: str
    logic_version: str
    selection_rule_refs: list[str]
    revision: int = Field(ge=1)
    supersedes: str | None = None
    nodes: list[ExecutionNode]
    initial_types: list[str]
    awaitable_types: list[str]
    goal_types: list[str]
    completion_rule_refs: list[str]
    planning_context: dict[str, Any]
    compiled_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    proposal_id: str
    content_hash: str = ""

    @model_validator(mode="after")
    def set_content_hash(self) -> "ExecutionPlan":
        payload = self.model_dump(mode="json", exclude={"content_hash", "compiled_at"})
        digest = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        if self.content_hash and self.content_hash != digest:
            raise ValueError("ExecutionPlan.content_hash 与内容不一致")
        self.content_hash = digest
        return self
