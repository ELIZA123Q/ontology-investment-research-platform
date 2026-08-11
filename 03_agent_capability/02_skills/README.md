# Skill 包

Skill 保存「这类事情怎样做好」的程序性知识，不是 Runtime 里的每一步代码。

每个 Skill 是一个包：

```text
<skill_package>/
├── SKILL.md          # 程序：何时用、怎么做、不做什么
├── references/       # 按需加载的方法正文、速查、领域材料
└── templates/        # 可选模板
```

加载顺序：`registry metadata → SKILL.md → 按需 references / templates`。

## 现行五个 Skill

| skill_id | 入口 | 回答 |
|---|---|---|
| `research-framing` | [`research_framing/SKILL.md`](research_framing/SKILL.md) | 这个问题到底在研究什么？ |
| `research-design` | [`research_design/SKILL.md`](research_design/SKILL.md) | 用什么框架与证伪设计？ |
| `evidence-research` | [`evidence_research/SKILL.md`](evidence_research/SKILL.md) | 证据去哪找、怎么核验与留痕？ |
| `judgment-reasoning` | [`judgment_reasoning/SKILL.md`](judgment_reasoning/SKILL.md) | 如何形成可审计判断？ |
| `research-delivery` | [`research_delivery/SKILL.md`](research_delivery/SKILL.md) | 如何交付（不止写文章）？ |

它们可以按任务组合，**不是**必须按 framing → design → evidence → judgment → delivery 顺序走完。

## 边界

| 内容 | 权威位置 |
|---|---|
| 任务 / 场景 / Role | `02_scenario_task` |
| 本体对象与语义 | `01_semantic_knowledge` |
| 强制门槛与 Verifier | `05_control_evaluation` |
| 真正调用搜索 / MCP | Tool（`03_tools`）+ MCP Protocol |
| 能力执行绑定 | `06_runtime/src/capabilities/registry.ts` |

## 怎么用

1. 日常研究：先看对应 Skill 的 `SKILL.md`，再按需打开 `references/`。
2. 取数：先看 `evidence-research` 的来源策略与 `source_routes.yaml`，再映射到 MCP。
3. 不要把 Context Builder、Source Capture、Policy、Verifier 伪装成 Skill。

## 怎么维护

- 改正文与资源：改对应 package
- 改可执行绑定：`06_runtime/src/capabilities/registry.ts`
- 跨 Skill 方法元数据：[`method_assets.yaml`](method_assets.yaml)
- 有校验脚本的包改完先跑：`research_design/validate.py`、`evidence_research/validate.py`、`judgment_reasoning/validate.py`

## 外部 Skill 准入

SkillHub 等市场只用于发现候选模式，不是运行时信任根。候选、价值、风险和当前决策登记在 [`external_candidates.json`](external_candidates.json)。外部 Skill 在完成源码、脚本、依赖、权限、输入输出合同、安全沙箱和 gold eval 审查前不得直接安装或激活；即使激活，也只能映射为本地 Skill 资源或 Tool/Connector 实现，不能改写本体、证据晋级、判断和发布门槛。
## A 股基本面投研能力分层

本目录的 Skill 分为两层：

- 研究纪律层：research-framing、research-design、evidence-research、judgment-reasoning、research-delivery。负责框定、方法约束、取证、裁决、表达与审计边界。
- 专业工作流层：company-fundamental-research、sector-cycle-research、financial-modeling、valuation-analysis、earnings-update、thesis-monitoring、independent-research-review。负责公司/行业研究、模型、估值、业绩更新、命题状态和隔离复核。

专业工作流层不能绕过纪律层：所有外部数据仍须按金融数据摄取合同进入 EvidenceFact；估值不自动生成评级、目标价、仓位或交易指令；独立复核只能写 review。

深度研究由 research-design 的 research_lens 注册表选择一个主 lens 和一个 counter-lens。交付表达由 research-delivery 的 expression preset 控制，不得改变证据等级、判断强度或风险揭示。
