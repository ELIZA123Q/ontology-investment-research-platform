from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


THESIS_BLOCKING_STATUSES = {"not_formed", "blocked", "expired", "rewrite"}
REQUIRED_DIMENSIONS = {
    "exposure_coverage",
    "fundamental_capture",
    "expectation_gap",
    "valuation",
    "downside_risk",
    "implementability",
}
PROHIBITED_OUTPUTS = {
    "buy_sell_instruction",
    "position_or_allocation",
    "order_execution",
    "target_price",
    "return_promise",
    "market_timing",
}
PROHIBITED_KEYS = {
    "trade_action",
    "position_size",
    "target_price",
    "timing_signal",
    "return_promise",
    "order_instruction",
}


class ComparisonDimension(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    comparison_basis: str = Field(min_length=1)


class ComparisonScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_universe: str = Field(min_length=1)
    horizon: str = Field(min_length=1)
    benchmark: str = Field(min_length=1)
    common_dimensions: list[ComparisonDimension] = Field(min_length=1)


class SelectionEdgeBasis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    evidence_refs: list[str] = Field(min_length=1)
    independent_source_groups: list[str] = Field(min_length=1)


class IndustryDispersion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    level: Literal["high", "medium", "low", "unknown"]
    dimensions: list[str]
    evidence_refs: list[str]


class EtfCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_ref: str = Field(min_length=1)
    name: str = Field(min_length=1)
    index_or_strategy: str = Field(min_length=1)
    exposure_coverage: str = Field(min_length=1)
    concentration_risks: list[str]
    replication_or_tracking: str = Field(min_length=1)
    evidence_refs: list[str]


class EtfAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidates: list[EtfCandidate]
    coverage_gaps: list[str]


class StockCategory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_ref: str = Field(min_length=1)
    name: str = Field(min_length=1)
    definition: str = Field(min_length=1)
    advantage_hypothesis: str = Field(min_length=1)
    inclusion_rule: str = Field(min_length=1)
    evidence_refs: list[str]


class DimensionAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension_ref: str = Field(min_length=1)
    assessment: str = Field(min_length=1)
    value_or_band: str = Field(min_length=1)
    evidence_refs: list[str]


class CandidateRankingItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rank: int = Field(ge=1)
    object_ref: str = Field(min_length=1)
    name: str = Field(min_length=1)
    object_type: Literal["etf", "stock", "basket", "other"]
    category_ref: str = Field(min_length=1)
    dimension_assessments: list[DimensionAssessment] = Field(min_length=1)
    advantage_statement: str = Field(min_length=1)
    decisive_risks: list[str]
    evidence_refs: list[str]


class DecisiveTradeoff(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: str = Field(min_length=1)
    favors: Literal["etf", "stock", "hybrid", "insufficient"]
    explanation: str = Field(min_length=1)
    evidence_refs: list[str]


class InvalidationCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    condition: str = Field(min_length=1)
    observable_signal: str = Field(min_length=1)
    deadline: str = Field(min_length=1)
    consequence: str = Field(min_length=1)
    evidence_refs: list[str]


class ReportBoundary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conclusion_level: Literal["research_vehicle_comparison"]
    prohibited_outputs: list[str]


class DecisionComparison(BaseModel):
    model_config = ConfigDict(extra="forbid")

    information_cutoff: str = Field(min_length=1)
    a10_thesis_ref: str = Field(min_length=1)
    a10_thesis_status: Literal[
        "formed", "conditional", "watch", "not_formed", "blocked", "expired", "rewrite"
    ]
    decision_question: str = Field(min_length=1)
    comparison_scope: ComparisonScope
    preferred_vehicle: Literal["etf", "stock", "hybrid", "insufficient"]
    preferred_vehicle_rationale: str = Field(min_length=1)
    selection_edge: Literal["strong", "moderate", "weak", "none", "unknown"]
    selection_edge_basis: list[SelectionEdgeBasis]
    industry_dispersion: IndustryDispersion
    etf_analysis: EtfAnalysis
    stock_categories: list[StockCategory]
    candidate_ranking: list[CandidateRankingItem]
    decisive_tradeoffs: list[DecisiveTradeoff]
    invalidation_conditions: list[InvalidationCondition]
    confidence: Literal["high", "medium", "low"]
    limitations: list[str] = Field(min_length=1)
    report_boundary: ReportBoundary

    @model_validator(mode="after")
    def validate_contract(self) -> "DecisionComparison":
        dimension_ids = {item.id for item in self.comparison_scope.common_dimensions}
        missing = REQUIRED_DIMENSIONS - dimension_ids
        if missing:
            raise ValueError(f"决策比较缺少共同维度: {sorted(missing)}")
        if self.a10_thesis_status in THESIS_BLOCKING_STATUSES:
            if self.preferred_vehicle != "insufficient":
                raise ValueError("A10 未形成、阻断、过期或需重写时，载体比较必须为 insufficient")
        if self.preferred_vehicle != "insufficient" and not self.candidate_ranking:
            raise ValueError("可比较结论必须给出候选排序或研究优先级")
        if self.selection_edge in {"strong", "moderate"} and len(self.selection_edge_basis) < 2:
            raise ValueError("strong/moderate selection_edge 至少需要两个维度支持")
        for item in self.candidate_ranking:
            unknown_dimensions = {assessment.dimension_ref for assessment in item.dimension_assessments} - dimension_ids
            if unknown_dimensions:
                raise ValueError(f"候选对象引用未知比较维度: {sorted(unknown_dimensions)}")
        prohibited = set(self.report_boundary.prohibited_outputs)
        if not PROHIBITED_OUTPUTS.issubset(prohibited):
            raise ValueError("report_boundary 必须保留全部禁止输出边界")
        return self


def _contains_prohibited_key(value: Any) -> str | None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in PROHIBITED_KEYS:
                return key
            found = _contains_prohibited_key(nested)
            if found:
                return found
    if isinstance(value, list):
        for nested in value:
            found = _contains_prohibited_key(nested)
            if found:
                return found
    return None


def validate_decision_comparison(payload: dict[str, Any]) -> DecisionComparison:
    """Validate a research-vehicle comparison without turning it into trading advice."""

    raw = payload.get("decision_comparison", payload)
    if not isinstance(raw, dict):
        raise ValueError("decision_comparison 必须是对象")
    prohibited = _contains_prohibited_key(raw)
    if prohibited:
        raise ValueError(f"决策比较不得包含交易或执行字段: {prohibited}")
    return DecisionComparison.model_validate(raw)
