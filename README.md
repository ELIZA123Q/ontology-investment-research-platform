# 动态规则驱动投研平台

这是一个可复现的投研方法与图运行项目，不是自动选股或交易系统。第一次接触项目，建议先阅读[目录导览](docs/repository-layout.md)，再运行下方的校验命令；想了解研究方法，从[研究方法入口](研究方法/README.md)开始；想看可运行样例，从[examples](examples/README.md)开始。

本项目以 Semantica 0.6.8 为图运行基座，将投研语义、研究规则和执行能力分成三个独立权威：

- **语义本体**定义世界中有什么：公司、人员、治理、产品与服务、市场、商业关系、财务口径、单位币种、设施技术、法域，以及半导体领域语义。
- **研究规则**使用受限 YAML DSL 定义何时调用能力、何时阻断、判断最高到哪一级、何时必须审批以及何时完成。
- **研究能力与 Logic**定义可调用能力及候选依赖；每次任务由规划器编译为不同的不可变 DAG。

证据、事件、观测、假设、判断、执行计划和审计都是运行对象，不属于本体。Oxigraph 是运行图的唯一权威；Semantica ContextGraph 和 Pipeline 是可重建的读模型与执行适配，SQLite provenance 保存追加式审计。

## 目录

| 目录 | 权威内容 |
|---|---|
| [语义本体](语义本体/) | 一级通用语义、二级半导体语义、46 项稳定指标定义 |
| [研究运行合同](研究运行合同/) | 证据、推理、动态计划、双时态与审批合同 |
| [研究规则](研究规则/rules.yaml) | 可执行受限 DSL 规则 |
| [研究能力](研究能力/) | Capability、Logic 和报告模板 |
| [研究方法](研究方法/) | 分析框架、取证手册、推理方法和半导体指南 |
| [.agents/skills](.agents/skills/) | A股权益宏观专项与完整研究总控入口 |
| [examples](examples/) | 两套可装载 TriG 研究图与报告投影 |
| [src/ir_platform](src/ir_platform/) | 编译、规划、执行、图仓储、追溯与 CLI |
| [research_outputs](research_outputs/) | 历史研究运行记录；与稳定验收样例分开 |
| [docs](docs/) | 架构、数据源、目录与公开发布说明 |
| [tests](tests/) | 自动化验证 |

生命周期视图仍可显示为“任务、设计、证据、推理、发布”，但它们只用于界面分组，不参与执行顺序或回退控制。

## 快速开始

需要 Python 3.12。依赖已由 `uv.lock` 固定。

```bash
uv sync --frozen
uv run --frozen --offline ir-platform validate
uv run --frozen --offline ir-platform compile-ontology
uv run --frozen --offline pytest
```

创建计划时提供任务 YAML；可选状态 YAML 用于描述当前图中已有证据或冲突：

```yaml
id: request:memory-update
bundle_id: memory-update
mode: full_research
title: 存储芯片周期更新
```

```bash
uv run --frozen --offline ir-platform --runtime-dir .runtime plan request.yaml --state state.yaml
uv run --frozen --offline ir-platform --runtime-dir .runtime run PLAN_ID BUNDLE_ID
uv run --frozen --offline ir-platform --runtime-dir .runtime approve BUNDLE_ID APPROVAL_REQUEST_ID --approver RESEARCHER_ID
```

计划只能引用登记过的 Capability、Logic 和 Rule。未知能力、循环依赖、类型不匹配、越权写入和绕过人工发布审批的提案都会被拒绝。节点失败时，只有声明为幂等的能力会按配置重试。

<<<<<<< Updated upstream
完整A股权益研究或更新须在请求中显式声明 `asset_class: equity` 和 `market_scope: A_share`。规划器会在取证与假设形成前加入 `ResearchDesign` 节点；个人原则档案中的候选条目不会自动启用。运行时必须提供有内容的研究设计，完整权益报告还须呈现 A10 投资命题结构。可通过 `run --node-outputs outputs.yaml` 按节点 ID 提供实际输出；未提供时流程在设计节点停止，不会凭标题或占位内容生成观点。设计字段和报告字段见[总控协议](.agents/skills/touyan-quanyi-yanjiu-zongkong/references/research-design-protocol.md)，个人原则及复盘治理见[个人方法论](研究方法/个人方法论/README.md)。旧请求与材料入库、证据刷新不受此要求影响。

## 图归档与查询

```bash
ir-platform --runtime-dir .runtime load-bundle examples/memory-cycle/research-bundle.trig
ir-platform --runtime-dir .runtime trace EXEC-MEM-CYCLE-20260715-1:J-RUN-01
ir-platform --runtime-dir .runtime state-at --bundle-id EXEC-MEM-CYCLE-20260715-1 --recorded-at 2026-07-15T15:00:00Z
```

TriG 是可移植归档格式；装载后 Oxigraph 仍是运行权威。报告 Markdown 只是图数据的表达投影。

## 质量边界

- AI 可提出计划、候选主张和候选判断，但不能直接形成正式事实、正式判断或发布结果。
- 判断等级不得超过证据规则给出的上限；证据不足时补证、降级或停止。
- 冲突事实双方都保留，未经正式裁决不得覆盖。
- 所有动态对象使用业务时间与记录时间，历史重放不得看到后来取得的信息。
- 正式发布必须有独立人工 `ApprovalRecord`。
- 业务代码不得直接导入 Semantica；只有适配模块可以使用其具体类。

完整设计见 [动态运行架构](docs/dynamic-research-runtime.md)。

## 开源与使用边界

项目原创代码、配置与文档按 [Apache-2.0](LICENSE) 授权；依赖及第三方材料仍遵循各自许可与使用条件，见[第三方声明](THIRD_PARTY_NOTICES.md)。研究报告及样例仅展示方法和当时的信息截面，不构成最新事实、投资建议或自动发布结果。公开镜像或二次分发前，请先完成[发布检查](docs/public-release-checklist.md)。贡献方式见[参与指南](CONTRIBUTING.md)。
=======
### Agent 与 Skill

项目只保留一个 Agent 入口：`.agents/agent.yaml`。所有项目 Skill 必须放在 `.agents/skills/`，并在 `agent.yaml` 中登记职责、触发阶段和边界。

新增或移除 Skill 后运行：

```bash
python3 governance/03_校验/validate_agent_skill_registry.py
```

新增/移除 MCP 数据通道时，同步更新 `.agents/skills/touyan-zhengju-mcp-qudao/SKILL.md`、`methods/03_取证/B03_MCP通道注册.md`、`OPS_MCP查询快速参考.md` 和 `03_registry.yaml`。
>>>>>>> Stashed changes
