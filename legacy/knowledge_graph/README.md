# Legacy Knowledge Graph Materializers

历史 stage→graph 物化与加载代码。**不是** Semantic source of truth，**不参与** vNext Runtime。

## 为何在这里

`01_semantic_knowledge/03_knowledge_graph/` 已收窄为 YAML 图合同。下列实现曾错误登记为 Semantic SoT，现迁出：

| 文件 | 原职责 |
|---|---|
| `types.ts` | GraphObject / GraphRelation / 查询结果类型 |
| `authority.ts` | 正式图阶段重放与 Action overlay |
| `projection.ts` | provisional 投影、merge、graph→stage JSON |
| `load.ts` | 读 DB / workspace 选 formal/package/provisional |
| `trace.ts` | BFS 下游追溯与样例包发现 |
| `materialize.ts` | stage JSON → graph |
| `materialize_stage04.ts` | Stage04 专用投影 |

现行合同见：

- `01_semantic_knowledge/03_knowledge_graph/contracts/`
- Runtime 边界：`06_runtime/src/semantic/graph-contracts.ts`

## 硬约束（迁出后仍适用）

**禁止** `generateEntityRelations` 一类「同处 ResearchScope → 推断 produces/supplies_to/contains/located_in」行为。  
Knowledge Graph 可以补结构，不可以补业务事实。
