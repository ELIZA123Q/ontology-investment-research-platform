from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


EvidenceRole = Literal["primary", "baseline", "mechanism", "cross_check", "counter"]
CoverageStatus = Literal["covered", "partial", "missing"]
Completeness = Literal["sufficient", "limited", "observation", "unusable"]


class EvidenceSourceRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    producer: str = Field(min_length=1)
    title: str = Field(min_length=1)
    source_type: Literal[
        "official_primary",
        "issuer_disclosure",
        "direct_measurement",
        "professional_secondary",
        "news",
        "search_result",
        "ai_summary",
    ]
    source_roles: list[EvidenceRole] = Field(min_length=1)
    publication_date: date
    captured_at: datetime
    original_url: HttpUrl
    access_method: str = Field(min_length=1)
    version_or_period: str = Field(min_length=1)
    independence_group: str = Field(min_length=1)
    query_playbook_ref: str = Field(min_length=1)


class EvidenceClaimRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    task_ref: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    source_ref: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    business_time: str = Field(min_length=1)
    scope: str = Field(min_length=1)
    metric_definition: str = Field(min_length=1)
    unit: str = Field(min_length=1)
    claim_kind: Literal["hard_fact", "context", "interpretation"]
    numeric: bool = False

    @model_validator(mode="after")
    def validate_claim_contract(self) -> "EvidenceClaimRecord":
        if self.numeric and self.unit.lower() in {"not_applicable", "n/a", "na"}:
            raise ValueError(f"数值主张 {self.id} 必须有实际单位")
        normalized_locator = self.locator.strip().lower()
        if normalized_locator in {"unknown", "n/a", "na", "原文", "正文", "未定位"} or "未定位" in normalized_locator:
            raise ValueError(f"主张 {self.id} 必须定位到页码、表格、段落、时间戳或字段")
        return self


class EvidenceObservationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    claim_refs: list[str] = Field(min_length=1)
    metric: str = Field(min_length=1)
    value: str | int | float
    unit: str = Field(min_length=1)
    business_time: str = Field(min_length=1)
    scope: str = Field(min_length=1)


class EvidenceCalculationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    input_refs: list[str] = Field(min_length=1)
    formula: str = Field(min_length=1)
    result: str | int | float
    unit: str = Field(min_length=1)


class EvidenceConflictRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    claim_refs: list[str] = Field(min_length=2)
    status: Literal["explained", "unresolved"]
    explanation: str = Field(min_length=1)


class CounterSearchRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    task_ref: str = Field(min_length=1)
    query: str = Field(min_length=1)
    scope: str = Field(min_length=1)
    searched_source_refs: list[str]
    result: str = Field(min_length=1)
    captured_at: datetime


class EvidenceGapRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    task_ref: str = Field(min_length=1)
    gap_type: Literal[
        "access_denied",
        "channel_error",
        "field_unavailable",
        "scope_mismatch",
        "time_mismatch",
        "trace_missing",
        "method_opaque",
        "source_not_found",
        "domain_measurement_missing",
    ]
    required_role: EvidenceRole
    description: str = Field(min_length=1)
    attempts: list[str] = Field(min_length=1)
    impact: str = Field(min_length=1)


class StopDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    continue_research: bool
    reason: str = Field(min_length=1)
    upgrade_evidence_needed: list[str]


class EvidenceHandoff(BaseModel):
    model_config = ConfigDict(extra="forbid")

    information_cutoff: datetime
    task_refs: list[str] = Field(min_length=1)
    sources: list[EvidenceSourceRecord]
    claims: list[EvidenceClaimRecord]
    observations: list[EvidenceObservationRecord]
    calculations: list[EvidenceCalculationRecord]
    coverage_by_role: dict[str, dict[EvidenceRole, CoverageStatus]]
    source_independence_groups: dict[str, list[str]]
    conflicts: list[EvidenceConflictRecord]
    counter_searches: list[CounterSearchRecord]
    gaps: list[EvidenceGapRecord]
    completeness: Completeness
    stop_decision: StopDecision

    @model_validator(mode="after")
    def validate_lineage_and_cutoff(self) -> "EvidenceHandoff":
        if len(self.task_refs) != len(set(self.task_refs)):
            raise ValueError("task_refs 不得重复")
        task_ids = set(self.task_refs)
        source_by_id = self._unique(self.sources, "来源")
        claim_by_id = self._unique(self.claims, "主张")
        observation_by_id = self._unique(self.observations, "观测")
        self._unique(self.calculations, "计算")
        self._unique(self.conflicts, "冲突")
        self._unique(self.counter_searches, "反证查询")
        self._unique(self.gaps, "证据缺口")

        cutoff = self.information_cutoff.date()
        for source in self.sources:
            if source.publication_date > cutoff:
                raise ValueError(f"来源 {source.id} 晚于信息截面")
        ineligible = {"search_result", "ai_summary"}
        hard_fact_sources = {"official_primary", "issuer_disclosure", "direct_measurement"}
        for claim in self.claims:
            if claim.task_ref not in task_ids:
                raise ValueError(f"主张 {claim.id} 引用未知任务 {claim.task_ref}")
            source = source_by_id.get(claim.source_ref)
            if source is None:
                raise ValueError(f"主张 {claim.id} 引用未知来源 {claim.source_ref}")
            if source.source_type in ineligible:
                raise ValueError(f"主张 {claim.id} 不得由搜索结果或 AI 摘要产生")
            if claim.claim_kind == "hard_fact" and source.source_type not in hard_fact_sources:
                raise ValueError(f"硬事实主张 {claim.id} 缺少原始或直接测量来源")

        for counter_search in self.counter_searches:
            unknown = set(counter_search.searched_source_refs) - set(source_by_id)
            if unknown:
                raise ValueError(f"反证查询 {counter_search.id} 引用未知来源: {sorted(unknown)}")

        for observation in self.observations:
            unknown = set(observation.claim_refs) - set(claim_by_id)
            if unknown:
                raise ValueError(f"观测 {observation.id} 引用未知主张: {sorted(unknown)}")
        valid_inputs = set(claim_by_id) | set(observation_by_id)
        for calculation in self.calculations:
            unknown = set(calculation.input_refs) - valid_inputs
            if unknown:
                raise ValueError(f"计算 {calculation.id} 引用未知输入: {sorted(unknown)}")
        for conflict in self.conflicts:
            unknown = set(conflict.claim_refs) - set(claim_by_id)
            if unknown:
                raise ValueError(f"冲突 {conflict.id} 引用未知主张: {sorted(unknown)}")

        grouped: set[str] = set()
        for group, refs in self.source_independence_groups.items():
            if not group or not refs:
                raise ValueError("独立来源组名称和成员不得为空")
            for ref in refs:
                source = source_by_id.get(ref)
                if source is None:
                    raise ValueError(f"独立来源组引用未知来源 {ref}")
                if source.independence_group != group:
                    raise ValueError(f"来源 {ref} 的独立来源组不一致")
                if ref in grouped:
                    raise ValueError(f"来源 {ref} 被重复计入独立来源组")
                grouped.add(ref)
        if grouped != set(source_by_id):
            raise ValueError("所有来源必须且只能进入一个独立来源组")

        lineage_groups: dict[tuple[str, str, str], str] = {}
        for source in self.sources:
            lineage_key = (source.producer.casefold(), source.title.casefold(), source.version_or_period.casefold())
            prior_group = lineage_groups.setdefault(lineage_key, source.independence_group)
            if prior_group != source.independence_group:
                raise ValueError(f"同一原始数据链的镜像不得计入不同独立来源组: {source.id}")

        for task_ref, roles in self.coverage_by_role.items():
            if task_ref not in task_ids:
                raise ValueError(f"证据覆盖引用未知任务 {task_ref}")
            if "primary" not in roles:
                raise ValueError(f"取证任务 {task_ref} 必须记录 primary 角色的覆盖或缺口")
            for role, status in roles.items():
                if status == "covered" and not any(
                    claim.task_ref == task_ref and role in source_by_id[claim.source_ref].source_roles
                    for claim in self.claims
                ):
                    raise ValueError(f"任务 {task_ref} 的 {role} 没有对应来源主张")
                if status in {"partial", "missing"} and not any(
                    gap.task_ref == task_ref and gap.required_role == role for gap in self.gaps
                ):
                    raise ValueError(f"任务 {task_ref} 的 {role} 缺口未结构化记录")
        if set(self.coverage_by_role) != task_ids:
            raise ValueError("每个取证任务都必须记录角色覆盖")
        tasks_requiring_counter_search = {
            task_ref for task_ref, roles in self.coverage_by_role.items() if "counter" in roles
        }
        tasks_with_counter_search = {item.task_ref for item in self.counter_searches}
        missing_counter_searches = tasks_requiring_counter_search - tasks_with_counter_search
        if missing_counter_searches:
            raise ValueError(f"取证任务缺少反证查询记录: {sorted(missing_counter_searches)}")
        if any(item.task_ref not in task_ids for item in [*self.counter_searches, *self.gaps]):
            raise ValueError("反证查询或证据缺口引用未知任务")
        if self.completeness == "sufficient" and any(
            status != "covered" for roles in self.coverage_by_role.values() for status in roles.values()
        ):
            raise ValueError("存在部分或缺失证据角色时完备度不得为 sufficient")
        if not self.claims and self.completeness != "unusable":
            raise ValueError("没有可用主张时完备度必须为 unusable")
        return self

    @staticmethod
    def _unique(items: list[BaseModel], label: str) -> dict[str, BaseModel]:
        result: dict[str, BaseModel] = {}
        for item in items:
            identifier = str(getattr(item, "id"))
            if identifier in result:
                raise ValueError(f"{label} ID 重复: {identifier}")
            result[identifier] = item
        return result


class EvidenceHandoffEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_handoff: EvidenceHandoff


def validate_evidence_handoff(payload: dict) -> EvidenceHandoffEnvelope:
    """Validate an agent-produced evidence handoff before reasoning consumes it."""

    return EvidenceHandoffEnvelope.model_validate(payload)
