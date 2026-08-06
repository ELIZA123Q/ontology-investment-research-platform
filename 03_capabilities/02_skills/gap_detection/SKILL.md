---
name: gap-detection
description: >
  证据缺口检测与补充技能集。分析证据覆盖缺口、
  规划补充采集、候选来源获取、缺口补充diff与视图。
metadata:
  category: gap_detection
  stage: "03"
  short-description: 证据缺口分析、补充规划与候选采集
---

# 缺口检测与补充技能集

## 触发条件

- Stage03 证据准备中发现覆盖不足
- 需要补充采集缺失的证据方向
- 需要分析证据缺口并规划补充策略
- 关键词：缺口、补充、覆盖不足、候选来源、diff

## 核心原则

**缺口是正常的研究状态，不需要填满所有格子。** 关键是把缺口说清楚，让 Stage04 在边界内做出合格判断。

## 组成文件

| 文件 | 职责 |
|------|------|
| `gap_analyzer.ts` | 缺口分析主逻辑：对比证据需求 vs 现有证据草稿，识别支持/反证/上下文缺口，计算补充优先级 |
| `acquisition_planning.ts` | 补充采集规划：按缺口优先级生成采集计划，估算采集成本 |
| `candidate_acquisition.ts` | 候选来源获取：预采集候选来源、冻结候选草稿 |
| `source_routes.ts` | 来源路由：根据取证画像推荐最佳获取通道 |
| `supplement_pure.ts` | 纯补充逻辑：去重、指纹、优先级排序 |
| `supplement_diff.ts` | 补充 diff：对比补充前后的证据覆盖变化 |
| `supplement_view.ts` | 补充视图：补充结果的可视化展示 |

## 使用流程

1. 从 `evidence_90_compat/evaluation/source_coverage.ts` 获取覆盖分析结果
2. 调用 `gap_analyzer` 识别具体缺口（按判断单元×证据角色）
3. 调用 `acquisition_planning` 生成补充计划（优先级、推荐通道）
4. 通过 `source_routes` 确定最佳获取通道
5. 执行补充采集（`candidate_acquisition`）
6. 通过 `supplement_diff` 对比补充效果
7. 决定是否继续补充（max 3 轮）

## 引用的参考文件

| 文件 | 用途 |
|------|------|
| `90_compat/methods/03_取证/B01_通用来源速查.md` | 来源选择 |
| `90_compat/methods/03_取证/B03_MCP通道注册.md` | MCP通道能力 |
| `90_compat/methods/03_取证/OPS_通用真实来源查询与回退手册.md` | Web回退路径 |
| `02_tasks/04_workflows/deep_research/stages/03_evidence.md` | 03阶段规范 |

## 输出规范

- 缺口记录含：判断单元、证据角色、缺失类型、推荐补充通道
- 补充计划含：优先级、预估采集成本、超时策略
- 补充结果含：新增来源数、缺口填补数、剩余缺口说明
