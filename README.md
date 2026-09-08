# 动态规则驱动投研平台

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
| [examples](examples/) | 两套可装载 TriG 研究图与报告投影 |
| [src/ir_platform](src/ir_platform/) | 编译、规划、执行、图仓储、追溯与 CLI |

生命周期视图仍可显示为“任务、设计、证据、推理、发布”，但它们只用于界面分组，不参与执行顺序或回退控制。

## 快速开始

需要 Python 3.12。依赖已由 `uv.lock` 固定。

```bash
uv sync --frozen
uv run --frozen --offline ir-platform validate
uv run --frozen --offline ir-platform compile-ontology
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
