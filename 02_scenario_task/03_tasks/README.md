# 标准任务定义 — 每个任务要完成什么判断

> 上级目录：[`02_scenario_task/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里登记标准研究任务的合同——回答「要完成什么判断、什么时候算完成」，**不回答**「用哪个工具、走哪条流程」。

## 里面有什么

每个 Task YAML 包含以下字段：

| 字段 | 白话说明 |
|------|---------|
| `objective` | 最终要解决什么问题 |
| `scope` | 什么时候适用、什么时候排除 |
| `judgment_requirements` | 至少必须形成哪些判断 |
| `expected_output` | 必须贡献哪些研究结果 |
| `completion_criteria` | 到什么程度可以停止 |
| `uncertainty_policy` | 证据不足时是否允许降级为「暂不可判断」 |
| `graph_motif` | 任务展开出的判断单元角色和连接模式 |

## 怎么维护

| 该做 | 不该做 |
|------|--------|
| 写可复用的标准判断合同 | 写单次运行实例 |
| 声明 `graph_motif`（问题结构） | 在 motif 中绑定具体 Skill/Tool/Agent |
| 写抽象 `capability_requirements` | 指定具体 Skill ID |
| 允许不同 Task 合并复用判断单元 | 写固定执行步骤或 TaskNode |

> `evidence_only` / 证据核验属于 Runtime Planning Intent + node-catalog，不在本目录登记。

---

## 技术附录（给开发维护者）

```
用户问题 ─┬─ Scenario constraints ─┐
          ├─ Task motif A ─────────┼─→ Research Problem Graph
          └─ Task motif B ─────────┘          │ frontier
                                               ▼
                                    Runtime Execution TaskGraph
```

### 维护规则

- 不要给 Task 写执行步骤或固定 01→05
- 不要绑定 `optional_workflow_pattern`；深度由 Planning Intent + Context 决定
- 不要写 `relevant_scenario_types`；由 Scenario 的条件化 `task_affordances` 引用
- 不同 Task motif 的等价 JudgmentUnit / EvidenceRequirement 必须允许合并复用
- 不要急着扩充大量 Task；先把现有合同写清楚
