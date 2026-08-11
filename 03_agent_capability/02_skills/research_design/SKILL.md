---
skill_id: research-design
name: Research Design
version: 1.0.0
purpose: 面对这个 Task，选择研究框架、判断结构与证伪设计。
consumes:
  - 02_scenario_task/03_tasks
  - 02_scenario_task/02_scenarios
output_kind: method_application
resources:
  - references/
  - registry.yaml
progressive_loading: metadata_then_instructions_then_resources
---

# Research Design

## 何时使用

研究问题已框定，需要决定用什么框架拆解判断单元、变量、路径与证伪设计时。

## 程序

1. 读取 Task / Scenario，识别判断类型与领域。
2. 从 `registry.yaml` 与 `references/` 匹配候选框架（基础 BF / 行业 IF）。
3. 深度研究从 `research_lenses.yaml` 选择一个主 lens 和一个 counter-lens，并记录二者的必要证据、反证与退出条件。
4. 记录方法约束、替代方法与退出条件。
5. 输出可执行的方法应用计划；不重新定义 Task 本身。

## 不做

- 不重新发明任务类型（权威在 `02_scenario_task`）
- 不执行取证或裁决
- 不把固定 01→05 阶段流水线伪装成唯一路径

## 资源加载顺序

1. 本文件（程序）
2. `registry.yaml`（方法 ID 与适用条件）
3. `research_lenses.yaml`（仅深度研究）
4. 按需加载 `references/基础/` 或 `references/行业/<domain>/`
