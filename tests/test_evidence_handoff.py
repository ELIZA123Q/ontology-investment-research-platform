from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from ir_platform import PublicSourceIndex, validate_evidence_handoff
from ir_platform.execution.capabilities import CapabilityCall, CapabilityRegistry
from ir_platform.planning.models import ExecutionNode
from ir_platform.rules import CapabilityDefinitionRegistry
from ir_platform.runtime import RuntimeEntity


def _payload() -> dict:
    return {
        "evidence_handoff": {
            "information_cutoff": "2026-09-08T23:59:59+08:00",
            "task_refs": ["task:industry-state"],
            "sources": [
                {
                    "id": "source:official",
                    "producer": "Official producer",
                    "title": "Official release",
                    "source_type": "official_primary",
                    "source_roles": ["primary", "baseline", "counter"],
                    "publication_date": "2026-09-01",
                    "captured_at": "2026-09-08T10:00:00+08:00",
                    "original_url": "https://example.com/release",
                    "access_method": "official page",
                    "version_or_period": "2026-07",
                    "independence_group": "official_statistics",
                    "query_playbook_ref": "OPS.md#QP-01",
                }
            ],
            "claims": [
                {
                    "id": "claim:state",
                    "task_ref": "task:industry-state",
                    "statement": "The measured value was 10.",
                    "source_ref": "source:official",
                    "locator": "table 1, row 2",
                    "business_time": "2026-07",
                    "scope": "defined market",
                    "metric_definition": "reported monthly value",
                    "unit": "CNY million",
                    "claim_kind": "hard_fact",
                    "numeric": True,
                }
            ],
            "observations": [],
            "calculations": [],
            "coverage_by_role": {
                "task:industry-state": {
                    "primary": "covered",
                    "baseline": "covered",
                    "counter": "covered",
                }
            },
            "source_independence_groups": {"official_statistics": ["source:official"]},
            "conflicts": [],
            "counter_searches": [
                {
                    "id": "counter:state",
                    "task_ref": "task:industry-state",
                    "query": "official downward revision",
                    "scope": "official releases through cutoff",
                    "searched_source_refs": ["source:official"],
                    "result": "No contrary release was found in the recorded search scope.",
                    "captured_at": "2026-09-08T10:30:00+08:00",
                }
            ],
            "gaps": [],
            "completeness": "sufficient",
            "stop_decision": {
                "continue_research": False,
                "reason": "Required roles and the counter search are complete.",
                "upgrade_evidence_needed": [],
            },
        }
    }


def test_valid_handoff_preserves_cutoff_lineage_and_four_level_completeness() -> None:
    result = validate_evidence_handoff(_payload()).evidence_handoff
    assert result.completeness == "sufficient"
    assert result.claims[0].source_ref == result.sources[0].id


def test_rejects_source_published_after_information_cutoff() -> None:
    payload = _payload()
    payload["evidence_handoff"]["sources"][0]["publication_date"] = "2026-09-09"
    with pytest.raises(ValidationError, match="晚于信息截面"):
        validate_evidence_handoff(payload)


@pytest.mark.parametrize("source_type", ["search_result", "ai_summary"])
def test_search_and_ai_summaries_cannot_generate_claims(source_type: str) -> None:
    payload = _payload()
    payload["evidence_handoff"]["sources"][0]["source_type"] = source_type
    with pytest.raises(ValidationError, match="不得由搜索结果或 AI 摘要产生"):
        validate_evidence_handoff(payload)


def test_professional_secondary_source_cannot_be_the_only_hard_fact_source() -> None:
    payload = _payload()
    payload["evidence_handoff"]["sources"][0]["source_type"] = "professional_secondary"
    with pytest.raises(ValidationError, match="缺少原始或直接测量来源"):
        validate_evidence_handoff(payload)


def test_partial_or_missing_role_requires_a_structured_gap() -> None:
    payload = _payload()
    payload["evidence_handoff"]["coverage_by_role"]["task:industry-state"]["baseline"] = "missing"
    payload["evidence_handoff"]["completeness"] = "limited"
    with pytest.raises(ValidationError, match="缺口未结构化记录"):
        validate_evidence_handoff(payload)


def test_numeric_claim_requires_a_real_unit() -> None:
    payload = _payload()
    payload["evidence_handoff"]["claims"][0]["unit"] = "not_applicable"
    with pytest.raises(ValidationError, match="必须有实际单位"):
        validate_evidence_handoff(payload)


def test_claim_requires_a_concrete_locator() -> None:
    payload = _payload()
    payload["evidence_handoff"]["claims"][0]["locator"] = "未定位"
    with pytest.raises(ValidationError, match="必须定位到"):
        validate_evidence_handoff(payload)


def test_counter_search_rejects_unknown_source_reference() -> None:
    payload = _payload()
    payload["evidence_handoff"]["counter_searches"][0]["searched_source_refs"] = ["source:missing"]
    with pytest.raises(ValidationError, match="反证查询.*未知来源"):
        validate_evidence_handoff(payload)


def test_percentage_completeness_score_is_not_part_of_the_contract() -> None:
    payload = _payload()
    payload["evidence_handoff"]["completeness_score"] = 81
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        validate_evidence_handoff(payload)


def test_mirrors_in_the_same_data_chain_remain_one_independence_group() -> None:
    payload = _payload()
    mirror = deepcopy(payload["evidence_handoff"]["sources"][0])
    mirror["id"] = "source:mirror"
    mirror["original_url"] = "https://mirror.example.com/release"
    payload["evidence_handoff"]["sources"].append(mirror)
    payload["evidence_handoff"]["source_independence_groups"]["official_statistics"].append("source:mirror")
    result = validate_evidence_handoff(payload).evidence_handoff
    assert len(result.source_independence_groups) == 1


def test_same_document_mirrors_cannot_claim_different_independence_groups() -> None:
    payload = _payload()
    mirror = deepcopy(payload["evidence_handoff"]["sources"][0])
    mirror["id"] = "source:mirror"
    mirror["original_url"] = "https://mirror.example.com/release"
    mirror["independence_group"] = "invented_independent_group"
    payload["evidence_handoff"]["sources"].append(mirror)
    payload["evidence_handoff"]["source_independence_groups"]["invented_independent_group"] = ["source:mirror"]
    with pytest.raises(ValidationError, match="镜像不得计入不同独立来源组"):
        validate_evidence_handoff(payload)


def test_public_source_index_routes_general_and_domain_sources_without_industry_skills() -> None:
    index = PublicSourceIndex()
    semiconductor = {item.id for item in index.select(market="A股", domain="semiconductor")}
    pharmaceuticals = {item.id for item in index.select(market="A股", domain="pharmaceutical")}
    assert "wsts-historical-billings" in semiconductor
    assert "csindex-semiconductor-931865" in semiconductor
    assert "cninfo-disclosures" in pharmaceuticals
    assert "wsts-historical-billings" not in pharmaceuticals


def test_non_semiconductor_company_verification_uses_only_general_sources() -> None:
    selected = PublicSourceIndex().select(market="A股", domain="company_financial")
    assert "cninfo-disclosures" in {item.id for item in selected}
    assert all("general" in item.domains for item in selected)
    assert not any(item.id.startswith(("wsts-", "semi-", "csindex-semiconductor")) for item in selected)


def test_unknown_industry_can_continue_with_general_sources_and_a_domain_gap() -> None:
    selected = PublicSourceIndex().select(market="A股", domain="industry_without_catalog")
    assert selected
    assert all("general" in item.domains for item in selected)

    payload = _payload()
    handoff = payload["evidence_handoff"]
    handoff["coverage_by_role"]["task:industry-state"]["primary"] = "missing"
    handoff["gaps"] = [
        {
            "id": "gap:domain-measurement",
            "task_ref": "task:industry-state",
            "gap_type": "domain_measurement_missing",
            "required_role": "primary",
            "description": "No registered industry-specific direct measurement exists.",
            "attempts": ["Selected all applicable general source families."],
            "impact": "The result can verify issuer facts but cannot measure the full industry directly.",
        }
    ]
    handoff["completeness"] = "limited"
    result = validate_evidence_handoff(payload).evidence_handoff
    assert result.gaps[0].gap_type == "domain_measurement_missing"


def test_semiconductor_pilot_is_a_valid_limited_handoff() -> None:
    root = Path(__file__).resolve().parents[1]
    path = root / "research_outputs" / "a-share-semiconductor-evidence-pilot-2026-09-08" / "evidence-handoff.yaml"
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    handoff = validate_evidence_handoff(payload).evidence_handoff

    assert handoff.completeness == "limited"
    assert len(handoff.task_refs) == 6
    assert len({item.task_ref for item in handoff.counter_searches}) == len(handoff.task_refs)
    assert all(claim.locator and claim.business_time and claim.metric_definition and claim.unit for claim in handoff.claims)
    assert all(source.publication_date <= handoff.information_cutoff.date() for source in handoff.sources)
    assert any(gap.gap_type == "scope_mismatch" for gap in handoff.gaps)


def test_source_index_rejects_unknown_source_family() -> None:
    with pytest.raises(KeyError, match="未知公开来源族"):
        PublicSourceIndex().resolve("invented")


def test_builtin_acquire_evidence_uses_public_source_index_when_no_node_output() -> None:
    definitions = CapabilityDefinitionRegistry()
    acquire = definitions.resolve("acquire_evidence")
    node = ExecutionNode(
        id="acquire",
        capability_ref=acquire.id,
        capability_version=acquire.version,
        dependencies=[],
        activate_rule_refs=[],
        selection_rule_refs=[],
        parameters={},
        input_types=acquire.input_types,
        output_types=acquire.output_types,
        reads=acquire.reads,
        writes=acquire.writes,
        idempotent=acquire.idempotent,
        max_retries=acquire.max_retries,
        side_effects=acquire.side_effects,
        parallel_safe=acquire.parallel_safe,
        lifecycle_view=acquire.lifecycle_view,
    )
    _, handler = CapabilityRegistry(definitions).resolve("acquire_evidence")
    result = handler(
        CapabilityCall(
            bundle_id="source-index-adapter",
            plan_id="plan:source-index-adapter:r1",
            node=node,
            definition=acquire,
            inputs=[
                RuntimeEntity(
                    id="context:source-index-adapter",
                    type="SemanticContext",
                    properties={"methodology": {"market_scope": "A_share", "domain": "semiconductor"}},
                    bundle_id="source-index-adapter",
                )
            ],
            runtime_context={},
        )
    )
    assert result
    assert {item.type for item in result} == {"SourceDocument"}
    assert any(item.properties["source_family_id"] == "wsts-historical-billings" for item in result)
    assert all(item.properties["formal_fact_policy"] == "candidate_source_only" for item in result)
