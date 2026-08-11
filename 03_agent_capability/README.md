# 能力域

> 第一次接触项目？先读仓库根目录 [`README.md`](../README.md)。

这里回答「完成研究靠什么」：

```text
谁来做（Agent）
  + 会怎么做（Skill）
  + 能执行什么动作（Tool）
  + 怎么连接外部能力（Protocol）
```

**03 = Capability Definition Authority**（能力是什么、资源在哪、边界是什么）。  
**06 = Execution Binding Authority**（capability ID 如何绑定 handler / model / tool / state）。

## 给谁看

- **研究员**：进对应 Skill 包查框架 / 取证 / 裁决 / 交付资源；取数看 MCP 操作卡
- **维护者**：改能力定义与资源；可执行绑定以 Runtime 为准

## 目录

| 子目录 | 含义 |
|---|---|
| [`01_agents/`](01_agents/README.md) | 谁来做：active Agent 与 candidates |
| [`02_skills/`](02_skills/README.md) | 会怎么做：Skill package（`SKILL.md` + references/templates） |
| [`03_tools/`](03_tools/README.md) | 能执行什么动作（动作语义，不是协议名） |
| [`04_protocols/`](04_protocols/README.md) | 怎么连接外部能力（目前正式层只有 MCP） |

没有第五类「方法库」目录。原研究框架 / 取证 / 裁决 / 表达已分别进入对应 Skill 的 `references/` 与 `templates/`。

## 怎么用

1. 选型研究框架 / 证伪设计 → [`02_skills/research_design/`](02_skills/research_design/SKILL.md)
2. 找证据、核验、留痕 → [`02_skills/evidence_research/`](02_skills/evidence_research/SKILL.md)
3. 形成可审计判断 → [`02_skills/judgment_reasoning/`](02_skills/judgment_reasoning/SKILL.md)
4. 组织交付物 → [`02_skills/research_delivery/`](02_skills/research_delivery/SKILL.md)
5. 已决定通道后如何连接 → [`04_protocols/mcp/`](04_protocols/mcp/README.md)

Skill 之间**不是**固定流水线；Research Lead 按任务组合。

## 怎么维护

- 改 Skill 程序或资源：改 `02_skills/<package>/`，有校验脚本则先跑
- 改 MCP 通道：改 `04_protocols/mcp/`，保持「通道 ≠ 生产者」
- 改可执行绑定：改 `06_runtime/src/capabilities/registry.ts`，再跑测试与 `audit-cutover`
- 禁止恢复 `05_method_libraries` 一级目录，也禁止把固定 01→05 阶段伪装成 Skill

---

## 维护者附录（可跳过）

- **registry:** [`registry.yaml`](./registry.yaml)
- Context Builder / Provider / Policy / Verifier **不是** Skill
- A2A 仅 planned：[`04_protocols/_planned/a2a.md`](04_protocols/_planned/a2a.md)
