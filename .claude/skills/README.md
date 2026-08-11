# .claude 技能说明 — 这里不放产品 Skill

> 根目录：[`README.md`](../../README.md)

这个目录是 Claude/Codex 个人工具技能的存放处。**产品 Runtime 的 Agent/Skill/Tool 唯一可执行注册源**是 `06_runtime/src/capabilities/registry.ts`，不是这里。

## 什么意思

- 改产品 Skill → 只改 Runtime registry 与对应实现
- **不要**把个人 IDE 技能复制进本仓库当产品能力
- 保持本目录不承载 Runtime Skill 正文或镜像，避免 `.claude`、`03_agent_capability`、`06_runtime` 三套漂移

> 产品能力定义在 `03_agent_capability/`（非实现镜像），可执行绑定在 `06_runtime/`。
