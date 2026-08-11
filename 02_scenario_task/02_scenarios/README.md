# 研究场景

Scenario Type（`types.yaml`）描述高层研究情境；SCN 场景卡描述相对主框架的增量约束。

**Method = 怎么思考**（[`research-design` Skill](../../03_agent_capability/02_skills/research_design/SKILL.md)）。  
**Scenario = 在什么情形下给思考过程附加什么约束**（本目录）。  
**Task = 要完成什么标准判断**（`../03_tasks`）；Scenario 用带条件的 `task_affordances` 激活或约束一个或多个 Task motif，多对多，不 1:1。

| 文件 | 含义 |
|---|---|
| [`types.yaml`](types.yaml) | CompanyResearch / IndustryResearch / … + 条件化 `task_affordances` |
| [`_scenario_card_template.md`](_scenario_card_template.md) | 场景卡模板 |
| [`semiconductor/`](semiconductor/) | 半导体 SCN-* 唯一正文 |

语义类型清单见 [`research_requirement_profiles.yaml`](../../01_semantic_knowledge/01_ontology/research_requirement_profiles.yaml)。
