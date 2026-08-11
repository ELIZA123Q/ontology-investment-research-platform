# 研究场景 — 不同研究情境有什么约束

> 上级目录：[`02_scenario_task/`](../README.md) | 根目录：[`README.md`](../../README.md)

这里定义不同研究情境下的约束条件。好比做公司研究和做行业研究的套路不一样——场景就是告诉系统「在这种研究情境下，要注意什么、优先做什么」。

## 里面有什么

| 文件 | 一句话说明 | 你需要管吗 |
|------|-----------|-----------|
| `types.yaml` | **场景类型**：公司研究、行业研究等 + 条件化任务约束 | 加新场景类型时改 |
| `_scenario_card_template.md` | **场景卡模板**：写新场景卡的格式参考 | 写新场景卡时参考 |
| [`semiconductor/`](semiconductor/README.md) | **半导体场景卡**：10 个半导体专属场景 | 加半导体场景时改 |

## 三者的关系

| 概念 | 回答什么 | 在哪 |
|------|---------|------|
| **Method（方法）** | 怎么思考 | [`research_design` Skill](../../03_agent_capability/02_skills/research_design/SKILL.md) |
| **Scenario（场景）** | 在什么情形下给思考加什么约束 | 本目录 |
| **Task（任务）** | 要完成什么标准判断 | [`../03_tasks/`](../03_tasks/README.md) |

> Scenario 用带条件的 `task_affordances` 激活或约束一个或多个 Task，多对多，不是 1:1。

## 怎么维护

- 加新场景：按模板写场景卡，放在对应行业目录下
- 研究框架资源留在 `03_agent_capability/02_skills/research_design/`，不回写本目录
- 语义类型清单见 [`research_requirement_profiles.yaml`](../../01_semantic_knowledge/01_ontology/research_requirement_profiles.yaml)
