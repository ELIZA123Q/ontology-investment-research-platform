---
skill_id: research-framing
name: Research Framing
version: 1.0.0
purpose: 明确这个问题到底在研究什么——对象、期限、决策目标、边界与必要澄清。
consumes:
  - 02_scenario_task/01_intents
  - 02_scenario_task/03_tasks
output_kind: research_plan
progressive_loading: metadata_then_instructions_then_resources
---

# Research Framing

## 何时使用

用户提出研究意图、对象模糊、决策目标不清，或需要把自然语言问题压成可证伪研究问题时。

## 程序

1. 识别会改变研究路径的缺口（对象、时间范围、决策用途、成功标准）。
2. 给出可编辑默认值，而不是无限追问。
3. 把目标表达为可证伪问题，并声明边界（不研究什么）。
4. 必要时引用 `02_scenario_task` 的 Intent / Task 定义，而不是在本 Skill 内重新发明任务类型。

## 不做

- 不选择具体研究框架（交给 `research-design`）
- 不取证、不裁决、不写交付物
- 不把澄清表单实现伪装成本 Skill 正文

## 资源

- `references/`：可选补充材料（当前以程序为主）
