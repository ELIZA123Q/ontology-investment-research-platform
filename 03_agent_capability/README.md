# 能力域

> 还不了解本项目？先读仓库根目录 [新手导读.md](../新手导读.md)。

这里回答「完成研究靠什么」：谁来做（Agent）、会哪些程序性步骤（Skill）、能调哪些工具（Tool）、数据怎么进来（协议），以及研究员可查阅的方法库。

## 给谁看

- **研究员**：方法库（框架/取证/裁决/表达）与 MCP 操作手册
- **维护者**：能力登记；可执行清单以 Runtime 为准

## 材料从哪来

| 子目录 | 白话含义 |
|---|---|
| [`01_agents/`](01_agents/README.md) | Agent 组织与职责登记 |
| [`02_skills/`](02_skills/README.md) | Skill（程序性知识）登记 |
| [`03_tools/`](03_tools/README.md) | Tool 登记 |
| [`04_protocols/`](04_protocols/README.md) | MCP / A2A 等获取通道配置 |
| [`05_method_libraries/`](05_method_libraries/README.md) | 研究框架、取证、裁决、表达方法库 |

**重要：** 本域主要是**治理索引与方法正文**。真正会被代码加载的 Agent/Skill/Tool 清单只在 [`06_runtime/src/capabilities/registry.ts`](../06_runtime/src/capabilities/registry.ts)。

MCP 是**获取通道**，不是来源生产者；材料质量由巨潮、通联、研究所等上游决定。

## 怎么用

1. 做研究选型方法 → 从 [`05_method_libraries/`](05_method_libraries/README.md) 进入对应库。
2. 需要自动/半自动取数 → 看 [`04_protocols/mcp/`](04_protocols/mcp/README.md) 的通道注册与 OPS 卡片。
3. 想知道系统当前启用了哪些 Agent/Skill → 以 Runtime registry 为准，再对照本域登记说明。

## 怎么维护

- 改方法库正文：在 `05_method_libraries/` 对应库改，并跑该库校验脚本。
- 改 MCP 通道：更新 `04_protocols/mcp/` 注册与 OPS，保持「通道 ≠ 生产者」表述。
- 改可执行能力：必须改 `06_runtime/src/capabilities/registry.ts`，并跑 Runtime 测试与 `audit-cutover`；本域只同步治理归属，不存实现镜像。

---

## 维护者附录（可跳过）

- **status:** active
- **registry:** [`registry.yaml`](./registry.yaml)
- **上位:** [`00_五域系统骨架.md`](../05_control_evaluation/01_架构/00_五域系统骨架.md)
- Context Builder / Provider / Policy / Verifier **不是** Skill，勿装进 skills 目录冒充
