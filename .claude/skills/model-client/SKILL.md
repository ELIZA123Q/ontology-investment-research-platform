---
name: model-client
description: >-
  LLM模型客户端配置。解析DeepSeek/OpenAI Compatible模型提供者，
  按阶段独立指定模型与token预算，管理producer/reviewer角色分离。
  Use when user asks to "切换模型" "模型配置" "token预算"
  or mentions model provider, DeepSeek, reasoning effort.
allowed-tools: Read
user-invocable: false
---

# 模型客户端

## 触发条件

- 任何阶段需要调用 LLM 生成/裁决时
- 需要解析模型提供者配置
- 需要按阶段选择不同模型

## 模型角色

| 角色 | 用途 | 约束 |
|------|------|------|
| `producer` | 执行各阶段的产出生成 | 默认 DeepSeek |
| `reviewer` | 执行独立语义审查 | 不得与 producer 同模型 |

## 配置方式

通过环境变量按阶段覆盖：
```
DEEPSEEK_MODEL_STAGE_02=...
DEEPSEEK_MAX_TOKENS_STAGE_03=...
OPENAI_COMPAT_MODEL=...
```

## 核心约束

- 生产者和审查者使用不同模型配置
- Stage 02/03/04 使用长跑租约（generationLeaseMs）
- Stage03 默认 max_tokens 上限 12k（双 JU patch 足够）

## 知识库引用（不复制，直接读取）

| 需要什么 | 读取位置 |
|---------|---------|
| 运行时支持配置 | `governance/02_合同/runtime_supported_profile.yaml` |
| 实现代码 | `07_07_runtime/skills/model_client/` |
