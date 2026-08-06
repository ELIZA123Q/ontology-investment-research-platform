---
name: gap-detection
description: >-
  证据缺口分析与补充规划。对比证据需求vs现有证据草稿，识别支持/反证/
  上下文缺口，规划补充采集策略，推荐最佳获取通道，执行最多3轮补充。
  Use when user asks to "补充证据" "证据缺口" "覆盖不足"
  "补证" or mentions gap analysis, supplement.
allowed-tools: Read, Bash, WebFetch
---

# 缺口检测与补充

## 触发条件

- Stage03 证据准备中发现覆盖不足
- 需要补充采集缺失的证据方向
- 需要分析证据缺口并规划补充策略

## 使用流程

1. 从 `evidence-evaluation` skill 获取覆盖分析结果
2. 识别具体缺口（按判断单元 × 证据角色）
3. 生成补充计划（优先级、推荐通道）
4. 确定最佳获取通道
5. 执行补充采集
6. 对比补充效果（diff）
7. 决定是否继续补充（默认 max 1 轮补证，可配至 3 轮）

## 核心约束

- **缺口是正常的研究状态，不需要填满所有格子**
- 关键是把缺口说清楚，让 Stage04 在边界内做出合格判断
- 补证轮次上限：`STAGE03_SUPPLEMENT_MAX_ROUNDS`（默认 1）
- 自动补证轮次上限：`STAGE03_AUTO_SUPPLEMENT_MAX_ROUNDS`（默认 3）

## 知识库引用（不复制，直接读取）

| 需要什么 | 读取位置 |
|---------|---------|
| 来源选择 | `90_compat/methods/03_取证/B01_通用来源速查.md` |
| MCP通道能力 | `90_compat/methods/03_取证/B03_MCP通道注册.md` |
| Web回退路径 | `90_compat/methods/03_取证/OPS_通用真实来源查询与回退手册.md` |
| 03阶段规范 | `tasks/workflows/deep_research/stages/03_evidence.md` |
| 实现代码 | `07_07_runtime/skills/gap_detection/` |

## 输出规范

- 缺口记录含：判断单元、证据角色、缺失类型、推荐补充通道
- 补充计划含：优先级、预估采集成本、超时策略
- 补充结果含：新增来源数、缺口填补数、剩余缺口说明
