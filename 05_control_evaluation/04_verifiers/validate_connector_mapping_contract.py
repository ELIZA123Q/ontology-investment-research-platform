#!/usr/bin/env python3
"""Validate connector registry, ontology mappings and Runtime bindings as one authority chain."""

from __future__ import annotations

import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
CHANNELS = ROOT / "03_agent_capability/04_protocols/mcp/mcp_channels.yaml"
PROFILES = ROOT / "01_semantic_knowledge/01_ontology/contracts/ontology_data_mapping_profiles.yaml"
B03 = ROOT / "03_agent_capability/04_protocols/mcp/ops/B03_MCP通道注册.md"
HTSC_MAPPER = ROOT / "06_runtime/src/tools/htsc-industry-sentiment-mapper.ts"
RUNTIME_CONTRACTS = ROOT / "06_runtime/src/contracts/evidence.ts"
RUNTIME_STORE = ROOT / "06_runtime/src/runtime/store.ts"
PERSISTENCE = ROOT / "06_runtime/packages/persistence-sqlite/src/index.ts"
FINANCIAL_ADAPTER = ROOT / "06_runtime/src/tools/financial-data-adapter.ts"
INGESTION = ROOT / "06_runtime/src/application/research-data-ingestion.ts"


def unique(items: list[dict], field: str, label: str) -> set[str]:
    values = [str(item.get(field, "")).strip() for item in items]
    if any(not value for value in values):
        raise AssertionError(f"{label} contains an empty {field}")
    if len(values) != len(set(values)):
        raise AssertionError(f"{label} contains duplicate {field} values")
    return set(values)


def main() -> int:
    channels_doc = yaml.safe_load(CHANNELS.read_text(encoding="utf-8"))
    profiles_doc = yaml.safe_load(PROFILES.read_text(encoding="utf-8"))
    channels = channels_doc.get("channels", [])
    profiles = profiles_doc.get("profiles", [])
    channel_ids = unique(channels, "id", "connector registry")
    unique(profiles, "id", "mapping profile registry")
    required = set(profiles_doc.get("required_connectors", []))
    active_profile_connectors = {
        str(item["connector"]) for item in profiles if item.get("status") == "active"
    }
    if channel_ids != required:
        raise AssertionError(
            f"connector registry/profile requirements drift: channels_only={sorted(channel_ids - required)}, "
            f"required_only={sorted(required - channel_ids)}"
        )
    missing_profiles = required - active_profile_connectors
    if missing_profiles:
        raise AssertionError(f"connectors without an active mapping profile: {sorted(missing_profiles)}")

    b03 = B03.read_text(encoding="utf-8")
    count_match = re.search(r"通道速查（(\d+)个证据通道）", b03)
    if not count_match or int(count_match.group(1)) != len(channel_ids):
        raise AssertionError("B03 connector count does not match the machine registry")

    htsc = next((item for item in channels if item.get("id") == "htsc_research_mcp"), None)
    if not htsc or htsc.get("runtime_status") != "live":
        raise AssertionError("HTSC connector must declare live runtime status after the real sample succeeds")
    htsc_profile = next((item for item in profiles if item.get("id") == "htsc_industry_sentiment_observation"), None)
    if not htsc_profile or htsc_profile.get("connector") != "htsc_research_mcp" or htsc_profile.get("status") != "active":
        raise AssertionError("HTSC connector is missing its active industry sentiment mapping profile")
    mapper = HTSC_MAPPER.read_text(encoding="utf-8")
    required_mapper_terms = {
        "htsc_research_mcp", "htsc_industry_sentiment_observation",
        "authorized_research_only_no_redistribution", "riskDisclosure",
    }
    if not required_mapper_terms <= set(re.findall(r"[A-Za-z0-9_.]+", mapper)):
        raise AssertionError("HTSC Runtime mapper is missing connector, profile or authorization boundaries")
    contracts = RUNTIME_CONTRACTS.read_text(encoding="utf-8")
    if '"authorized_research_use"' not in contracts:
        raise AssertionError("Runtime SourceSnapshot lacks authorized_research_use permission scope")
    store = RUNTIME_STORE.read_text(encoding="utf-8")
    persistence = PERSISTENCE.read_text(encoding="utf-8")
    adapter = FINANCIAL_ADAPTER.read_text(encoding="utf-8")
    ingestion = INGESTION.read_text(encoding="utf-8")
    if "CREATE TABLE IF NOT EXISTS connector_response_blobs" not in persistence or "class SqliteConnectorResponseRepository" not in persistence or "get(fingerprint:" not in persistence:
        raise AssertionError("Runtime lacks a private connector response vault with metadata-only access")
    if "providerResponse body does not match contentHash" not in adapter or "responseFingerprint" not in adapter:
        raise AssertionError("financial adapter does not bind raw provider response to its fingerprint")
    if "connectorResponses.put" not in ingestion or "providerResponseRef" not in ingestion:
        raise AssertionError("financial ingestion does not freeze provider responses or project their safe reference")

    print(
        f"CONNECTOR_MAPPING_CONTRACT_PASS: channels={len(channel_ids)}, "
        f"active_profile_connectors={len(active_profile_connectors)}, htsc={htsc['runtime_status']}, raw_vault=active."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
