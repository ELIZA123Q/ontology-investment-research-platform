from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

from ir_platform.adapters import SemanticaPipelineAdapter, SemanticaResearchGraphRepository
from ir_platform.execution import ResearchOrchestrator
from ir_platform.planning import ExecutionPlanCompiler, ResearchPlanningService
from ir_platform.runtime import RuntimeEntity


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "quickstart"


def document(name: str) -> dict:
    value = yaml.safe_load((EXAMPLE / name).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{name} 必须是 YAML 对象")
    return value


def main() -> int:
    request = document("request.yaml")
    state = document("initial-state.yaml")
    context = document("runtime-context.yaml")
    proposal = ResearchPlanningService().propose(request, state)
    plan = ExecutionPlanCompiler().compile(proposal)
    bundle_id = str(request["bundle_id"])
    seed = RuntimeEntity(
        id=str(request["id"]),
        type="ResearchRequest",
        properties=request,
        recorded_at=datetime.now(timezone.utc),
        bundle_id=bundle_id,
    )
    with tempfile.TemporaryDirectory(prefix="ir-platform-demo-") as runtime_dir:
        repository = SemanticaResearchGraphRepository(runtime_dir)
        try:
            orchestrator = ResearchOrchestrator(
                repository,
                pipeline_adapter=SemanticaPipelineAdapter(max_workers=2),
            )
            summary = orchestrator.start(
                plan,
                bundle_id=bundle_id,
                seed_entities=[seed],
                runtime_context=context,
            )
            entities = repository.list_entities(bundle_id)
            result = {
                "status": summary.status,
                "plan_id": plan.id,
                "logic": plan.logic_ref,
                "node_count": len(plan.nodes),
                "waiting_for_types": summary.waiting_for_types,
                "selected_methodology": plan.planning_context.get("methodology"),
                "default_financial_data_source": plan.planning_context.get("financial_data_source"),
                "approval_requests": sum(item.type == "ApprovalRequest" for item in entities),
                "published_reports": sum(item.type == "PublishedReport" for item in entities),
            }
            if result["status"] != "awaiting_input" or result["waiting_for_types"] != ["ApprovalRecord"]:
                raise RuntimeError(f"演示未在人工审批门槛停止：{result}")
            if result["published_reports"] != 0:
                raise RuntimeError("未经人工审批生成了正式报告")
            print(json.dumps(result, ensure_ascii=False, indent=2))
        finally:
            repository.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
