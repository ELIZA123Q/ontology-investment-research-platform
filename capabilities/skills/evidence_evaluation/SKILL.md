---
name: evidence-evaluation
description: >
  03证据评估技能集。来源采集与快照、证据质量门、最低质量检查、
  覆盖分析、来源权威性分级、证据上限计算。
metadata:
  category: evidence_evaluation
  stage: "03"
  short-description: 证据采集、快照、质量门与覆盖分析
---

# 证据评估技能集

## 触发条件

- 处理 Stage03 证据准备任务
- 需要获取、快照、核验来源材料
- 需要计算证据覆盖与最低质量门
- 关键词：来源采集、证据草稿、质量门、覆盖分析、快照

## 核心原则

**每条来源必须可追溯、可复现。** MCP、API 是获取通道，不是来源生产者。材料质量由上游来源决定。

## 组成文件

| 文件 | 职责 |
|------|------|
| `source_acquisition.ts` | 公开来源采集：URL → 快照 → 来源记录（content_hash, usability_status, retrieval_status） |
| `source_acquisition_input.ts` | 来源采集输入归一化（URL, title, publisher, source_tier, authority_type） |
| `source_snapshot.ts` | 来源快照捕获：网页抓取、内容哈希、可用性判定 |
| `snapshot_apply.ts` | 快照应用：将已捕获快照批量应用到来源记录 |
| `snapshot_layout_03.py` | Stage03 快照布局工具 |
| `source_coverage.ts` | 来源覆盖分析：独立来源组数、反证覆盖率、证据上限计算 |
| `quality_gate.ts` | 最低质量门：来源权威性分级、多样性分析、证据上限跨阶段检查 |
| `batch_isolation.ts` | 批量补丁隔离：分批处理大证据集时的上下文限制与数据范围控制 |
| `draft_normalize.ts` | 证据草稿归一化：未核验草稿降级、方法应用空值补齐 |
| `requirement_bindings.ts` | 证据需求绑定：将证据草稿绑定到 evidence_requirement_ids |
| `review_assist.ts` | 审查辅助：证据草稿逐条审阅支持 |
| `sources.ts` | 来源类型定义 |
| `profile_gaps.ts` | 取证画像缺口分析 |

## 使用流程

1. 从 Stage02 获取 `evidence_requirements`（证据需求投影）
2. 按 `evidence_recipe_ref` 确定取证配方
3. 调用 `acquirePublicSource` 获取来源 → 自动快照
4. 将来源事实转化为证据草稿
5. 执行 `quality_gate` 最低质量检查
6. 执行 `source_coverage` 覆盖分析
7. 缺口通过 `gap_detection` skill 触发补充

## 引用的参考文件

| 文件 | 用途 |
|------|------|
| `methods/03_取证/A01—A09/` | 证据质量评价方法 |
| `methods/03_取证/B00_来源选择与使用边界.md` | 来源准入原则 |
| `methods/03_取证/B01_通用来源速查.md` | 通用来源映射 |
| `runtime/workflow/stage_specs/03_证据/03_数据与证据准备规范.md` | 03阶段规范 |
| `runtime/workflow/stage_specs/03_证据/03_附录2_取数留痕与材料处理操作手册.md` | 取数留痕手册 |
| `governance/02_合同/ontology_data_mapping_profiles.yaml` | 数据映射配置 |

## 输出规范

- 来源记录含完整留痕：content_hash、retrieval_status、usability_status、quote_verified
- 证据草稿含 kind/directness/source_ids/direction/evidence_role
- 覆盖分析返回按判断单元的独立来源组数与证据上限
