---
name: method-selection
description: >
  方法选择与知识加载技能集。加载判断方法注册表、
  提供方法卡片与适用指引、知识包组装、方法路由匹配。
metadata:
  category: method_selection
  stage: "02-04"
  short-description: 方法注册表加载、方法卡片与知识包组装
---

# 方法选择与知识加载技能集

## 触发条件

- Stage02 需要为判断单元分配取证/裁决方法
- Stage03 需要加载取证方法卡片与指引
- Stage04 需要加载裁决方法卡片与适用条件
- 关键词：方法注册、方法卡片、知识包、方法路由

## 核心原则

**方法提供可复用做法，不替代具体判断。** 方法卡片描述适用条件、输入输出与质量门，实际参数由研究员在上下文中决定。

## 组成文件

| 文件 | 职责 |
|------|------|
| `method_registry.ts` | 方法注册表加载：从 `90_compat/methods/00_登记/` 加载全部已注册方法，支持按判断类型路由 |
| `method_guidance.ts` | 方法指引：按方法ID加载完整方法卡片，含适用条件、输出门、下游解锁、边界交接 |
| `method_application.ts` | 方法应用：将方法绑定到判断单元，校验适用条件与必需角色 |
| `knowledge_package.ts` | 知识包组装：为 LLM 上下文组装方法卡片摘要与完整指引 |
| `knowledge_loader.ts` | 知识加载：按文件路径加载方法正文 |
| `knowledge_browser.ts` | 知识浏览：浏览可用方法目录 |
| `knowledge_dashboard.ts` | 知识仪表盘：当前研究的方法应用全景 |

## 方法注册表结构

每个已注册方法含：
- `method_id` / `method_version` / `capability_type`（取证/裁决/表达）
- `applicable_judgment_types`（适用判断类型）
- `required_roles` / `optional_roles`
- `output_gates`（输出门禁）
- `downstream_unlocks`（下游解锁）
- `boundary_handoffs`（边界交接）
- `use_when`（适用条件）

## 使用流程

1. 从 `judgment_method_routes.yaml` 获取方法路由
2. 调用 `loadMethodRegistry` 加载方法注册表
3. 按判断类型匹配适用方法（`defaultMethodIdsForJudgmentType`）
4. 调用 `loadSelectedMethodGuidance` 加载完整方法卡片
5. 通过 `knowledge_package` 组装 LLM 上下文
6. 方法应用绑定到判断单元

## 引用的参考文件

| 文件 | 用途 |
|------|------|
| `90_compat/methods/00_登记/` | 方法ID、版本和能力类型机器登记 |
| `90_compat/methods/02_研究框架/基础/` | 15类通用分析框架 |
| `90_compat/methods/02_研究框架/行业/` | 半导体主框架与场景卡 |
| `90_compat/methods/03_取证/A01—A09/` | 取证方法正文 |
| `90_compat/methods/04_裁决/A00—A10/` | 裁决方法正文 |
| `05_governance/02_合同/judgment_method_routes.yaml` | 方法路由 |
| `05_governance/02_合同/method_application_contract.yaml` | 方法应用合同 |

## 输出规范

- 方法卡片含完整适用条件与输出门
- 方法应用含 method_id、method_version、capability_type、绑定判断单元
- 知识包适合 LLM 上下文窗口（按 CONTEXT_SLOT_BUDGETS 限制）
