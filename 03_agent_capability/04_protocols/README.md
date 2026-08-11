# 协议与数据通道

这里配置「已经决定要从某个渠道获取以后，怎么连过去」。

来源选择（找谁、先找谁、找不到怎么办）属于
[`evidence-research`](../02_skills/evidence_research/SKILL.md)，不在本目录。

## 给谁看

- **研究员：** MCP 通道清单与 OPS 操作卡
- **维护者：** 通道注册与 adapter 边界

## 目录

| 子目录 | 含义 |
|---|---|
| [`mcp/`](mcp/README.md) | 正式协议层：通道注册与 OPS |
| [`_planned/`](_planned/a2a.md) | A2A 等未启用协议（roadmap） |

**MCP 是获取通道，不是来源生产者。**

## 怎么用

1. 先在 `evidence-research` 确定「要证明什么 / 找谁」。
2. 再映射到通道 → [`mcp/ops/B03_MCP通道注册.md`](mcp/ops/B03_MCP通道注册.md)。
3. 按 [`mcp/ops/OPS_MCP查询快速参考.md`](mcp/ops/OPS_MCP查询快速参考.md) 操作并留痕。

## 维护

- 新增/变更通道：更新 mcp 注册表、B03、OPS，保持「通道 ≠ 生产者」。
- A2A 保持 planned，不写假协议。
- 配置权威在本目录；执行在 `06_runtime`。
