# 知识图合同 — 图的图纸规范

> 上级目录：[`01_semantic_knowledge/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里定义「对象和关系怎么组织成可查询、可追溯的图」。好比建筑图纸规范——规定墙怎么画、门怎么标，但不负责某栋楼具体怎么盖。

## 里面有什么

| 文件 | 一句话说明 |
|------|-----------|
| `contracts/graph_schema.yaml` | **图基础结构**：Graph/Object/Relation 怎么表示 |
| `contracts/graph_views.yaml` | **两类图怎么区分**：领域语义图 vs 研究溯源图 |
| `contracts/relation_policy.yaml` | **入图规则**：什么关系允许画线（含禁止推断业务事实） |
| `contracts/projection_policy.yaml` | **投影方向**：图和制品怎么单向投影（禁止双向同步） |
| `contracts/trace_policy.yaml` | **追溯方向**：下游失效怎么传播 |

## 日常怎么用

1. **查图结构规则** → 读 `contracts/` 下的 YAML
2. **看某次研究的实例数据** → 去 `06_runtime/`，不要改合同来「修一次结果」
3. **正式图和制品之间** → 从图单向投影，不要手工双向同步

## 怎么维护

- 改图纸规范只改本目录合同和 `registry.yaml`
- 关系类型本身改 `01_ontology/`，这里只改「如何入图」
- **禁止**把 UI 临时布局、单次运行结果、数据库操作、固定阶段序列写进本目录
- 改完跑语义/项目校验与 Runtime 测试

## 常见问题

**Q：两类图有什么区别？**
A：**领域语义图**（Domain Semantic Graph）描述「世界里有什么」——稳定的世界模型。**研究溯源图**（Research Provenance Graph）描述「结论为什么成立」——一次研究的证据链。两者不能混。

**Q：什么是「可以补结构，不可以补业务事实」？**
A：已有明确关系的对象可以画线（补结构），但不能因为两个对象恰好在同一个研究范围里就推断它们有业务关系（补事实）。事实必须由证据支撑。

---

## 技术附录（给开发维护者）

| 项 | 值 |
|----|-----|
| status | active |
| 读面策略 | 正式图可用且指纹可验证时，读面从图单向投影；禁止制品 ↔ 图双向手工同步 |
| 运行时边界 | 仅支持 vNext TaskGraph/Artifact 投影；历史包不在工作树内继续兼容 |

### 边界

- Runtime 图边界类型：[`06_runtime/src/semantic/graph-contracts.ts`](../../06_runtime/src/semantic/graph-contracts.ts)
- 制品与来源校验：[`06_runtime/src/governance/verifiers.ts`](../../06_runtime/src/governance/verifiers.ts)

### 硬原则

- 已有显式 Ontology 关系（如 `produces`）→ 可以物化边
- 领域权威 `business_instances` 已确认 → 可以引用
- 经 authority gate 确认、且登记了图投影的研究制品 → 可以入研究溯源图
- 仅仅因为两个对象同处一个 ResearchScope → **不生成业务关系**
- 正式图不依赖固定 Workflow 或阶段序列

### 本目录不负责

- 从数据库读哪个 artifact
- 具体 TaskGraph 或 Artifact 如何物化为图
- 一次 run 如何生成 provisional graph
- 怎么读 workspace
- Task/TaskNode/AgentRun/Event/Checkpoint（Execution Trace）
