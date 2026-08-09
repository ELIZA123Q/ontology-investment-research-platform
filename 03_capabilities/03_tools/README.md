# Tool 登记

Tool 负责**执行动作**（例如发现来源、抓取快照）。Skill 负责程序性知识；二者不要混用。

## 给谁看

- **研究员：** 了解系统能调用哪些动作类能力（通常经 Lead 调用）
- **维护者：** Tool 边界与 MCP 配置分工

## 材料从哪来

- 本目录治理登记
- **唯一可执行注册源：** `07_runtime/src/capabilities/registry.ts`
- MCP 连接与通道配置：[`../04_protocols/mcp/`](../04_protocols/mcp/README.md)

## 怎么用

1. 日常通过工作台提需求即可，不必直接点 Tool 名。
2. 查「某个动作是否存在 / 是否可执行」→ Runtime registry。
3. Provider Adapter、Verifier、Policy **不属于** Tool。

## 怎么维护

- 可执行 Tool 变更必须改 Runtime registry 与实现；本目录同步治理说明。
- MCP 通道参数改协议目录，不在 Tool 目录复制通道清单。
- 改完跑测试与 `audit-cutover`。

---

## 维护者附录（可跳过）

- Tool ≠ Skill ≠ Verifier ≠ Policy ≠ Provider Adapter
