---
name: shared
description: >
  跨阶段共享能力。提供高质量门禁公共逻辑、HQ返工机制、
  以及各阶段 LLM 提示词模板，被五个阶段 agent 共同引用。
skills: [model-client]
---

# Shared 共享能力

## 职责概述

为五个阶段 agent 提供不绑定特定阶段的公共能力。

## 组成文件

| 文件 | 职责 |
|------|------|
| `high_quality_gate.ts` | 各阶段 high_quality_pass 共用启发式：占位句检测、正文密度检查、deterministic_check_status 核验、降档逻辑 |
| `hq_retry.ts` | HQ 失败后的受控返工：记录返工原因、保留返工前快照、限制最大返工次数 |
| `prompts_source.ts` | 各阶段 LLM 系统提示词模板：共享纪律段落 + 按阶段分叉的详细指令 |

## 高质量门禁共用规则（对齐 00A）

`high_quality_gate.ts` 提供所有阶段调用的公共函数：

- `nonEmptyText` — 空值/占位符检测
- `requireDeterministicChecked` — deterministic_check_status 必须为 checked
- `looksLikePlaceholder` — 检测占位句（如"待补充""TBD"等）
- `bodyMeetsMinDensity` — 正文密度达标检查
- `applyHighQualityGate` — 收集 issues 并按 severity 过滤
- `downgradeIfHighQualityFails` — HQ 失败时降档到 minimum_pass + 记录原因

minimum_pass 只要求可流转；high_quality_pass 额外要求实质密度与 deterministic_check_status=checked。

## 可用 Skills

| Skill | 用途 |
|-------|------|
| `model-client` | 模型提供者解析（DeepSeek / OpenAI Compatible） |

## 读取的参考文件

| 文件 | 用途 |
|------|------|
| `05_governance/03_校验/00A_高质量产出判别标准.md` | 高质量判别标准（00A） |
| `05_governance/02_合同/runtime_supported_profile.yaml` | 运行时支持配置 |

## 空目录说明

以下目录当前为空，预留给后续实现：

| 目录 | 预留给 |
|------|--------|
| `baseline/` | 基线对比 agent：对比多次运行的判断差异 |
| `controller/` | 流程控制器：编排五阶段的执行顺序与返工调度 |
| `reviewer/` | 独立审查 agent：人类确认前的自动语义审查（当前审查逻辑在 skills/semantic_review 中） |
