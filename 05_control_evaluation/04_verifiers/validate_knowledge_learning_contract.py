#!/usr/bin/env python3
"""校验知识沉淀闭环的机器合同、Runtime 值域和存储实现没有漂移。"""

from __future__ import annotations

import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "05_control_evaluation/01_rules/knowledge_promotion/knowledge_learning_contract.yaml"
ARCHITECTURE = ROOT / "05_control_evaluation/01_rules/knowledge_promotion.md"
TYPESCRIPT = ROOT / "06_runtime/src/contracts/knowledge.ts"
STORE = ROOT / "06_runtime/src/runtime/store.ts"
PERSISTENCE = ROOT / "06_runtime/packages/persistence-sqlite/src/index.ts"
KNOWLEDGE_REPOSITORY = ROOT / "06_runtime/src/persistence/knowledge-repository.ts"
KERNEL = ROOT / "06_runtime/src/runtime/kernel.ts"
LIFECYCLE = ROOT / "04_context_state/02_state/lifecycle_contract.yaml"


def union_values(source: str, name: str) -> set[str]:
    match = re.search(rf"export type {re.escape(name)}\s*=\s*(.*?);", source, re.S)
    if not match:
        raise AssertionError(f"Runtime 缺少类型 {name}")
    return set(re.findall(r'"([a-z0-9_]+)"', match.group(1)))


def projected_type(source: str, name: str, authority_path: str) -> bool:
    match = re.search(rf"export type {re.escape(name)}\s*=\s*(.*?);", source, re.S)
    return bool(match and authority_path in match.group(1))


def fail_if(condition: bool, message: str) -> None:
    if condition:
        raise AssertionError(message)


def main() -> int:
    document = yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))
    lifecycle = yaml.safe_load(LIFECYCLE.read_text(encoding="utf-8"))
    runtime = TYPESCRIPT.read_text(encoding="utf-8")
    store = STORE.read_text(encoding="utf-8")
    persistence = PERSISTENCE.read_text(encoding="utf-8")
    knowledge_repository = KNOWLEDGE_REPOSITORY.read_text(encoding="utf-8")
    kernel = KERNEL.read_text(encoding="utf-8")
    architecture = ARCHITECTURE.read_text(encoding="utf-8")

    frontmatter_match = re.match(r"---\n(.*?)\n---", architecture, re.S)
    fail_if(not frontmatter_match, "知识闭环架构文档缺少 frontmatter")
    frontmatter = yaml.safe_load(frontmatter_match.group(1))
    fail_if(document.get("schema_version") != frontmatter.get("version"), "机器合同与人工可读文档版本不一致")
    fail_if(document.get("status") != "active", "知识闭环机器合同未启用")

    scopes = set(document["scope_kinds"])
    scope_block = re.search(r"export type KnowledgeScope\s*=\s*(.*?)\n\nexport type AssetKind", runtime, re.S)
    fail_if(not scope_block, "Runtime 缺少 KnowledgeScope")
    runtime_scopes = set(re.findall(r'kind:\s*"([a-z]+)"', scope_block.group(1)))
    fail_if(scopes != runtime_scopes, f"KnowledgeScope 漂移: yaml={scopes}, runtime={runtime_scopes}")

    yaml_assets = {item for values in document["asset_kinds"].values() for item in values}
    fail_if(yaml_assets != union_values(runtime, "AssetKind"), "AssetKind 与机器合同不一致")
    fail_if(not projected_type(runtime, "CandidateOperation", "DOMAIN_CATALOG.governance.knowledgePromotion.candidate_operations"), "CandidateOperation 未从 05 生成投影")
    yaml_statuses = set(document["candidate_statuses"]["main"]) | set(document["candidate_statuses"]["terminal_or_side"])
    lifecycle_statuses = set(lifecycle["state_machines"]["KnowledgeCandidate"]["states"])
    fail_if(yaml_statuses != lifecycle_statuses, "KnowledgeCandidate 状态在 04 与 05 之间漂移")
    fail_if(not projected_type(runtime, "CandidateStatus", "DOMAIN_CATALOG.contextState.lifecycle.state_machines.KnowledgeCandidate.states"), "CandidateStatus 未从 04 生成投影")

    transitions = document["candidate_statuses"]["transitions"]
    transition_values = set(transitions) | {target for targets in transitions.values() for target in targets}
    fail_if(not transition_values <= yaml_statuses, "状态机包含未声明状态")
    runtime_jobs = union_values(runtime, "RuntimeJobKind")
    fail_if(set(document["job_kinds"]) != runtime_jobs - {"execute", "resume"}, "后台 Job 值域漂移")

    required_tables = {
        "knowledge_locks", "mining_runs", "asset_candidates", "candidate_occurrences",
        "asset_revisions", "asset_releases", "release_members", "asset_usage",
        "evaluation_cases", "evaluation_runs",
    }
    missing_tables = {name for name in required_tables if f"CREATE TABLE IF NOT EXISTS {name}" not in persistence}
    fail_if(bool(missing_tables), f"RuntimeStore 缺少表: {sorted(missing_tables)}")
    fail_if("userReleaseId" not in runtime or "user_release_id" not in persistence, "KnowledgeLock 未锁定 user Release")
    fail_if("asOf" not in runtime or "as_of" not in persistence, "KnowledgeLock 未固定时态 asOf")
    fail_if("putContextPackage" not in store or 'type: "context.assembled"' not in store, "ContextPackage 未以 append-only Event Manifest 留痕")
    fail_if("observeAssetUsage" not in knowledge_repository or "observeAssetUsage" not in kernel, "Usage helpful/regression 回流未接入 Runtime 执行闭环")

    authority_paths = re.findall(r'"(0[1-5]_[a-z_]+/registry\.yaml)"', knowledge_repository)
    fail_if(len(authority_paths) != 5, "global Release 未完整引用五域权威")
    missing_authorities = [path for path in authority_paths if not (ROOT / path).is_file()]
    fail_if(bool(missing_authorities), f"五域权威入口不存在: {missing_authorities}")

    required_headings = [
        "为什么需要闭环", "报告、运行记录与知识", "闭环什么", "三层知识隔离",
        "双 Diff", "风险分级", "时态事实", "Method 到 Skill", "冻结 Replay",
        "发布、回滚", "闭环指标", "GitHub", "版本与决策",
    ]
    missing_headings = [heading for heading in required_headings if heading not in architecture]
    fail_if(bool(missing_headings), f"架构文档缺少必需章节: {missing_headings}")

    print(
        f"KNOWLEDGE_LEARNING_CONTRACT_PASS: version={document['schema_version']}, scopes=3, assets="
        f"{len(yaml_assets)}, operations={len(document['candidate_operations'])}, "
        f"statuses={len(yaml_statuses)}, tables={len(required_tables)}, authorities=5."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
