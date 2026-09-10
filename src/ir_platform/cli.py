from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import yaml

from ir_platform.ontology import SemanticOntologyCompiler
from ir_platform.planning import ExecutionPlan, ExecutionPlanCompiler, ResearchPlanningService
from ir_platform.runtime import RuntimeEntity
from ir_platform.validation import validate_project


def _datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def _document(path: str) -> dict[str, Any]:
    result = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(result, dict):
        raise ValueError(f"{path} 必须是对象")
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ir-platform", description="动态规则驱动的投研语义与图运行时")
    parser.add_argument("--runtime-dir", default=".runtime", help="本地 Oxigraph 与 provenance 存储目录")
    commands = parser.add_subparsers(dest="command", required=True)

    compile_parser = commands.add_parser("compile-ontology", help="生成 OWL、SHACL、SKOS 与 IRI 映射")
    compile_parser.add_argument("--output", default="build/semantic-ontology")
    commands.add_parser("validate", help="离线验证本体、动态配置、架构边界与样例")

    plan_parser = commands.add_parser("plan", help="按任务与当前图状态编译不可变 DAG")
    plan_parser.add_argument("request")
    plan_parser.add_argument("--state")

    load_parser = commands.add_parser("load-bundle", help="装载可移植 TriG 研究图包")
    load_parser.add_argument("archive")
    export_parser = commands.add_parser("export-bundle", help="导出可移植 TriG 研究图包")
    export_parser.add_argument("bundle_id")
    export_parser.add_argument("output")

    run_parser = commands.add_parser("run", help="执行或恢复已持久化的动态计划")
    run_parser.add_argument("plan_id")
    run_parser.add_argument("bundle_id")
    run_parser.add_argument("--context", help="节点输出与规则上下文 YAML")

    approval_parser = commands.add_parser("approve", help="人工批准发布请求")
    approval_parser.add_argument("bundle_id")
    approval_parser.add_argument("request_id")
    approval_parser.add_argument("--approver", required=True)

    query_parser = commands.add_parser("query", help="对权威 RDF 图执行 SPARQL")
    query_parser.add_argument("query")
    trace_parser = commands.add_parser("trace", help="反向追溯研究对象")
    trace_parser.add_argument("target_id")
    state_parser = commands.add_parser("state-at", help="按业务时间和记录时间重放")
    state_parser.add_argument("--bundle-id")
    state_parser.add_argument("--valid-at")
    state_parser.add_argument("--recorded-at")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "compile-ontology":
        result = SemanticOntologyCompiler().compile(Path(args.output))
        print(json.dumps({"output_dir": str(result.output_dir), "digest": result.digest}, ensure_ascii=False))
        return 0
    if args.command == "validate":
        print(json.dumps(validate_project(), ensure_ascii=False, indent=2))
        return 0

    from ir_platform.adapters import SemanticaResearchGraphRepository
    from ir_platform.execution import ApprovalService, ResearchOrchestrator
    from ir_platform.runtime import EvidenceLineageService, ResearchGraphArchiveService, ResearchStateService

    repository = SemanticaResearchGraphRepository(args.runtime_dir)
    try:
        if args.command == "plan":
            request = _document(args.request)
            state = _document(args.state) if args.state else {}
            proposal = ResearchPlanningService().propose(request, state)
            plan = ExecutionPlanCompiler().compile(proposal)
            seed = RuntimeEntity(
                id=str(request["id"]),
                type="ResearchRequest",
                properties=request,
                recorded_at=datetime.now(timezone.utc),
                bundle_id=str(request.get("bundle_id") or request["id"]),
            )
            ResearchOrchestrator(repository).persist_plan(plan, bundle_id=seed.bundle_id, seed_entities=[seed])
            print(plan.model_dump_json(indent=2))
        elif args.command == "load-bundle":
            bundle = ResearchGraphArchiveService(repository).import_bundle(args.archive)
            print(json.dumps({"bundle_id": bundle.bundle_id, "entities": len(bundle.entities), "relations": len(bundle.relations)}, ensure_ascii=False))
        elif args.command == "export-bundle":
            path = ResearchGraphArchiveService(repository).export_bundle(args.bundle_id, args.output)
            print(json.dumps({"bundle_id": args.bundle_id, "path": str(path)}, ensure_ascii=False))
        elif args.command == "run":
            entity = repository.get_entity(args.plan_id)
            if entity is None or entity.type not in {"ExecutionPlan", "PlanRevision"}:
                raise ValueError("动态计划不存在")
            plan = ExecutionPlan.model_validate(entity.properties)
            runtime_context = _document(args.context) if args.context else {}
            summary = ResearchOrchestrator(repository).resume(
                plan,
                bundle_id=args.bundle_id,
                runtime_context=runtime_context,
            )
            print(json.dumps(summary.__dict__, ensure_ascii=False))
        elif args.command == "approve":
            approval = ApprovalService(repository).approve(
                bundle_id=args.bundle_id, request_id=args.request_id, approver_id=args.approver
            )
            print(approval.model_dump_json(indent=2))
        elif args.command == "query":
            print(json.dumps(repository.query_sparql(args.query), ensure_ascii=False, default=str))
        elif args.command == "trace":
            print(json.dumps(EvidenceLineageService(repository).trace(args.target_id), ensure_ascii=False))
        elif args.command == "state-at":
            state = ResearchStateService(repository).state_at(
                bundle_id=args.bundle_id,
                valid_at=_datetime(args.valid_at),
                recorded_at=_datetime(args.recorded_at),
            )
            print(state.model_dump_json(indent=2))
        return 0
    finally:
        repository.close()


if __name__ == "__main__":
    raise SystemExit(main())
