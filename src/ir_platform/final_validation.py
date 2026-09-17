from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ValidationStatus = Literal["pass", "fail", "unverifiable"]
Verdict = Literal["pass", "needs_revision", "block"]
REQUIRED_CATEGORIES = {
    "numbers_and_calculations",
    "evidence_boundary",
    "logic_and_counterevidence",
    "report_boundary",
    "language_quality",
    "question_coverage",
}


class ValidationCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Literal[
        "numbers_and_calculations",
        "evidence_boundary",
        "logic_and_counterevidence",
        "report_boundary",
        "language_quality",
        "question_coverage",
    ]
    status: ValidationStatus
    evidence: list[str] = Field(min_length=1)
    note: str = Field(min_length=1)


class ValidationFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    severity: Literal["blocker", "high", "medium", "low"]
    location: str = Field(min_length=1)
    issue: str = Field(min_length=1)
    impact: str = Field(min_length=1)
    required_revision: str = Field(min_length=1)


class QuestionCoverageItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1)
    answer_location: str = Field(min_length=1)
    status: Literal["answered", "partial", "missing"]


class FinalArtifactValidation(BaseModel):
    """Independent, read-only validation result for a complete research artifact."""

    model_config = ConfigDict(extra="forbid")

    artifact_ref: str = Field(min_length=1)
    validator_role: Literal["independent_final_artifact_validator"]
    independent_from_production: Literal[True]
    verdict: Verdict
    checks: list[ValidationCheck] = Field(min_length=6, max_length=6)
    findings: list[ValidationFinding]
    question_coverage: list[QuestionCoverageItem] = Field(min_length=1)
    calculation_audit: str = Field(min_length=1)
    counterevidence_audit: str = Field(min_length=1)
    unverified_items: list[str]

    @model_validator(mode="after")
    def validate_verdict(self) -> "FinalArtifactValidation":
        categories = [item.category for item in self.checks]
        if set(categories) != REQUIRED_CATEGORIES or len(categories) != len(set(categories)):
            raise ValueError("独立成品验证必须且只能覆盖六类检查")
        failed = [item for item in self.checks if item.status != "pass"]
        blockers = [item for item in self.findings if item.severity == "blocker"]
        incomplete_questions = [
            item for item in self.question_coverage if item.status != "answered"
        ]
        if self.verdict == "pass" and (failed or self.findings or incomplete_questions or self.unverified_items):
            raise ValueError("pass 不得带失败项、发现、未回答问题或未验证项目")
        if self.verdict == "needs_revision":
            if not self.findings or blockers:
                raise ValueError("needs_revision 必须有可修正发现且不得含 blocker")
        if self.verdict == "block" and not (blockers or any(item.status == "unverifiable" for item in failed)):
            raise ValueError("block 必须由 blocker 或不可验证项支持")
        return self


def validate_final_artifact_validation(payload: dict[str, Any]) -> FinalArtifactValidation:
    return FinalArtifactValidation.model_validate(payload)
