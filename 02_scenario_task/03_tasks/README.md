# 标准任务定义

status: active

登记用户级 **Research Task Contract**：研究目标的标准语义合同。

回答的是「要完成什么判断、何时算完成」，不是「用哪条 Workflow / 哪个 Skill / 哪个 Runtime Node」。

```text
用户问题
  → Scenario（研究情境）
  → Research Task（标准判断合同）
  → Planner（最小必要 TaskGraph）
  → Agent / Skill / Tool
  → Runtime 执行
```

## 边界

| 是 | 不是 |
|---|---|
| 可复用的标准研究判断合同 | 单次 run 实例 |
| `objective` / `scope` / `judgment_requirements` / `completion_criteria` | 预定义 Workflow 入口 |
| 抽象 `capability_requirements` | 指定具体 Skill ID |
| Scenario 的候选目标（由 Scenario 单向引用） | 与 Scenario 1:1 绑定 |

`evidence_only` / 证据核验属于 Runtime Planning Intent + node-catalog，**不**在本目录登记。

## 合同字段

每个 Task YAML 至少包含：

1. **objective** — 最终要解决什么问题
2. **scope** — 何时适用 / 何时排除（供 Planner 选型）
3. **judgment_requirements** — 至少必须形成哪些判断（不是执行步骤）
4. **expected_output** — 必须贡献哪些研究结果
5. **completion_criteria** — 到什么程度可以停止
6. **uncertainty_policy** — 证据不足时是否允许明确降级为“暂不可判断”

可选：`capability_requirements`（需要什么能力，不是必须调用哪个 Skill）。

## 维护规则

- 不要给 Task 写执行步骤或固定 01→05。
- 不要绑定 `optional_workflow_pattern`；深度由 Planning Intent + Context 决定。
- 不要写 `relevant_scenario_types`；由 Scenario 的 `candidate_tasks` 单向引用。
- 不要急着扩充大量 Task；先把现有合同写清楚。
