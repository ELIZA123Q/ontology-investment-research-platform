# Semantica 运行基座架构

## 1. 设计结论

本项目采用依赖集成，不 fork Semantica。当前仓库继续负责投研领域语义、研究合同、规则和交付规范；`semantica==0.6.8` 只通过 `src/ir_platform/adapters/` 使用。除适配包外，代码导入 `semantica.*` 会被架构测试拒绝。

本体是稳定语义层，不是“所有能放进图里的对象”。Evidence、Judgment、RuleEvaluation 和 Trace 可以成为图节点，但它们仍是运行记录。

## 2. 权威与数据流

```text
语义 YAML（唯一人工语义权威）
  └─ SemanticOntologyCompiler
       ├─ OWL/Turtle
       ├─ SHACL
       ├─ SKOS
       └─ 稳定 IRI 映射

研究服务 / 旧格式导入
  └─ ResearchGraphRepository（唯一写入口）
       └─ SemanticaResearchGraphRepository
            ├─ Oxigraph：持久化 RDF 数据图唯一权威
            ├─ ContextGraph：进程内只读遍历模型
            └─ ProvenanceManager/SQLite：追加式审计账本
```

Oxigraph 使用每次研究运行一个 named graph，并登记为 `prov:Bundle`。运行对象映射为 `prov:Entity`；采集、抽取、评价等映射为 `prov:Activity`；研究员、模型和程序映射为 `prov:Agent`。

## 3. 公共接口

- `SemanticOntologyCompiler.compile(output_dir)`：确定性生成 OWL、SHACL、SKOS 和 `mapping.json`。
- `SemanticOntologyRegistry`：查询允许的类型、关系、继承、端点、词表和稳定 IRI。
- `ResearchGraphRepository`：新增、查询、版本化、历史状态与 provenance 的抽象端口。
- `SemanticaResearchGraphRepository`：Oxigraph、ContextGraph 和 ProvenanceManager 的唯一适配实现。
- `ResearchRunImporter.import_legacy_run()`：只读导入现有 01—05 目录。
- `ResearchRunExporter.export_legacy_run()`：从图中按原 SHA-256 恢复旧审阅格式。
- `EvidenceLineageService.trace()`：从判断或报告观点反向遍历来源链。
- `ResearchStateService.state_at()`：按业务时间与记录时间重放。
- `RuleExecutionService.evaluate()`：运行确定性规则，写入 RuleEvaluation 和 provenance。

## 4. 双时态与修订

每个动态对象都有 `valid_from/valid_until` 和 `recorded_at/invalidated_at`。历史重放同时应用两组时间，后取得的证据不会泄漏到更早记录截面。

修订不覆盖旧对象：新对象使用新 ID，通过 `supersedes` 与 `prov:wasRevisionOf` 指向旧版本。冲突事实可以并存；正式裁决前仓储层不会自动选择一个版本。

## 5. 规则执行边界

SHACL 负责结构约束。证据质量、J 等级上限、阻断和表达权限继续由确定性 Python 负责。Semantica Rete/Datalog 只有在逐条规则完成结果同一性测试后才可切换；SPARQL 首期仅查询。

Semantica `Decision` 只可记录发布、模式升级和接受变更等系统决策，不替代投研 `Judgment`。GraphRAG、相似度、中心性和链接预测只能辅助检索，不能提高结论等级。

## 6. 兼容迁移

旧 02 `2.2.0`、03 `3.0.0`、04 `4.0.0` 和 run manifest `1.2.0` 通过只读导入器进入新图。每个旧文本文件都保存为 `LegacyArtifact`，包含相对路径、原文、媒体类型与 SHA-256；导出时校验哈希，因此可做字节级往返。

旧 `一级通用本体规范/*.yaml` 与 `二级半导体领域本体规范/*.yaml` 只保存弃用声明和 `authority_targets`。`运行校验/authority_loader.py` 在兼容周期内生成旧内存视图，新定义不得写回旧路径。

## 7. 本地命令

```bash
uv sync --frozen --python 3.12
uv run --frozen --offline ir-platform compile-ontology --output build/semantic-ontology
uv run --frozen --offline ir-platform --runtime-dir .runtime import-run 示例1
uv run --frozen --offline ir-platform --runtime-dir .runtime state-at --bundle-id EXEC-MEM-CYCLE-20260715-1 --recorded-at 2026-07-15T23:59:59+08:00
uv run --frozen --offline pytest
uv run --frozen --offline python validate_project.py
```

CI 在锁定依赖安装完成后，以 `--offline` 执行测试；测试不调用 LLM、网络数据源或远程数据库。
