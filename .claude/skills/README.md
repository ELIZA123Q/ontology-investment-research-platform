# 这里不维护产品 Runtime Skill

投研工作台的 Agent / Skill / Tool **唯一可执行注册源**是：

`06_runtime/src/capabilities/registry.ts`

## 给谁看

维护者（避免在 `.claude` 里误放第二套产品 Skill）。

## 材料从哪来

- 产品能力：`06_runtime/src/capabilities/registry.ts`
- 治理索引：`03_agent_capability/`（非实现镜像）
- 本目录：Claude/Codex **个人工具**技能若存在，也不等于产品 Runtime

## 怎么用

改产品 Skill → 只改 Runtime registry 与对应实现。不要把个人 IDE 技能复制进本仓库当产品能力。

## 怎么维护

保持本目录不承载 Runtime Skill 正文或镜像，避免 `.claude`、`03_agent_capability`、`06_runtime` 三套漂移。
