# 协议与数据通道 — 怎么连接外部能力

> 上级目录：[`03_agent_capability/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里配置「已经决定要从某个渠道获取数据以后，怎么连过去」。好比决定了要查华泰的数据后，这里负责怎么接上华泰的接口。

> 来源选择（找谁、先找谁、找不到怎么办）属于 [`evidence-research` Skill](../02_skills/evidence_research/SKILL.md)，不在本目录。

## 里面有什么

| 子目录 | 一句话说明 | 状态 |
|--------|-----------|------|
| [`mcp/`](mcp/README.md) | **MCP 通道**：通道注册与操作手册 | 正式启用 |
| [`_planned/`](_planned/a2a.md) | **A2A 协议**：Agent 间通信（未启用） | 计划中 |

> **MCP 是获取通道，不是来源生产者。**

## 日常怎么用

1. 先在 `evidence-research` 确定「要证明什么 / 找谁」
2. 再映射到通道 → [`mcp/ops/B03_MCP通道注册.md`](mcp/ops/B03_MCP通道注册.md)
3. 按 [`mcp/ops/OPS_MCP查询快速参考.md`](mcp/ops/OPS_MCP查询快速参考.md) 操作并留痕

## 怎么维护

- 新增/变更通道：更新 mcp 注册表、B03、OPS，保持「通道 ≠ 生产者」
- A2A 保持 planned，不写假协议
- 配置权威在本目录；执行在 `06_runtime/`
