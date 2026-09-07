from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class RuntimeEntity(BaseModel):
    """研究运行实体。进入图存储不代表成为语义本体类型。"""

    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    properties: dict[str, Any] = Field(default_factory=dict)
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    recorded_at: datetime = Field(default_factory=utc_now)
    invalidated_at: datetime | None = None
    supersedes: str | None = None
    bundle_id: str

    @field_validator("valid_from", "valid_until", "recorded_at", "invalidated_at")
    @classmethod
    def normalize_timezone(cls, value: datetime | None) -> datetime | None:
        return _aware(value)

    @model_validator(mode="after")
    def validate_time_order(self) -> "RuntimeEntity":
        if self.valid_from and self.valid_until and self.valid_from > self.valid_until:
            raise ValueError("valid_from 不得晚于 valid_until")
        if self.invalidated_at and self.invalidated_at < self.recorded_at:
            raise ValueError("invalidated_at 不得早于 recorded_at")
        if self.supersedes == self.id:
            raise ValueError("对象不能替代自身")
        return self

    def visible_at(self, valid_at: datetime | None, recorded_at: datetime | None) -> bool:
        valid_at = _aware(valid_at)
        recorded_at = _aware(recorded_at)
        if recorded_at and self.recorded_at > recorded_at:
            return False
        if recorded_at and self.invalidated_at and self.invalidated_at <= recorded_at:
            return False
        if valid_at and self.valid_from and valid_at < self.valid_from:
            return False
        if valid_at and self.valid_until and valid_at >= self.valid_until:
            return False
        return True


class RuntimeRelation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    source_id: str
    target_id: str
    properties: dict[str, Any] = Field(default_factory=dict)
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    recorded_at: datetime = Field(default_factory=utc_now)
    invalidated_at: datetime | None = None
    bundle_id: str

    @field_validator("valid_from", "valid_until", "recorded_at", "invalidated_at")
    @classmethod
    def normalize_timezone(cls, value: datetime | None) -> datetime | None:
        return _aware(value)

    @model_validator(mode="after")
    def validate_time_order(self) -> "RuntimeRelation":
        if self.valid_from and self.valid_until and self.valid_from > self.valid_until:
            raise ValueError("valid_from 不得晚于 valid_until")
        if self.invalidated_at and self.invalidated_at < self.recorded_at:
            raise ValueError("invalidated_at 不得早于 recorded_at")
        return self

    def visible_at(self, valid_at: datetime | None, recorded_at: datetime | None) -> bool:
        valid_at = _aware(valid_at)
        recorded_at = _aware(recorded_at)
        if recorded_at and self.recorded_at > recorded_at:
            return False
        if recorded_at and self.invalidated_at and self.invalidated_at <= recorded_at:
            return False
        if valid_at and self.valid_from and valid_at < self.valid_from:
            return False
        if valid_at and self.valid_until and valid_at >= self.valid_until:
            return False
        return True


class GraphBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bundle_id: str
    entities: list[RuntimeEntity] = Field(default_factory=list)
    relations: list[RuntimeRelation] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_identity_and_endpoints(self) -> "GraphBundle":
        ids = [item.id for item in self.entities]
        if len(ids) != len(set(ids)):
            raise ValueError("bundle 内实体 ID 重复")
        relation_ids = [item.id for item in self.relations]
        if len(relation_ids) != len(set(relation_ids)):
            raise ValueError("bundle 内关系 ID 重复")
        entity_ids = set(ids)
        for relation in self.relations:
            if relation.source_id not in entity_ids or relation.target_id not in entity_ids:
                raise ValueError(f"关系 {relation.id} 端点不在 bundle 中")
        return self


class RuleEvaluationRecord(BaseModel):
    rule_id: str
    rule_version: str
    matched: bool
    status: str
    input_refs: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)
    evaluated_at: datetime = Field(default_factory=utc_now)

