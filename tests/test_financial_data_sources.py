from __future__ import annotations

from pathlib import Path

import pytest

from ir_platform.execution import FinancialDataSourceRegistry
from ir_platform.planning import ResearchPlanningService


def test_default_financial_data_source_is_free_keyless_akshare_mcp() -> None:
    registry = FinancialDataSourceRegistry()
    default = registry.default()
    assert default.id == "akshare_mcp"
    assert default.protocol == "mcp"
    assert default.transport == "stdio"
    assert default.credentials_required is False
    assert default.revision == "9b6a22b6d83cce2a996a5072743bb06686040ce0"
    with pytest.raises(KeyError, match="已禁用"):
        registry.resolve("wind_mcp")


def test_planner_records_default_source_on_evidence_capabilities() -> None:
    proposal = ResearchPlanningService().propose(
        {"id": "request:data-source", "mode": "full_research"},
        {"evidence_ready": False, "conflict_detected": False},
    )
    acquire_nodes = [item for item in proposal.nodes if item.capability_ref == "acquire_evidence"]
    assert acquire_nodes
    assert all(item.parameters["data_source_ref"] == "akshare_mcp" for item in acquire_nodes)
    assert proposal.context["financial_data_source"]["id"] == "akshare_mcp"
    assert proposal.context["financial_data_source"]["credentials_required"] is False


def test_registry_rejects_forbidden_default(tmp_path: Path) -> None:
    config = tmp_path / "sources.yaml"
    config.write_text(
        """
default_source: wind_mcp
forbidden_source_ids: [wind_mcp]
sources:
  akshare_mcp:
    version: 1.0.0
    protocol: mcp
    transport: stdio
    repository: https://example.invalid/ashare
    revision: "1234567"
    command: uvx
    args: [ashare-mcp]
    credentials_required: false
    markets: [A股]
    capabilities: [financial_statements]
    preferred_tools: [get_financial_report]
    upstream_sources: [exchange]
    restrictions: [verify]
""",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="默认金融数据源已被禁用"):
        FinancialDataSourceRegistry(config)
