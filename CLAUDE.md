# 本体约束的投研判断工作台

AI 上下文文件。打开此仓库时自动加载，提供项目身份、可用数据源与取数规则。

## 项目身份

- **名称：** 本体约束的投研判断工作台（Ontology-Constrained Investment Research）
- **类型：** 投研判断工作台（本体约束 + 证据计算 + LLM 受约束判断）
- **当前焦点：** 半导体（存储周期、管制政策与国产设备替代）
- **运行端口：** `http://127.0.0.1:3000`（不要用 localhost）
- **三层公式：** 可靠判断 = 确定性计算 + 本体语义/约束 + 受约束的开放推理（LLM）

## 架构

Agent-native 五域骨架（目标权威；细则见 `governance/01_架构/00_五域系统骨架.md`）：

```
Intent → Task → Context → Agent → Skill/Tool/Knowledge → Workspace → Result
```

权威索引：`governance/01_架构/five_domain_authority.yaml`（先查这个，再查各域 registry）。

| 域 | 目标目录 | 新增改动入口 | compat 回放 |
|----|----------|--------------|-------------|
| Semantic | `semantic/` | `semantic/**/registry.yaml` | `ontology/` 等 |
| Task | `tasks/` | `tasks/workflows/deep_research/` | `runtime/workflow/stage_specs/` |
| Capability | `capabilities/` | `capabilities/registry.yaml` | `runtime/agents|skills`、`methods/` |
| Execution | `execution/` | `execution/registry.yaml` + `governance/01_架构/runtime_contexts.yaml` | `runtime/`、`instances/` |
| Governance | `governance/` | `rules|evals|verifiers|identity|permissions` | `02_合同`、`03_校验`、`evaluation/` |

深度研究推荐路径（Deep Research，非仓库骨架）：

```
                        Research Controller
                              │
         ┌──────────┬─────────┼─────────┬──────────┐
         ↓          ↓         ↓         ↓          ↓
     01_intake  02_struct  03_evidence 04_judge  05_deliver
                              │
                         Skill Layer
```

## 目录结构

| 目录 | 用途 |
|------|------|
| `semantic/` | 五域：本体/词典/图合同/证据 provenance（registry 可答权威） |
| `tasks/` | 五域：场景/任务定义/角色/deep_research（阶段规范默认读这里） |
| `capabilities/` | 五域：agents/skills/tools/protocols（最小 registry） |
| `execution/` | 五域：context/memory/workspace/runtime（最小 registry） |
| `ontology/` | **compat** 语义本体正文（机器可读 YAML；不重写语义） |
| `methods/` | **compat** 方法正文（框架、取证、裁决、表达） |
| `governance/` | 治理（合同、校验、评测、元治理、五域架构文档） |
| `runtime/` | **compat** 运行时实现（Next.js、agents、skills、workflow、存储） |
| `instances/` | 运行实例（SQLite、正式包；目标 `execution/workspace`） |
| `evaluation/` | 研究价值评测（目标 `governance/evals`） |

迁移账本：`governance/04_路线图/2026-08-06_五域迁移资产账本.md`。顶层 `knowledge/` 仅为 compat 桥接，权威在 `methods/` / 五域。

### runtime/ 内部结构（过渡期仍有效）

| 目录 | 用途 |
|------|------|
| `runtime/agents/` | 研究 Agent（01-05 + reviewer + baseline + controller）→ 目标 `capabilities/agents` |
| `runtime/skills/` | 可调用能力 → 目标 `capabilities/skills` |
| `runtime/workflow/` | 研究编排；`stage_specs` 为 compat，默认读 `tasks/workflows/deep_research` |
| `runtime/runner/` | 研究执行器 → 目标 `execution/runtime` |
| `runtime/storage/` | 持久化（SQLite） |
| `runtime/export/` | 导出（formal_pack、workbench_export） |
| `runtime/schemas/` | 共享类型定义 |
| `runtime/app/` | Next.js App Router（UI + API；根级 `app/` 缓建） |
| `runtime/tests/` | 测试 |

## 五阶段研究流程

```
01 受理 → 02 结构 → 03 证据 → 04 判断 → 05 表达
```

阶段规范默认路径：`tasks/workflows/deep_research/`（compat：`runtime/workflow/stage_specs/`）。`02` 搭结构，`03` 备事实与计算，`04` 做判断；本体贯穿但不替代任一阶段。

## 可用金融数据通道

本项目配置了以下 MCP 数据通道。**MCP、API、数据库终端和 AI 工具是获取通道，不是来源生产者**。

### 法定披露
| MCP | 数据源 | 能取到什么 |
|-----|--------|-----------|
| `cninfo` | 巨潮资讯网 | A股公告列表、定期报告、临时公告、问询函原文 |
| `china-policy` | 国务院/部委 | 中央政策原文全文 |

### 金融行情与财务（通联数据 DataYes）
| MCP | 能取到什么 |
|-----|-----------|
| `datayes-stock-mkt` | A股日/周/月K线、分时、技术指标 |
| `datayes-stock-finoper` | 利润表、资产负债表、现金流量表 |
| `datayes-stock-info` | 公司基本信息、股东 |
| `datayes-stock-eqhld` | 机构持仓明细 |
| `datayes-stock-event` | 公司事件摘要 |
| `datayes-macro` | GDP/CPI/PMI/贸易/工业/消费等宏观指标 |
| `datayes-index-*` | 指数成分、行情与估值 |
| `datayes-fund-*` | 基金信息/业绩/持仓/财务/分析 |

### 研报与资讯
| MCP | 数据源 | 能取到什么 |
|-----|--------|-----------|
| `htsc_research_mcp` | 华泰证券研究所 | 研报、行业观点、估值模型 |
| `caixin-news` | 财新 | 财经新闻 |
| `jina-reader` | 网页 | 内容提取与搜索 |

## 数据使用核心规则

1. **来源可追溯：** 每次调用记录 connector、上游来源、查询参数、原始响应、字段血缘、权限范围、获取时间
2. **回放能力：** 同一参数是否可复现
3. **回退机制：** MCP 不可用时 → `methods/03_取证/OPS_MCP查询快速参考.md` 回退链
4. **留痕模板：** 见 `tasks/workflows/deep_research/supporting/03_evidence_provenance_manual.md`（compat：`runtime/workflow/stage_specs/03_证据/`）

## 关键文件索引

| 文件 | 用途 |
|------|------|
| `governance/01_架构/five_domain_authority.yaml` | 五域权威索引（先查这里） |
| `governance/01_架构/00_项目定位与边界.md` | 项目定位与边界 |
| `governance/01_架构/runtime_contexts.yaml` | Runtime 阶段知识白名单 |
| `governance/02_合同/public_contract.yaml` | 公共合同（跨阶段主链标识） |
| `governance/02_合同/rule_authority_registry.yaml` | 规则权威注册表 |
| `governance/02_合同/judgment_threshold_policy.yaml` | 判断阈值策略 |
| `governance/03_校验/00A_高质量产出判别标准.md` | 质量自检标准 |
| `governance/03_校验/status_derivation.py` | 结论强度派生逻辑 |
| `governance/03_校验/runtime_asset_coverage.yaml` | Runtime 资产覆盖矩阵 |
| `ontology/01_通用/model_registry.yaml` | 本体模型注册表 |
| `methods/03_取证/README.md` | 取证库总入口 |
| `methods/03_取证/B00_来源选择与使用边界.md` | 来源准入原则 |
| `methods/03_取证/B01_通用来源速查.md` | 通用来源→MCP通道映射 |
| `methods/03_取证/B02_半导体来源速查.md` | 半导体来源→MCP通道映射 |
| `methods/03_取证/B03_MCP通道注册.md` | MCP通道注册表 |
| `methods/03_取证/OPS_MCP查询快速参考.md` | MCP操作卡片 |
| `methods/03_取证/03_registry.yaml` | 取证方法注册中心 |
| `methods/02_研究框架/registry.yaml` | 框架依赖注册表 |
| `methods/04_裁决/A00_裁决总则.md` | 裁决方法总则 |
| `tasks/workflows/deep_research/stages/03_evidence.md` | 03阶段规范 |
