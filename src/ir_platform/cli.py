from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Sequence

from ir_platform.ontology import SemanticOntologyCompiler


def _datetime(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ir-platform", description="投研语义与研究图运行时")
    parser.add_argument("--runtime-dir", default=".runtime", help="本地 Oxigraph 与 provenance 存储目录")
    commands = parser.add_subparsers(dest="command", required=True)

    compile_parser = commands.add_parser("compile-ontology", help="确定性生成 OWL、SHACL、SKOS 与映射")
    compile_parser.add_argument("--output", default="build/semantic-ontology")

    import_parser = commands.add_parser("import-run", help="导入旧 01—05 研究运行目录")
    import_parser.add_argument("run_dir")

    export_parser = commands.add_parser("export-run", help="导出旧格式人工审阅产物")
    export_parser.add_argument("bundle_id")
    export_parser.add_argument("output_dir")

    query_parser = commands.add_parser("query", help="对权威 RDF 图执行 SPARQL")
    query_parser.add_argument("query")

    trace_parser = commands.add_parser("trace", help="反向追溯研究对象的证据链")
    trace_parser.add_argument("target_id")

    state_parser = commands.add_parser("state-at", help="按业务时间与系统记录时间重放")
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

    # Semantica 的 ContextGraph 会装载可选的分析组件；只有图运行命令才延迟导入。
    from ir_platform.adapters import SemanticaResearchGraphRepository
    from ir_platform.compat import ResearchRunExporter, ResearchRunImporter
    from ir_platform.runtime import EvidenceLineageService, ResearchStateService

    repository = SemanticaResearchGraphRepository(args.runtime_dir)
    try:
        if args.command == "import-run":
            bundle = ResearchRunImporter(repository).import_legacy_run(args.run_dir)
            print(json.dumps({"bundle_id": bundle.bundle_id, "entities": len(bundle.entities), "relations": len(bundle.relations)}, ensure_ascii=False))
        elif args.command == "export-run":
            paths = ResearchRunExporter(repository).export_legacy_run(args.bundle_id, args.output_dir)
            print(json.dumps({"bundle_id": args.bundle_id, "files": len(paths)}, ensure_ascii=False))
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
