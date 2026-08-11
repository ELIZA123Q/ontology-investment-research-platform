# 能力域 — 靠什么完成研究

> 第一次接触项目？先读仓库根目录 [`README.md`](../README.md)。

这里回答「完成研究靠什么」。好比一个投研团队的人员和能力清单——谁来做（Agent）、会怎么做（Skill）、能用什么工具（Tool）、怎么连外部数据（Protocol）。

**03 = 能力定义权威**（能力是什么、资源在哪、边界是什么）
**06 = 执行绑定权威**（能力 ID 怎么绑到具体程序）

## 里面有什么

| 子目录 | 一句话说明 | 你需要管吗 |
|--------|-----------|-----------|
| [`01_agents/`](01_agents/README.md) | **AI 助手名册**：谁是正式上线的，谁是候选的 | 加新 Agent 时看 |
| [`02_skills/`](02_skills/README.md) | **技能包**：每个技能包含方法文档和模板（共 12 个技能） | 改研究方法时看 |
| [`03_tools/`](03_tools/README.md) | **工具登记**：系统能执行哪些动作（搜索、抓取、发布等） | 加新工具时看 |
| [`04_protocols/`](04_protocols/README.md) | **协议层**：怎么连接外部能力（目前正式启用的是 MCP） | 改数据通道时看 |

> 没有第五类「方法库」目录——研究框架、取证、裁决、表达已分别进入对应 Skill 的 `references/` 和 `templates/`。

## 日常怎么用

| 你要做什么 | 去哪找 |
|-----------|--------|
| 选研究框架或证伪设计 | [`02_skills/research_design/`](02_skills/research_design/SKILL.md) |
| 找证据、核验、留痕 | [`02_skills/evidence_research/`](02_skills/evidence_research/SKILL.md) |
| 形成可审计的判断 | [`02_skills/judgment_reasoning/`](02_skills/judgment_reasoning/SKILL.md) |
| 组织交付物 | [`02_skills/research_delivery/`](02_skills/research_delivery/SKILL.md) |
| 连接外部数据源 | [`04_protocols/mcp/`](04_protocols/mcp/README.md) |

> Skill 之间**不是**固定流水线——Research Lead 按任务灵活组合。

## 怎么维护

| 要改什么 | 改哪里 | 改完做什么 |
|---------|--------|-----------|
| 技能的方法文档或模板 | `02_skills/<包名>/` | 有校验脚本就先跑 |
| MCP 数据通道 | `04_protocols/mcp/` | 保持「通道 ≠ 生产者」 |
| 能力定义或发布状态 | 本域 registry 或 `releases/current.json` | `npm run domain:sync` |
| 可执行程序绑定 | `06_runtime/src/capabilities/registry.ts` | `audit:domain` + `audit:cutover` |

### 禁止

- **禁止恢复 `05_method_libraries` 一级目录**
- **禁止把固定 01→05 阶段伪装成 Skill**

## 常见问题

**Q：Agent 和 Role 有什么区别？**
A：Role（在 `02_scenario_task/04_roles/`）是研究任务中的责任位置，比如「研究负责人」「证据调查员」。Agent 是实际干活的 AI 助手。一个 Agent 可以承担多个 Role。

**Q：技能分几层？**
A：两层——**研究纪律层**（研究框架设计、证据研究、判断推理、交付组织）和**专业工作流层**（公司基本面、行业景气、财务建模、估值、业绩更新、论点监控、独立复核）。专业层不能绕过纪律层。

**Q：什么是 Release Manifest？**
A：能力发布清单（`releases/current.json`）。12 个技能虽然都写好了，但只有清单里标记 `active` 且命中启用范围的才能在生产环境执行。不会因为「代码已存在」就自动上线。

---

## 技术附录（给开发维护者）

- **registry:** [`registry.yaml`](./registry.yaml)
- Context Builder / Provider / Policy / Verifier **不是** Skill
- A2A 仅 planned：[`04_protocols/_planned/a2a.md`](04_protocols/_planned/a2a.md)

### 当前 Agent 状态

| Agent | 状态 | 说明 |
|-------|------|------|
| research_lead | active | 唯一正式上线的 Agent |
| evidence_investigator | candidate | 计划中，不调度 |
| financial_modeler | candidate | 计划中，不调度 |
| independent_reviewer | candidate | 计划中，不调度 |

### Skill 分层

| 层 | Skill | 说明 |
|----|-------|------|
| 研究纪律层 | research_framing | 这个问题到底在研究什么 |
| 研究纪律层 | research_design | 用什么框架与证伪设计 |
| 研究纪律层 | evidence_research | 证据去哪找、怎么核验 |
| 研究纪律层 | judgment_reasoning | 如何形成可审计判断 |
| 研究纪律层 | research_delivery | 如何交付 |
| 专业工作流层 | company_fundamental_research | 公司基本面 |
| 专业工作流层 | sector_cycle_research | 行业景气 |
| 专业工作流层 | financial_modeling | 财务建模 |
| 专业工作流层 | valuation_analysis | 估值分析 |
| 专业工作流层 | earnings_update | 业绩更新 |
| 专业工作流层 | thesis_monitoring | 论点监控 |
| 专业工作流层 | independent_research_review | 独立复核 |
