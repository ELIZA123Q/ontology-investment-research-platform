---
name: method-selection
description: >-
  判断方法选择与知识加载。从方法注册表加载取证/裁决/表达方法，
  按判断类型路由匹配，组装LLM上下文知识包，校验方法适用条件。
  Use when user asks to "选方法" "方法注册" "方法卡片"
  "知识包" "方法路由" or mentions method registry, knowledge package.
allowed-tools: Read
---

# 方法选择与知识加载

## 触发条件

- Stage02：为判断单元分配取证/裁决方法
- Stage03：加载取证方法卡片与指引
- Stage04：加载裁决方法卡片与适用条件

## 使用流程

1. 读取方法路由：`governance/02_合同/judgment_method_routes.yaml`
2. 加载方法注册表：读取 `90_compat/methods/00_登记/`
3. 按判断类型匹配适用方法
4. 加载完整方法卡片（适用条件、输出门、下游解锁、边界交接）
5. 组装 LLM 上下文知识包（按 CONTEXT_SLOT_BUDGETS 限制大小）
6. 校验方法适用条件与必需角色
7. 方法应用绑定到判断单元

## 方法注册表字段

每个已注册方法含：
- `method_id` / `method_version` / `capability_type`（取证/裁决/表达）
- `applicable_judgment_types`
- `required_roles` / `optional_roles`
- `output_gates` / `downstream_unlocks` / `boundary_handoffs`
- `use_when`（适用条件）

## 核心约束

- **方法提供可复用做法，不替代具体判断**
- 方法卡片描述适用条件与质量门，实际参数由研究员决定
- 知识包必须适配 LLM 上下文窗口

## 知识库引用（不复制，直接读取）

| 需要什么 | 读取位置 |
|---------|---------|
| 方法ID登记 | `90_compat/methods/00_登记/` |
| 通用分析框架（15类） | `90_compat/methods/02_研究框架/基础/` |
| 半导体框架与场景卡 | `90_compat/methods/02_研究框架/行业/` |
| 取证方法正文 | `90_compat/methods/03_取证/A01—A09/` |
| 裁决方法正文 | `90_compat/methods/04_裁决/A00—A10/` |
| 方法路由 | `governance/02_合同/judgment_method_routes.yaml` |
| 方法应用合同 | `governance/02_合同/method_application_contract.yaml` |
| 实现代码 | `07_07_runtime/skills/method_selection/` |
