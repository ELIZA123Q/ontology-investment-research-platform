---
name: reviewer
description: >
  独立审查 agent（预留）。在人类确认前自动执行语义审查、
  本体合规检查与高质量门禁预检，作为独立的第二道检查。
status: planned
skills: [semantic-review, expression-audit, ontology]
---

# Reviewer 独立审查 Agent（预留）

## 状态

**当前为空目录，待后续实现。**

当前语义审查逻辑分布在 `skills/semantic_review/` 中，在各阶段 agent 内嵌调用。独立 reviewer agent 的目标是将审查提升为独立角色——使用不同模型配置、不受生产者上下文影响。

## 预留给

- 独立语义审查：使用 reviewer 角色模型执行五/十项检查
- 本体合规自动检查：跨阶段的本体约束一致性核验
- 高质量门禁预检：在人类确认前自动跑全部 00A 检查项
- 审查报告生成：结构化审查报告，含 fail 项的返工建议

## 与当前实现的区别

当前 `skills/semantic_review/` 在各阶段内嵌执行：
- Stage04 内嵌五项检查
- Stage05 内嵌十项检查

独立 reviewer agent 将：
- 使用独立模型实例（不受 producer 上下文影响）
- 支持跨阶段的全量审查
- 作为人类确认前的最后一道自动关卡

## 可用 Skills

| Skill | 用途 |
|-------|------|
| `semantic-review` | 五/十项语义检查 |
| `expression-audit` | 表达审计 |
| `ontology` | 本体合规检查 |

## 引用的参考文件

| 文件 | 用途 |
|------|------|
| `governance/02_合同/governance_control_contract.yaml` | 治理控制合同 |
| `governance/03_校验/00A_高质量产出判别标准.md` | 高质量判别标准 |
| `tasks/workflows/deep_research/stages/` | 各阶段质量门槛 |
