# 知识图合同

这里只回答四个问题：

1. **图有哪些类型**（领域语义图 / 研究溯源图）
2. **节点与边怎么表示**
3. **两类图怎么区分**
4. **什么关系允许投影 / 追溯**

可以把它理解成**图纸规范**，不是某一次研究画出来的那张具体图。

## 一句话定位

> Ontology 定义「世界里有什么对象和关系」；Knowledge Graph 定义「这些对象和关系如何组织成可查询、可追溯的图视图」；Runtime 负责「某一次研究如何把实例真正写进图里」。

再补一条边界：

> **Research Provenance Graph = 研究结论为什么成立**；**Execution Trace = 这次 Agent 怎么跑出来的**。Knowledge Graph 只管前者。

## 给谁看

- **研究员**：理解「领域语义图」和「研究溯源图」为什么分开
- **维护者**：改图合同与入图策略

## 本目录有什么

```text
03_knowledge_graph/
├── README.md
├── registry.yaml
└── contracts/
    ├── graph_schema.yaml        # Graph / Object / Relation 基础结构
    ├── graph_views.yaml         # Domain Semantic vs Research Provenance
    ├── relation_policy.yaml     # 关系如何进入图（含禁止推断业务事实）
    ├── projection_policy.yaml   # 投影方向与禁止双向同步
    └── trace_policy.yaml        # 下游失效传播方向
```

## 本目录不负责

- 从数据库读哪个 artifact
- 固定 Stage02/03/04（或任意 Workflow）如何变成图
- 一次 run 如何生成 provisional graph
- 怎么读 workspace
- 历史 CSV 兼容校验
- Task / TaskNode / AgentRun / Event / Checkpoint（Execution Trace）

这些分别在：

| 职责 | 位置 |
|---|---|
| Runtime 图边界类型 | [`06_runtime/src/semantic/graph-contracts.ts`](../../06_runtime/src/semantic/graph-contracts.ts) |
| 实例图校验 / 任务视图投影 | [`05_control_evaluation/03_校验/knowledge_graph/`](../../05_control_evaluation/03_校验/knowledge_graph/) |
| 历史 03/04 样例兼容 | [`05_control_evaluation/03_校验/legacy_compat/`](../../05_control_evaluation/03_校验/legacy_compat/) |
| 旧 stage→graph 物化器（非 vNext，仅 adapter） | [`legacy/knowledge_graph/`](../../legacy/knowledge_graph/) |

## 硬原则

**Knowledge Graph 可以补结构，不可以补业务事实。**

- 已有显式 Ontology 关系（如 `produces`）→ 可以物化边
- 领域权威 `business_instances` 已确认 → 可以引用
- 经 authority gate 确认、且登记了图投影的研究制品 → 可以入研究溯源图
- **仅仅因为两个对象同处一个 ResearchScope → 不生成业务关系**
- **正式图不依赖固定 Workflow 或阶段序列**

## 怎么用

1. 要查图结构 / 视图 / 入图策略 → 读本目录 `contracts/`。
2. 要看某次研究留下的实例数据 → 去 Runtime / Workspace，不要改合同目录来「修一次结果」。
3. 正式图存在且指纹一致时，读面应从**图单向投影**；不要手工双向同步研究制品与图。

## 怎么维护

- 改图纸规范只改本目录合同与 `registry.yaml`，并核对 Runtime `graph-contracts.ts`。
- 关系类型本身仍改 `01_ontology`；这里只改「如何入图」。示例字段（`example_*`）不构成类型登记。
- 禁止把 UI 临时布局、单次 run 物化结果、DB I/O、固定阶段序列写进本目录。
- 改完跑语义/项目校验与 Runtime 测试。

---

## 维护者附录（可跳过）

- **status:** active（合同定稿：与 Workflow/Execution Trace 解耦）
- **读面策略：** 正式图可用且指纹可验证时，读面从图单向投影；禁止制品 ↔ 图双向手工同步
- **兼容：** Stage02–04 物化仅作 Runtime/legacy adapter，不是本合同前提
