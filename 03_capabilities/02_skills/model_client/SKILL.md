---
name: model-client
description: >
  模型客户端技能集。解析模型提供者配置（DeepSeek / OpenAI Compatible）、
  管理各阶段模型选择、token预算与超时控制。
metadata:
  category: model_client
  short-description: LLM模型提供者配置与客户端管理
---

# 模型客户端技能集

## 触发条件

- 任何阶段需要调用 LLM 生成/裁决时
- 需要解析模型提供者配置
- 需要按阶段选择不同模型
- 关键词：模型、DeepSeek、OpenAI、provider、token

## 核心原则

**生产者与审查者使用不同模型配置。** 各阶段可按环境变量独立指定模型与 token 预算。

## 组成文件

| 文件 | 职责 |
|------|------|
| `model_provider.ts` | 模型提供者解析：从环境变量加载 DeepSeek / OpenAI Compatible 配置，支持按阶段独立指定模型、max_tokens、reasoning_effort |
| `deepseek_client.ts` | DeepSeek 客户端：完整的 LLM 调用封装，含 tool_use、streaming、重试与超时控制 |

## 模型角色

| 角色 | 用途 |
|------|------|
| `producer` | 生成角色：执行各阶段的产出生成 |
| `reviewer` | 审查角色：执行独立语义审查（不得与 producer 同模型） |

## 配置方式

通过环境变量按阶段覆盖：

```
DEEPSEEK_MODEL_STAGE_02=...
DEEPSEEK_MAX_TOKENS_STAGE_03=...
OPENAI_COMPAT_MODEL=...
```

默认使用 DeepSeek，可切换到 OpenAI Compatible。

## 使用流程

1. 确定当前阶段与模型角色（producer / reviewer）
2. 调用 `resolveModelProvider` 获取配置
3. 通过 `createResearchModelClient` 创建客户端
4. 调用 LLM 并处理结果

## 引用的参考文件

无外部参考文件。配置来自环境变量与 `05_governance/02_合同/runtime_supported_profile.yaml`。

## 输出规范

- 每次 LLM 调用记录：model、provider、input_tokens、output_tokens、finish_reason
- 超时策略：Stage 02/03/04 使用长跑租约（generationLeaseMs）
