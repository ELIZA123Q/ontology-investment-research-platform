from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


RelationshipConclusion = Literal[
    "forward_a_to_b",
    "reverse_b_to_a",
    "common_cause",
    "bidirectional",
    "multiple_causes",
    "association_only",
    "unresolved",
]
CausalStatus = Literal[
    "identified",
    "strongly_supported",
    "partially_supported",
    "consistent_only",
    "not_identified",
    "contradicted",
]
DiagnosticType = Literal[
    "temporality",
    "mechanism",
    "exposure_contrast",
    "reverse_direction",
    "common_cause",
    "negative_control",
    "placebo",
    "pretrend",
    "robustness",
]
DiagnosticStatus = Literal["passed", "weakened", "rejected", "inconclusive", "not_applicable"]
IdentificationStrategy = Literal[
    "randomized_experiment",
    "natural_experiment",
    "difference_in_differences",
    "regression_discontinuity",
    "instrumental_variable",
    "synthetic_control",
    "event_study",
    "exposure_comparison",
    "process_tracing",
    "observational_triangulation",
    "descriptive_only",
]
ClaimLanguageLevel = Literal[
    "direct_causal",
    "supported_causal",
    "possible_contribution",
    "association_only",
    "unidentified",
    "causal_rejection",
]

MANDATORY_STRUCTURES = {"forward_a_to_b", "reverse_b_to_a", "common_cause"}
MANDATORY_DIAGNOSTICS = {
    "temporality",
    "mechanism",
    "exposure_contrast",
    "reverse_direction",
    "common_cause",
}
IDENTIFICATION_STRATEGIES = {
    "randomized_experiment",
    "natural_experiment",
    "difference_in_differences",
    "regression_discontinuity",
    "instrumental_variable",
    "synthetic_control",
}
QUASI_EXPERIMENT_STRATEGIES = IDENTIFICATION_STRATEGIES - {"randomized_experiment"}
DIRECT_CAUSAL_TERMS = (
    "导致",
    "造成",
    "决定了",
    "主要由",
    "源于",
    "causes",
    "caused by",
    "results in",
)
NEGATED_CAUSAL_PATTERNS = (
    r"不支持.{0,20}(?:导致|造成|主要由|源于)",
    r"(?:并未|未能|不一定).{0,20}(?:导致|造成|主要由|源于)",
    r"(?:没有|缺少)证据.{0,20}(?:导致|造成|主要由|源于)",
    r"(?:尚)?不能(?:说明|证明|确认|认定|说|写成).{0,20}(?:导致|造成|主要由|源于)",
    r"无法(?:说明|证明|确认|区分).{0,20}(?:导致|造成|主要由|源于)",
)


class CausalCandidateStructure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relationship: Literal[
        "forward_a_to_b", "reverse_b_to_a", "common_cause", "bidirectional"
    ]
    statement: str = Field(min_length=1)
    directed_edges: list[str] = Field(min_length=1)
    observable_predictions: list[str] = Field(min_length=1)
    falsifier: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_structure(self) -> "CausalCandidateStructure":
        if self.relationship == "common_cause" and len(self.directed_edges) < 2:
            raise ValueError("共同原因结构必须同时记录 C→A 和 C→B")
        if self.relationship == "bidirectional" and len(self.directed_edges) < 2:
            raise ValueError("双向结构必须分别记录 A→B 和 B→A")
        return self


class CausalEvidenceTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_ref: str = Field(min_length=1)
    diagnostic_type: DiagnosticType
    target_structure: str = Field(min_length=1)
    question: str = Field(min_length=1)
    evidence_roles: list[Literal["primary", "baseline", "mechanism", "cross_check", "counter"]] = Field(
        min_length=1
    )


class CausalDesign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    causal_question: str = Field(min_length=1)
    cause_a: str = Field(min_length=1)
    outcome_b: str = Field(min_length=1)
    unit_of_analysis: str = Field(min_length=1)
    scope: str = Field(min_length=1)
    business_window: str = Field(min_length=1)
    lag_hypothesis: str = Field(min_length=1)
    causal_estimand: str = Field(min_length=1)
    counterfactual: str = Field(min_length=1)
    candidate_structures: list[CausalCandidateStructure] = Field(min_length=3)
    confounders: list[str]
    confounder_search: str = Field(min_length=1)
    mediators: list[str]
    colliders: list[str]
    identification_strategy: IdentificationStrategy
    identification_assumptions: list[str] = Field(min_length=1)
    evidence_tasks: list[CausalEvidenceTask] = Field(min_length=5)
    downgrade_if_missing: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_competing_structures_and_tasks(self) -> "CausalDesign":
        structures = [item.relationship for item in self.candidate_structures]
        if len(structures) != len(set(structures)):
            raise ValueError("因果候选结构不得重复")
        missing_structures = MANDATORY_STRUCTURES - set(structures)
        if missing_structures:
            raise ValueError(f"因果设计缺少必要候选结构: {sorted(missing_structures)}")
        task_refs = [item.task_ref for item in self.evidence_tasks]
        if len(task_refs) != len(set(task_refs)):
            raise ValueError("因果证据任务引用不得重复")
        missing_diagnostics = MANDATORY_DIAGNOSTICS - {
            item.diagnostic_type for item in self.evidence_tasks
        }
        if missing_diagnostics:
            raise ValueError(f"因果设计缺少必要识别任务: {sorted(missing_diagnostics)}")
        task_types = {item.diagnostic_type for item in self.evidence_tasks}
        if self.identification_strategy in QUASI_EXPERIMENT_STRATEGIES:
            missing_quasi = {"pretrend", "robustness"} - task_types
            if missing_quasi:
                raise ValueError(f"准实验设计缺少事前趋势或稳健性任务: {sorted(missing_quasi)}")
        if self.identification_strategy == "randomized_experiment" and "robustness" not in task_types:
            raise ValueError("随机实验设计缺少稳健性任务")
        return self


class CausalDiagnostic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    diagnostic_type: DiagnosticType
    status: DiagnosticStatus
    evidence_refs: list[str]
    independent_source_groups: list[str]
    explanation: str = Field(min_length=1)

    @model_validator(mode="after")
    def require_evidence_for_directional_result(self) -> "CausalDiagnostic":
        if self.status in {"passed", "weakened", "rejected"} and not self.evidence_refs:
            raise ValueError(f"识别检查 {self.diagnostic_type} 缺少证据引用")
        if self.status in {"passed", "weakened", "rejected"} and not self.independent_source_groups:
            raise ValueError(f"识别检查 {self.diagnostic_type} 缺少独立来源组")
        return self


class CausalEffectEstimate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    estimate: float
    unit: str = Field(min_length=1)
    uncertainty_interval: str = Field(min_length=1)
    sample_description: str = Field(min_length=1)
    method: str = Field(min_length=1)
    reproducible_artifact_ref: str = Field(min_length=1)


class DirectionalPathAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    direction: Literal["forward_a_to_b", "reverse_b_to_a"]
    lag: str = Field(min_length=1)
    mediator: str = Field(min_length=1)
    lag_evidence_refs: list[str] = Field(min_length=1)
    mediator_evidence_refs: list[str] = Field(min_length=1)


class CausalAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    design_ref: str = Field(min_length=1)
    relationship_conclusion: RelationshipConclusion
    causal_status: CausalStatus
    diagnostics: list[CausalDiagnostic] = Field(min_length=5)
    identification_assumptions_status: Literal["passed", "partial", "failed", "not_tested"]
    independent_source_groups: list[str]
    effect_estimate: CausalEffectEstimate | None = None
    directional_paths: list[DirectionalPathAssessment] = Field(default_factory=list)
    decisive_evidence_refs: list[str]
    unresolved_alternatives: list[str]
    limitations: list[str] = Field(min_length=1)
    claim_language_level: ClaimLanguageLevel
    conclusion_statement: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_diagnostics(self) -> "CausalAssessment":
        diagnostic_types = [item.diagnostic_type for item in self.diagnostics]
        if len(diagnostic_types) != len(set(diagnostic_types)):
            raise ValueError("因果识别检查不得重复")
        missing = MANDATORY_DIAGNOSTICS - set(diagnostic_types)
        if missing:
            raise ValueError(f"因果评估缺少必要识别检查: {sorted(missing)}")
        if self.relationship_conclusion == "common_cause":
            statement = self.conclusion_statement
            if "相关" not in statement or "不支持" not in statement or "直接导致" not in statement:
                raise ValueError("共同原因结论必须明确A与B相关，但不支持A直接导致B")
        return self

    def diagnostic(self, diagnostic_type: DiagnosticType) -> CausalDiagnostic:
        return next(item for item in self.diagnostics if item.diagnostic_type == diagnostic_type)


STATUS_LANGUAGE_LEVEL: dict[str, str] = {
    "identified": "direct_causal",
    "strongly_supported": "supported_causal",
    "partially_supported": "possible_contribution",
    "consistent_only": "association_only",
    "not_identified": "unidentified",
    "contradicted": "causal_rejection",
}


def validate_claim_language(
    statement: str,
    *,
    causal_status: CausalStatus,
    cause_a: str | None = None,
    outcome_b: str | None = None,
) -> None:
    if causal_status != "identified" and contains_direct_causal_language(statement):
        raise ValueError("只有 identified 允许使用“A导致B”类直接因果表达")
    if causal_status == "strongly_supported" and not (
        "较强支持" in statement and any(term in statement for term in ("因果", "共同原因"))
    ):
        raise ValueError("strongly_supported 必须表述为证据较强支持因果作用")
    if causal_status == "partially_supported" and "可能" not in statement:
        raise ValueError("partially_supported 只能表述为可能促成或可能贡献")
    if causal_status == "consistent_only" and not any(
        term in statement for term in ("相关", "一致", "共变")
    ):
        raise ValueError("consistent_only 只能表述相关、变化一致或共变")
    if causal_status == "not_identified":
        forward = f"{cause_a}→{outcome_b}" if cause_a and outcome_b else "A→B"
        reverse = f"{outcome_b}→{cause_a}" if cause_a and outcome_b else "B→A"
        if not all(term in statement for term in ("无法区分", forward, reverse, "共同原因")):
            raise ValueError("not_identified 必须明确无法区分正向、反向和共同原因")
    if causal_status == "contradicted" and not any(
        term in statement for term in ("反驳", "不支持", "矛盾", "先于")
    ):
        raise ValueError("contradicted 必须明确目标因果方向为何被反驳")


def validate_causal_design(payload: dict[str, Any]) -> CausalDesign:
    return CausalDesign.model_validate(payload)


def validate_causal_assessment(
    payload: dict[str, Any], *, design: CausalDesign
) -> CausalAssessment:
    assessment = CausalAssessment.model_validate(payload)
    expected_language = STATUS_LANGUAGE_LEVEL[assessment.causal_status]
    if assessment.claim_language_level != expected_language:
        raise ValueError(
            f"因果状态 {assessment.causal_status} 只允许表达级别 {expected_language}"
        )
    diagnostics = {item.diagnostic_type: item for item in assessment.diagnostics}
    temporality = diagnostics["temporality"].status
    mechanism = diagnostics["mechanism"].status
    exposure = diagnostics["exposure_contrast"].status
    reverse = diagnostics["reverse_direction"].status
    common = diagnostics["common_cause"].status

    relationship = assessment.relationship_conclusion

    def alternatives_are_addressed() -> bool:
        if relationship == "forward_a_to_b":
            return reverse in {"weakened", "rejected"} and common in {"weakened", "rejected"}
        if relationship == "reverse_b_to_a":
            return reverse == "passed" and common in {"weakened", "rejected"}
        if relationship == "common_cause":
            return common == "passed" and reverse != "passed"
        if relationship == "bidirectional":
            return reverse == "passed" and common in {"weakened", "rejected"}
        if relationship == "multiple_causes":
            return common == "passed" and mechanism == "passed"
        return False

    def direction_evidence_is_sufficient() -> bool:
        if relationship == "common_cause":
            return common == "passed" and exposure == "passed"
        return mechanism == "passed" and exposure == "passed"

    if assessment.causal_status == "identified":
        if design.identification_strategy not in IDENTIFICATION_STRATEGIES:
            raise ValueError("identified 必须使用随机或合格准实验识别策略")
        if assessment.identification_assumptions_status != "passed":
            raise ValueError("identified 必须通过全部识别假设检查")
        if temporality != "passed" or not alternatives_are_addressed():
            raise ValueError("identified 必须通过时序并区分反向因果、共同原因及所选结构")
        robustness = diagnostics.get("robustness")
        if robustness is None or robustness.status != "passed":
            raise ValueError("identified 必须通过稳健性检查")
        if design.identification_strategy in QUASI_EXPERIMENT_STRATEGIES:
            pretrend = diagnostics.get("pretrend")
            if pretrend is None or pretrend.status != "passed":
                raise ValueError("准实验达到 identified 前必须通过事前趋势检查")
        if assessment.effect_estimate is None:
            raise ValueError("identified 必须提供效应估计、不确定区间和可复现产物")
    elif assessment.causal_status == "strongly_supported":
        if temporality != "passed" or not direction_evidence_is_sufficient():
            raise ValueError("strongly_supported 必须同时通过时序及两项适用于所选结构的方向证据")
        if not alternatives_are_addressed():
            raise ValueError("strongly_supported 必须区分反向因果、共同原因及所选结构")
        if len(set(assessment.independent_source_groups)) < 2:
            raise ValueError("strongly_supported 至少需要两个独立来源组")
        relevant_diagnostics = {"temporality", "mechanism", "exposure_contrast"}
        if relationship == "reverse_b_to_a":
            relevant_diagnostics.add("reverse_direction")
        elif relationship == "common_cause":
            relevant_diagnostics = {"temporality", "common_cause", "exposure_contrast"}
        diagnostic_groups = {
            group
            for diagnostic in assessment.diagnostics
            if diagnostic.diagnostic_type in relevant_diagnostics
            for group in diagnostic.independent_source_groups
        }
        if not set(assessment.independent_source_groups).issubset(diagnostic_groups):
            raise ValueError("strongly_supported 的独立来源组必须来自识别检查")
    elif assessment.causal_status == "partially_supported":
        directional_statuses = (common, exposure) if relationship == "common_cause" else (mechanism, exposure)
        if temporality != "passed" or not any(status == "passed" for status in directional_statuses):
            raise ValueError("partially_supported 必须通过时序及至少一项方向性检查")
    elif assessment.causal_status == "contradicted":
        if not (
            temporality == "rejected"
            or mechanism == "rejected"
            or reverse == "passed"
            or common == "passed"
        ):
            raise ValueError("contradicted 必须有时序、必要机制或竞争结构的决定性反证")

    causal_relationships = {
        "forward_a_to_b", "reverse_b_to_a", "common_cause", "bidirectional", "multiple_causes"
    }
    if assessment.causal_status in {"identified", "strongly_supported", "partially_supported"}:
        if assessment.relationship_conclusion not in causal_relationships:
            raise ValueError("因果支持状态必须给出具体方向或共同原因结构")
    if assessment.causal_status in {"consistent_only", "not_identified"}:
        if assessment.relationship_conclusion not in {"association_only", "unresolved"}:
            raise ValueError("未识别因果时只能输出相关或未决结构")
    if assessment.relationship_conclusion == "bidirectional":
        if "bidirectional" not in {item.relationship for item in design.candidate_structures}:
            raise ValueError("输出双向因果前必须在设计阶段预登记 A↔B")
        if reverse != "passed" or temporality != "passed" or mechanism != "passed":
            raise ValueError("双向因果必须分别有方向时滞和机制证据")
        directions = [item.direction for item in assessment.directional_paths]
        if set(directions) != {"forward_a_to_b", "reverse_b_to_a"} or len(directions) != 2:
            raise ValueError("双向因果必须分别记录 A→B 与 B→A 的时滞和中介证据")
    if assessment.relationship_conclusion == "reverse_b_to_a" and reverse != "passed":
        raise ValueError("反向因果结论必须有 B→A 方向检查通过")
    if assessment.relationship_conclusion == "common_cause" and common != "passed":
        raise ValueError("共同原因结论必须有 C→A 与 C→B 检查通过")
    validate_claim_language(
        assessment.conclusion_statement,
        causal_status=assessment.causal_status,
        cause_a=design.cause_a,
        outcome_b=design.outcome_b,
    )
    return assessment


def contains_direct_causal_language(statement: str) -> bool:
    lowered = statement.casefold()
    scrubbed = lowered
    for pattern in NEGATED_CAUSAL_PATTERNS:
        scrubbed = re.sub(pattern, "", scrubbed)
    return any(term in scrubbed for term in DIRECT_CAUSAL_TERMS)


def validate_causal_judgment(
    payload: dict[str, Any], *, causal_required: bool, assessment: CausalAssessment | None = None
) -> None:
    statement = str(payload.get("statement") or "")
    if not causal_required:
        if contains_direct_causal_language(statement):
            raise ValueError("未启用因果识别的 Judgment 不得使用强因果表达")
        return
    if assessment is None:
        raise ValueError("因果 Judgment 缺少 CausalAssessment")
    required = {
        "relationship_conclusion": assessment.relationship_conclusion,
        "causal_status": assessment.causal_status,
        "claim_language_level": assessment.claim_language_level,
    }
    for field, expected in required.items():
        if payload.get(field) != expected:
            raise ValueError(f"因果 Judgment 的 {field} 与 CausalAssessment 不一致")
    if not str(payload.get("causal_assessment_ref") or "").strip():
        raise ValueError("因果 Judgment 缺少 causal_assessment_ref")
    validate_claim_language(statement, causal_status=assessment.causal_status)
