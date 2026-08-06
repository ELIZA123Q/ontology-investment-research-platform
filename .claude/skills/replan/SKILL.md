---
name: replan
description: >-
  工作流修订与变更集管理。支持在01/02/04阶段后的受控回溯，
  生成变更集补丁，校验不会湮灭已有产出，执行变更集应用。
  Use when user asks to "修订判断" "修改结构" "回溯"
  "变更集" "replan" "change set" or mentions workflow revise,
  controlled backtracking.
allowed-tools: Read
---

# 工作流修订与变更集

## 触发条件

- 当前阶段产出触发下游回溯需求（如证据缺口、结构不合理）
- 需要生成变更集补丁但不湮灭已有产出
- Stage01/02/04 后的受控回溯

## 支持的回溯模式

| 触发阶段 | 目标阶段 | 机制 |
|---------|---------|------|
| Stage02 结构 | Stage01 受理 | 还原前提，重新生成判断单元 |
| Stage03 证据 | 提示缺口 | 填证通道（不回溯，由 gap-detection 处理） |
| Stage04 判断 | Stage02 结构 | 还原判断单元与证据 |
| Stage04 判断 | Stage01 受理 | 还原前提与问题 |

## 使用流程

1. 识别回溯触发信号
2. 生成变更集（content_hash diff）
3. 校验变更集：确保已关闭阶段的产出不被湮灭
4. 应用变更集
5. 重新执行被影响阶段

## 核心约束

- **已关闭阶段的产出不会被变更集湮灭**
- 变更集仅影响未关闭阶段
- 受控回溯：不无限回溯

## 知识库引用（不复制，直接读取）

| 需要什么 | 读取位置 |
|---------|---------|
| 阶段规范 | `runtime/workflow/stage_specs/` |
| 变更集 Schema | `governance/02_合同/change_set_schema.yaml` |
| 实现代码 | `runtime/skills/replan/` |
