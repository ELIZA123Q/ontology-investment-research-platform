# 技能包 — 怎样做好各类研究工作

> 上级目录：[`03_agent_capability/`](../README.md) | 根目录：[`README.md`](../../README.md)

Skill 保存「这类事情怎样做好」的方法知识，不是程序代码。好比研究员的技能树——会框定问题、会选框架、会找证据、会做判断、会写报告。

## 里面有什么

每个 Skill 是一个包：

```
<skill_package>/
├── SKILL.md          # 程序：何时用、怎么做、不做什么
├── references/       # 按需加载的方法正文、速查、领域材料
└── templates/        # 可选模板
```

### 研究纪律层（5 个）

| 技能 | 回答什么 |
|------|---------|
| [`research_framing`](research_framing/SKILL.md) | 这个问题到底在研究什么？ |
| [`research_design`](research_design/SKILL.md) | 用什么框架与证伪设计？ |
| [`evidence_research`](evidence_research/SKILL.md) | 证据去哪找、怎么核验与留痕？ |
| [`judgment_reasoning`](judgment_reasoning/SKILL.md) | 如何形成可审计判断？ |
| [`research_delivery`](research_delivery/SKILL.md) | 如何交付（不止写文章）？ |

### 专业工作流层（7 个）

| 技能 | 回答什么 |
|------|---------|
| `company_fundamental_research` | 公司基本面怎么研究？ |
| `sector_cycle_research` | 行业景气怎么跟踪？ |
| `financial_modeling` | 财务模型怎么建？ |
| `valuation_analysis` | 估值怎么分析？ |
| `earnings_update` | 业绩怎么更新？ |
| `thesis_monitoring` | 论点怎么监控？ |
| `independent_research_review` | 独立复核怎么做？ |

> 专业工作流层**不能绕过**纪律层。所有外部数据仍须按金融数据摄取合同进入 EvidenceFact。

## 日常怎么用

1. 日常研究：先看对应 Skill 的 `SKILL.md`，再按需打开 `references/`
2. 取数：先看 `evidence-research` 的来源策略与 `source_routes.yaml`，再映射到 MCP
3. 加载顺序：`registry metadata → SKILL.md → 按需 references/templates`

> Skill 之间**不是**固定流水线——可以按任务灵活组合。

## 怎么维护

- 改正文与资源：改对应 package
- 改可执行绑定：`06_runtime/src/capabilities/registry.ts`
- 有校验脚本的包改完先跑：`research_design/validate.py`、`evidence_research/validate.py`、`judgment_reasoning/validate.py`
- 跨 Skill 方法元数据：[`method_assets.yaml`](method_assets.yaml)
- **不要**把 Context Builder、Source Capture、Policy、Verifier 伪装成 Skill

## 常见问题

**Q：外部 Skill 能直接安装使用吗？**
A：不能。SkillHub 等市场只用于发现候选模式。外部 Skill 在完成源码、脚本、依赖、权限、输入输出合同、安全沙箱和 gold eval 审查前不得直接安装或激活。候选登记在 [`external_candidates.json`](external_candidates.json)。

---

## 技术附录（给开发维护者）

### 能力分层

- 研究纪律层：负责框定、方法约束、取证、裁决、表达与审计边界
- 专业工作流层：负责公司/行业研究、模型、估值、业绩更新、命题状态和隔离复核
- 深度研究由 `research-design` 的 `research_lens` 注册表选择一个主 lens 和一个 counter-lens
- 交付表达由 `research-delivery` 的 expression preset 控制，不得改变证据等级、判断强度或风险揭示
- 估值不自动生成评级、目标价、仓位或交易指令
- 独立复核只能写 review
